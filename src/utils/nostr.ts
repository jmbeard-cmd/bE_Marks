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
const RELAY_URL = 'wss://relay.beginningend.com';

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

// ─── Amber Signer (Android NIP-55) ────────────────────────────────

export async function signWithAmber(eventJson: string): Promise<string | null> {
  const callbackUrl = 'milestones://amber-callback';
  const url = `intent:#Intent;scheme=nostrsigner;S.event=${encodeURIComponent(eventJson)};S.callbackUrl=${encodeURIComponent(callbackUrl)};S.type=sign_event;end`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) return null;
  await Linking.openURL(url);
  // Amber returns via deep link — handled in app/_layout.tsx
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
  imageUrl?: string; // blossom URL or empty
}

export function buildMilestoneEvent(payload: MilestonePayload, pubkeyHex: string): UnsignedEvent {
  const tags: string[][] = payload.tags.map(t => ['t', t]);
  if (payload.imageUrl) tags.push(['image', payload.imageUrl]);
  tags.push(['client', 'milestone-journal']);

  return {
    kind: 1, // plain text note — change to custom kind (e.g. 30023) later
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
    const result = await publishToRelay(signed);
    return result;
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Relay ────────────────────────────────────────────────────────

export function publishToRelay(event: Event): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return new Promise(resolve => {
    const ws = new WebSocket(RELAY_URL);
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: 'Relay timeout' });
    }, 8000);

    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', event]));
    };

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