import * as SecureStore from 'expo-secure-store';
import { recordGroupPost } from './group-storage';

const GROUP_MESSAGES_KEY = 'be_group_messages_v1';

export type GroupMessage = {
  id: string;
  groupId: string;
  text?: string;
  imageUrl?: string;
  mine: boolean;
  senderNpub?: string;
  senderName?: string;
  createdAt: number;
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {}
}

export async function getAllGroupMessages(): Promise<GroupMessage[]> {
  return await readJson<GroupMessage[]>(GROUP_MESSAGES_KEY, []);
}

export async function saveAllGroupMessages(messages: GroupMessage[]): Promise<void> {
  await writeJson(GROUP_MESSAGES_KEY, messages);
}

export async function getMessagesForGroup(groupId: string): Promise<GroupMessage[]> {
  const all = await getAllGroupMessages();
  return all
    .filter(message => message.groupId === groupId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function sendLocalGroupMessage(input: {
  groupId: string;
  text?: string;
  imageUrl?: string;
  mine?: boolean;
  senderNpub?: string;
  senderName?: string;
}): Promise<GroupMessage> {
  const trimmedText = input.text?.trim() || '';

  if (!trimmedText && !input.imageUrl) {
    throw new Error('Cannot send an empty group message');
  }

  const allMessages = await getAllGroupMessages();

  const newMessage: GroupMessage = {
    id: `group_msg_${Date.now()}`,
    groupId: input.groupId,
    text: trimmedText || undefined,
    imageUrl: input.imageUrl,
    mine: input.mine ?? true,
    senderNpub: input.senderNpub,
    senderName: input.senderName,
    createdAt: Math.floor(Date.now() / 1000),
  };

  allMessages.push(newMessage);
  await saveAllGroupMessages(allMessages);

  const preview =
    trimmedText ||
    (input.imageUrl ? '📷 Photo' : 'New message');

  await recordGroupPost(input.groupId, preview);

  return newMessage;
}

export async function deleteMessagesForGroup(groupId: string): Promise<void> {
  const all = await getAllGroupMessages();
  const filtered = all.filter(message => message.groupId !== groupId);
  await saveAllGroupMessages(filtered);
}
export async function saveRemoteGroupMessage(input: {
  id: string;
  groupId: string;
  text?: string;
  imageUrl?: string;
  mine: boolean;
  senderNpub?: string;
  senderName?: string;
  createdAt: number;
}): Promise<void> {
  const allMessages = await getAllGroupMessages();

  // Exact remote id already stored
  const existsById = allMessages.some(message => message.id === input.id);
  if (existsById) return;

  // Prevent duplicate echo of a message we already saved locally
  const existsByContent = allMessages.some(message => {
    const sameGroup = message.groupId === input.groupId;
    const sameMine = message.mine === input.mine;
    const sameText = (message.text || '') === (input.text || '');
    const sameImage = (message.imageUrl || '') === (input.imageUrl || '');
    const closeInTime = Math.abs(message.createdAt - input.createdAt) <= 10;

    return sameGroup && sameMine && sameText && sameImage && closeInTime;
  });

  if (existsByContent) return;

  allMessages.push({
    id: input.id,
    groupId: input.groupId,
    text: input.text,
    imageUrl: input.imageUrl,
    mine: input.mine,
    senderNpub: input.senderNpub,
    senderName: input.senderName,
    createdAt: input.createdAt,
  });

  allMessages.sort((a, b) => a.createdAt - b.createdAt);
  await saveAllGroupMessages(allMessages);

  const preview =
    input.text?.trim() ||
    (input.imageUrl ? '📷 Photo' : 'New message');

  await recordGroupPost(input.groupId, preview);
}