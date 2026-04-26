import * as SecureStore from 'expo-secure-store';
import { recordGroupPost } from './group-storage';

const GROUP_MESSAGES_KEY = 'be_group_messages_v1';

export type GroupMediaType = 'image' | 'video';

export type GroupMessage = {
  id: string;
  groupId: string;
  text?: string;

  // New clean media shape
  mediaUrl?: string;
  mediaType?: GroupMediaType;
  thumbnailUrl?: string;

  // Old fallback support
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

function getMessageMediaUrl(message: Pick<GroupMessage, 'mediaUrl' | 'imageUrl'>) {
  return message.mediaUrl || message.imageUrl;
}

function getMessagePreview(input: {
  text?: string;
  mediaUrl?: string;
  imageUrl?: string;
  mediaType?: GroupMediaType;
}) {
  const text = input.text?.trim();
  if (text) return text;

  const mediaUrl = input.mediaUrl || input.imageUrl;
  if (!mediaUrl) return 'New message';

  return input.mediaType === 'video' ? '🎥 Video' : '📷 Photo';
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
  mediaUrl?: string;
  mediaType?: GroupMediaType;
  thumbnailUrl?: string;

  // Old support while screens are being migrated
  imageUrl?: string;

  mine?: boolean;
  senderNpub?: string;
  senderName?: string;
}): Promise<GroupMessage> {
  const trimmedText = input.text?.trim() || '';
  const mediaUrl = input.mediaUrl || input.imageUrl;
  const mediaType = input.mediaType || (input.imageUrl ? 'image' : undefined);

  if (!trimmedText && !mediaUrl) {
    throw new Error('Cannot send an empty group message');
  }

  const allMessages = await getAllGroupMessages();

  const newMessage: GroupMessage = {
  id: `group_msg_${Date.now()}`,
  groupId: input.groupId,
  text: trimmedText || undefined,
  mediaUrl,
  mediaType,
  thumbnailUrl: input.thumbnailUrl,
  imageUrl: input.imageUrl,
  mine: input.mine ?? true,
  senderNpub: input.senderNpub,
  senderName: input.senderName,
  createdAt: Math.floor(Date.now() / 1000),
};

  allMessages.push(newMessage);
  await saveAllGroupMessages(allMessages);

  await recordGroupPost(input.groupId, getMessagePreview(newMessage));

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
  mediaUrl?: string;
  mediaType?: GroupMediaType;
  thumbnailUrl?: string;

  // Old support
  imageUrl?: string;

  mine: boolean;
  senderNpub?: string;
  senderName?: string;
  createdAt: number;
}): Promise<void> {
  const allMessages = await getAllGroupMessages();

  const mediaUrl = input.mediaUrl || input.imageUrl;
  const mediaType = input.mediaType || (input.imageUrl ? 'image' : undefined);

  const existsById = allMessages.some(message => message.id === input.id);
  if (existsById) return;

  const existsByContent = allMessages.some(message => {
    const sameGroup = message.groupId === input.groupId;
    const sameMine = message.mine === input.mine;
    const sameText = (message.text || '') === (input.text || '');
    const sameMedia = (getMessageMediaUrl(message) || '') === (mediaUrl || '');
    const closeInTime = Math.abs(message.createdAt - input.createdAt) <= 10;

    return sameGroup && sameMine && sameText && sameMedia && closeInTime;
  });

  if (existsByContent) return;

  const newMessage: GroupMessage = {
  id: input.id,
  groupId: input.groupId,
  text: input.text,
  mediaUrl,
  mediaType,
  thumbnailUrl: input.thumbnailUrl,
  imageUrl: input.imageUrl,
  mine: input.mine,
  senderNpub: input.senderNpub,
  senderName: input.senderName,
  createdAt: input.createdAt,
};

  allMessages.push(newMessage);
  allMessages.sort((a, b) => a.createdAt - b.createdAt);
  await saveAllGroupMessages(allMessages);

  await recordGroupPost(input.groupId, getMessagePreview(newMessage));
}