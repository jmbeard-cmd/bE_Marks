import * as Notifications from 'expo-notifications';
import { getPublicKey, nip19 } from 'nostr-tools';
import { AppState, type AppStateStatus } from 'react-native';
import { emitDMChanged } from './dm-events';
import {
  createThread,
  deleteThread,
  getDMThreads,
  getMessagesForThread,
  saveRemoteDMMessage,
} from './dm-storage';

import { FAST_RELAYS, fetchNostrDMs, getStoredIdentity, subscribeToNostrDMs } from './nostr';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function sendDMNotification(senderName: string, preview: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `New message from ${senderName}`,
        body: preview.length > 80 ? preview.slice(0, 80) + '…' : preview,
        sound: true,
        badge: 1,
        data: { type: 'dm' },
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[DMService] notification failed:', e);
  }
}

let _running = false;
let _unsubscribe: (() => void) | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _appStateSubscription: any = null;
const _seenIds = new Set<string>();

export async function startDMService(): Promise<void> {
  console.log('[DMService] startDMService called');

  if (_running) {
    console.log('[DMService] already running');
    return;
  }

  _running = true;
  await _connect();

  if (!_appStateSubscription) {
    _appStateSubscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        console.log('[DMService] AppState:', state);

        if (state === 'active') {
          _scheduleReconnect(500);
        }
      }
    );
  }
}

export function stopDMService(): void {
  console.log('[DMService] stopDMService called');

  _running = false;
  _cleanup();

  if (_appStateSubscription) {
    _appStateSubscription.remove();
    _appStateSubscription = null;
  }

  _seenIds.clear();
}

async function _connect(): Promise<void> {
  console.log('[DMService] connecting...');
  _cleanup();

  const identity = await getStoredIdentity();

  if (!identity?.nsec) {
    console.log('[DMService] no nsec found');
    return;
  }

  try {
    const decoded = nip19.decode(identity.nsec);

    if (decoded.type !== 'nsec') {
      console.log('[DMService] stored key is not nsec');
      return;
    }

    const sk = decoded.data as Uint8Array;
    const myPubkey = getPublicKey(sk);
    const since = Math.floor(Date.now() / 1000) - 600;

    console.log('[DMService] myPubkey:', myPubkey.slice(0, 16));
    console.log('[DMService] relays:', FAST_RELAYS);
    console.log('[DMService] subscribing since:', since);

    console.log('[DMService] starting nostr.ts DM subscription');

const unsubscribe = await subscribeToNostrDMs({
  onMessage: async (message) => {
    if (!_running) return;

    const wrappedId = message.rawEvent?.id;
    if (!wrappedId) return;

    if (_seenIds.has(wrappedId)) {
      console.log('[DMService] duplicate skipped:', wrappedId);
      return;
    }

    _seenIds.add(wrappedId);

    try {
      if (message.isMine) {
        console.log('[DMService] skipped my own self-copy');
        return;
      }

      const otherPubkey = message.senderPubkey;

      console.log('[DMService] incoming DM from:', otherPubkey.slice(0, 16));

      const threads = await getDMThreads();

      const thread = threads.find(
        t => t.participantPubkey?.toLowerCase() === otherPubkey.toLowerCase()
      );

      let activeThread = thread;

if (!activeThread) {
  console.log('[DMService] Creating thread for pubkey:', otherPubkey);

  activeThread = await createThread({
    title: otherPubkey.slice(0, 8),
    participantPubkey: otherPubkey,
  });
}

const existing = await getMessagesForThread(activeThread.id);

      const alreadyStored = existing.some(
        m => m.id === `nostr_${message.id}`
      );

      if (alreadyStored) {
        console.log('[DMService] already stored:', message.id);
        return;
      }

      await saveRemoteDMMessage({
        id: `nostr_${message.id}`,
        threadId: activeThread.id,
        text: message.content,
        mine: false,
        createdAt: message.createdAt,
      });

      console.log('[DMService] saved incoming DM:', activeThread.id);
emitDMChanged(activeThread.id);

      const senderName = activeThread.title || otherPubkey.slice(0, 8);
      await sendDMNotification(senderName, message.content);

    } catch (err) {
      console.warn('[DMService] failed processing DM:', err);
    }
  },
});

_unsubscribe = unsubscribe;
console.log('[DMService] subscription started (nostr.ts)');

    _scheduleKeepAlive();
  } catch (e) {
    console.warn('[DMService] connection error:', e);

    if (_running) {
      _scheduleReconnect(5000);
    }
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
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
  }

  _reconnectTimer = setTimeout(() => {
    if (_running) {
      _connect();
    }
  }, delayMs);
}

function _scheduleKeepAlive(): void {
  if (!_running) return;

  _reconnectTimer = setTimeout(() => {
    if (_running) {
      console.log('[DMService] keepalive reconnect');
      _connect();
    }
  }, 5 * 60_000);
}
export async function restoreDMsFromRelay(): Promise<void> {
  console.log('[DM RESTORE] starting full restore');

  try {
    const identity = await getStoredIdentity();

    if (!identity?.nsec) {
      console.log('[DM RESTORE] no identity');
      return;
    }

    const decoded = nip19.decode(identity.nsec);
    if (decoded.type !== 'nsec') {
      console.log('[DM RESTORE] invalid nsec');
      return;
    }

    const sk = decoded.data as Uint8Array;
    const myPubkey = getPublicKey(sk);

    console.log('[DM RESTORE] myPubkey:', myPubkey.slice(0, 16));

    const existingThreads = await getDMThreads();

    for (const thread of existingThreads) {
      if (
        thread.participantPubkey?.toLowerCase() === myPubkey.toLowerCase()
      ) {
        console.log('[DM RESTORE] deleting self-thread:', thread.id);
        await deleteThread(thread.id);
      }
    }

    const messages = await fetchNostrDMs({
      relayUrls: FAST_RELAYS,
      limit: 2000,
    });

    console.log('[DM RESTORE] messages fetched:', messages.length);

    const threadMap = new Map<string, string>();

    for (const msg of messages) {
      const otherPubkey = msg.threadPubkey;

      if (!otherPubkey) continue;

      if (otherPubkey.toLowerCase() === myPubkey.toLowerCase()) {
        console.log('[DM RESTORE] skipped self DM event:', msg.id);
        continue;
      }

      let threadId = threadMap.get(otherPubkey);

      if (!threadId) {
        const latestThreads = await getDMThreads();

        const existing = latestThreads.find(
          t =>
            t.participantPubkey?.toLowerCase() ===
            otherPubkey.toLowerCase()
        );

        if (existing) {
          threadId = existing.id;
        } else {
          const newThread = await createThread({
            title: otherPubkey.slice(0, 8),
            participantPubkey: otherPubkey,
          });

          threadId = newThread.id;
        }

        threadMap.set(otherPubkey, threadId);
      }

      await saveRemoteDMMessage({
        id: `nostr_${msg.id}`,
        threadId,
        text: msg.content,
        mine: msg.isMine,
        createdAt: msg.createdAt,
      });
    }

    console.log('[DM RESTORE] complete');
  } catch (error) {
    console.warn('[DM RESTORE] failed:', error);
  }
}