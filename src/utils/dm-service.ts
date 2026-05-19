import { getPublicKey, nip19 } from 'nostr-tools';
import { AppState, type AppStateStatus } from 'react-native';
import { isAppBusy } from './app-activity';
import { emitDMChanged } from './dm-events';
import { getContacts } from './contacts-storage';
import {
  createThread,
  deleteThread,
  getDMThreads,
  getMessagesForThread,
  saveRemoteDMMessage,
  saveRemoteDMMessagesBatch,
} from './dm-storage';
import { sendLocalDMNotification } from './push-notifications';

import {
  FAST_RELAYS,
  fetchNostrDMs,
  fetchNostrProfile,
  getStoredIdentity,
  subscribeToNostrDMs,
} from './nostr';

async function resolveDMSenderName(input: {
  senderPubkey: string;
  fallbackName?: string;
}) {
  const fallback = input.fallbackName?.trim();

  if (fallback && !fallback.match(/^[a-f0-9]{6,}$/i)) {
    return fallback;
  }

  try {
    const senderNpub = nip19.npubEncode(input.senderPubkey);
    const profile = await fetchNostrProfile(senderNpub);

    const profileName =
      profile?.display_name ||
      profile?.name;

    if (profileName?.trim()) {
      return profileName.trim();
    }

    return `${senderNpub.slice(0, 12)}…`;
  } catch (error) {
    console.warn('[DMService] failed to resolve sender profile for notification:', error);
    return input.senderPubkey.slice(0, 8);
  }
}

let _running = false;
let _unsubscribe: (() => void) | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _appStateSubscription: any = null;
let _restoreInFlight: Promise<void> | null = null;
let _lastRestorePubkey = '';
let _lastRestoreAt = 0;
let _lastConnectAt = 0;
const _seenIds = new Set<string>();
const RESTORE_CHUNK_SIZE = 20;
const BUSY_WAIT_MS = 500;
const RESTORE_COOLDOWN_MS = 5 * 60_000;
const ACTIVE_RECONNECT_COOLDOWN_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function yieldRestoreWork(): Promise<void> {
  if (isAppBusy()) {
    await sleep(BUSY_WAIT_MS);
    return;
  }

  await sleep(0);
}

async function waitUntilAppIsNotBusy(): Promise<void> {
  while (isAppBusy()) {
    await sleep(BUSY_WAIT_MS);
  }
}

async function isSavedBEContactPubkey(pubkey: string): Promise<boolean> {
  const normalizedPubkey = pubkey.toLowerCase();

  try {
    const contacts = await getContacts();

    return contacts.some(contact => {
      if (contact.pubkeyHex?.toLowerCase() === normalizedPubkey) {
        return true;
      }

      if (!contact.npub) return false;

      try {
        const decoded = nip19.decode(contact.npub);

        return (
          decoded.type === 'npub' &&
          typeof decoded.data === 'string' &&
          decoded.data.toLowerCase() === normalizedPubkey
        );
      } catch {
        return false;
      }
    });
  } catch (error) {
    console.warn('[DMService] failed to check saved contacts:', error);
    return false;
  }
}

export async function startDMService(): Promise<void> {
  console.log('[DMService] startDMService called');

  if (isAppBusy()) {
    console.log('[DMService] app busy, skipping start for now');
    return;
  }

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
          const recentlyConnected = Date.now() - _lastConnectAt < ACTIVE_RECONNECT_COOLDOWN_MS;

          if (!_unsubscribe || !recentlyConnected) {
            _scheduleReconnect(1500);
          }
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
  if (isAppBusy()) {
    console.log('[DMService] app busy, delaying connect');
    _scheduleReconnect(3000);
    return;
  }

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
  const isSavedContact = await isSavedBEContactPubkey(otherPubkey);

  if (!isSavedContact) {
    console.log('[DMService] skipped external live DM from unsaved contact:', otherPubkey.slice(0, 16));
    return;
  }

  console.log('[DMService] Creating thread for saved contact:', otherPubkey.slice(0, 16));

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
        provisionalEventId: message.rawEvent?.id,
      });

      console.log('[DMService] saved incoming DM:', activeThread.id);
emitDMChanged(activeThread.id);

const senderName = await resolveDMSenderName({
  senderPubkey: otherPubkey,
  fallbackName: activeThread.title,
});

await sendLocalDMNotification({
  senderName,
  senderPubkey: otherPubkey,
  threadId: activeThread.id,
  preview: message.content,
  eventId: message.rawEvent?.id,
  createdAt: message.createdAt,
});

    } catch (err) {
      console.warn('[DMService] failed processing DM:', err);
    }
  },
});

_unsubscribe = unsubscribe;
_lastConnectAt = Date.now();
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
  if (_restoreInFlight) {
    console.log('[DM RESTORE] already running; joining existing restore');
    return _restoreInFlight;
  }

  _restoreInFlight = restoreDMsFromRelayNow();

  try {
    await _restoreInFlight;
  } finally {
    _restoreInFlight = null;
  }
}

async function restoreDMsFromRelayNow(): Promise<void> {
  if (isAppBusy()) {
    console.log('[DM RESTORE] app busy, waiting to restore');
    await waitUntilAppIsNotBusy();
  }

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
    const normalizedMyPubkey = myPubkey.toLowerCase();

    console.log('[DM RESTORE] myPubkey:', myPubkey.slice(0, 16));

    const now = Date.now();
    if (
      _lastRestorePubkey === myPubkey &&
      now - _lastRestoreAt < RESTORE_COOLDOWN_MS
    ) {
      console.log('[DM RESTORE] skipped; recently restored');
      return;
    }

    const existingThreads = await getDMThreads();

    for (const thread of existingThreads) {
      if (
        thread.participantPubkey?.toLowerCase() === normalizedMyPubkey
      ) {
        console.log('[DM RESTORE] deleting self-thread:', thread.id);
        await deleteThread(thread.id);
      }
    }
        await yieldRestoreWork();

    const messages = await fetchNostrDMs({
      relayUrls: FAST_RELAYS,
      limit: 250,
    });

    if (isAppBusy()) {
      console.log('[DM RESTORE] app busy after fetch, waiting before save');
      await waitUntilAppIsNotBusy();
    }

    console.log('[DM RESTORE] recent messages fetched:', messages.length);

    const latestThreads = await getDMThreads();
    const threadMap = new Map<string, string>();

    for (const thread of latestThreads) {
      if (!thread.participantPubkey) continue;
      threadMap.set(thread.participantPubkey.toLowerCase(), thread.id);
    }

    const messagesToSave: {
      id: string;
      threadId: string;
      text: string;
      mine: boolean;
      createdAt: number;
      provisionalEventId?: string;
    }[] = [];

    for (const msg of messages) {
      const otherPubkey = msg.threadPubkey;

      if (!otherPubkey) continue;

      const normalizedOtherPubkey = otherPubkey.toLowerCase();

      if (normalizedOtherPubkey === normalizedMyPubkey) {
        continue;
      }

      let threadId = threadMap.get(normalizedOtherPubkey);

if (!threadId) {
  const isSavedContact = await isSavedBEContactPubkey(otherPubkey);

  if (!isSavedContact) {
    continue;
  }

  const newThread = await createThread({
    title: otherPubkey.slice(0, 8),
    participantPubkey: otherPubkey,
  });

  threadId = newThread.id;
  threadMap.set(normalizedOtherPubkey, threadId);
}

      messagesToSave.push({
        id: `nostr_${msg.id}`,
        threadId,
        text: msg.content,
        mine: msg.isMine,
        createdAt: msg.createdAt,
        provisionalEventId: msg.rawEvent?.id,
      });

      if (messagesToSave.length % RESTORE_CHUNK_SIZE === 0) {
        await yieldRestoreWork();
      }
    }

    const touchedThreadIds = Array.from(
      new Set(messagesToSave.map(message => message.threadId))
    );

    for (let i = 0; i < messagesToSave.length; i += RESTORE_CHUNK_SIZE) {
      const chunk = messagesToSave.slice(i, i + RESTORE_CHUNK_SIZE);

      if (isAppBusy()) {
        await waitUntilAppIsNotBusy();
      }

      await saveRemoteDMMessagesBatch(chunk);
      await yieldRestoreWork();
    }

    for (const threadId of touchedThreadIds) {
      emitDMChanged(threadId);
    }

    emitDMChanged('__restore_done__');

    setTimeout(() => {
      for (const threadId of touchedThreadIds) {
        emitDMChanged(threadId);
      }

      emitDMChanged('__restore_done__');
    }, 500);

    _lastRestorePubkey = myPubkey;
    _lastRestoreAt = Date.now();

    console.log('[DM RESTORE] complete, saved candidates:', messagesToSave.length);

  } catch (error) {
    console.warn('[DM RESTORE] failed:', error);
  }
}
