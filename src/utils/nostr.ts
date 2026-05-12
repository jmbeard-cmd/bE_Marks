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
import { Linking, Platform } from 'react-native';

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

    // Use provided relays or fall back to all fast relays
    const relayUrls = ['wss://relay.beginningend.com'];

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

console.log('[DM SEND] myPubkey:', myPubkey.slice(0, 16));
console.log('[DM SEND] toPubkey:', input.toPubkey.slice(0, 16));
console.log('[DM SEND] wrapped event id:', wrappedEvent.id);
console.log('[DM SEND] wrapped event p tags:', wrappedEvent.tags.filter(tag => tag[0] === 'p'));

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
console.log('[DM SEND] successful event ids:', successfulIds);

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
    console.log('[DM RECEIVE] ignored unwrap result; not kind 14:', inner?.kind);
    return null;
  }

  const pTag = inner.tags.find((tag: string[]) => tag[0] === 'p');
  const recipientPubkey = pTag?.[1] || '';
  const otherPubkey = inner.pubkey === myPubkey ? recipientPubkey : inner.pubkey;

  if (!otherPubkey) {
    console.log('[DM RECEIVE] ignored inner DM because otherPubkey was empty:', inner.id);
    return null;
  }

  if (withPubkey && otherPubkey !== withPubkey) {
    console.log('[DM RECEIVE] ignored DM for different thread:', {
      expected: withPubkey.slice(0, 16),
      actual: otherPubkey.slice(0, 16),
    });
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
    const seenGiftWraps = new Set<string>();
    const rawGiftWraps: Event[] = [];

    console.log('[DM FETCH] starting 1059 fetch:', {
      relays: relayUrls.length,
      limit,
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
      }, 5000);

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

          ws.onerror = (error) => {
            console.warn(`[DM FETCH] ${relayLabel} websocket error:`, error);
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
    const chunkSize = 8;

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
  console.log('[DM LIVE] connected');

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
  console.log('[DM AUTH] proactive auth sent');

  // 🔥 WAIT before sending REQ
  setTimeout(() => {
    console.log('[DM LIVE] sending REQ after AUTH');

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
          console.log('[DM AUTH] challenge received');

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
          console.log('[DM AUTH] response sent');
          return;
        }

        // 📦 HANDLE EVENT
        if (data[0] === 'EVENT') {
          const wrapped = data[2];

const wrapPTag = wrapped.tags?.find((tag: string[]) => tag[0] === 'p');
const wrapRecipient = wrapPTag?.[1] || '';

if (wrapRecipient.toLowerCase() !== myPubkey.toLowerCase()) {
  console.log('[DM LIVE] skipped 1059 not addressed to me');
  return;
}

if (seen.has(wrapped.id)) return;
seen.add(wrapped.id);

console.log('[DM LIVE] wrapped event received for me');

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
          console.log('[DM LIVE] EOSE');
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

export async function signWithAmber(eventJson: string): Promise<string | null> {
  const callbackUrl = 'marksapp://amber-callback';
  const url = `intent:#Intent;scheme=nostrsigner;S.event=${encodeURIComponent(eventJson)};S.callbackUrl=${encodeURIComponent(callbackUrl)};S.type=sign_event;end`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) return null;
  await Linking.openURL(url);
  return null;
}

export async function getPublicKeyFromAmber(): Promise<string | null> {
  const callbackUrl = 'marksapp://amber-callback';
  const url = `intent:#Intent;scheme=nostrsigner;S.callbackUrl=${encodeURIComponent(callbackUrl)};S.type=get_public_key;end`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) return null;
  await Linking.openURL(url);
  return null;
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
  nsec: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const unsigned = buildMilestoneEvent(payload, pk);
    const signed = finalizeEvent(unsigned, sk);
    // Publish to all fast relays simultaneously
    const results = await Promise.all(FAST_RELAYS.map(r => publishToSpecificRelay(signed, r)));
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

// ─── Groups (kind 30080 / 30081) ─────────────────────────────────

export const GROUP_KIND = 30080;
export const GROUP_MEMBER_KIND = 30081;

export interface NostrGroupPayload {
  id: string;
  name: string;
  description?: string;
  season?: string;
  sport?: string;
  icon?: string;
  schoolId?: string;
  inviteCode: string;
  status: 'active' | 'archived';
  relayUrl: string;
  createdAt: number;
  ownerNpub: string;
  bookEnabled?: boolean;
  bookOfficerNpubs?: string[];
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

    const tags: string[][] = [
      ['d', group.id],
      ['name', group.name],
      ['t', `group-invite:${normalizedInviteCode}`],
      ['status', group.status],
      ['relay', group.relayUrl],
      ['client', 'bE-Marks'],
    ];

    if (group.season) tags.push(['season', group.season]);
    if (group.sport) tags.push(['sport', group.sport]);
    if (group.icon) tags.push(['icon', group.icon]);
    if (group.schoolId) tags.push(['school', group.schoolId]);
    if (group.bookEnabled) tags.push(['book', 'enabled']);

    const content = JSON.stringify({
      id: group.id,
      name: group.name,
      description: group.description,
      season: group.season,
      sport: group.sport,
      icon: group.icon,
      schoolId: group.schoolId,
      inviteCode: group.inviteCode,
      status: group.status,
      relayUrl: group.relayUrl,
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

    return await publishToSpecificRelay(signed, group.relayUrl);
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

        console.log('[Groups] sending REQ:', JSON.stringify(req));
        ws.send(JSON.stringify(req));
      };

      ws.onmessage = (msg) => {
        console.log('[Groups] fetchGroupByInviteCode raw message:', msg.data);

        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[2]?.kind === GROUP_KIND) {
            clearTimeout(timeout);
            ws.close();
            const parsed = JSON.parse(data[2].content || '{}') as NostrGroupPayload;
            console.log('[Groups] fetchGroupByInviteCode parsed EVENT:', parsed);
            resolve(parsed);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            console.log('[Groups] fetchGroupByInviteCode got EOSE, no match');
            resolve(null);
          }
        } catch (error) {
          console.log('[Groups] fetchGroupByInviteCode parse error:', error);
          resolve(null);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        console.log('[Groups] fetchGroupByInviteCode websocket error:', error);
        resolve(null);
      };
    } catch (error) {
      console.log('[Groups] fetchGroupByInviteCode outer error:', error);
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

            resolve(parsed);
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
  nsec: string;
  relayUrl: string;
}): Promise<{ success: boolean; error?: string }> {
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

    const unsigned: UnsignedEvent = {
      kind: GROUP_MEMBER_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify({
        action: input.action,
        groupId: input.groupId,
        memberNpub: input.memberNpub,
        role: membershipRole,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    return await publishToSpecificRelay(signed, input.relayUrl);
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export const GROUP_MESSAGE_KIND = 30082;
export const GROUP_STICKY_KIND = 30083;
export const GROUP_MESSAGE_DELETE_KIND = 30087;
export const GROUP_MESSAGE_REACTION_KIND = 30088;
export const GROUP_MESSAGE_EDIT_KIND = 30089;
export const GROUP_POLL_VOTE_KIND = 30090;
export const GROUP_BOOK_ENTRY_KIND = 30086;

export type NostrGroupMediaType = 'image' | 'video' | 'file';

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
    return await publishToSpecificRelay(signed, input.relayUrl);
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function publishGroupMessageDelete(input: {
  groupId: string;
  messageId: string;
  clientMessageId?: string;
  deletedByNpub?: string;
  nsec: string;
  relayUrl: string;
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
    return await publishToSpecificRelay(signed, input.relayUrl);
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
    return await publishToSpecificRelay(signed, input.relayUrl);
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
    return await publishToSpecificRelay(signed, input.relayUrl);
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
    return await publishToSpecificRelay(signed, input.relayUrl);
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
  authorNpub?: string;
  nsec: string;
  relayUrl: string;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');

    const sk = decoded.data as Uint8Array;
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const tags: string[][] = [
      ['d', input.stickyId],
      ['t', `group-sticky:${input.groupId}`],
      ['group', input.groupId],
      ['client', 'bE-Marks'],
    ];

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
        authorNpub: input.authorNpub,
        createdAt: now,
        updatedAt: now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    return await publishToSpecificRelay(signed, input.relayUrl);
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
  description?: string;
  contributorName?: string;
  status: 'pending' | 'confirmed';
  createdByNpub?: string;
  createdByName?: string;
  nsec: string;
  relayUrl: string;
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
    return await publishToSpecificRelay(signed, input.relayUrl);
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

// ─── Group Calendar (kind 30084) ─────────────────────────────────────────────


export const GROUP_CALENDAR_KIND = 30084;
export const GROUP_RSVP_KIND     = 30085;
export const GROUP_CALENDAR_DELETE_KIND = 30086;

export interface GroupCalendarEventRaw {
  id:           string;
  groupId:      string;
  title:        string;
  description?: string;
  location?:    string;
  eventType:    'timed' | 'allday';
  startTime:    number;
  endTime?:     number;
  startDate?:   string;
  endDate?:     string;
  authorNpub?:  string;
  authorName?:  string;
  createdAt:    number;
  updatedAt:    number;
}

export async function publishGroupCalendarEvent(input: {
  eventId:      string;
  groupId:      string;
  title:        string;
  description?: string;
  location?:    string;
  eventType:    'timed' | 'allday';
  startTime:    number;
  endTime?:     number;
  startDate?:   string;
  endDate?:     string;
  authorNpub?:  string;
  authorName?:  string;
  nsec:         string;
  relayUrl:     string;
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
        startTime:   input.startTime,
        endTime:     input.endTime,
        startDate:   input.startDate,
        endDate:     input.endDate,
        authorNpub:  input.authorNpub,
        authorName:  input.authorName,
        createdAt:   now,
        updatedAt:   now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    return await publishToSpecificRelay(signed, input.relayUrl);
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

            try {
              const parsed = JSON.parse(evt.content || '{}') as GroupCalendarEventRaw;
              if (parsed.id && parsed.groupId === groupId) {
                events.push(parsed);
              }
            } catch {}

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

export async function publishGroupRSVP(input: {
  rsvpId:      string;
  eventId:     string;
  groupId:     string;
  status:      'accepted' | 'declined' | 'tentative';
  note?:       string;
  authorNpub?: string;
  nsec:        string;
  relayUrl:    string;
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
        createdAt:  now,
      }),
      pubkey: pk,
    };

    const signed = finalizeEvent(unsigned, sk);
    return await publishToSpecificRelay(signed, input.relayUrl);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

export async function publishGroupCalendarDelete(input: {
  eventId: string;
  groupId: string;
  nsec: string;
  relayUrl: string;
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
    return await publishToSpecificRelay(signed, input.relayUrl);
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