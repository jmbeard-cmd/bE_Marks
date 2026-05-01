import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getPublicKey, nip19 } from 'nostr-tools';
import { getStoredIdentity } from './nostr';

const DM_THREADS_KEY = 'dm_threads_v1';
const DM_MESSAGES_KEY = 'dm_messages_v1';

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
};

async function getIdentityScopedKey(baseKey: string): Promise<string> {
  const identity = await getStoredIdentity();

  if (!identity?.nsec) {
    return `${baseKey}_no_identity`;
  }

  const decoded = nip19.decode(identity.nsec);

  if (decoded.type !== 'nsec') {
    return `${baseKey}_invalid_identity`;
  }

  const pubkeyHex = getPublicKey(decoded.data as Uint8Array);
  return `${baseKey}_${pubkeyHex}`;
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
  const threads = await getDMThreads();

  return (
    threads.find(
      thread =>
        thread.participantPubkey?.toLowerCase() === participantPubkey.toLowerCase()
    ) || null
  );
}

export async function saveDMThreads(threads: DMThread[]): Promise<void> {
  const key = await getThreadKey();
  await writeJson(key, threads);
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
  const all = await getDMMessages();

  return all
    .filter(message => message.threadId === threadId)
    .sort((a, b) => a.createdAt - b.createdAt);
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
}): Promise<void> {
  const allMessages = await getDMMessages();

  const existsById = allMessages.some(message => message.id === input.id);
  if (existsById) return;

  allMessages.push({
    id: input.id,
    threadId: input.threadId,
    text: input.text,
    mine: input.mine,
    createdAt: input.createdAt,
  });

  allMessages.sort((a, b) => a.createdAt - b.createdAt);
  await saveDMMessages(allMessages);

  const threads = await getDMThreads();

  const updatedThreads = threads.map(thread =>
    thread.id === input.threadId
      ? {
          ...thread,
          updatedAt: input.createdAt,
          lastMessage: input.text,
          unread: input.mine ? thread.unread : thread.unread + 1,
        }
      : thread
  );

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
  await saveDMThreads(threads.filter(thread => thread.id !== threadId));

  const messages = await getDMMessages();
  await saveDMMessages(messages.filter(message => message.threadId !== threadId));
}

export function formatDMTime(unix: number): string {
  const date = new Date(unix * 1000);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export async function clearDMStorage(): Promise<void> {
  try {
    const threadKey = await getThreadKey();
    const messageKey = await getMessageKey();

    await AsyncStorage.removeItem(threadKey);
    await AsyncStorage.removeItem(messageKey);

    await SecureStore.deleteItemAsync(threadKey);
    await SecureStore.deleteItemAsync(messageKey);

    await AsyncStorage.removeItem(DM_THREADS_KEY);
    await AsyncStorage.removeItem(DM_MESSAGES_KEY);

    await SecureStore.deleteItemAsync(DM_THREADS_KEY);
    await SecureStore.deleteItemAsync(DM_MESSAGES_KEY);

    console.log('[DM Storage] Cleared for current identity');
  } catch (error) {
    console.warn('[DM Storage] Failed to clear:', error);
  }
}