import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAllGroupMessages,
  type GroupMessage,
} from './group-messages';

const GROUP_CHAT_READ_STATE_KEY_PREFIX = 'be_group_chat_read_state_v1';

type GroupChatReadState = Record<string, number>;
type GroupChatReadStateListener = (change: {
  readerNpub: string;
  groupId?: string;
}) => void;

const listeners = new Set<GroupChatReadStateListener>();

function normalizeReaderNpub(readerNpub?: string | null): string {
  return (readerNpub || '').trim().toLowerCase();
}

function getReadStateKey(readerNpub: string): string {
  return `${GROUP_CHAT_READ_STATE_KEY_PREFIX}_${readerNpub}`;
}

async function readGroupChatReadState(readerNpub: string): Promise<GroupChatReadState> {
  const normalizedReader = normalizeReaderNpub(readerNpub);

  if (!normalizedReader) return {};

  try {
    const raw = await AsyncStorage.getItem(getReadStateKey(normalizedReader));
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    return parsed as GroupChatReadState;
  } catch (error) {
    console.warn('[Group Read State] failed to read group chat state:', error);
    return {};
  }
}

async function writeGroupChatReadState(
  readerNpub: string,
  state: GroupChatReadState
): Promise<void> {
  const normalizedReader = normalizeReaderNpub(readerNpub);

  if (!normalizedReader) return;

  try {
    await AsyncStorage.setItem(getReadStateKey(normalizedReader), JSON.stringify(state));
  } catch (error) {
    console.warn('[Group Read State] failed to write group chat state:', error);
  }
}

function emitGroupChatReadStateChange(readerNpub: string, groupId?: string): void {
  const normalizedReader = normalizeReaderNpub(readerNpub);

  if (!normalizedReader) return;

  listeners.forEach(listener => {
    try {
      listener({ readerNpub: normalizedReader, groupId });
    } catch {}
  });
}

function hasReadCursor(state: GroupChatReadState, groupId: string): boolean {
  return Object.prototype.hasOwnProperty.call(state, groupId);
}

function isCountableUnreadGroupMessage(
  message: GroupMessage,
  readerNpub: string
): boolean {
  if (message.isDeleted) return false;
  if (message.kind === 'system') return false;
  if (message.mine) return false;

  const senderNpub = normalizeReaderNpub(message.senderNpub);

  if (senderNpub && senderNpub === readerNpub) return false;

  return true;
}

export function subscribeToGroupChatReadStateChanges(
  listener: GroupChatReadStateListener
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getLatestReadableGroupMessageCreatedAt(messages: GroupMessage[]): number {
  return messages.reduce((latest, message) => {
    if (message.isDeleted) return latest;

    return Math.max(latest, message.createdAt || 0);
  }, 0);
}

export async function markGroupChatRead(
  readerNpub: string,
  groupId: string,
  readAt: number
): Promise<void> {
  const normalizedReader = normalizeReaderNpub(readerNpub);
  const normalizedReadAt = Math.floor(readAt || 0);

  if (!normalizedReader || !groupId || normalizedReadAt <= 0) return;

  const state = await readGroupChatReadState(normalizedReader);
  const currentReadAt = state[groupId] ?? 0;

  if (normalizedReadAt <= currentReadAt) return;

  await writeGroupChatReadState(normalizedReader, {
    ...state,
    [groupId]: normalizedReadAt,
  });
  emitGroupChatReadStateChange(normalizedReader, groupId);
}

export async function baselineGroupChatReadCursors(
  readerNpub: string,
  groupIds: string[]
): Promise<void> {
  const normalizedReader = normalizeReaderNpub(readerNpub);
  const uniqueGroupIds = Array.from(new Set(groupIds.filter(Boolean)));

  if (!normalizedReader || uniqueGroupIds.length === 0) return;

  const state = await readGroupChatReadState(normalizedReader);
  let changed = false;
  let allMessages: GroupMessage[] | null = null;

  for (const groupId of uniqueGroupIds) {
    if (hasReadCursor(state, groupId)) continue;

    allMessages = allMessages ?? await getAllGroupMessages();

    const latestReadAt = getLatestReadableGroupMessageCreatedAt(
      allMessages.filter(message => message.groupId === groupId)
    );

    state[groupId] = latestReadAt;
    changed = true;
  }

  if (!changed) return;

  await writeGroupChatReadState(normalizedReader, state);
  emitGroupChatReadStateChange(normalizedReader);
}

export async function getGroupChatUnreadCounts(
  readerNpub: string,
  groupIds: string[]
): Promise<Record<string, number>> {
  const normalizedReader = normalizeReaderNpub(readerNpub);
  const uniqueGroupIds = Array.from(new Set(groupIds.filter(Boolean)));

  if (!normalizedReader || uniqueGroupIds.length === 0) return {};

  const groupIdSet = new Set(uniqueGroupIds);
  const state = await readGroupChatReadState(normalizedReader);
  const counts: Record<string, number> = {};
  const allMessages = await getAllGroupMessages();

  uniqueGroupIds.forEach(groupId => {
    counts[groupId] = 0;
  });

  allMessages.forEach(message => {
    if (!groupIdSet.has(message.groupId)) return;
    if (!isCountableUnreadGroupMessage(message, normalizedReader)) return;

    const readAt = state[message.groupId] ?? 0;

    if ((message.createdAt || 0) > readAt) {
      counts[message.groupId] = (counts[message.groupId] ?? 0) + 1;
    }
  });

  return counts;
}
