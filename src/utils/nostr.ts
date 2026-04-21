import * as SecureStore from 'expo-secure-store';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type Event,
  type UnsignedEvent,
} from 'nostr-tools';
import { Linking } from 'react-native';

const SECKEY = 'nostr_nsec';
const PUBKEY = 'nostr_npub';
export const DEFAULT_RELAY = 'wss://relay.beginningend.com';
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

export async function getStoredIdentity(): Promise<{ npub: string; nsec: string } | null> {
  const nsec = await SecureStore.getItemAsync(SECKEY);
  const npub = await SecureStore.getItemAsync(PUBKEY);
  if (!nsec || !npub) return null;
  return { nsec, npub };
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
      if (decoded.type !== 'npub') { resolve(null); return; }
      const pubkeyHex = decoded.data as string;
      const ws = new WebSocket(DEFAULT_RELAY);
      const timeout = setTimeout(() => { ws.close(); resolve(null); }, 6000);
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', 'profile-fetch', { kinds: [0], authors: [pubkeyHex], limit: 1 }]));
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[2]?.kind === 0) {
            clearTimeout(timeout);
            ws.close();
            resolve(JSON.parse(data[2].content) as NostrProfile);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(null);
          }
        } catch { resolve(null); }
      };
      ws.onerror = () => { clearTimeout(timeout); resolve(null); };
    } catch { resolve(null); }
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
        ws.send(JSON.stringify(['REQ', 'relay-fetch', { kinds: [10002], authors: [pubkeyHex], limit: 1 }]));
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
      ['client', 'be-milestones'],
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

      const timeout = setTimeout(() => {
        ws.close();
        resolve(events);
      }, 8000);

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

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(events);
      };
    } catch {
      resolve([]);
    }
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
    createdAt: number;
    familyId: string;
    authorNpub: string;
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
      createdAt: milestone.createdAt,
      authorNpub: milestone.authorNpub,
    });

    const eventTags: string[][] = [
      ['d', milestone.id],
      ['t', `family:${milestone.familyId}`],
      ['client', 'be-milestones'],
    ];
    milestone.tags.forEach(t => eventTags.push(['t', t]));

    const unsigned: UnsignedEvent = {
      kind: FAMILY_MILESTONE_KIND,
      created_at: milestone.createdAt,
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
  const callbackUrl = 'milestones://amber-callback';
  const url = `intent:#Intent;scheme=nostrsigner;S.event=${encodeURIComponent(eventJson)};S.callbackUrl=${encodeURIComponent(callbackUrl)};S.type=sign_event;end`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) return null;
  await Linking.openURL(url);
  return null;
}

export async function getPublicKeyFromAmber(): Promise<string | null> {
  const callbackUrl = 'milestones://amber-callback';
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
}

export function buildMilestoneEvent(payload: MilestonePayload, pubkeyHex: string): UnsignedEvent {
  const tags: string[][] = payload.tags.map(t => ['t', t]);
  if (payload.imageUrl) tags.push(['image', payload.imageUrl]);
  tags.push(['client', 'milestone-journal']);
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: payload.note,
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
    return await publishToRelay(signed);
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Relay ────────────────────────────────────────────────────────

export function publishToRelay(event: Event): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return publishToSpecificRelay(event, DEFAULT_RELAY);
}

export function publishToSpecificRelay(
  event: Event,
  relayUrl: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return new Promise(resolve => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => { ws.close(); resolve({ success: false, error: 'Relay timeout' }); }, 8000);
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
    ws.onerror = () => { clearTimeout(timeout); resolve({ success: false, error: 'WebSocket error' }); };
  });
}