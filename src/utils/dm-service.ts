/**
 * dm-service.ts
 *
 * Persistent background DM listener.
 * - Keeps WebSocket connections alive across all fast relays
 * - Automatically reconnects if a connection drops
 * - Sends local push notifications for incoming messages
 * - Runs silently — no UI, no state, just a background process
 *
 * Usage: call startDMService() once in _layout.tsx after identity loads.
 * Call stopDMService() on sign out.
 */

import * as Notifications from 'expo-notifications';
import type { Event } from 'nostr-tools';
import { getPublicKey, nip17, nip19, SimplePool } from 'nostr-tools';
import { AppState, type AppStateStatus } from 'react-native';
import { getDMThreads, getMessagesForThread, sendLocalDM } from './dm-storage';
import { FAST_RELAYS, getStoredIdentity } from './nostr';

// ─── Notification Setup ───────────────────────────────────────────

// Configure how notifications appear when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function sendDMNotification(senderName: string, preview: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `New message from ${senderName}`,
      body: preview.length > 80 ? preview.slice(0, 80) + '…' : preview,
      sound: true,
      badge: 1,
      data: { type: 'dm' },
    },
    trigger: null, // show immediately
  });
}

// ─── Service State ────────────────────────────────────────────────

let _running = false;
let _unsubscribe: (() => void) | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _appStateSubscription: any = null;
const _seenIds = new Set<string>();

// ─── Start / Stop ─────────────────────────────────────────────────

export async function startDMService(): Promise<void> {
  if (_running) return;
  _running = true;

  await requestNotificationPermissions();
  await _connect();

  // Reconnect when app comes back to foreground
  _appStateSubscription = AppState.addEventListener(
    'change',
    (state: AppStateStatus) => {
      if (state === 'active') {
        _scheduleReconnect(500);
      }
    }
  );
}

export function stopDMService(): void {
  _running = false;
  _cleanup();
  if (_appStateSubscription) {
    _appStateSubscription.remove();
    _appStateSubscription = null;
  }
  _seenIds.clear();
}

// ─── Connection Logic ─────────────────────────────────────────────

async function _connect(): Promise<void> {
  _cleanup();

  const identity = await getStoredIdentity();
  if (!identity?.nsec) return;

  try {
    const decoded = nip19.decode(identity.nsec);
    if (decoded.type !== 'nsec') return;

    const sk = decoded.data as Uint8Array;
    const myPubkey = getPublicKey(sk);

    const pool = new SimplePool();

    const sub = pool.subscribe(
      FAST_RELAYS,
      {
        kinds: [1059],
        '#p': [myPubkey],
        since: Math.floor(Date.now() / 1000) - 30, // small lookback for missed messages
      },
      {
        onevent: async (wrapped: Event) => {
          if (!_running) return;
          if (_seenIds.has(wrapped.id)) return;
          _seenIds.add(wrapped.id);

          try {
            const inner = nip17.unwrapEvent(wrapped, sk);
            if (!inner || inner.kind !== 14) return;

            const pTag = inner.tags.find((t: string[]) => t[0] === 'p');
            const recipientPubkey = pTag?.[1] || '';
            const otherPubkey = inner.pubkey === myPubkey
              ? recipientPubkey
              : inner.pubkey;

            if (!otherPubkey || inner.pubkey === myPubkey) return;

            // Find which thread this belongs to
            const threads = await getDMThreads();
            const thread = threads.find(t => t.participantPubkey === otherPubkey);
            if (!thread) return;

            // Check if we already have this message stored
            const existing = await getMessagesForThread(thread.id);
            const alreadyStored = existing.some(
              m => m.id === `nostr_${inner.id}` || m.text === inner.content
            );
            if (alreadyStored) return;

            // Save to local storage
            await sendLocalDM({
              threadId: thread.id,
              text: inner.content,
              mine: false,
            });

            // Send push notification
            const senderName = thread.title || otherPubkey.slice(0, 8);
            await sendDMNotification(senderName, inner.content);

          } catch {}
        },
      }
    );

    _unsubscribe = () => {
      try { sub.close(); } catch {}
    };

    // Keep-alive ping every 30 seconds
    // WebSocket connections drop silently — this forces a reconnect if the relay
    // has gone quiet for too long
    _scheduleKeepAlive();

  } catch (e) {
    console.warn('[DMService] Connection error:', e);
    if (_running) _scheduleReconnect(5000);
  }
}

function _cleanup(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
}

function _scheduleReconnect(delayMs: number): void {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    if (_running) _connect();
  }, delayMs);
}

function _scheduleKeepAlive(): void {
  if (!_running) return;
  _reconnectTimer = setTimeout(() => {
    if (_running) {
      // Reconnect every 45 seconds to keep the subscription fresh
      _connect();
    }
  }, 45_000);
}