import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip17,
  nip19,
  SimplePool,
  type Event,
  type UnsignedEvent,
} from 'nostr-tools';
import { Platform } from 'react-native';
import type {
  LivingMarkMetadata,
  LivingMarkPlacement,
  LivingSpaceType,
  SchoolConsentMode,
  SchoolMinorDefaultPolicy,
} from '../types/living-spaces';
import { isAppBusy } from './app-activity';
import type { Milestone } from './storage';

const SECKEY = 'nostr_nsec';
const PUBKEY = 'nostr_npub';

export const DEFAULT_RELAY = 'wss://relay.beginningend.com';

// Fast public relays used alongside your sovereign relay for speed.
// Messages publish to ALL simultaneously — whichever arrives first wins.
export const FAST_RELAYS = [
  'wss://relay.beginningend.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

export const FAMILY_MILESTONE_KIND = 30078;
export const FAMILY_MEMBERSHIP_KIND = 30079;

const DM_LIVE_DEBUG = false;

function dmLiveLog(...args: unknown[]) {
  if (DM_LIVE_DEBUG) {
    console.log(...args);
  }
}

// ─── Key Management ───────────────────────────────────────────────

export async function generateAndStoreKeypair(): Promise<{ npub: string; nsec: string }> {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const nsec = nip19.nsecEncode(sk);
  const npub = nip19.npubEncode(pk);
  await SecureStore.setItemAsync(SECKEY, nsec);
  await SecureStore.setItemAsync(PUBKEY, npub);
  return { npub, nsec };
}

export async function importNsec(nsec: string): Promise<{ npub: string; nsec: string }> {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
  const sk = decoded.data as Uint8Array;
  const pk = getPublicKey(sk);
  const npub = nip19.npubEncode(pk);
  await SecureStore.setItemAsync(SECKEY, nsec);
  await SecureStore.setItemAsync(PUBKEY, npub);
  return { npub, nsec };
}

export async function getStoredIdentity() {
  try {
    if (Platform.OS === 'web') {
      return null;
    }

    const nsec =
      (await SecureStore.getItemAsync(SECKEY)) ||
      (await SecureStore.getItemAsync('nsec'));

    const npub =
      (await SecureStore.getItemAsync(PUBKEY)) ||
      (await SecureStore.getItemAsync('npub'));

    if (!npub || !nsec) return null;

    return { npub, nsec };
  } catch (err) {
    console.warn('getStoredIdentity failed', err);
    return null;
  }
}

export async function clearIdentity() {
  await SecureStore.deleteItemAsync(SECKEY);
  await SecureStore.deleteItemAsync(PUBKEY);
}

export function npubToHex(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') throw new Error('Invalid npub');
  return decoded.data as string;
}

// ─── DM Types ─────────────────────────────────────────────────────

export interface SendDMResult {
  success: boolean;
  threadPubkey?: string;
  eventIds?: string[];
  error?: string;
}

export interface NostrDMMessage {
  id: string;
  threadPubkey: string;
  senderPubkey: string;
  recipientPubkey: string;
  content: string;
  createdAt: number;
  isMine: boolean;
  rawEvent?: Event;
  rawInnerEvent?: any;
}

// ─── Send DM (multi-relay for speed) ──────────────────────────────

export async function sendNostrDM(input: {
  toPubkey: string;
  content: string;
  relayUrls?: string[];
  subject?: string;
  replyToEventId?: string;
}): Promise<SendDMResult> {
  try {
    const identity = await getStoredIdentity();
    if (!identity?.nsec) throw new Error('Missing nsec in SecureStore');

    const trimmed = input.content.trim();
    if (!trimmed) throw new Error('Cannot send an empty message');

    const decoded = nip19.decode(identity.nsec);
    if (decoded.type !== 'nsec') throw new Error('Stored nsec is invalid');

    const sk = decoded.data as Uint8Array;
    const myPubkey = getPublicKey(sk);

    const relayUrls =
      input.relayUrls && input.relayUrls.length > 0
        ? Array.from(new Set(input.relayUrls))
        : [DEFAULT_RELAY];

    const recipients = [
      { publicKey: input.toPubkey, relayUrl: relayUrls[0] },
      { publicKey: myPubkey, relayUrl: relayUrls[0] }, // self-copy for cross-device sync
    ];

    const recipient = recipients[0];

if (!recipient?.publicKey) {
  throw new Error('Missing recipient pubkey');
}

const wrappedEvent = nip17.wrapEvent(
  sk,
  recipient,
  trimmed,
  input.subject,
  input.replyToEventId ? { eventId: input.replyToEventId } : undefined
);

const wrappedEvents = [wrappedEvent];

console.log('[DM SEND] publishing wrapped DM');

    const pool = new SimplePool();

    // Publish each wrapped event to ALL relays simultaneously
    // Promise.any resolves as soon as ONE relay accepts it
    const publishResults = await Promise.all(
  wrappedEvents.map(async (evt) => {
    const pubs = pool.publish(relayUrls, evt);

    const results = await Promise.allSettled(pubs);

    const success = results.find(r => r.status === 'fulfilled');

    if (!success) {
      console.warn('[DM SEND] all relays rejected event:', evt.id);
      return null;
    }

    return evt.id;
  })
);

const successfulIds = publishResults.filter((id): id is string => typeof id === 'string');
console.log('[DM SEND] successful publishes:', successfulIds.length);

    return {
  success: successfulIds.length > 0,
  threadPubkey: input.toPubkey,
  eventIds: successfulIds,
};
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || 'Failed to send Nostr DM',
    };
  }
}

// ─── DM Receive Helpers ───────────────────────────────────────────

type RawRelayMessage = any[];

function getRelayLabel(relayUrl: string): string {
  return relayUrl.replace('wss://', '').replace('ws://', '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function yieldToUI(): Promise<void> {
  if (isAppBusy()) {
    await sleep(500);
    return;
  }

  await sleep(0);
}

function buildDMMessageFromGiftWrap(
  wrapped: Event,
  sk: Uint8Array,
  myPubkey: string,
  withPubkey?: string,
): NostrDMMessage | null {
  const inner = nip17.unwrapEvent(wrapped, sk);

if (!inner || inner.kind !== 14) {
  return null;
}

  const pTag = inner.tags.find((tag: string[]) => tag[0] === 'p');
  const recipientPubkey = pTag?.[1] || '';
  const otherPubkey = inner.pubkey === myPubkey ? recipientPubkey : inner.pubkey;

if (!otherPubkey) {
  return null;
}

if (withPubkey && otherPubkey !== withPubkey) {
  return null;
}

  return {
    id: inner.id,
    threadPubkey: otherPubkey,
    senderPubkey: inner.pubkey,
    recipientPubkey,
    content: inner.content,
    createdAt: inner.created_at,
    isMine: inner.pubkey === myPubkey,
    rawEvent: wrapped,
    rawInnerEvent: inner,
  };
}

// ─── Fetch DMs (manual WebSocket so AUTH/NOTICE are visible) ──────

export async function fetchNostrDMs(input?: {
  withPubkey?: string;
  relayUrls?: string[];
  limit?: number;
  timeoutMs?: number;
}): Promise<NostrDMMessage[]> {
  try {
    const identity = await getStoredIdentity();
    if (!identity?.nsec) throw new Error('Missing nsec in SecureStore');

    const decoded = nip19.decode(identity.nsec);
    if (decoded.type !== 'nsec') throw new Error('Stored nsec is invalid');

    const sk = decoded.data as Uint8Array;
    const myPubkey = getPublicKey(sk);

    const relayUrls = input?.relayUrls && input.relayUrls.length > 0
      ? input.relayUrls
      : FAST_RELAYS;

    const limit = input?.limit ?? 100;
    const timeoutMs = input?.timeoutMs ?? 5000;
    const seenGiftWraps = new Set<string>();
    const rawGiftWraps: Event[] = [];

    console.log('[DM FETCH] starting 1059 fetch:', {
      relays: relayUrls.length,
      limit,
      timeoutMs,
      withPubkey: input?.withPubkey?.slice(0, 16) || 'any',
    });

    await new Promise<void>((resolve) => {
      let settled = false;
      let finishedCount = 0;
      const sockets: WebSocket[] = [];

      const finishAll = () => {
        if (settled) return;

        settled = true;

        sockets.forEach((ws) => {
          try {
            ws.close();
          } catch {}
        });

        resolve();
      };

      const finishRelay = () => {
        finishedCount += 1;

        if (finishedCount >= relayUrls.length) {
          finishAll();
        }
      };

      const timeout = setTimeout(() => {
        console.log('[DM FETCH] timeout; closing sockets');
        finishAll();
      }, timeoutMs);

      const originalResolve = resolve;
      resolve = () => {
        clearTimeout(timeout);
        originalResolve();
      };

      relayUrls.forEach((relayUrl) => {
        const relayLabel = getRelayLabel(relayUrl);

        try {
          const ws = new WebSocket(relayUrl);
          sockets.push(ws);

          ws.onopen = () => {
            const subId = `dm-fetch-${Date.now()}-${Math.random().toString(16).slice(2)}`;

            ws.send(JSON.stringify([
              'REQ',
              subId,
              {
                kinds: [1059],
                '#p': [myPubkey],
                limit,
              },
            ]));
          };

          ws.onmessage = (msg) => {
            try {
              const data = JSON.parse(String(msg.data)) as RawRelayMessage;
              const type = data[0];

              if (type === 'AUTH') {
                console.warn(`[DM FETCH] ${relayLabel} requires NIP-42 AUTH`);
                return;
              }

              if (type === 'NOTICE') {
                console.warn(`[DM FETCH] ${relayLabel} NOTICE:`, data[1]);
                return;
              }

              if (type === 'CLOSED') {
                console.warn(`[DM FETCH] ${relayLabel} CLOSED:`, data[2]);
                finishRelay();
                return;
              }

              if (type === 'EOSE') {
                finishRelay();
                return;
              }

              if (type !== 'EVENT') return;

              const wrapped = data[2] as Event;

              if (!wrapped?.id) return;
              if (seenGiftWraps.has(wrapped.id)) return;

              seenGiftWraps.add(wrapped.id);
              rawGiftWraps.push(wrapped);
            } catch (error) {
              console.warn(`[DM FETCH] ${relayLabel} parse error:`, error);
            }
          };

ws.onerror = () => {
  console.warn(`[DM FETCH] ${relayLabel} websocket error`);
  finishRelay();
};

          ws.onclose = () => {};
        } catch (error) {
          console.warn(`[DM FETCH] ${relayLabel} setup error:`, error);
          finishRelay();
        }
      });
    });

    rawGiftWraps.sort((a, b) => a.created_at - b.created_at);

    console.log('[DM FETCH] raw gift wraps collected:', rawGiftWraps.length);

    const seenMessages = new Set<string>();
    const messages: NostrDMMessage[] = [];
    const chunkSize = 3;

    for (let i = 0; i < rawGiftWraps.length; i += chunkSize) {
      const chunk = rawGiftWraps.slice(i, i + chunkSize);

      for (const wrapped of chunk) {
        try {
          const message = buildDMMessageFromGiftWrap(
            wrapped,
            sk,
            myPubkey,
            input?.withPubkey,
          );

          if (!message) continue;
          if (seenMessages.has(message.id)) continue;

          seenMessages.add(message.id);
          messages.push(message);
        } catch (error) {
          console.warn('[DM FETCH] unwrap error:', error);
        }
      }

      await yieldToUI();
    }

    messages.sort((a, b) => a.createdAt - b.createdAt);

    console.log('[DM FETCH] complete; decrypted messages:', messages.length);

    return messages;
  } catch (e) {
    console.warn('[fetchNostrDMs] error:', e);
    return [];
  }
}

// ─── Subscribe to DMs (manual WebSocket so AUTH/NOTICE are visible) ─

export async function subscribeToNostrDMs(
  input: {
    withPubkey?: string;
    relayUrls?: string[];
    onMessage: (message: NostrDMMessage) => void;
  }
): Promise<() => void> {
  try {
    const identity = await getStoredIdentity();
    if (!identity?.nsec) throw new Error('Missing nsec');

    const decoded = nip19.decode(identity.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const myPubkey = getPublicKey(sk);

    const relayUrl = 'wss://relay.beginningend.com';

    const ws = new WebSocket(relayUrl);
    const seen = new Set<string>();

    ws.onopen = () => {
  dmLiveLog('[DM LIVE] connected');

  const authEvent = finalizeEvent({
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['relay', relayUrl],
      ['challenge', ''],
    ],
    content: '',
  }, sk);

  ws.send(JSON.stringify(['AUTH', authEvent]));
  dmLiveLog('[DM AUTH] proactive auth sent');

  // 🔥 WAIT before sending REQ
  setTimeout(() => {
    dmLiveLog('[DM LIVE] sending REQ after AUTH');

    ws.send(JSON.stringify([
  'REQ',
  'dm-sub',
  {
    kinds: [1059],
    limit: 50,
  }
]));
  }, 300); // <-- key
};

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);

        // 🔐 HANDLE AUTH
        if (data[0] === 'AUTH') {
          dmLiveLog('[DM AUTH] challenge received');

          const challenge = data[1];

          const authEvent = finalizeEvent({
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['relay', relayUrl],
              ['challenge', challenge],
            ],
            content: '',
          }, sk);

          ws.send(JSON.stringify(['AUTH', authEvent]));
          dmLiveLog('[DM AUTH] response sent');
          return;
        }

        // 📦 HANDLE EVENT
        if (data[0] === 'EVENT') {
          const wrapped = data[2];

const wrapPTag = wrapped.tags?.find((tag: string[]) => tag[0] === 'p');
const wrapRecipient = wrapPTag?.[1] || '';

if (wrapRecipient.toLowerCase() !== myPubkey.toLowerCase()) {
  return;
}

if (seen.has(wrapped.id)) return;
seen.add(wrapped.id);

dmLiveLog('[DM LIVE] wrapped event received for me');

          let inner: any = null;

try {
  inner = nip17.unwrapEvent(wrapped, sk);
} catch (e) {
  console.warn('[DM LIVE] unwrap failed, skipping:', e);
  return;
}
          if (!inner || inner.kind !== 14) return;

          const pTag = inner.tags.find((t: string[]) => t[0] === 'p');
          const recipientPubkey = pTag?.[1] || '';

          const otherPubkey =
            inner.pubkey === myPubkey
              ? recipientPubkey
              : inner.pubkey;

          if (!otherPubkey) return;
          if (input.withPubkey && otherPubkey !== input.withPubkey) return;

          input.onMessage({
            id: inner.id,
            threadPubkey: otherPubkey,
            senderPubkey: inner.pubkey,
            recipientPubkey,
            content: inner.content,
            createdAt: inner.created_at,
            isMine: inner.pubkey === myPubkey,
            rawEvent: wrapped,
            rawInnerEvent: inner,
          });
        }

        if (data[0] === 'EOSE') {
          dmLiveLog('[DM LIVE] EOSE');
        }

      } catch (e) {
        console.warn('[DM LIVE] parse error', e);
      }
    };

    return () => {
      try { ws.close(); } catch {}
    };

  } catch (e) {
    console.warn('[subscribeToNostrDMs] error:', e);
    return () => {};
  }
}

// ─── Nostr Profile (kind 0) ───────────────────────────────────────

export interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
}

export function fetchNostrProfile(npub: string): Promise<NostrProfile | null> {
  return new Promise(resolve => {
    try {
      const decoded = nip19.decode(npub);

      if (decoded.type !== 'npub') {
        resolve(null);
        return;
      }

      const pubkeyHex = decoded.data as string;
      const relaysToTry = [
        DEFAULT_RELAY,
        ...FAST_RELAYS,
        'wss://relay.nostr.band',
        'wss://relay.snort.social',
      ];

      let resolved = false;
      let completed = 0;

      const finishNullIfDone = () => {
        completed += 1;

        if (!resolved && completed >= relaysToTry.length) {
          resolved = true;
          resolve(null);
        }
      };

      relaysToTry.forEach(relayUrl => {
        try {
          const ws = new WebSocket(relayUrl);

          const timeout = setTimeout(() => {
            try { ws.close(); } catch {}
            finishNullIfDone();
          }, 3500);

          ws.onopen = () => {
            ws.send(JSON.stringify([
              'REQ',
              `profile-fetch-${pubkeyHex.slice(0, 8)}-${Date.now()}`,
              {
                kinds: [0],
                authors: [pubkeyHex],
                limit: 1,
              }
            ]));
          };

          ws.onmessage = (msg) => {
            try {
              const data = JSON.parse(msg.data);

              if (data[0] === 'EVENT' && data[2]?.kind === 0) {
                clearTimeout(timeout);

                if (!resolved) {
                  resolved = true;
                  try { ws.close(); } catch {}
                  resolve(JSON.parse(data[2].content) as NostrProfile);
                }
              } else if (data[0] === 'EOSE') {
                clearTimeout(timeout);
                try { ws.close(); } catch {}
                finishNullIfDone();
              }
            } catch {
              clearTimeout(timeout);
              try { ws.close(); } catch {}
              finishNullIfDone();
            }
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            try { ws.close(); } catch {}
            finishNullIfDone();
          };
        } catch {
          finishNullIfDone();
        }
      });
    } catch {
      resolve(null);
    }
  });
}

export async function publishProfile(
  profile: NostrProfile,
  nsec: string,
  relays: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const unsigned: UnsignedEvent = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(profile),
      pubkey: pk,
    };
    const signed = finalizeEvent(unsigned, sk);
    const results = await Promise.all(relays.map(r => publishToSpecificRelay(signed, r)));
    const anySuccess = results.some(r => r.success);
    return { success: anySuccess, error: anySuccess ? undefined : 'All relays failed' };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function publishProfileWithAmber(
  profile: NostrProfile,
  npub: string,
  relays: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const pubkeyHex = npubToHex(npub);

    const unsigned: UnsignedEvent = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(profile),
      pubkey: pubkeyHex,
    };

    const signed = await signWithAmber(JSON.stringify(unsigned), pubkeyHex);

    if (!signed) {
      return { success: false, error: 'Amber did not return a signed profile event.' };
    }

    const results = await Promise.all(relays.map(r => publishToSpecificRelay(signed, r)));
    const anySuccess = results.some(r => r.success);

    return {
      success: anySuccess,
      error: anySuccess ? undefined : 'All relays failed',
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Could not publish profile with Amber' };
  }
}

// ─── Relay List (kind 10002) ──────────────────────────────────────

export function fetchRelayList(npub: string): Promise<string[]> {
  return new Promise(resolve => {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') { resolve([DEFAULT_RELAY]); return; }
      const pubkeyHex = decoded.data as string;
      const ws = new WebSocket(DEFAULT_RELAY);
      const timeout = setTimeout(() => { ws.close(); resolve([DEFAULT_RELAY]); }, 6000);
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', 'relay-fetch', {
          kinds: [10002],
          authors: [pubkeyHex],
          limit: 1,
        }]));
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[2]?.kind === 10002) {
            clearTimeout(timeout);
            ws.close();
            const relays = (data[2].tags as string[][])
              .filter(t => t[0] === 'r')
              .map(t => t[1]);
            resolve(relays.length > 0 ? relays : [DEFAULT_RELAY]);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve([DEFAULT_RELAY]);
          }
        } catch { resolve([DEFAULT_RELAY]); }
      };
      ws.onerror = () => { clearTimeout(timeout); resolve([DEFAULT_RELAY]); };
    } catch { resolve([DEFAULT_RELAY]); }
  });
}

export async function publishRelayList(
  relays: string[],
  nsec: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const unsigned: UnsignedEvent = {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags: relays.map(r => ['r', r]),
      content: '',
      pubkey: pk,
    };
    const signed = finalizeEvent(unsigned, sk);
    return await publishToSpecificRelay(signed, DEFAULT_RELAY);
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Family Membership (kind 30079) ──────────────────────────────

export interface FamilyMembershipPayload {
  familyId: string;
  familyName?: string;
  memberNpub: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

export interface FamilyMemberRecord {
  familyId: string;
  familyName?: string;
  memberNpub: string;
  role: 'admin' | 'member';
  joinedAt: number;
  pubkey: string;
  created_at: number;
  eventId: string;
}

export async function publishFamilyMembership(
  membership: FamilyMembershipPayload,
  nsec: string,
  relays: string[]
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);

    const content = JSON.stringify({
      familyId: membership.familyId,
      familyName: membership.familyName || '',
      memberNpub: membership.memberNpub,
      role: membership.role,
      joinedAt: membership.joinedAt,
    });

    const tags: string[][] = [
  ['d', `${membership.familyId}:${membership.memberNpub}`],
  ['t', `family:${membership.familyId}`],
  ['p', npubToHex(membership.memberNpub)],
  ['client', 'bE-Marks'],
];

    const unsigned: UnsignedEvent = {
      kind: FAMILY_MEMBERSHIP_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const results = await Promise.all(relays.map(r => publishToSpecificRelay(signed, r)));
    const anySuccess = results.some(r => r.success);
    const successResult = results.find(r => r.success);

    return {
      success: anySuccess,
      eventId: successResult?.eventId,
      error: anySuccess ? undefined : 'All relays failed',
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function fetchFamilyMembers(
  familyId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<FamilyMemberRecord[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const events: FamilyMemberRecord[] = [];
      const seen = new Set<string>();
      const timeout = setTimeout(() => { ws.close(); resolve(events); }, 8000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `family-members-${familyId}`,
          {
            kinds: [FAMILY_MEMBERSHIP_KIND],
            '#t': [`family:${familyId}`],
            limit: 100,
          }
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[2]?.kind === FAMILY_MEMBERSHIP_KIND) {
            const evt = data[2];
            const parsed = JSON.parse(evt.content || '{}');
            const memberNpub = parsed.memberNpub;
            if (!memberNpub || seen.has(memberNpub)) return;
            seen.add(memberNpub);
            events.push({
              familyId: parsed.familyId,
              familyName: parsed.familyName,
              memberNpub,
              role: parsed.role === 'admin' ? 'admin' : 'member',
              joinedAt: parsed.joinedAt || evt.created_at,
              pubkey: evt.pubkey,
              created_at: evt.created_at,
              eventId: evt.id,
            });
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(events);
          }
        } catch {}
      };

      ws.onerror = () => { clearTimeout(timeout); resolve(events); };
    } catch { resolve([]); }
  });
}

// ─── Family Milestones (kind 30078) ──────────────────────────────

export async function publishFamilyMilestone(
  milestone: {
    id: string;
    note: string;
    tags: string[];
    photoUri?: string;
    videoUri?: string;
        audioUri?: string;
    media?: {
      id: string;
      uri: string;
      type: 'image' | 'video';
      source?: 'local' | 'cloud' | 'r2';
      thumbnailUri?: string;
    }[];
    reflections?: { text: string; createdAt: number; authorNpub?: string }[];
    createdAt: number;
    familyId: string;
    authorNpub: string;
    authorName?: string;
  },
  nsec: string,
  relays: string[]
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);

    const content = JSON.stringify({
  id: milestone.id,
  note: milestone.note,
  tags: milestone.tags,
  photoUri: milestone.photoUri,
  videoUri: milestone.videoUri,
  audioUri: milestone.audioUri,
  media: milestone.media ?? [],
  reflections: milestone.reflections ?? [],
  createdAt: milestone.createdAt,
  authorNpub: milestone.authorNpub,
  authorName: milestone.authorName,
});
    const eventTags: string[][] = [
      ['d', milestone.id],
      ['t', `family:${milestone.familyId}`],
      ['client', 'bE-Marks'],
    ];
    milestone.tags.forEach(t => eventTags.push(['t', t]));

    const unsigned: UnsignedEvent = {
      kind: FAMILY_MILESTONE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: eventTags,
      content,
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const results = await Promise.all(relays.map(r => publishToSpecificRelay(signed, r)));
    const anySuccess = results.some(r => r.success);
    const successResult = results.find(r => r.success);

    return {
      success: anySuccess,
      eventId: successResult?.eventId,
      error: anySuccess ? undefined : 'All relays failed',
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function fetchFamilyMilestones(
  familyId: string,
  since: number = 0,
  relayUrl: string = DEFAULT_RELAY
): Promise<any[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const events: any[] = [];
      const timeout = setTimeout(() => { ws.close(); resolve(events); }, 8000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          'family-fetch',
          {
            kinds: [FAMILY_MILESTONE_KIND],
            '#t': [`family:${familyId}`],
            since,
            limit: 100,
          }
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[2]?.kind === FAMILY_MILESTONE_KIND) {
            events.push(data[2]);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(events);
          }
        } catch {}
      };

      ws.onerror = () => { clearTimeout(timeout); resolve(events); };
    } catch { resolve([]); }
  });
}

// ─── Amber Signer (Android NIP-55) ────────────────────────────────

export async function signWithAmber(
  eventJson: string,
  currentUserPubkey?: string,
  signerPackageName?: string
): Promise<Event | null> {
  try {
    const unsignedEvent = JSON.parse(eventJson) as UnsignedEvent & { id?: string };
    const intentParams: Record<string, any> = {
      data: `nostrsigner:${eventJson}`,
      extra: {
        type: 'sign_event',
        id: unsignedEvent.id || `amber_sign_${Date.now()}`,
        ...(currentUserPubkey ? { current_user: currentUserPubkey } : {}),
      },
    };

    if (signerPackageName) {
      intentParams.packageName = signerPackageName;
    }

    const result = await IntentLauncher.startActivityAsync(
      'android.intent.action.VIEW',
      intentParams
    ) as any;

    const resultExtra = result?.extra ?? {};
    const signedEventJson =
      resultExtra.event ||
      resultExtra.result ||
      (typeof result?.data === 'string' ? result.data : '');

    if (!signedEventJson || typeof signedEventJson !== 'string') {
      console.warn('[Amber] sign_event returned no signed event:', result);
      return null;
    }

    const parsed = JSON.parse(signedEventJson) as Event;

    if (!parsed?.id || !parsed?.sig || !parsed?.pubkey) {
      console.warn('[Amber] sign_event returned invalid event:', parsed);
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn('[Amber] sign_event failed:', error);
    return null;
  }
}

export type AmberPublicKeyResult = {
  pubkey: string;
  packageName?: string;
};

export async function getPublicKeyFromAmber(): Promise<AmberPublicKeyResult | null> {
  try {
    const result = await IntentLauncher.startActivityAsync(
      'android.intent.action.VIEW',
      {
        data: 'nostrsigner:',
        extra: {
          type: 'get_public_key',
        },
      }
    ) as any;

    const resultExtra = result?.extra ?? {};
    const resultData = typeof result?.data === 'string' ? result.data : '';

    const pubkey =
      resultExtra.result ||
      resultExtra.pubkey ||
      resultExtra.publicKey;

    const packageName =
      resultExtra.package ||
      resultExtra.packageName;

    if (typeof pubkey === 'string' && pubkey.trim()) {
      return {
        pubkey: pubkey.trim(),
        packageName: typeof packageName === 'string' ? packageName : undefined,
      };
    }

    console.warn('[Amber] get_public_key returned no pubkey:', {
      resultCode: result?.resultCode,
      data: resultData,
      extra: resultExtra,
    });

    return null;
  } catch (error) {
    console.warn('[Amber] get_public_key intent failed:', error);
    return null;
  }
}

// ─── Event Building ───────────────────────────────────────────────

export interface MilestonePayload {
  note: string;
  tags: string[];
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}

export function buildMilestoneEvent(payload: MilestonePayload, pubkeyHex: string): UnsignedEvent {
  const tags: string[][] = payload.tags.map(t => ['t', t]);

  if (payload.imageUrl) {
    tags.push(['image', payload.imageUrl]);
    tags.push(['url', payload.imageUrl]);
    tags.push(['imeta', `url ${payload.imageUrl}`, 'mime image/jpeg']);
  }

  if (payload.videoUrl) {
    tags.push(['url', payload.videoUrl]);
    tags.push(['imeta', `url ${payload.videoUrl}`, 'mime video/mp4']);
  }

  if (payload.audioUrl) {
    tags.push(['url', payload.audioUrl]);
  }

  tags.push(['client', 'bE-Marks']);

  let content = payload.note;
  if (payload.imageUrl) content += `\n\n${payload.imageUrl}`;
  if (payload.videoUrl) content += `\n\n${payload.videoUrl}`;
  if (payload.audioUrl) content += `\n\n${payload.audioUrl}`;

  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
    pubkey: pubkeyHex,
  };
}

export async function signAndPublish(
  payload: MilestonePayload,
  nsec: string,
  relayUrls?: string[]
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const unsigned = buildMilestoneEvent(payload, pk);
    const signed = finalizeEvent(unsigned, sk);

    const publishRelays = Array.from(
      new Set(
        [
          ...(relayUrls && relayUrls.length > 0 ? relayUrls : []),
          ...FAST_RELAYS,
        ]
          .map(relayUrl => relayUrl.trim())
          .filter(relayUrl => relayUrl.startsWith('wss://') || relayUrl.startsWith('ws://'))
      )
    );

    const results = await Promise.all(
      publishRelays.map(r => publishToSpecificRelay(signed, r))
    );

    const success = results.find(r => r.success);

    return success ?? { success: false, error: 'All relays failed' };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Relay Publishing ─────────────────────────────────────────────

export function publishToRelay(
  event: Event
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return publishToSpecificRelay(event, DEFAULT_RELAY);
}

export function publishToSpecificRelay(
  event: Event,
  relayUrl: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return new Promise(resolve => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: 'Relay timeout' });
    }, 8000);
    ws.onopen = () => { ws.send(JSON.stringify(['EVENT', event])); };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] === 'OK' && data[1] === event.id) {
          clearTimeout(timeout);
          ws.close();
          resolve({ success: data[2] === true, eventId: event.id, error: data[3] });
        }
      } catch {}
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      resolve({ success: false, error: 'WebSocket error' });
    };
  });
}

export async function publishToSpecificRelays(
  event: Event,
  relayUrls: string[]
): Promise<{
  success: boolean;
  eventId?: string;
  successfulRelays: string[];
  failedRelays: { relayUrl: string; error?: string }[];
  error?: string;
}> {
  const uniqueRelayUrls = Array.from(
    new Set(
      relayUrls
        .map(relayUrl => relayUrl.trim())
        .filter(relayUrl => relayUrl.startsWith('wss://') || relayUrl.startsWith('ws://'))
    )
  );

  if (uniqueRelayUrls.length === 0) {
    return {
      success: false,
      successfulRelays: [],
      failedRelays: [],
      error: 'No valid relay URLs provided',
    };
  }

  const results = await Promise.all(
    uniqueRelayUrls.map(async relayUrl => {
      const result = await publishToSpecificRelay(event, relayUrl);

      return {
        relayUrl,
        ...result,
      };
    })
  );

  const successfulRelays = results
    .filter(result => result.success)
    .map(result => result.relayUrl);

  const failedRelays = results
    .filter(result => !result.success)
    .map(result => ({
      relayUrl: result.relayUrl,
      error: result.error,
    }));

  return {
    success: successfulRelays.length > 0,
    eventId: event.id,
    successfulRelays,
    failedRelays,
    error: successfulRelays.length > 0 ? undefined : 'All relays failed',
  };
}

// ─── Groups (kind 30080 / 30081) ─────────────────────────────────

export const GROUP_KIND = 30080;
export const GROUP_MEMBER_KIND = 30081;

export interface NostrGroupPayload {
  id: string;
  name: string;
  description?: string;
  season?: string;
  spaceType?: LivingSpaceType;
  spaceLabel?: string;
  schoolYearId?: string;
  seasonId?: string;
  parentSpaceId?: string;
  isSpace?: boolean;
  schoolConsentMode?: SchoolConsentMode;
  requiresGuardianConsent?: boolean;
  defaultMinorMarkPolicy?: SchoolMinorDefaultPolicy;
  directoryInfoAllowed?: boolean;
  consentNoticeVersion?: string;
  sport?: string;
  icon?: string;
  coverImage?: string;
  schoolId?: string;
  inviteCode: string;
  status: 'active' | 'archived';
  relayUrl: string;
  relayMode?: 'default' | 'custom' | 'both';
  backupRelayUrls?: string[];
  createdAt: number;
  ownerNpub: string;
  bookEnabled?: boolean;
  bookOfficerNpubs?: string[];
}

function isRemoteImageUrl(uri?: string): uri is string {
  return typeof uri === 'string' && /^https?:\/\//i.test(uri.trim());
}

export async function publishGroup(
  group: NostrGroupPayload,
  nsec: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);

    const normalizedInviteCode = group.inviteCode.toUpperCase();
    const coverImage = isRemoteImageUrl(group.coverImage) ? group.coverImage.trim() : undefined;

    const tags: string[][] = [
      ['d', group.id],
      ['name', group.name],
      ['t', `group-invite:${normalizedInviteCode}`],
      ['status', group.status],
      ['relay', group.relayUrl],
      ['client', 'bE-Marks'],
    ];

    if (group.season) tags.push(['season', group.season]);
    if (group.spaceType) tags.push(['space-type', group.spaceType]);
    if (group.schoolYearId) tags.push(['school-year', group.schoolYearId]);
    if (group.seasonId) tags.push(['season-id', group.seasonId]);
    if (group.parentSpaceId) tags.push(['parent-space', group.parentSpaceId]);
    if (group.isSpace) tags.push(['space', 'true']);
    if (group.schoolConsentMode) tags.push(['school-consent', group.schoolConsentMode]);
    if (group.requiresGuardianConsent) tags.push(['guardian-consent', 'required']);
    if (group.defaultMinorMarkPolicy) tags.push(['minor-policy', group.defaultMinorMarkPolicy]);
    if (group.directoryInfoAllowed) tags.push(['directory-info', 'allowed']);
    if (group.consentNoticeVersion) tags.push(['consent-notice', group.consentNoticeVersion]);
    if (group.sport) tags.push(['sport', group.sport]);
    if (group.icon) tags.push(['icon', group.icon]);
    if (coverImage) tags.push(['cover-image', coverImage]);
    if (group.schoolId) tags.push(['school', group.schoolId]);
    if (group.bookEnabled) tags.push(['book', 'enabled']);
    (group.backupRelayUrls ?? []).forEach(relayUrl => {
      tags.push(['backup-relay', relayUrl]);
    });

    const content = JSON.stringify({
      id: group.id,
      name: group.name,
      description: group.description,
      season: group.season,
      spaceType: group.spaceType,
      spaceLabel: group.spaceLabel,
      schoolYearId: group.schoolYearId,
      seasonId: group.seasonId,
      parentSpaceId: group.parentSpaceId,
      isSpace: group.isSpace === true,
      schoolConsentMode: group.schoolConsentMode,
      requiresGuardianConsent: group.requiresGuardianConsent === true,
      defaultMinorMarkPolicy: group.defaultMinorMarkPolicy,
      directoryInfoAllowed: group.directoryInfoAllowed === true,
      consentNoticeVersion: group.consentNoticeVersion,
      sport: group.sport,
      icon: group.icon,
      coverImage,
      schoolId: group.schoolId,
      inviteCode: group.inviteCode,
      status: group.status,
      relayUrl: group.relayUrl,
      relayMode: group.relayMode,
      backupRelayUrls: group.backupRelayUrls ?? [],
      createdAt: group.createdAt,
      ownerNpub: group.ownerNpub,
      bookEnabled: group.bookEnabled === true,
      bookOfficerNpubs: group.bookOfficerNpubs ?? [],
    });

    const unsigned: UnsignedEvent = {
      kind: GROUP_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);

    const relayUrls = Array.from(
      new Set([
        group.relayUrl,
        ...(group.backupRelayUrls ?? []),
      ].filter(Boolean))
    );

    const relayResult = await publishToSpecificRelays(signed, relayUrls);

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function fetchGroupByInviteCode(
  inviteCode: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupPayload | null> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const timeout = setTimeout(() => {
        console.log('[Groups] fetchGroupByInviteCode timeout');
        ws.close();
        resolve(null);
      }, 6000);

      ws.onopen = () => {
        const normalizedInviteCode = inviteCode.toUpperCase();


        const req = [
          'REQ',
          'group-invite-fetch',
          {
            kinds: [GROUP_KIND],
            '#t': [`group-invite:${normalizedInviteCode}`],
            limit: 1,
          }
        ];

        ws.send(JSON.stringify(req));
      };

      ws.onmessage = (msg) => {

        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_KIND) {
            clearTimeout(timeout);
            ws.close();
            const parsed = JSON.parse(data[2].content || '{}') as NostrGroupPayload;
            const coverImage = parsed.coverImage || data[2].tags?.find((tag: string[]) => tag[0] === 'cover-image')?.[1];
            console.log('[Groups] invite code matched group');
            resolve({ ...parsed, coverImage });
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            console.log('[Groups] fetchGroupByInviteCode got EOSE, no match');
            resolve(null);
          }
} catch {
  resolve(null);
}
      };

ws.onerror = () => {
  clearTimeout(timeout);
  console.log('[Groups] fetchGroupByInviteCode websocket error');
  resolve(null);
};
} catch {
  resolve(null);
}
  });
}

export function fetchGroupById(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupPayload | null> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(null);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-id-fetch-${groupId}`,
          {
            kinds: [GROUP_KIND],
            '#d': [groupId],
            limit: 1,
          }
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_KIND) {
            clearTimeout(timeout);
            ws.close();

            const parsed = JSON.parse(data[2].content || '{}') as NostrGroupPayload;
            const coverImage = parsed.coverImage || data[2].tags?.find((tag: string[]) => tag[0] === 'cover-image')?.[1];

            resolve({ ...parsed, coverImage });
          }

          if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };

    } catch {
      resolve(null);
    }
  });
}

export async function publishGroupMembership(input: {
  groupId: string;
  memberNpub: string;
  memberPubkeyHex: string;
  action: 'join' | 'leave' | 'remove';
  role?: 'owner' | 'admin' | 'member';
  displayName?: string;
  avatarUrl?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);

    const membershipRole =
      input.action === 'join'
        ? input.role ?? 'member'
        : 'removed';

    const tags: string[][] = [
      ['d', input.groupId],
      ['member', input.memberNpub],
      ['npub', input.memberNpub],
      ['group', input.groupId],
      ['p', input.memberPubkeyHex],
      ['role', membershipRole],
      ['action', input.action],
      ['client', 'bE-Marks'],
    ];

    if (input.displayName) tags.push(['name', input.displayName]);
    if (input.avatarUrl) tags.push(['picture', input.avatarUrl]);

    const unsigned: UnsignedEvent = {
      kind: GROUP_MEMBER_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify({
        action: input.action,
        groupId: input.groupId,
        memberNpub: input.memberNpub,
        role: membershipRole,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export const GROUP_MESSAGE_KIND = 30082;
export const GROUP_STICKY_KIND = 30083;
export const GROUP_CALENDAR_KIND = 30084;
export const GROUP_RSVP_KIND = 30085;
export const GROUP_CALENDAR_DELETE_KIND = 30086;
export const GROUP_MESSAGE_DELETE_KIND = 30087;
export const GROUP_MESSAGE_REACTION_KIND = 30088;
export const GROUP_MESSAGE_EDIT_KIND = 30089;
export const GROUP_POLL_VOTE_KIND = 30090;
export const GROUP_MARK_KIND = 30091;
export const GROUP_BOOK_ENTRY_KIND = 30092;

export type NostrGroupMediaType = 'image' | 'video' | 'file';

export type NostrGroupMarkPayload = {
  schemaVersion: 2;
  groupId: string;
  milestone: Milestone;
  metadata?: LivingMarkMetadata;
  placement?: LivingMarkPlacement;
  authorNpub?: string;
  updatedAt: number;
};

function getRemoteMediaUri(uri?: string): string | undefined {
  const trimmed = uri?.trim();

  if (!trimmed) return undefined;

  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function sanitizeMilestoneForGroupMarkSnapshot(milestone: Milestone): Milestone {
  const mediaItems = milestone.media ?? [];

  const remoteMedia = mediaItems
    .map(item => {
      const remoteUri = getRemoteMediaUri(item.uri);

      if (!remoteUri) return null;

      return {
        ...item,
        uri: remoteUri,
        thumbnailUri: getRemoteMediaUri(item.thumbnailUri),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    ...milestone,
    photoUri: getRemoteMediaUri(milestone.photoUri),
    videoUri: getRemoteMediaUri(milestone.videoUri),
    audioUri: getRemoteMediaUri(milestone.audioUri),
    media: remoteMedia,
  };
}

export async function publishGroupMark(input: {
  groupId: string;
  milestone: Milestone;
  metadata?: LivingMarkMetadata;
  placement?: LivingMarkPlacement;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    if (!input.milestone.authorNpub) {
      return { success: false, error: 'Space Mark snapshot missing author identity' };
    }

    const snapshotMilestone = sanitizeMilestoneForGroupMarkSnapshot(input.milestone);

    const payload: NostrGroupMarkPayload = {
      schemaVersion: 2,
      groupId: input.groupId,
      milestone: {
        ...snapshotMilestone,
        publishedToRelay: input.milestone.publishedToRelay === true,
      },
      metadata: input.metadata,
      placement: input.placement,
      authorNpub: input.milestone.authorNpub,
      updatedAt: now,
    };

    const tags: string[][] = [
      ['d', input.milestone.id],
      ['t', `group-mark:${input.groupId}`],
      ['group', input.groupId],
      ['client', 'bE-Marks'],
    ];

    const unsigned: UnsignedEvent = {
      kind: GROUP_MARK_KIND,
      created_at: now,
      tags,
      content: JSON.stringify(payload),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function fetchGroupMarks(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupMarkPayload[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const seen = new Set<string>();
      const byMarkId = new Map<string, NostrGroupMarkPayload>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(Array.from(byMarkId.values()).sort((a, b) => b.updatedAt - a.updatedAt));
      }, 5000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-mark-fetch-${groupId}`,
          {
            kinds: [GROUP_MARK_KIND],
            '#t': [`group-mark:${groupId}`],
            limit: 200,
          },
        ]));
      };

      ws.onmessage = msg => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_MARK_KIND) {
            const evt = data[2];
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}') as NostrGroupMarkPayload;
            if (parsed.schemaVersion !== 2) return;
            if (!parsed?.milestone?.id || parsed.groupId !== groupId) return;

            const existing = byMarkId.get(parsed.milestone.id);
            if (!existing || parsed.updatedAt > existing.updatedAt) {
              byMarkId.set(parsed.milestone.id, parsed);
            }
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(Array.from(byMarkId.values()).sort((a, b) => b.updatedAt - a.updatedAt));
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(Array.from(byMarkId.values()).sort((a, b) => b.updatedAt - a.updatedAt));
      };
    } catch {
      resolve([]);
    }
  });
}

export type NostrGroupMessageMedia = {
  id: string;
  uri: string;
  type: NostrGroupMediaType;
  thumbnailUrl?: string;
  fileName?: string;
  mimeType?: string;
};

export type NostrGroupPollOption = {
  id: string;
  text: string;
};

export type NostrGroupPollVote = {
  id: string;
  groupId: string;
  messageId: string;
  clientMessageId: string;
  optionId: string;
  voterPubkey: string;
  voterNpub?: string;
  voterName?: string;
  createdAt: number;
};

export type NostrGroupBookEntry = {
  id: string;
  groupId: string;
  type: 'income' | 'expense';
  amountCents: number;
  title: string;
  category?: string;
  description?: string;
  contributorName?: string;
  status: 'pending' | 'confirmed';
  createdAt: number;
  createdByPubkey: string;
  createdByNpub?: string;
  createdByName?: string;
  relayUrl?: string;
  nostrEventId?: string;
};

export type NostrGroupPoll = {
  id: string;
  question: string;
  options: NostrGroupPollOption[];
};

export interface NostrGroupMessage {
  id: string;
  clientMessageId?: string;
  groupId: string;
  senderPubkey: string;
  senderNpub?: string;
  senderName?: string;
  text?: string;
  kind?: 'message' | 'system';
  systemType?: 'join' | 'leave' | 'remove';

  // Reply metadata
  replyToMessageId?: string;
  replyToClientMessageId?: string;
  replyPreviewText?: string;
  replyPreviewSenderName?: string;

  // New multi-attachment shape
  media?: NostrGroupMessageMedia[];

  // Poll metadata
  poll?: NostrGroupPoll;

  // Legacy single media shape
  mediaUrl?: string;
  mediaType?: NostrGroupMediaType;
  thumbnailUrl?: string;

  // old fallback
  imageUrl?: string;

  createdAt: number;
}

export interface NostrGroupMessageDelete {
  id: string;
  groupId: string;
  messageId: string;
  clientMessageId?: string;
  deletedAt: number;
  deletedByPubkey: string;
  deletedByNpub?: string;
}

export interface NostrGroupMessageReaction {
  id: string;
  groupId: string;
  messageId: string;
  clientMessageId: string;
  reaction: string;
  reactorPubkey: string;
  reactorNpub?: string;
  reactorName?: string;
  createdAt: number;
}

export interface NostrGroupMessageEdit {
  id: string;
  groupId: string;
  messageId: string;
  clientMessageId: string;
  text: string;
  editedAt: number;
  editedByPubkey: string;
  editedByNpub?: string;
}

function normalizeGroupMessageMedia(input: {
  media?: NostrGroupMessageMedia[];
  mediaUrl?: string;
  mediaType?: NostrGroupMediaType;
  thumbnailUrl?: string;
  imageUrl?: string;
}): NostrGroupMessageMedia[] {
  if (Array.isArray(input.media) && input.media.length > 0) {
    return input.media
      .filter(item => !!item.uri)
      .map((item, index) => ({
        id: item.id || `media_${Date.now()}_${index}`,
        uri: item.uri,
        type: item.type,
        thumbnailUrl: item.thumbnailUrl,
        fileName: item.fileName,
        mimeType: item.mimeType,
      }));
  }

  const legacyUri = input.mediaUrl || input.imageUrl;

  if (!legacyUri) return [];

  return [
    {
      id: `legacy_media_${legacyUri}`,
      uri: legacyUri,
      type: input.mediaType || (input.imageUrl ? 'image' : 'image'),
      thumbnailUrl: input.thumbnailUrl,
    },
  ];
}

function normalizeNostrGroupPoll(input?: {
  id?: string;
  question?: string;
  options?: { id?: string; text?: string }[];
}): NostrGroupPoll | undefined {
  const question = input?.question?.trim();

  if (!question) return undefined;

  const options = Array.isArray(input?.options)
    ? input.options
        .map((option, index) => ({
          id: option.id || `poll_option_${index + 1}`,
          text: option.text?.trim() || '',
        }))
        .filter(option => !!option.text)
    : [];

  if (options.length < 2) return undefined;

  return {
    id: input?.id || `poll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    question,
    options,
  };
}

export async function publishGroupMessage(input: {
  groupId: string;
  clientMessageId?: string;
  text?: string;
  kind?: 'message' | 'system';
  systemType?: 'join' | 'leave' | 'remove';

  // Reply metadata
  replyToMessageId?: string;
  replyToClientMessageId?: string;
  replyPreviewText?: string;
  replyPreviewSenderName?: string;

  // New multi-attachment support
  media?: NostrGroupMessageMedia[];

  // Poll support
  poll?: NostrGroupPoll;

  // Legacy single media support
  mediaUrl?: string;
  mediaType?: NostrGroupMediaType;
  thumbnailUrl?: string;

  // old support
  imageUrl?: string;

  senderNpub?: string;
  senderName?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const trimmedText = input.text?.trim() || '';
    const media = normalizeGroupMessageMedia(input);
    const primaryMedia = media[0];
    const poll = normalizeNostrGroupPoll(input.poll);

    const mediaUrl = input.mediaUrl || input.imageUrl || primaryMedia?.uri;
    const mediaType =
      input.mediaType ||
      primaryMedia?.type ||
      (input.imageUrl ? 'image' : undefined);

    if (!trimmedText && media.length === 0 && !mediaUrl && !poll) {
      throw new Error('Cannot publish an empty group message');
    }

    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);
    const clientMessageId =
      input.clientMessageId ||
      `client_msg_${input.groupId}_${now}_${Math.random().toString(36).slice(2, 10)}`;

    const tags: string[][] = [
      ['d', clientMessageId],
      ['t', `group-msg:${input.groupId}`],
      ['group', input.groupId],
      ['clientMessageId', clientMessageId],
      ['client', 'bE-Marks'],
    ];

    if (poll) {
      tags.push(['poll', poll.id]);
    }

    if (input.replyToClientMessageId) {
      tags.push(['replyToClientMessageId', input.replyToClientMessageId]);
    }

    if (input.replyToMessageId) {
      tags.push(['replyToMessageId', input.replyToMessageId]);
    }

    for (const item of media) {
      tags.push(['url', item.uri]);

      if (item.type === 'image') {
        tags.push(['image', item.uri]);
        tags.push(['imeta', `url ${item.uri}`, 'mime image/jpeg']);
      }

      if (item.type === 'video') {
        tags.push(['video', item.uri]);
        tags.push(['imeta', `url ${item.uri}`, 'mime video/mp4']);
      }

      if (item.type === 'file') {
        tags.push(['file', item.uri]);

        if (item.mimeType) {
          tags.push(['imeta', `url ${item.uri}`, `mime ${item.mimeType}`]);
        }
      }
    }

    const content = JSON.stringify({
      groupId: input.groupId,
      clientMessageId,
      text: trimmedText || undefined,
      kind: input.kind || 'message',
      systemType: input.systemType,

      replyToMessageId: input.replyToMessageId,
      replyToClientMessageId: input.replyToClientMessageId,
      replyPreviewText: input.replyPreviewText,
      replyPreviewSenderName: input.replyPreviewSenderName,

      media,
      poll,

      // legacy single media fields preserved for older app versions
      mediaUrl,
      mediaType,
      thumbnailUrl: input.thumbnailUrl || primaryMedia?.thumbnailUrl,
      imageUrl: mediaType === 'image' ? mediaUrl : undefined,

      senderNpub: input.senderNpub,
      senderName: input.senderName,
      createdAt: now,
    });

    const unsigned: UnsignedEvent = {
      kind: GROUP_MESSAGE_KIND,
      created_at: now,
      tags,
      content,
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function publishGroupMessageWithAmber(input: {
  groupId: string;
  clientMessageId?: string;
  text?: string;
  kind?: 'message' | 'system';
  systemType?: 'join' | 'leave' | 'remove';

  // Reply metadata
  replyToMessageId?: string;
  replyToClientMessageId?: string;
  replyPreviewText?: string;
  replyPreviewSenderName?: string;

  // New multi-attachment support
  media?: NostrGroupMessageMedia[];

  // Poll support
  poll?: NostrGroupPoll;

  // Legacy single media support
  mediaUrl?: string;
  mediaType?: NostrGroupMediaType;
  thumbnailUrl?: string;

  // old support
  imageUrl?: string;

  senderNpub: string;
  senderName?: string;
  relayUrl: string;
  relayUrls?: string[];
  signerPackageName?: string;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const trimmedText = input.text?.trim() || '';
    const media = normalizeGroupMessageMedia(input);
    const primaryMedia = media[0];
    const poll = normalizeNostrGroupPoll(input.poll);

    const mediaUrl = input.mediaUrl || input.imageUrl || primaryMedia?.uri;
    const mediaType =
      input.mediaType ||
      primaryMedia?.type ||
      (input.imageUrl ? 'image' : undefined);

    if (!trimmedText && media.length === 0 && !mediaUrl && !poll) {
      throw new Error('Cannot publish an empty group message');
    }

    const pubkeyHex = npubToHex(input.senderNpub);
    const now = Math.floor(Date.now() / 1000);
    const clientMessageId =
      input.clientMessageId ||
      `client_msg_${input.groupId}_${now}_${Math.random().toString(36).slice(2, 10)}`;

    const tags: string[][] = [
      ['d', clientMessageId],
      ['t', `group-msg:${input.groupId}`],
      ['group', input.groupId],
      ['clientMessageId', clientMessageId],
      ['client', 'bE-Marks'],
    ];

    if (poll) {
      tags.push(['poll', poll.id]);
    }

    if (input.replyToClientMessageId) {
      tags.push(['replyToClientMessageId', input.replyToClientMessageId]);
    }

    if (input.replyToMessageId) {
      tags.push(['replyToMessageId', input.replyToMessageId]);
    }

    for (const item of media) {
      tags.push(['url', item.uri]);

      if (item.type === 'image') {
        tags.push(['image', item.uri]);
        tags.push(['imeta', `url ${item.uri}`, 'mime image/jpeg']);
      }

      if (item.type === 'video') {
        tags.push(['video', item.uri]);
        tags.push(['imeta', `url ${item.uri}`, 'mime video/mp4']);
      }

      if (item.type === 'file') {
        tags.push(['file', item.uri]);

        if (item.mimeType) {
          tags.push(['imeta', `url ${item.uri}`, `mime ${item.mimeType}`]);
        }
      }
    }

    const content = JSON.stringify({
      groupId: input.groupId,
      clientMessageId,
      text: trimmedText || undefined,
      kind: input.kind || 'message',
      systemType: input.systemType,

      replyToMessageId: input.replyToMessageId,
      replyToClientMessageId: input.replyToClientMessageId,
      replyPreviewText: input.replyPreviewText,
      replyPreviewSenderName: input.replyPreviewSenderName,

      media,
      poll,

      // legacy single media fields preserved for older app versions
      mediaUrl,
      mediaType,
      thumbnailUrl: input.thumbnailUrl || primaryMedia?.thumbnailUrl,
      imageUrl: mediaType === 'image' ? mediaUrl : undefined,

      senderNpub: input.senderNpub,
      senderName: input.senderName,
      createdAt: now,
    });

    const unsigned: UnsignedEvent = {
      kind: GROUP_MESSAGE_KIND,
      created_at: now,
      tags,
      content,
      pubkey: pubkeyHex,
    };

    const signed = await signWithAmber(
      JSON.stringify(unsigned),
      pubkeyHex,
      input.signerPackageName
    );

    if (!signed) {
      return {
        success: false,
        error: 'Amber did not return a signed group message event.',
      };
    }

    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Could not publish group message with Amber' };
  }
}

export async function publishGroupMessageDelete(input: {
  groupId: string;
  messageId: string;
  clientMessageId?: string;
  deletedByNpub?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);
    const deleteTargetId = input.clientMessageId || input.messageId;

    const tags: string[][] = [
      ['d', deleteTargetId],
      ['t', `group-msg-delete:${input.groupId}`],
      ['group', input.groupId],
      ['message', input.messageId],
      ['clientMessageId', deleteTargetId],
      ['client', 'bE-Marks'],
    ];

    const unsigned: UnsignedEvent = {
      kind: GROUP_MESSAGE_DELETE_KIND,
      created_at: now,
      tags,
      content: JSON.stringify({
        groupId: input.groupId,
        messageId: input.messageId,
        clientMessageId: deleteTargetId,
        deletedAt: now,
        deletedByNpub: input.deletedByNpub,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function publishGroupMessageReaction(input: {
  groupId: string;
  messageId: string;
  clientMessageId: string;
  reaction: string;
  reactorNpub?: string;
  reactorName?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const reaction = input.reaction.trim();

    if (!reaction) {
      throw new Error('Cannot publish an empty reaction');
    }

    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const reactionId = `reaction_${input.clientMessageId}_${input.reactorNpub || pk}_${reaction}`;

    const tags: string[][] = [
      ['d', reactionId],
      ['t', `group-msg-reaction:${input.groupId}`],
      ['group', input.groupId],
      ['message', input.messageId],
      ['clientMessageId', input.clientMessageId],
      ['reaction', reaction],
      ['client', 'bE-Marks'],
    ];

    const unsigned: UnsignedEvent = {
      kind: GROUP_MESSAGE_REACTION_KIND,
      created_at: now,
      tags,
      content: JSON.stringify({
        groupId: input.groupId,
        messageId: input.messageId,
        clientMessageId: input.clientMessageId,
        reaction,
        reactorNpub: input.reactorNpub,
        reactorName: input.reactorName,
        createdAt: now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function publishGroupMessageEdit(input: {
  groupId: string;
  messageId: string;
  clientMessageId: string;
  text: string;
  editedByNpub?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const trimmedText = input.text.trim();

    if (!trimmedText) {
      throw new Error('Cannot publish an empty group message edit');
    }

    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const editId = `edit_${input.clientMessageId}_${now}`;

    const tags: string[][] = [
      ['d', editId],
      ['t', `group-msg-edit:${input.groupId}`],
      ['group', input.groupId],
      ['message', input.messageId],
      ['clientMessageId', input.clientMessageId],
      ['client', 'bE-Marks'],
    ];

    const unsigned: UnsignedEvent = {
      kind: GROUP_MESSAGE_EDIT_KIND,
      created_at: now,
      tags,
      content: JSON.stringify({
        groupId: input.groupId,
        messageId: input.messageId,
        clientMessageId: input.clientMessageId,
        text: trimmedText,
        editedAt: now,
        editedByNpub: input.editedByNpub,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function publishGroupPollVote(input: {
  groupId: string;
  messageId: string;
  clientMessageId: string;
  optionId: string;
  voterNpub?: string;
  voterName?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const optionId = input.optionId.trim();

    if (!optionId) {
      throw new Error('Cannot publish a poll vote without an option.');
    }

    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const voteId = `poll_vote_${input.clientMessageId}_${input.voterNpub || pk}`;

    const tags: string[][] = [
      ['d', voteId],
      ['t', `group-poll-vote:${input.groupId}`],
      ['group', input.groupId],
      ['message', input.messageId],
      ['clientMessageId', input.clientMessageId],
      ['optionId', optionId],
      ['client', 'bE-Marks'],
    ];

    const unsigned: UnsignedEvent = {
      kind: GROUP_POLL_VOTE_KIND,
      created_at: now,
      tags,
      content: JSON.stringify({
        groupId: input.groupId,
        messageId: input.messageId,
        clientMessageId: input.clientMessageId,
        optionId,
        voterNpub: input.voterNpub,
        voterName: input.voterName,
        createdAt: now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function publishGroupSticky(input: {
  stickyId: string;
  groupId: string;
  title: string;
  body: string;
  media?: {
    id: string;
    uri: string;
    type: 'image' | 'video' | 'file';
    name?: string;
    thumbnailUri?: string;
  }[];
  displayMode?: 'pin' | 'announcement' | 'alert';
  priority?: 'normal' | 'high';
  expiresAt?: number;
  authorName?: string;
  authorNpub?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const displayMode = input.displayMode ?? 'pin';
    const priority = input.priority ?? 'normal';

    const tags: string[][] = [
      ['d', input.stickyId],
      ['t', `group-sticky:${input.groupId}`],
      ['group', input.groupId],
      ['display-mode', displayMode],
      ['priority', priority],
      ['client', 'bE-Marks'],
    ];

    if (typeof input.expiresAt === 'number') {
      tags.push(['expires-at', String(input.expiresAt)]);
    }

    for (const media of input.media ?? []) {
      tags.push(['url', media.uri]);

      if (media.type === 'image') {
        tags.push(['image', media.uri]);
        tags.push(['imeta', `url ${media.uri}`, 'mime image/jpeg']);
      }

      if (media.type === 'video') {
        tags.push(['video', media.uri]);
        tags.push(['imeta', `url ${media.uri}`, 'mime video/mp4']);
      }

      if (media.type === 'file') {
        tags.push(['file', media.uri]);
      }
    }

    const unsigned: UnsignedEvent = {
      kind: GROUP_STICKY_KIND,
      created_at: now,
      tags,
      content: JSON.stringify({
        id: input.stickyId,
        groupId: input.groupId,
        title: input.title,
        body: input.body,
        media: input.media ?? [],
        displayMode,
        priority,
        expiresAt: input.expiresAt,
        authorName: input.authorName,
        authorNpub: input.authorNpub,
        createdAt: now,
        updatedAt: now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function fetchGroupStickies(
  groupId: string,
  relayUrl: string,
): Promise<Event[]> {
  const pool = new SimplePool();

  try {
    const events = await pool.querySync([relayUrl], {
      kinds: [GROUP_STICKY_KIND],
      '#t': [`group-sticky:${groupId}`],
      limit: 100,
    });

    const seen = new Set<string>();

    return events.filter(event => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  } finally {
    pool.close([relayUrl]);
  }
}

export async function fetchGroupMemberships(
  groupId: string,
  relayUrls: string[],
): Promise<Event[]> {
  const pool = new SimplePool();

  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [GROUP_MEMBER_KIND],
      '#d': [groupId],
      limit: 500,
    });

    const seen = new Set<string>();

    return events.filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  } finally {
    pool.close(relayUrls);
  }
}

export async function fetchGroupMembershipsForPubkey(
  pubkeyHex: string,
  relayUrls: string[],
): Promise<Event[]> {
  const pool = new SimplePool();

  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [GROUP_MEMBER_KIND],
      '#p': [pubkeyHex],
      limit: 500,
    });

    const seen = new Set<string>();

    return events.filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  } finally {
    pool.close(relayUrls);
  }
}

export function fetchGroupMessages(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupMessage[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const events: NostrGroupMessage[] = [];
      const seen = new Set<string>();
      const timeout = setTimeout(() => {
        ws.close();
        resolve(events);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-msg-fetch-${groupId}`,
          {
            kinds: [GROUP_MESSAGE_KIND],
            '#t': [`group-msg:${groupId}`],
            limit: 200,
          }
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_MESSAGE_KIND) {
            const evt = data[2];
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || evt.id;

            const media = normalizeGroupMessageMedia({
              media: parsed.media,
              mediaUrl: parsed.mediaUrl,
              mediaType: parsed.mediaType,
              thumbnailUrl: parsed.thumbnailUrl,
              imageUrl: parsed.imageUrl,
            });

            const primaryMedia = media[0];
            const poll = normalizeNostrGroupPoll(parsed.poll);

            events.push({
              id: evt.id,
              clientMessageId,
              groupId: parsed.groupId || groupId,
              senderPubkey: evt.pubkey,
              senderNpub: parsed.senderNpub,
              senderName: parsed.senderName,
              text: parsed.text,
              kind: (parsed as any).kind,
              systemType: (parsed as any).systemType,

              replyToMessageId: parsed.replyToMessageId,
              replyToClientMessageId: parsed.replyToClientMessageId,
              replyPreviewText: parsed.replyPreviewText,
              replyPreviewSenderName: parsed.replyPreviewSenderName,

              media,
              poll,

              mediaUrl: parsed.mediaUrl || parsed.imageUrl || primaryMedia?.uri,
              mediaType:
                parsed.mediaType ||
                primaryMedia?.type ||
                (parsed.imageUrl ? 'image' : undefined),
              thumbnailUrl: parsed.thumbnailUrl || primaryMedia?.thumbnailUrl,
              imageUrl:
                parsed.imageUrl ||
                (primaryMedia?.type === 'image' ? primaryMedia.uri : undefined),

              createdAt: evt.created_at,
            });
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            events.sort((a, b) => a.createdAt - b.createdAt);
            resolve(events);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(events);
      };
    } catch {
      resolve([]);
    }
  });
}

export async function subscribeToGroupMessages(input: {
  groupId: string;
  relayUrl?: string;
  onMessage: (message: NostrGroupMessage) => void;
}): Promise<() => void> {
  try {
    const relayUrl = input.relayUrl ?? DEFAULT_RELAY;
    const pool = new SimplePool();
    const seen = new Set<string>();

    const sub = pool.subscribe(
      [relayUrl],
      {
        kinds: [GROUP_MESSAGE_KIND],
        '#t': [`group-msg:${input.groupId}`],
        since: Math.floor(Date.now() / 1000),
      },
      {
        onevent(evt) {
          try {
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || evt.id;

            const media = normalizeGroupMessageMedia({
              media: parsed.media,
              mediaUrl: parsed.mediaUrl,
              mediaType: parsed.mediaType,
              thumbnailUrl: parsed.thumbnailUrl,
              imageUrl: parsed.imageUrl,
            });

            const primaryMedia = media[0];
            const poll = normalizeNostrGroupPoll(parsed.poll);

            input.onMessage({
              id: evt.id,
              clientMessageId,
              groupId: parsed.groupId || input.groupId,
              senderPubkey: evt.pubkey,
              senderNpub: parsed.senderNpub,
              senderName: parsed.senderName,
              text: parsed.text,

              replyToMessageId: parsed.replyToMessageId,
              replyToClientMessageId: parsed.replyToClientMessageId,
              replyPreviewText: parsed.replyPreviewText,
              replyPreviewSenderName: parsed.replyPreviewSenderName,

              media,
              poll,

              mediaUrl: parsed.mediaUrl || parsed.imageUrl || primaryMedia?.uri,
              mediaType:
                parsed.mediaType ||
                primaryMedia?.type ||
                (parsed.imageUrl ? 'image' : undefined),
              thumbnailUrl: parsed.thumbnailUrl || primaryMedia?.thumbnailUrl,
              imageUrl:
                parsed.imageUrl ||
                (primaryMedia?.type === 'image' ? primaryMedia.uri : undefined),

              createdAt: evt.created_at,
            });
          } catch {}
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

export function fetchGroupMessageDeletes(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupMessageDelete[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const deletes: NostrGroupMessageDelete[] = [];
      const seen = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(deletes);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-msg-delete-fetch-${groupId}`,
          {
            kinds: [GROUP_MESSAGE_DELETE_KIND],
            '#t': [`group-msg-delete:${groupId}`],
            limit: 300,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_MESSAGE_DELETE_KIND) {
            const evt = data[2];

            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');
            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;

            if (parsed.groupId === groupId && messageId) {
              deletes.push({
                id: evt.id,
                groupId,
                messageId,
                clientMessageId,
                deletedAt: parsed.deletedAt || evt.created_at,
                deletedByPubkey: evt.pubkey,
                deletedByNpub: parsed.deletedByNpub,
              });
            }
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            deletes.sort((a, b) => a.deletedAt - b.deletedAt);
            resolve(deletes);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(deletes);
      };
    } catch {
      resolve([]);
    }
  });
}

export function fetchGroupMessageReactions(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupMessageReaction[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const reactions: NostrGroupMessageReaction[] = [];
      const seen = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(reactions);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-msg-reaction-fetch-${groupId}`,
          {
            kinds: [GROUP_MESSAGE_REACTION_KIND],
            '#t': [`group-msg-reaction:${groupId}`],
            limit: 500,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_MESSAGE_REACTION_KIND) {
            const evt = data[2];

            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');
            const reactionTag = evt.tags?.find((tag: string[]) => tag[0] === 'reaction');

            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;
            const reaction = parsed.reaction || reactionTag?.[1];

            if (parsed.groupId === groupId && messageId && clientMessageId && reaction) {
              reactions.push({
                id: evt.id,
                groupId,
                messageId,
                clientMessageId,
                reaction,
                reactorPubkey: evt.pubkey,
                reactorNpub: parsed.reactorNpub,
                reactorName: parsed.reactorName,
                createdAt: parsed.createdAt || evt.created_at,
              });
            }
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            reactions.sort((a, b) => a.createdAt - b.createdAt);
            resolve(reactions);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(reactions);
      };
    } catch {
      resolve([]);
    }
  });
}

export function fetchGroupMessageEdits(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupMessageEdit[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const edits: NostrGroupMessageEdit[] = [];
      const seen = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(edits);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-msg-edit-fetch-${groupId}`,
          {
            kinds: [GROUP_MESSAGE_EDIT_KIND],
            '#t': [`group-msg-edit:${groupId}`],
            limit: 500,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_MESSAGE_EDIT_KIND) {
            const evt = data[2];

            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');

            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;
            const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';

            if (parsed.groupId === groupId && messageId && clientMessageId && text) {
              edits.push({
                id: evt.id,
                groupId,
                messageId,
                clientMessageId,
                text,
                editedAt: parsed.editedAt || evt.created_at,
                editedByPubkey: evt.pubkey,
                editedByNpub: parsed.editedByNpub,
              });
            }
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            edits.sort((a, b) => a.editedAt - b.editedAt);
            resolve(edits);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(edits);
      };
    } catch {
      resolve([]);
    }
  });
}

export function fetchGroupPollVotes(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupPollVote[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const votes: NostrGroupPollVote[] = [];
      const seen = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(votes);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-poll-vote-fetch-${groupId}`,
          {
            kinds: [GROUP_POLL_VOTE_KIND],
            '#t': [`group-poll-vote:${groupId}`],
            limit: 1000,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_POLL_VOTE_KIND) {
            const evt = data[2];

            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');
            const optionIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'optionId');

            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;
            const optionId = parsed.optionId || optionIdTag?.[1];

            if (parsed.groupId === groupId && messageId && clientMessageId && optionId) {
              votes.push({
                id: evt.id,
                groupId,
                messageId,
                clientMessageId,
                optionId,
                voterPubkey: evt.pubkey,
                voterNpub: parsed.voterNpub,
                voterName: parsed.voterName,
                createdAt: parsed.createdAt || evt.created_at,
              });
            }
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            votes.sort((a, b) => a.createdAt - b.createdAt);
            resolve(votes);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(votes);
      };
    } catch {
      resolve([]);
    }
  });
}

export async function publishGroupBookEntry(input: {
  id: string;
  groupId: string;
  type: 'income' | 'expense';
  amountCents: number;
  title: string;
  category?: string;
  description?: string;
  contributorName?: string;
  status: 'pending' | 'confirmed';
  createdByNpub?: string;
  createdByName?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const tags: string[][] = [
      ['d', input.id],
      ['t', `group-book:${input.groupId}`],
      ['group', input.groupId],
      ['type', input.type],
      ['status', input.status],
      ['amount_cents', String(input.amountCents)],
      ['client', 'bE-Marks'],
    ];

    const unsigned: UnsignedEvent = {
      kind: GROUP_BOOK_ENTRY_KIND,
      created_at: now,
      tags,
      content: JSON.stringify({
        id: input.id,
        groupId: input.groupId,
        type: input.type,
        amountCents: input.amountCents,
        title: input.title,
        category: input.category,
        description: input.description,
        contributorName: input.contributorName,
        status: input.status,
        createdAt: now,
        createdByNpub: input.createdByNpub,
        createdByName: input.createdByName,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function fetchGroupBookEntries(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY
): Promise<NostrGroupBookEntry[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const entries: NostrGroupBookEntry[] = [];
      const seen = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(entries);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-book-fetch-${groupId}`,
          {
            kinds: [GROUP_BOOK_ENTRY_KIND],
            '#t': [`group-book:${groupId}`],
            limit: 1000,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_BOOK_ENTRY_KIND) {
            const evt = data[2];

            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const dTag = evt.tags?.find((tag: string[]) => tag[0] === 'd');
            const typeTag = evt.tags?.find((tag: string[]) => tag[0] === 'type');
            const statusTag = evt.tags?.find((tag: string[]) => tag[0] === 'status');
            const amountTag = evt.tags?.find((tag: string[]) => tag[0] === 'amount_cents');

            const entryGroupId = parsed.groupId || groupId;

            if (entryGroupId !== groupId) return;

            const amountCents = Number(parsed.amountCents ?? amountTag?.[1] ?? 0);
            const entryType = parsed.type || typeTag?.[1];
            const entryStatus = parsed.status || statusTag?.[1];

            if (entryType !== 'income' && entryType !== 'expense') return;
            if (entryStatus !== 'pending' && entryStatus !== 'confirmed') return;
            if (!Number.isFinite(amountCents) || amountCents <= 0) return;

            entries.push({
              id: parsed.id || dTag?.[1] || evt.id,
              groupId,
              type: entryType,
              amountCents,
              title: parsed.title || 'Book entry',
              category: parsed.category,
              description: parsed.description,
              contributorName: parsed.contributorName,
              status: entryStatus,
              createdAt: parsed.createdAt || evt.created_at,
              createdByPubkey: evt.pubkey,
              createdByNpub: parsed.createdByNpub,
              createdByName: parsed.createdByName,
              relayUrl,
              nostrEventId: evt.id,
            });
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            entries.sort((a, b) => b.createdAt - a.createdAt);
            resolve(entries);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(entries);
      };
    } catch {
      resolve([]);
    }
  });
}

export async function subscribeToGroupMessageDeletes(input: {
  groupId: string;
  relayUrl?: string;
  onDelete: (messageDelete: NostrGroupMessageDelete) => void;
}): Promise<() => void> {
  try {
    const relayUrl = input.relayUrl ?? DEFAULT_RELAY;
    const pool = new SimplePool();
    const seen = new Set<string>();

    const sub = pool.subscribe(
      [relayUrl],
      {
        kinds: [GROUP_MESSAGE_DELETE_KIND],
        '#t': [`group-msg-delete:${input.groupId}`],
        since: Math.floor(Date.now() / 1000),
      },
      {
        onevent(evt) {
          try {
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');

            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;

            if (parsed.groupId !== input.groupId || !messageId) return;

            input.onDelete({
              id: evt.id,
              groupId: input.groupId,
              messageId,
              clientMessageId,
              deletedAt: parsed.deletedAt || evt.created_at,
              deletedByPubkey: evt.pubkey,
              deletedByNpub: parsed.deletedByNpub,
            });
          } catch {}
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

export async function subscribeToGroupMessageReactions(input: {
  groupId: string;
  relayUrl?: string;
  onReaction: (messageReaction: NostrGroupMessageReaction) => void;
}): Promise<() => void> {
  try {
    const relayUrl = input.relayUrl ?? DEFAULT_RELAY;
    const pool = new SimplePool();
    const seen = new Set<string>();

    const sub = pool.subscribe(
      [relayUrl],
      {
        kinds: [GROUP_MESSAGE_REACTION_KIND],
        '#t': [`group-msg-reaction:${input.groupId}`],
        since: Math.floor(Date.now() / 1000),
      },
      {
        onevent(evt) {
          try {
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');
            const reactionTag = evt.tags?.find((tag: string[]) => tag[0] === 'reaction');

            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;
            const reaction = parsed.reaction || reactionTag?.[1];

            if (parsed.groupId !== input.groupId || !messageId || !clientMessageId || !reaction) {
              return;
            }

            input.onReaction({
              id: evt.id,
              groupId: input.groupId,
              messageId,
              clientMessageId,
              reaction,
              reactorPubkey: evt.pubkey,
              reactorNpub: parsed.reactorNpub,
              reactorName: parsed.reactorName,
              createdAt: parsed.createdAt || evt.created_at,
            });
          } catch {}
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

// ─── Group Calendar (kind 30084) ─────────────────────────────────────────────

export async function subscribeToGroupMessageEdits(input: {
  groupId: string;
  relayUrl?: string;
  onEdit: (messageEdit: NostrGroupMessageEdit) => void;
}): Promise<() => void> {
  try {
    const relayUrl = input.relayUrl ?? DEFAULT_RELAY;
    const pool = new SimplePool();
    const seen = new Set<string>();

    const sub = pool.subscribe(
      [relayUrl],
      {
        kinds: [GROUP_MESSAGE_EDIT_KIND],
        '#t': [`group-msg-edit:${input.groupId}`],
        since: Math.floor(Date.now() / 1000),
      },
      {
        onevent(evt) {
          try {
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');

            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;
            const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';

            if (parsed.groupId !== input.groupId || !messageId || !clientMessageId || !text) {
              return;
            }

            input.onEdit({
              id: evt.id,
              groupId: input.groupId,
              messageId,
              clientMessageId,
              text,
              editedAt: parsed.editedAt || evt.created_at,
              editedByPubkey: evt.pubkey,
              editedByNpub: parsed.editedByNpub,
            });
          } catch {}
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

export async function subscribeToGroupPollVotes(input: {
  groupId: string;
  relayUrl?: string;
  onVote: (pollVote: NostrGroupPollVote) => void;
}): Promise<() => void> {
  try {
    const relayUrl = input.relayUrl ?? DEFAULT_RELAY;
    const pool = new SimplePool();
    const seen = new Set<string>();

    const sub = pool.subscribe(
      [relayUrl],
      {
        kinds: [GROUP_POLL_VOTE_KIND],
        '#t': [`group-poll-vote:${input.groupId}`],
        since: Math.floor(Date.now() / 1000),
      },
      {
        onevent(evt) {
          try {
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');
            const messageTag = evt.tags?.find((tag: string[]) => tag[0] === 'message');
            const clientMessageIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'clientMessageId');
            const optionIdTag = evt.tags?.find((tag: string[]) => tag[0] === 'optionId');

            const messageId = parsed.messageId || messageTag?.[1];
            const clientMessageId = parsed.clientMessageId || clientMessageIdTag?.[1] || messageId;
            const optionId = parsed.optionId || optionIdTag?.[1];

            if (parsed.groupId !== input.groupId || !messageId || !clientMessageId || !optionId) {
              return;
            }

            input.onVote({
              id: evt.id,
              groupId: input.groupId,
              messageId,
              clientMessageId,
              optionId,
              voterPubkey: evt.pubkey,
              voterNpub: parsed.voterNpub,
              voterName: parsed.voterName,
              createdAt: parsed.createdAt || evt.created_at,
            });
          } catch {}
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

// ─── Group Calendar (kinds 30084 / 30085 / 30086) ────────────────────────────

export interface GroupCalendarEventRaw {
  id:           string;
  groupId:      string;
  title:        string;
  description?: string;
  location?:    string;
  eventType:    'timed' | 'allday';
  spaceEventType?: 'game' | 'practice' | 'meeting' | 'volunteer' | 'fundraiser' | 'banquet' | 'tournament' | 'deadline' | 'event' | 'other';
  opponent?: string;
  homeAway?: 'home' | 'away' | 'neutral';
  ourScore?: number;
  opponentScore?: number;
  result?: 'win' | 'loss' | 'tie';
  scoreFinal?: boolean;
  eventNotes?: string;
  legacyEligible?: boolean;
  invitedNpubs?: string[];
  startTime:    number;
  endTime?:     number;
  startDate?:   string;
  endDate?:     string;
  authorNpub?:  string;
  authorName?:  string;
  relayUrl?:     string;
  relayPublishedAt?: number;
  createdAt:    number;
  updatedAt:    number;
}

export interface GroupRSVPRaw {
  id: string;
  eventId: string;
  groupId: string;
  status: 'accepted' | 'declined' | 'tentative';
  note?: string;
  authorNpub?: string;
  displayName?: string;
  createdAt: number;
  updatedAt?: number;
}

function parseGroupCalendarEventRaw(
  evt: Event,
  groupId: string,
  relayUrl?: string
): GroupCalendarEventRaw | null {
  try {
    const parsed = JSON.parse(evt.content || '{}') as GroupCalendarEventRaw;
    if (!parsed.id || parsed.groupId !== groupId) return null;

    return {
      ...parsed,
      relayUrl,
      relayPublishedAt: typeof evt.created_at === 'number' ? evt.created_at : parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function publishGroupCalendarEvent(input: {
  eventId:      string;
  groupId:      string;
  title:        string;
  description?: string;
  location?:    string;
  eventType:    'timed' | 'allday';
  spaceEventType?: 'game' | 'practice' | 'meeting' | 'volunteer' | 'fundraiser' | 'banquet' | 'tournament' | 'deadline' | 'event' | 'other';
  opponent?: string;
  homeAway?: 'home' | 'away' | 'neutral';
  ourScore?: number;
  opponentScore?: number;
  result?: 'win' | 'loss' | 'tie';
  scoreFinal?: boolean;
  eventNotes?: string;
  legacyEligible?: boolean;
  invitedNpubs?: string[];
  startTime:    number;
  endTime?:     number;
  startDate?:   string;
  endDate?:     string;
  authorNpub?:  string;
  authorName?:  string;
  createdAt?:   number;
  updatedAt?:   number;
  nsec:         string;
  relayUrl:     string;
  relayUrls?:   string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk  = decoded.data as Uint8Array;
    const pk  = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const tags: string[][] = [
      ['d',      input.eventId],
      ['t',      `group-cal:${input.groupId}`],
      ['group',  input.groupId],
      ['title',  input.title],
      ['client', 'bE-Marks'],
    ];

    if (input.description) tags.push(['description', input.description]);
    if (input.location)    tags.push(['location',    input.location]);
    if (input.spaceEventType) tags.push(['space_event_type', input.spaceEventType]);
    if (input.opponent) tags.push(['opponent', input.opponent]);
    if (input.result) tags.push(['result', input.result]);
    input.invitedNpubs?.forEach(invitedNpub => {
      tags.push(['invitee', invitedNpub]);
    });

    if (input.eventType === 'allday' && input.startDate) {
      tags.push(['start', input.startDate]);
      if (input.endDate) tags.push(['end', input.endDate]);
    } else {
      tags.push(['start', String(input.startTime)]);
      if (input.endTime) tags.push(['end', String(input.endTime)]);
    }

    tags.push(['event_type', input.eventType]);

    const unsigned: UnsignedEvent = {
      kind:       GROUP_CALENDAR_KIND,
      created_at: now,
      tags,
      content: JSON.stringify({
        id:          input.eventId,
        groupId:     input.groupId,
        title:       input.title,
        description: input.description,
        location:    input.location,
        eventType:   input.eventType,
        spaceEventType: input.spaceEventType,
        opponent: input.opponent,
        homeAway: input.homeAway,
        ourScore: input.ourScore,
        opponentScore: input.opponentScore,
        result: input.result,
        scoreFinal: input.scoreFinal,
        eventNotes: input.eventNotes,
        legacyEligible: input.legacyEligible,
        invitedNpubs: input.invitedNpubs,
        startTime:   input.startTime,
        endTime:     input.endTime,
        startDate:   input.startDate,
        endDate:     input.endDate,
        authorNpub:  input.authorNpub,
        authorName:  input.authorName,
        createdAt:   input.createdAt ?? now,
        updatedAt:   input.updatedAt ?? now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

export function fetchGroupCalendarEvents(
  groupId:  string,
  relayUrl: string = DEFAULT_RELAY,
): Promise<GroupCalendarEventRaw[]> {
  return new Promise(resolve => {
    try {
      const ws     = new WebSocket(relayUrl);
      const events: GroupCalendarEventRaw[] = [];
      const seen   = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(events);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-cal-fetch-${groupId}`,
          {
            kinds: [GROUP_CALENDAR_KIND],
            '#t':  [`group-cal:${groupId}`],
            limit: 200,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_CALENDAR_KIND) {
            const evt = data[2];
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = parseGroupCalendarEventRaw(evt, groupId, relayUrl);
            if (parsed) events.push(parsed);

          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(events);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(events);
      };
    } catch {
      resolve([]);
    }
  });
}

export async function subscribeToGroupCalendarEvents(input: {
  groupId: string;
  relayUrl?: string;
  onEvent: (event: GroupCalendarEventRaw) => void;
}): Promise<() => void> {
  try {
    const relayUrl = input.relayUrl ?? DEFAULT_RELAY;
    const pool = new SimplePool();
    const seen = new Set<string>();

    const sub = pool.subscribe(
      [relayUrl],
      {
        kinds: [GROUP_CALENDAR_KIND],
        '#t': [`group-cal:${input.groupId}`],
        since: Math.floor(Date.now() / 1000),
      },
      {
        onevent(evt) {
          if (seen.has(evt.id)) return;
          seen.add(evt.id);

          const parsed = parseGroupCalendarEventRaw(evt, input.groupId, relayUrl);
          if (parsed) input.onEvent(parsed);
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

export async function publishGroupRSVP(input: {
  rsvpId:      string;
  eventId:     string;
  groupId:     string;
  status:      'accepted' | 'declined' | 'tentative';
  note?:       string;
  authorNpub?: string;
  displayName?: string;
  nsec:        string;
  relayUrl:    string;
  relayUrls?:  string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk  = decoded.data as Uint8Array;
    const pk  = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const unsigned: UnsignedEvent = {
      kind:       GROUP_RSVP_KIND,
      created_at: now,
      tags: [
        ['d',      input.rsvpId],
        ['t',      `group-rsvp:${input.eventId}`],
        ['group',  input.groupId],
        ['event',  input.eventId],
        ['status', input.status],
        ['client', 'bE-Marks'],
      ],
      content: JSON.stringify({
        id:         input.rsvpId,
        eventId:    input.eventId,
        groupId:    input.groupId,
        status:     input.status,
        note:       input.note,
        authorNpub: input.authorNpub,
        displayName: input.displayName,
        createdAt:  now,
        updatedAt:  now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

export function fetchGroupRSVPsForEvents(input: {
  groupId: string;
  eventIds: string[];
  relayUrl?: string;
}): Promise<GroupRSVPRaw[]> {
  const eventIds = Array.from(new Set(input.eventIds.filter(Boolean)));

  if (!input.groupId || eventIds.length === 0) return Promise.resolve([]);

  return new Promise(resolve => {
    try {
      const relayUrl = input.relayUrl ?? DEFAULT_RELAY;
      const ws = new WebSocket(relayUrl);
      const rsvps: GroupRSVPRaw[] = [];
      const seen = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(rsvps);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-rsvp-fetch-${input.groupId}-${Date.now()}`,
          {
            kinds: [GROUP_RSVP_KIND],
            '#t': eventIds.map(eventId => `group-rsvp:${eventId}`),
            limit: 500,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_RSVP_KIND) {
            const evt = data[2];
            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            try {
              const parsed = JSON.parse(evt.content || '{}') as Partial<GroupRSVPRaw>;
              const eventId = parsed.eventId || evt.tags?.find((tag: string[]) => tag[0] === 'event')?.[1];
              const groupId = parsed.groupId || evt.tags?.find((tag: string[]) => tag[0] === 'group')?.[1];
              const status = parsed.status || evt.tags?.find((tag: string[]) => tag[0] === 'status')?.[1];

              if (
                eventId &&
                eventIds.includes(eventId) &&
                groupId === input.groupId &&
                (status === 'accepted' || status === 'declined' || status === 'tentative')
              ) {
                rsvps.push({
                  id: parsed.id || evt.tags?.find((tag: string[]) => tag[0] === 'd')?.[1] || evt.id,
                  eventId,
                  groupId,
                  status,
                  note: parsed.note,
                  authorNpub: parsed.authorNpub || nip19.npubEncode(evt.pubkey),
                  displayName: parsed.displayName,
                  createdAt: parsed.createdAt || evt.created_at,
                  updatedAt: parsed.updatedAt || parsed.createdAt || evt.created_at,
                });
              }
            } catch {}
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(rsvps);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(rsvps);
      };
    } catch {
      resolve([]);
    }
  });
}

export async function publishGroupCalendarDelete(input: {
  eventId: string;
  groupId: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const unsigned: UnsignedEvent = {
      kind: GROUP_CALENDAR_DELETE_KIND,
      created_at: now,
      tags: [
        ['d', input.eventId],
        ['t', `group-cal-delete:${input.groupId}`],
        ['group', input.groupId],
        ['event', input.eventId],
        ['client', 'bE-Marks'],
      ],
      content: JSON.stringify({
        eventId: input.eventId,
        groupId: input.groupId,
        deletedAt: now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    const relayResult = await publishToSpecificRelays(
      signed,
      input.relayUrls && input.relayUrls.length > 0
        ? input.relayUrls
        : [input.relayUrl]
    );

    return {
      success: relayResult.success,
      eventId: relayResult.eventId,
      error: relayResult.success
        ? relayResult.failedRelays.length > 0
          ? `Published with ${relayResult.failedRelays.length} relay warning(s)`
          : undefined
        : relayResult.error,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

export function fetchGroupCalendarDeletes(
  groupId: string,
  relayUrl: string = DEFAULT_RELAY,
): Promise<string[]> {
  return new Promise(resolve => {
    try {
      const ws = new WebSocket(relayUrl);
      const deletedIds: string[] = [];
      const seen = new Set<string>();

      const timeout = setTimeout(() => {
        ws.close();
        resolve(deletedIds);
      }, 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          `group-cal-delete-fetch-${groupId}`,
          {
            kinds: [GROUP_CALENDAR_DELETE_KIND],
            '#t': [`group-cal-delete:${groupId}`],
            limit: 200,
          },
        ]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);

          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_CALENDAR_DELETE_KIND) {
            const evt = data[2];

            if (seen.has(evt.id)) return;
            seen.add(evt.id);

            const parsed = JSON.parse(evt.content || '{}');

            if (parsed.groupId === groupId && parsed.eventId) {
              deletedIds.push(parsed.eventId);
            }
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(deletedIds);
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(deletedIds);
      };
    } catch {
      resolve([]);
    }
  });
}
