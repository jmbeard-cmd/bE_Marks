import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { recordGroupPost } from './group-storage';

const GROUP_MESSAGES_KEY = 'be_group_messages_v1';

export type GroupMediaType = 'image' | 'video' | 'file';

export type GroupMessageMedia = {
  id: string;
  uri: string;
  type: GroupMediaType;
  thumbnailUrl?: string;
  fileName?: string;
  mimeType?: string;
};

export type GroupMessageReaction = {
  id: string;
  groupId: string;
  messageId?: string;
  clientMessageId: string;
  reaction: string;
  reactorNpub?: string;
  reactorName?: string;
  createdAt: number;
};

export type GroupMessage = {
  id: string;
  clientMessageId: string;
  groupId: string;
  text?: string;

  // New multi-attachment shape
  media?: GroupMessageMedia[];

  // Legacy single media shape
  mediaUrl?: string;
  mediaType?: GroupMediaType;
  thumbnailUrl?: string;

  // Old fallback support
  imageUrl?: string;

  // Message lifecycle
  isDeleted?: boolean;
  deletedAt?: number;
  deletedByNpub?: string;
  deletedOriginalText?: string;
  deletedOriginalMediaSignature?: string;
  deletedOriginalPrimaryMediaUrl?: string;
  editedAt?: number;

  // Message reactions
  reactions?: GroupMessageReaction[];

  mine: boolean;
  senderNpub?: string;
  senderName?: string;
  createdAt: number;
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const asyncRaw = await AsyncStorage.getItem(key);

    if (asyncRaw) {
      return JSON.parse(asyncRaw) as T;
    }

    // Migration fallback from older SecureStore-based versions.
    const secureRaw = await SecureStore.getItemAsync(key);

    if (secureRaw) {
      const parsed = JSON.parse(secureRaw) as T;

      try {
        await AsyncStorage.setItem(key, secureRaw);
        await SecureStore.deleteItemAsync(key);
        console.log(`[Group Messages] migrated ${key} from SecureStore to AsyncStorage`);
      } catch (migrationError) {
        console.warn(`[Group Messages] failed to migrate ${key}:`, migrationError);
      }

      return parsed;
    }

    return fallback;
  } catch (error) {
    console.warn(`[Group Messages] failed to read ${key}:`, error);
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[Group Messages] failed to write ${key}:`, error);
  }
}

function createClientMessageId(groupId: string): string {
  return `client_msg_${groupId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeMessageMedia(input: {
  media?: GroupMessageMedia[];
  mediaUrl?: string;
  mediaType?: GroupMediaType;
  thumbnailUrl?: string;
  imageUrl?: string;
}): GroupMessageMedia[] {
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

function getMessageMediaUrl(message: Pick<GroupMessage, 'media' | 'mediaUrl' | 'imageUrl'>) {
  if (message.media?.[0]?.uri) return message.media[0].uri;
  return message.mediaUrl || message.imageUrl;
}

function getMediaSignature(media: GroupMessageMedia[]): string {
  return media
    .map(item => `${item.type}:${item.uri}:${item.thumbnailUrl || ''}:${item.fileName || ''}`)
    .join('|');
}

function getMessagePreview(input: {
  text?: string;
  media?: GroupMessageMedia[];
  mediaUrl?: string;
  imageUrl?: string;
  mediaType?: GroupMediaType;
  isDeleted?: boolean;
}) {
  if (input.isDeleted) return 'Message deleted';

  const text = input.text?.trim();
  if (text) return text;

  const media = normalizeMessageMedia(input);

  if (media.length === 0) return 'New message';

  if (media.length > 1) {
    return `📎 ${media.length} attachments`;
  }

  const first = media[0];

  if (first.type === 'video') return '🎥 Video';
  if (first.type === 'file') return `📎 ${first.fileName || 'File'}`;

  return '📷 Photo';
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
  clientMessageId?: string;
  text?: string;

  // New multi-attachment support
  media?: GroupMessageMedia[];

  // Legacy single media support
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
  const media = normalizeMessageMedia(input);
  const primaryMedia = media[0];

  if (!trimmedText && media.length === 0) {
    throw new Error('Cannot send an empty group message');
  }

  const allMessages = await getAllGroupMessages();
  const clientMessageId = input.clientMessageId || createClientMessageId(input.groupId);

  const newMessage: GroupMessage = {
    id: clientMessageId,
    clientMessageId,
    groupId: input.groupId,
    text: trimmedText || undefined,

    media,

    mediaUrl: input.mediaUrl || primaryMedia?.uri,
    mediaType: input.mediaType || primaryMedia?.type,
    thumbnailUrl: input.thumbnailUrl || primaryMedia?.thumbnailUrl,
    imageUrl:
      input.imageUrl ||
      (primaryMedia?.type === 'image' ? primaryMedia.uri : undefined),

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

export async function markGroupMessageDeleted(input: {
  groupId: string;
  messageId: string;
  clientMessageId?: string;
  deletedByNpub?: string;
  deletedAt?: number;
}): Promise<boolean> {
  const all = await getAllGroupMessages();
  const now = input.deletedAt ?? Math.floor(Date.now() / 1000);
  let changed = false;

  const updated = all.map(message => {
    const matchesId = message.id === input.messageId;
    const matchesClientId =
      !!input.clientMessageId &&
      message.clientMessageId === input.clientMessageId;

    if (message.groupId !== input.groupId || (!matchesId && !matchesClientId)) {
      return message;
    }

    changed = true;

    const originalMedia = normalizeMessageMedia(message);
    const originalPrimaryMediaUrl = getMessageMediaUrl(message);

    return {
      ...message,
      text: undefined,
      media: [],
      mediaUrl: undefined,
      mediaType: undefined,
      thumbnailUrl: undefined,
      imageUrl: undefined,
      isDeleted: true,
      deletedAt: now,
      deletedByNpub: input.deletedByNpub,
      deletedOriginalText: message.text,
      deletedOriginalMediaSignature: getMediaSignature(originalMedia),
      deletedOriginalPrimaryMediaUrl: originalPrimaryMediaUrl,
    };
  });

  if (!changed) return false;

  await saveAllGroupMessages(updated);
  await recordGroupPost(input.groupId, 'Message deleted');

  return true;
}

export async function saveRemoteGroupMessage(input: {
  id: string;
  clientMessageId?: string;
  groupId: string;
  text?: string;

  // New multi-attachment support
  media?: GroupMessageMedia[];

  // Legacy single media support
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

  const media = normalizeMessageMedia(input);
  const primaryMedia = media[0];
  const mediaUrl = input.mediaUrl || input.imageUrl || primaryMedia?.uri;
  const mediaType =
    input.mediaType ||
    primaryMedia?.type ||
    (input.imageUrl ? 'image' : undefined);

  const incomingSignature = getMediaSignature(media);
  const clientMessageId = input.clientMessageId || input.id;

  const existsById = allMessages.some(message => message.id === input.id);
  if (existsById) return;

  const existsByClientMessageId = allMessages.some(message => {
    return !!clientMessageId && message.clientMessageId === clientMessageId;
  });

  if (existsByClientMessageId) return;

  const matchesDeletedLocalMessage = allMessages.some(message => {
    if (!message.isDeleted) return false;

    const sameGroup = message.groupId === input.groupId;
    const sameClientMessageId =
      !!clientMessageId &&
      message.clientMessageId === clientMessageId;

    if (sameGroup && sameClientMessageId) return true;

    const sameMine = message.mine === input.mine;
    const closeInTime = Math.abs(message.createdAt - input.createdAt) <= 10;

    if (!sameGroup || !sameMine || !closeInTime) return false;

    const deletedText = message.deletedOriginalText || '';
    const incomingText = input.text || '';

    const sameDeletedText =
      !!deletedText &&
      deletedText === incomingText;

    const sameDeletedPrimaryMedia =
      !!message.deletedOriginalPrimaryMediaUrl &&
      message.deletedOriginalPrimaryMediaUrl === mediaUrl;

    const sameDeletedMediaList =
      !!message.deletedOriginalMediaSignature &&
      message.deletedOriginalMediaSignature === incomingSignature;

    // Fallback for messages deleted before tombstone signatures existed.
    // This prevents the relay copy from reappearing under a nearby deleted placeholder.
    const deletedWithoutSignature =
      !message.deletedOriginalText &&
      !message.deletedOriginalPrimaryMediaUrl &&
      !message.deletedOriginalMediaSignature;

    return (
      sameDeletedText ||
      sameDeletedPrimaryMedia ||
      sameDeletedMediaList ||
      deletedWithoutSignature
    );
  });

  if (matchesDeletedLocalMessage) return;

  const existsByContent = allMessages.some(message => {
    if (message.isDeleted) return false;

    const sameGroup = message.groupId === input.groupId;
    const sameMine = message.mine === input.mine;
    const sameText = (message.text || '') === (input.text || '');
    const samePrimaryMedia = (getMessageMediaUrl(message) || '') === (mediaUrl || '');
    const sameMediaList = getMediaSignature(normalizeMessageMedia(message)) === incomingSignature;
    const closeInTime = Math.abs(message.createdAt - input.createdAt) <= 10;

    return sameGroup && sameMine && sameText && samePrimaryMedia && sameMediaList && closeInTime;
  });

  if (existsByContent) return;

  const newMessage: GroupMessage = {
    id: input.id,
    clientMessageId,
    groupId: input.groupId,
    text: input.text,

    media,

    mediaUrl,
    mediaType,
    thumbnailUrl: input.thumbnailUrl || primaryMedia?.thumbnailUrl,
    imageUrl:
      input.imageUrl ||
      (mediaType === 'image' && mediaUrl ? mediaUrl : undefined),

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

export async function addGroupMessageReaction(input: {
  groupId: string;
  messageId: string;
  clientMessageId?: string;
  reaction: string;
  reactorNpub?: string;
  reactorName?: string;
  createdAt?: number;
}): Promise<boolean> {
  const all = await getAllGroupMessages();
  const now = input.createdAt ?? Math.floor(Date.now() / 1000);
  const clientMessageId = input.clientMessageId || input.messageId;
  let changed = false;

  const reactionRecord: GroupMessageReaction = {
    id: `reaction_${clientMessageId}_${input.reactorNpub || 'unknown'}_${input.reaction}`,
    groupId: input.groupId,
    messageId: input.messageId,
    clientMessageId,
    reaction: input.reaction,
    reactorNpub: input.reactorNpub,
    reactorName: input.reactorName,
    createdAt: now,
  };

  const updated = all.map(message => {
    const matchesId = message.id === input.messageId;
    const matchesClientId = message.clientMessageId === clientMessageId;

    if (message.groupId !== input.groupId || (!matchesId && !matchesClientId)) {
      return message;
    }

    if (message.isDeleted) {
      return message;
    }

    changed = true;

    const existingReactions = Array.isArray(message.reactions)
      ? message.reactions
      : [];

    const withoutExistingSameUserReaction = existingReactions.filter(existing => {
      if (!input.reactorNpub) {
        return existing.id !== reactionRecord.id;
      }

      return existing.reactorNpub !== input.reactorNpub;
    });

    return {
      ...message,
      reactions: [...withoutExistingSameUserReaction, reactionRecord],
    };
  });

  if (!changed) return false;

  await saveAllGroupMessages(updated);
  return true;
}
