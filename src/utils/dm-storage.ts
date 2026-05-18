import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getPublicKey, nip19 } from 'nostr-tools';
import { getStoredIdentity } from './nostr';

const DM_THREADS_KEY = 'dm_threads_v1';
const DM_MESSAGES_KEY = 'dm_messages_v1';
const DM_THREAD_MESSAGES_KEY = 'dm_thread_messages_v1';
const DM_PARTICIPANT_THREAD_INDEX_KEY = 'dm_participant_thread_index_v1';

let cachedIdentityStorageSuffix: string | null = null;

export type DMThread = {
  id: string;
  title: string;
  participantPubkey?: string;
  participantNpub?: string;
  updatedAt: number;
  unread: number;
  lastMessage: string;
};

export type DMMessage = {
  id: string;
  threadId: string;
  text: string;
  mine: boolean;
  createdAt: number;
  provisional?: boolean;
  provisionalEventId?: string;
};

export type DMParticipantThreadIndexEntry = {
  threadId: string;
  title: string;
  participantPubkey: string;
  participantNpub?: string;
  updatedAt: number;
};

async function getIdentityScopedKey(baseKey: string): Promise<string> {
  if (cachedIdentityStorageSuffix) {
    return `${baseKey}_${cachedIdentityStorageSuffix}`;
  }

  const identity = await getStoredIdentity();

  if (!identity?.nsec) {
    cachedIdentityStorageSuffix = 'no_identity';
    return `${baseKey}_${cachedIdentityStorageSuffix}`;
  }

  const decoded = nip19.decode(identity.nsec);

  if (decoded.type !== 'nsec') {
    cachedIdentityStorageSuffix = 'invalid_identity';
    return `${baseKey}_${cachedIdentityStorageSuffix}`;
  }

  const pubkeyHex = getPublicKey(decoded.data as Uint8Array);
  cachedIdentityStorageSuffix = pubkeyHex;

  return `${baseKey}_${cachedIdentityStorageSuffix}`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const asyncRaw = await AsyncStorage.getItem(key);

    if (asyncRaw) {
      return JSON.parse(asyncRaw) as T;
    }

    const secureRaw = await SecureStore.getItemAsync(key);

    if (secureRaw) {
      await AsyncStorage.setItem(key, secureRaw);
      await SecureStore.deleteItemAsync(key);
      return JSON.parse(secureRaw) as T;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[DM Storage] writeJson failed:', error);
  }
}

async function getThreadKey(): Promise<string> {
  return await getIdentityScopedKey(DM_THREADS_KEY);
}

async function getMessageKey(): Promise<string> {
  return await getIdentityScopedKey(DM_MESSAGES_KEY);
}

async function getThreadMessageKey(threadId: string): Promise<string> {
  return await getIdentityScopedKey(`${DM_THREAD_MESSAGES_KEY}_${threadId}`);
}

async function getParticipantThreadIndexKey(): Promise<string> {
  return await getIdentityScopedKey(DM_PARTICIPANT_THREAD_INDEX_KEY);
}

function normalizePubkey(pubkey?: string): string {
  return pubkey?.trim().toLowerCase() || '';
}

async function readParticipantThreadIndex(): Promise<Record<string, DMParticipantThreadIndexEntry>> {
  const key = await getParticipantThreadIndexKey();
  return await readJson<Record<string, DMParticipantThreadIndexEntry>>(key, {});
}

async function writeParticipantThreadIndex(
  index: Record<string, DMParticipantThreadIndexEntry>
): Promise<void> {
  const key = await getParticipantThreadIndexKey();
  await writeJson(key, index);
}

async function rebuildParticipantThreadIndex(threads: DMThread[]): Promise<void> {
  const index: Record<string, DMParticipantThreadIndexEntry> = {};

  for (const thread of threads) {
    const participantPubkey = normalizePubkey(thread.participantPubkey);
    if (!participantPubkey) continue;

    index[participantPubkey] = {
      threadId: thread.id,
      title: thread.title,
      participantPubkey,
      participantNpub: thread.participantNpub,
      updatedAt: thread.updatedAt,
    };
  }

  await writeParticipantThreadIndex(index);
}

async function upsertParticipantThreadIndexForThread(thread: DMThread): Promise<void> {
  const participantPubkey = normalizePubkey(thread.participantPubkey);
  if (!participantPubkey) return;

  const index = await readParticipantThreadIndex();

  index[participantPubkey] = {
    threadId: thread.id,
    title: thread.title,
    participantPubkey,
    participantNpub: thread.participantNpub,
    updatedAt: thread.updatedAt,
  };

  await writeParticipantThreadIndex(index);
}

async function saveMessagesForThreadCache(
  threadId: string,
  messages: DMMessage[]
): Promise<void> {
  const key = await getThreadMessageKey(threadId);

  const sortedMessages = [...messages].sort(
    (a, b) => a.createdAt - b.createdAt
  );

  await writeJson(key, sortedMessages);
}

async function upsertMessagesForThreadCache(
  threadId: string,
  incomingMessages: DMMessage[]
): Promise<void> {
  if (incomingMessages.length === 0) return;

  const key = await getThreadMessageKey(threadId);
  let existingMessages = await readJson<DMMessage[]>(key, []);

  if (existingMessages.length === 0) {
    const allMessages = await getDMMessages();

    existingMessages = allMessages.filter(
      message => message.threadId === threadId
    );
  }

  const byId = new Map<string, DMMessage>();

  for (const message of existingMessages) {
    byId.set(message.id, message);
  }

  for (const message of incomingMessages) {
    byId.set(message.id, message);
  }

  const nextMessages = Array.from(byId.values()).sort(
    (a, b) => a.createdAt - b.createdAt
  );

  await writeJson(key, nextMessages);
}

function isCloseInTime(a: number, b: number, windowSeconds = 180): boolean {
  return Math.abs(a - b) <= windowSeconds;
}

function findMatchingProvisionalIndex(
  messages: DMMessage[],
  input: {
    threadId: string;
    text: string;
    mine: boolean;
    createdAt: number;
    provisionalEventId?: string;
  }
): number {
  if (input.provisionalEventId) {
    const eventMatch = messages.findIndex(message =>
      message.provisional === true &&
      message.provisionalEventId === input.provisionalEventId
    );

    if (eventMatch >= 0) return eventMatch;
  }

  return messages.findIndex(message =>
    message.provisional === true &&
    message.threadId === input.threadId &&
    message.mine === input.mine &&
    message.text === input.text &&
    isCloseInTime(message.createdAt, input.createdAt)
  );
}

function getNewestMessageForThread(
  messages: DMMessage[],
  threadId: string
): DMMessage | null {
  return messages
    .filter(message => message.threadId === threadId)
    .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

export async function getDMThreads(): Promise<DMThread[]> {
  const key = await getThreadKey();
  const threads = await readJson<DMThread[]>(key, []);
  return threads.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDMThreadById(threadId: string): Promise<DMThread | null> {
  const threads = await getDMThreads();
  return threads.find(thread => thread.id === threadId) || null;
}

export async function getDMThreadByParticipantPubkey(
  participantPubkey: string
): Promise<DMThread | null> {
  const indexed = await getDMThreadIndexEntryForParticipantPubkey(participantPubkey);

  if (indexed) {
    const indexedThread = await getDMThreadById(indexed.threadId);

    if (indexedThread) {
      return indexedThread;
    }
  }

  const threads = await getDMThreads();

  const thread =
    threads.find(
      thread =>
        normalizePubkey(thread.participantPubkey) === normalizePubkey(participantPubkey)
    ) || null;

  if (thread) {
    await upsertParticipantThreadIndexForThread(thread);
  }

  return thread;
}

export async function saveDMThreads(threads: DMThread[]): Promise<void> {
  const key = await getThreadKey();
  await writeJson(key, threads);
  await rebuildParticipantThreadIndex(threads);
}

export async function getDMThreadIndexEntryForParticipantPubkey(
  participantPubkey: string
): Promise<DMParticipantThreadIndexEntry | null> {
  const normalizedPubkey = normalizePubkey(participantPubkey);
  if (!normalizedPubkey) return null;

  const index = await readParticipantThreadIndex();
  return index[normalizedPubkey] || null;
}

export async function getDMMessages(): Promise<DMMessage[]> {
  const key = await getMessageKey();
  return await readJson<DMMessage[]>(key, []);
}

export async function saveDMMessages(messages: DMMessage[]): Promise<void> {
  const key = await getMessageKey();
  await writeJson(key, messages);
}

export async function getMessagesForThread(threadId: string): Promise<DMMessage[]> {
  const key = await getThreadMessageKey(threadId);
  const cachedThreadMessages = await readJson<DMMessage[]>(key, []);

  if (cachedThreadMessages.length > 0) {
    return cachedThreadMessages.sort((a, b) => a.createdAt - b.createdAt);
  }

  const all = await getDMMessages();

  const threadMessages = all
    .filter(message => message.threadId === threadId)
    .sort((a, b) => a.createdAt - b.createdAt);

  if (threadMessages.length > 0) {
    await saveMessagesForThreadCache(threadId, threadMessages);
  }

  return threadMessages;
}

export async function getRecentMessagesForThread(
  threadId: string,
  limit = 30
): Promise<DMMessage[]> {
  const messages = await getMessagesForThread(threadId);

  if (messages.length <= limit) {
    return messages;
  }

  return messages.slice(messages.length - limit);
}

export async function createThread(input: {
  title: string;
  participantPubkey?: string;
  participantNpub?: string;
}): Promise<DMThread> {
  const threads = await getDMThreads();

  const newThread: DMThread = {
    id: `thread_${Date.now()}`,
    title: input.title.trim(),
    participantPubkey: input.participantPubkey,
    participantNpub: input.participantNpub,
    updatedAt: Math.floor(Date.now() / 1000),
    unread: 0,
    lastMessage: '',
  };

  threads.unshift(newThread);
  await saveDMThreads(threads);
  await upsertParticipantThreadIndexForThread(newThread);

  return newThread;
}

export async function sendLocalDM(input: {
  threadId: string;
  text: string;
  mine?: boolean;
}): Promise<DMMessage> {
  const messages = await getDMMessages();
  const threads = await getDMThreads();

  const newMessage: DMMessage = {
    id: `msg_${Date.now()}`,
    threadId: input.threadId,
    text: input.text.trim(),
    mine: input.mine ?? true,
    createdAt: Math.floor(Date.now() / 1000),
  };

  messages.push(newMessage);
  await saveDMMessages(messages);
  await upsertMessagesForThreadCache(input.threadId, [newMessage]);

  const updatedThreads = threads.map(thread =>
    thread.id === input.threadId
      ? {
          ...thread,
          updatedAt: newMessage.createdAt,
          lastMessage: newMessage.text,
        }
      : thread
  );

  await saveDMThreads(updatedThreads);

  return newMessage;
}

export async function saveRemoteDMMessage(input: {
  id: string;
  threadId: string;
  text: string;
  mine: boolean;
  createdAt: number;
  provisionalEventId?: string;
}): Promise<void> {
  const allMessages = await getDMMessages();

  const existsById = allMessages.some(message => message.id === input.id);
  if (existsById) return;

  const matchingProvisionalIndex = findMatchingProvisionalIndex(allMessages, input);

  const newMessage: DMMessage = {
    id: input.id,
    threadId: input.threadId,
    text: input.text,
    mine: input.mine,
    createdAt: input.createdAt,
    provisionalEventId: input.provisionalEventId,
  };

  const replacedProvisional = matchingProvisionalIndex >= 0;

  if (replacedProvisional) {
    allMessages[matchingProvisionalIndex] = newMessage;
  } else {
    allMessages.push(newMessage);
  }

  console.log('[DM Storage] remote DM confirmed', {
    threadId: input.threadId,
    eventId: input.provisionalEventId?.slice(0, 12) || 'none',
    replacedProvisional,
  });

  allMessages.sort((a, b) => a.createdAt - b.createdAt);
  await saveDMMessages(allMessages);
  await saveMessagesForThreadCache(
    input.threadId,
    allMessages.filter(message => message.threadId === input.threadId)
  );

  const threads = await getDMThreads();
  const newestThreadMessage = getNewestMessageForThread(allMessages, input.threadId);

  const updatedThreads = threads.map(thread => {
    if (thread.id !== input.threadId) return thread;

    const isNewerThanThread =
      !!newestThreadMessage &&
      newestThreadMessage.createdAt >= thread.updatedAt;

    return {
      ...thread,
      updatedAt: isNewerThanThread ? newestThreadMessage.createdAt : thread.updatedAt,
      lastMessage: isNewerThanThread ? newestThreadMessage.text : thread.lastMessage,
      unread:
        input.mine || replacedProvisional
          ? thread.unread
          : thread.unread + 1,
    };
  });

  await saveDMThreads(updatedThreads);
}

export async function saveProvisionalRemoteDMMessage(input: {
  id: string;
  threadId: string;
  text: string;
  mine?: boolean;
  createdAt: number;
  provisionalEventId?: string;
}): Promise<DMMessage | null> {
  const text = input.text.trim();

  if (!text) return null;

  const message: DMMessage = {
    id: input.id,
    threadId: input.threadId,
    text,
    mine: input.mine ?? false,
    createdAt: input.createdAt,
    provisional: true,
    provisionalEventId: input.provisionalEventId,
  };

  const threadMessages = await getMessagesForThread(input.threadId);
  const existingThreadMessage = threadMessages.find(existing => existing.id === input.id);

  if (existingThreadMessage) {
    return existingThreadMessage;
  }

  const matchingThreadProvisionalIndex = findMatchingProvisionalIndex(threadMessages, {
    threadId: input.threadId,
    text,
    mine: input.mine ?? false,
    createdAt: input.createdAt,
    provisionalEventId: input.provisionalEventId,
  });

  const confirmedThreadDuplicate = threadMessages.find(existing =>
    !existing.provisional &&
    existing.threadId === input.threadId &&
    existing.mine === (input.mine ?? false) &&
    existing.text === text &&
    isCloseInTime(existing.createdAt, input.createdAt)
  );

  if (confirmedThreadDuplicate) {
    return confirmedThreadDuplicate;
  }

  if (matchingThreadProvisionalIndex >= 0) {
    threadMessages[matchingThreadProvisionalIndex] = {
      ...threadMessages[matchingThreadProvisionalIndex],
      ...message,
    };
  } else {
    threadMessages.push(message);
  }

  await saveMessagesForThreadCache(input.threadId, threadMessages);

  const allMessages = await getDMMessages();

  const existingById = allMessages.find(existing => existing.id === input.id);
  if (existingById) {
    await upsertMessagesForThreadCache(input.threadId, [existingById]);
    return existingById;
  }

  const matchingProvisionalIndex = findMatchingProvisionalIndex(allMessages, {
    threadId: input.threadId,
    text,
    mine: input.mine ?? false,
    createdAt: input.createdAt,
    provisionalEventId: input.provisionalEventId,
  });

  const confirmedDuplicate = allMessages.find(existing =>
    !existing.provisional &&
    existing.threadId === input.threadId &&
    existing.mine === (input.mine ?? false) &&
    existing.text === text &&
    isCloseInTime(existing.createdAt, input.createdAt)
  );

  if (confirmedDuplicate) {
    await saveMessagesForThreadCache(
      input.threadId,
      allMessages.filter(existing => existing.threadId === input.threadId)
    );
    return confirmedDuplicate;
  }

  if (matchingProvisionalIndex >= 0) {
    allMessages[matchingProvisionalIndex] = {
      ...allMessages[matchingProvisionalIndex],
      ...message,
    };
  } else {
    allMessages.push(message);
  }

  allMessages.sort((a, b) => a.createdAt - b.createdAt);

  await saveDMMessages(allMessages);

  const threads = await getDMThreads();

  const updatedThreads = threads.map(thread => {
    if (thread.id !== input.threadId) return thread;

    const isNewerThanThread = input.createdAt >= thread.updatedAt;

    return {
      ...thread,
      updatedAt: isNewerThanThread ? input.createdAt : thread.updatedAt,
      lastMessage: isNewerThanThread ? text : thread.lastMessage,
      unread: message.mine ? thread.unread : thread.unread + 1,
    };
  });

  await saveDMThreads(updatedThreads);

  return message;
}

export async function saveRemoteDMMessagesBatch(
  inputs: {
    id: string;
    threadId: string;
    text: string;
    mine: boolean;
    createdAt: number;
    provisionalEventId?: string;
  }[]
): Promise<void> {
  if (inputs.length === 0) return;

  const allMessages = await getDMMessages();
  const threads = await getDMThreads();

  const existingIds = new Set(allMessages.map(message => message.id));
  const newMessages: DMMessage[] = [];
  const replacedThreadIds = new Set<string>();

  for (const input of inputs) {
    if (existingIds.has(input.id)) continue;

    existingIds.add(input.id);

    const newMessage: DMMessage = {
      id: input.id,
      threadId: input.threadId,
      text: input.text,
      mine: input.mine,
      createdAt: input.createdAt,
      provisionalEventId: input.provisionalEventId,
    };

    const matchingProvisionalIndex = findMatchingProvisionalIndex(allMessages, input);

    if (matchingProvisionalIndex >= 0) {
      allMessages[matchingProvisionalIndex] = newMessage;
      replacedThreadIds.add(input.threadId);
      continue;
    }

    newMessages.push(newMessage);
  }

  if (newMessages.length === 0 && replacedThreadIds.size === 0) return;

  const nextMessages = [...allMessages, ...newMessages].sort(
    (a, b) => a.createdAt - b.createdAt
  );

  const newestMessageByThread = new Map<string, DMMessage>();

  for (const message of nextMessages) {
    const existing = newestMessageByThread.get(message.threadId);

    if (!existing || message.createdAt >= existing.createdAt) {
      newestMessageByThread.set(message.threadId, message);
    }
  }

  const unreadIncreaseByThread = new Map<string, number>();

  for (const message of newMessages) {
    if (message.mine) continue;

    unreadIncreaseByThread.set(
      message.threadId,
      (unreadIncreaseByThread.get(message.threadId) || 0) + 1
    );
  }

  const updatedThreads = threads.map(thread => {
    const latestMessage = newestMessageByThread.get(thread.id);
    const unreadIncrease = unreadIncreaseByThread.get(thread.id) || 0;

    if (!latestMessage && unreadIncrease === 0) {
      return thread;
    }

    return {
      ...thread,
      updatedAt: latestMessage ? latestMessage.createdAt : thread.updatedAt,
      lastMessage: latestMessage ? latestMessage.text : thread.lastMessage,
      unread: thread.unread + unreadIncrease,
    };
  });

  const touchedThreadIds = new Set([
    ...newMessages.map(message => message.threadId),
    ...Array.from(replacedThreadIds),
  ]);

  await saveDMMessages(nextMessages);

  for (const threadId of touchedThreadIds) {
    const threadMessages = nextMessages.filter(
      message => message.threadId === threadId
    );

    await saveMessagesForThreadCache(threadId, threadMessages);
  }

  await saveDMThreads(updatedThreads);
}

export async function markThreadRead(threadId: string): Promise<void> {
  const threads = await getDMThreads();

  const updatedThreads = threads.map(thread =>
    thread.id === threadId ? { ...thread, unread: 0 } : thread
  );

  await saveDMThreads(updatedThreads);
}

export async function deleteThread(threadId: string): Promise<void> {
  const threads = await getDMThreads();
  const remainingThreads = threads.filter(thread => thread.id !== threadId);
  await saveDMThreads(remainingThreads);

  const messages = await getDMMessages();
  await saveDMMessages(messages.filter(message => message.threadId !== threadId));

  const threadMessageKey = await getThreadMessageKey(threadId);
  await AsyncStorage.removeItem(threadMessageKey);
  await SecureStore.deleteItemAsync(threadMessageKey);
}

export function formatDMTime(unix: number): string {
  const date = new Date(unix * 1000);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export async function clearDMStorage(): Promise<void> {
  try {
    const existingThreads = await getDMThreads();

    const threadKey = await getThreadKey();
    const messageKey = await getMessageKey();
    const participantThreadIndexKey = await getParticipantThreadIndexKey();

    for (const thread of existingThreads) {
      const threadMessageKey = await getThreadMessageKey(thread.id);

      await AsyncStorage.removeItem(threadMessageKey);
      await SecureStore.deleteItemAsync(threadMessageKey);
    }

    await AsyncStorage.removeItem(threadKey);
    await AsyncStorage.removeItem(messageKey);
    await AsyncStorage.removeItem(participantThreadIndexKey);

    await SecureStore.deleteItemAsync(threadKey);
    await SecureStore.deleteItemAsync(messageKey);
    await SecureStore.deleteItemAsync(participantThreadIndexKey);

    await AsyncStorage.removeItem(DM_THREADS_KEY);
    await AsyncStorage.removeItem(DM_MESSAGES_KEY);
    await AsyncStorage.removeItem(DM_PARTICIPANT_THREAD_INDEX_KEY);

    await SecureStore.deleteItemAsync(DM_THREADS_KEY);
    await SecureStore.deleteItemAsync(DM_MESSAGES_KEY);
    await SecureStore.deleteItemAsync(DM_PARTICIPANT_THREAD_INDEX_KEY);

    cachedIdentityStorageSuffix = null;

    console.log('[DM Storage] Cleared for current identity');
  } catch (error) {
    cachedIdentityStorageSuffix = null;
    console.warn('[DM Storage] Failed to clear:', error);
  }
}
