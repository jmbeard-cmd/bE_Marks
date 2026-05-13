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

export type GroupMessagePollOption = {
  id: string;
  text: string;
};

export type GroupMessagePollVote = {
  id: string;
  groupId: string;
  messageId?: string;
  clientMessageId: string;
  optionId: string;
  voterNpub?: string;
  voterName?: string;
  createdAt: number;
};

export type GroupMessagePoll = {
  id: string;
  question: string;
  options: GroupMessagePollOption[];
  votes?: GroupMessagePollVote[];
};


export type GroupMessage = {
  id: string;
  clientMessageId: string;
  groupId: string;
  text?: string;
    kind?: 'message' | 'system';
  systemType?: 'join' | 'leave' | 'remove';

  // Reply metadata
  replyToMessageId?: string;
  replyToClientMessageId?: string;
  replyPreviewText?: string;
  replyPreviewSenderName?: string;

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

  // Poll metadata
  poll?: GroupMessagePoll;


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
  poll?: GroupMessagePoll;
}) {
  if (input.isDeleted) return 'Message deleted';

  if (input.poll?.question) {
    return `📊 ${input.poll.question}`;
  }

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

function isMembershipSystemText(text?: string): boolean {
  const value = text?.trim();

  if (!value) return false;

  return (
    value.endsWith(' joined the group') ||
    value.endsWith(' left the group') ||
    value.endsWith(' was removed from the group')
  );
}

function createPollOptionId(index: number): string {
  return `poll_option_${index + 1}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePoll(input?: {
  id?: string;
  question?: string;
  options?: { id?: string; text?: string }[];
  votes?: GroupMessagePollVote[];
}): GroupMessagePoll | undefined {
  const question = input?.question?.trim();

  if (!question) return undefined;

  const options = Array.isArray(input?.options)
    ? input.options
        .map((option, index) => ({
          id: option.id || createPollOptionId(index),
          text: option.text?.trim() || '',
        }))
        .filter(option => !!option.text)
    : [];

  if (options.length < 2) return undefined;

  return {
    id: input?.id || `poll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    question,
    options,
    votes: Array.isArray(input?.votes) ? input.votes : [],
  };
}


export async function getAllGroupMessages(): Promise<GroupMessage[]> {
  return await readJson<GroupMessage[]>(GROUP_MESSAGES_KEY, []);
}

export async function saveAllGroupMessages(messages: GroupMessage[]): Promise<void> {
  await writeJson(GROUP_MESSAGES_KEY, messages);
}

export async function saveLocalGroupSystemMessage(input: {
  groupId: string;
  text: string;
  systemType: 'join' | 'leave' | 'remove';
  actorNpub?: string;
  actorName?: string;
  createdAt?: number;
}): Promise<GroupMessage> {
  const allMessages = await getAllGroupMessages();
  const now = input.createdAt ?? Math.floor(Date.now() / 1000);
  const safeText = input.text.trim();
  const actorKey = input.actorNpub || input.actorName || 'unknown';
  const duplicateWindowSeconds = 5;

  const existing = allMessages.find(message =>
    message.groupId === input.groupId &&
    message.kind === 'system' &&
    message.systemType === input.systemType &&
    message.text?.trim() === safeText &&
    Math.abs(message.createdAt - now) <= duplicateWindowSeconds
  );

  if (existing) return existing;

  const clientMessageId = `system_${input.systemType}_${input.groupId}_${actorKey}_${now}`;

  const systemMessage: GroupMessage = {
    id: clientMessageId,
    clientMessageId,
    groupId: input.groupId,
    text: safeText,
    kind: 'system',
    systemType: input.systemType,
    mine: false,
    senderNpub: input.actorNpub,
    senderName: input.actorName || 'System',
    createdAt: now,
  };

  allMessages.push(systemMessage);
  allMessages.sort((a, b) => a.createdAt - b.createdAt);

  await saveAllGroupMessages(allMessages);
  await recordGroupPost(input.groupId, safeText);

  return systemMessage;
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

  // Reply metadata
  replyToMessageId?: string;
  replyToClientMessageId?: string;
  replyPreviewText?: string;
  replyPreviewSenderName?: string;

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

    replyToMessageId: input.replyToMessageId,
    replyToClientMessageId: input.replyToClientMessageId,
    replyPreviewText: input.replyPreviewText,
    replyPreviewSenderName: input.replyPreviewSenderName,

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

export async function sendLocalGroupPoll(input: {
  groupId: string;
  clientMessageId?: string;
  question: string;
  options: string[];
  mine?: boolean;
  senderNpub?: string;
  senderName?: string;
}): Promise<GroupMessage> {
  const question = input.question.trim();

  const poll = normalizePoll({
    question,
    options: input.options.map((text, index) => ({
      id: createPollOptionId(index),
      text,
    })),
  });

  if (!poll) {
    throw new Error('Polls need a question and at least two options.');
  }

  const allMessages = await getAllGroupMessages();
  const clientMessageId = input.clientMessageId || createClientMessageId(input.groupId);

  const newMessage: GroupMessage = {
    id: clientMessageId,
    clientMessageId,
    groupId: input.groupId,
    poll,
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

export async function editGroupMessage(input: {
  groupId: string;
  messageId: string;
  clientMessageId?: string;
  text: string;
  editedAt?: number;
}): Promise<GroupMessage | null> {
  const trimmedText = input.text.trim();

  if (!trimmedText) {
    throw new Error('Cannot save an empty group message edit');
  }

  const all = await getAllGroupMessages();
  const now = input.editedAt ?? Math.floor(Date.now() / 1000);
  let editedMessage: GroupMessage | null = null;

  const updated = all.map(message => {
    const matchesId = message.id === input.messageId;
    const matchesClientId =
      !!input.clientMessageId &&
      message.clientMessageId === input.clientMessageId;

    if (message.groupId !== input.groupId || (!matchesId && !matchesClientId)) {
      return message;
    }

    if (message.isDeleted) {
      return message;
    }

    const currentText = message.text?.trim() || '';
    const currentMedia = normalizeMessageMedia(message);

    if (!currentText || currentMedia.length > 0) {
      return message;
    }

    const nextMessage: GroupMessage = {
      ...message,
      text: trimmedText,
      editedAt: now,
    };

    editedMessage = nextMessage;
    return nextMessage;
  });

  if (!editedMessage) return null;

  await saveAllGroupMessages(updated);
  await recordGroupPost(input.groupId, trimmedText);

  return editedMessage;
}

export async function saveRemoteGroupMessage(input: {
  id: string;
  clientMessageId?: string;
  groupId: string;
  text?: string;
  kind?: 'message' | 'system';
  systemType?: 'join' | 'leave' | 'remove';

  // Reply metadata
  replyToMessageId?: string;
  replyToClientMessageId?: string;
  replyPreviewText?: string;
  replyPreviewSenderName?: string;

  // New multi-attachment support
  media?: GroupMessageMedia[];

  // Poll support
  poll?: GroupMessagePoll;

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
  const poll = normalizePoll(input.poll);
  const clientMessageId = input.clientMessageId || input.id;

  const existsById = allMessages.some(message => message.id === input.id);
  if (existsById) return;

  const existsByClientMessageId = allMessages.some(message => {
    return !!clientMessageId && message.clientMessageId === clientMessageId;
  });

  if (existsByClientMessageId) return;

const incomingText = input.text?.trim();

if (incomingText && isMembershipSystemText(incomingText)) {
  const duplicateWindowSeconds = 5;

  const existingMembershipNotice = allMessages.some(message =>
    message.groupId === input.groupId &&
    isMembershipSystemText(message.text) &&
    message.text?.trim() === incomingText &&
    Math.abs(message.createdAt - input.createdAt) <= duplicateWindowSeconds
  );

  if (existingMembershipNotice) return;
}

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
    const samePoll =
      !!poll &&
      !!message.poll &&
      message.poll.question === poll.question &&
      message.poll.options.map(option => option.text).join('|') === poll.options.map(option => option.text).join('|');

    const closeInTime = Math.abs(message.createdAt - input.createdAt) <= 10;

    return (
      sameGroup &&
      sameMine &&
      closeInTime &&
      (
        (sameText && samePrimaryMedia && sameMediaList) ||
        samePoll
      )
    );
  });


  if (existsByContent) return;

  const newMessage: GroupMessage = {
    id: input.id,
    clientMessageId,
    groupId: input.groupId,
    text: input.text,
    kind: input.kind,
    systemType: input.systemType,

    replyToMessageId: input.replyToMessageId,
    replyToClientMessageId: input.replyToClientMessageId,
    replyPreviewText: input.replyPreviewText,
    replyPreviewSenderName: input.replyPreviewSenderName,

    media,
    poll,

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

export async function addGroupPollVote(input: {
  groupId: string;
  messageId: string;
  clientMessageId?: string;
  optionId: string;
  voterNpub?: string;
  voterName?: string;
  createdAt?: number;
}): Promise<boolean> {
  const all = await getAllGroupMessages();
  const now = input.createdAt ?? Math.floor(Date.now() / 1000);
  const clientMessageId = input.clientMessageId || input.messageId;
  let changed = false;

  const voteRecord: GroupMessagePollVote = {
    id: `poll_vote_${clientMessageId}_${input.voterNpub || 'unknown'}_${input.optionId}`,
    groupId: input.groupId,
    messageId: input.messageId,
    clientMessageId,
    optionId: input.optionId,
    voterNpub: input.voterNpub,
    voterName: input.voterName,
    createdAt: now,
  };

  const updated = all.map(message => {
    const matchesId = message.id === input.messageId;
    const matchesClientId = message.clientMessageId === clientMessageId;

    if (message.groupId !== input.groupId || (!matchesId && !matchesClientId)) {
      return message;
    }

    if (message.isDeleted || !message.poll) {
      return message;
    }

    const optionExists = message.poll.options.some(option => option.id === input.optionId);

    if (!optionExists) {
      return message;
    }

    changed = true;

    const existingVotes = Array.isArray(message.poll.votes)
      ? message.poll.votes
      : [];

    const withoutExistingSameUserVote = existingVotes.filter(existing => {
      if (!input.voterNpub) {
        return existing.id !== voteRecord.id;
      }

      return existing.voterNpub !== input.voterNpub;
    });

    return {
      ...message,
      poll: {
        ...message.poll,
        votes: [...withoutExistingSameUserVote, voteRecord],
      },
    };
  });

  if (!changed) return false;

  await saveAllGroupMessages(updated);
  return true;
}