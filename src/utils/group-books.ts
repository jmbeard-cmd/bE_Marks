// src/utils/group-books.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    fetchGroupBookEntries,
    publishGroupBookEntry,
} from './nostr';

const GROUP_BOOK_ENTRIES_KEY = 'be_group_book_entries_v2';

export type GroupBookEntryType = 'income' | 'expense';

export type GroupBookEntryStatus = 'pending' | 'confirmed';

export type GroupBookEntry = {
  id: string;
  groupId: string;
  type: GroupBookEntryType;
  amountCents: number;
  title: string;
  description?: string;
  contributorName?: string;
  status: GroupBookEntryStatus;
  createdAt: number;
  createdByNpub: string;
  createdByName?: string;
  relayUrl?: string;
  nostrEventId?: string;
};

export type GroupBookSummary = {
  groupId: string;
  entries: GroupBookEntry[];
  incomeCents: number;
  expenseCents: number;
  pendingIncomeCents: number;
  pendingExpenseCents: number;
  confirmedIncomeCents: number;
  confirmedExpenseCents: number;
  balanceCents: number;
  entryCount: number;
  updatedAt: number;
};

type GroupBooksListener = (groupId: string) => void;

const listeners = new Set<GroupBooksListener>();

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.warn(`[Group Books] failed to read ${key}:`, error);
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[Group Books] failed to write ${key}:`, error);
  }
}

async function readEntries(): Promise<GroupBookEntry[]> {
  return readJson<GroupBookEntry[]>(GROUP_BOOK_ENTRIES_KEY, []);
}

async function writeEntries(entries: GroupBookEntry[]): Promise<void> {
  await writeJson(GROUP_BOOK_ENTRIES_KEY, entries);
}

function emitGroupBooksChanged(groupId: string) {
  listeners.forEach(listener => {
    try {
      listener(groupId);
    } catch (error) {
      console.warn('[Group Books] listener failed:', error);
    }
  });
}

export function subscribeToGroupBooks(listener: GroupBooksListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export async function getBookEntriesForGroup(groupId: string): Promise<GroupBookEntry[]> {
  const entries = await readEntries();

  return entries
    .filter(entry => entry.groupId === groupId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createGroupBookEntry(input: {
  groupId: string;
  type: GroupBookEntryType;
  amountCents: number;
  title: string;
  description?: string;
  contributorName?: string;
  status?: GroupBookEntryStatus;
  createdByNpub: string;
  createdByName?: string;
  relayUrl?: string;
  nsec?: string;
}): Promise<GroupBookEntry> {
  const entries = await readEntries();
  const now = Math.floor(Date.now() / 1000);

  const entry: GroupBookEntry = {
    id: `book_entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId: input.groupId,
    type: input.type,
    amountCents: Math.max(0, Math.round(input.amountCents)),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    contributorName: input.contributorName?.trim() || undefined,
    status: input.status ?? 'confirmed',
    createdAt: now,
    createdByNpub: input.createdByNpub,
    createdByName: input.createdByName,
    relayUrl: input.relayUrl,
  };

  await writeEntries([...entries, entry]);
  emitGroupBooksChanged(input.groupId);

  if (input.nsec && input.relayUrl) {
    publishGroupBookEntry({
      id: entry.id,
      groupId: entry.groupId,
      type: entry.type,
      amountCents: entry.amountCents,
      title: entry.title,
      description: entry.description,
      contributorName: entry.contributorName,
      status: entry.status,
      createdByNpub: entry.createdByNpub,
      createdByName: entry.createdByName,
      nsec: input.nsec,
      relayUrl: input.relayUrl,
    }).then(async result => {
      if (!result.success) {
        console.warn('[Group Books] publish entry failed:', result.error);
        return;
      }

      if (result.eventId) {
        const latestEntries = await readEntries();

        await writeEntries(
          latestEntries.map(item =>
            item.id === entry.id
              ? { ...item, nostrEventId: result.eventId }
              : item
          )
        );

        emitGroupBooksChanged(input.groupId);
      }
    }).catch(error => {
      console.warn('[Group Books] publish entry error:', error);
    });
  }

  return entry;
}

export async function updateGroupBookEntryStatus(
  entryId: string,
  status: GroupBookEntryStatus,
  options?: {
    nsec?: string;
    relayUrl?: string;
  }
): Promise<void> {
  const entries = await readEntries();

  const existingEntry = entries.find(entry => entry.id === entryId);

  if (!existingEntry) return;

  const changedEntry: GroupBookEntry = {
    ...existingEntry,
    status,
  };

  const updated = entries.map(entry =>
    entry.id === entryId ? changedEntry : entry
  );

  await writeEntries(updated);
  emitGroupBooksChanged(changedEntry.groupId);

  if (options?.nsec && options.relayUrl) {
    publishGroupBookEntry({
      id: changedEntry.id,
      groupId: changedEntry.groupId,
      type: changedEntry.type,
      amountCents: changedEntry.amountCents,
      title: changedEntry.title,
      description: changedEntry.description,
      contributorName: changedEntry.contributorName,
      status: changedEntry.status,
      createdByNpub: changedEntry.createdByNpub,
      createdByName: changedEntry.createdByName,
      nsec: options.nsec,
      relayUrl: options.relayUrl,
    }).then(result => {
      if (!result.success) {
        console.warn('[Group Books] publish status update failed:', result.error);
      }
    }).catch(error => {
      console.warn('[Group Books] publish status update error:', error);
    });
  }
}

export async function syncGroupBookEntriesFromRelay(
  groupId: string,
  relayUrl?: string
): Promise<GroupBookEntry[]> {
  if (!relayUrl) {
    return getBookEntriesForGroup(groupId);
  }

  const remoteEntries = await fetchGroupBookEntries(groupId, relayUrl);
  const localEntries = await readEntries();

  const entryMap = new Map<string, GroupBookEntry>();

  for (const entry of localEntries) {
    entryMap.set(entry.id, entry);
  }

  for (const remoteEntry of remoteEntries) {
    const existing = entryMap.get(remoteEntry.id);

    const mergedEntry: GroupBookEntry = {
      id: remoteEntry.id,
      groupId: remoteEntry.groupId,
      type: remoteEntry.type,
      amountCents: remoteEntry.amountCents,
      title: remoteEntry.title,
      description: remoteEntry.description,
      contributorName: remoteEntry.contributorName,
      status: remoteEntry.status,
      createdAt: remoteEntry.createdAt,
      createdByNpub: remoteEntry.createdByNpub || existing?.createdByNpub || '',
      createdByName: remoteEntry.createdByName || existing?.createdByName,
      relayUrl: remoteEntry.relayUrl || relayUrl,
      nostrEventId: remoteEntry.nostrEventId || existing?.nostrEventId,
    };

    if (!existing || remoteEntry.createdAt >= existing.createdAt || existing.status !== remoteEntry.status) {
      entryMap.set(remoteEntry.id, mergedEntry);
    }
  }

  const mergedEntries = Array.from(entryMap.values());

  await writeEntries(mergedEntries);
  emitGroupBooksChanged(groupId);

  return mergedEntries
    .filter(entry => entry.groupId === groupId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function publishUnsyncedGroupBookEntries(input: {
  groupId: string;
  nsec?: string;
  relayUrl?: string;
  force?: boolean;
}): Promise<void> {
  if (!input.nsec || !input.relayUrl) return;

  const entries = await getBookEntriesForGroup(input.groupId);

  const entriesToPublish = input.force
    ? entries
    : entries.filter(entry => !entry.nostrEventId);

  if (entriesToPublish.length === 0) return;

  for (const entry of entriesToPublish) {
    try {
      const result = await publishGroupBookEntry({
        id: entry.id,
        groupId: entry.groupId,
        type: entry.type,
        amountCents: entry.amountCents,
        title: entry.title,
        description: entry.description,
        contributorName: entry.contributorName,
        status: entry.status,
        createdByNpub: entry.createdByNpub,
        createdByName: entry.createdByName,
        nsec: input.nsec,
        relayUrl: input.relayUrl,
      });

      if (!result.success) {
        console.warn('[Group Books] backfill publish failed:', result.error);
        continue;
      }

      if (result.eventId) {
        const latestEntries = await readEntries();

        await writeEntries(
          latestEntries.map(item =>
            item.id === entry.id
              ? { ...item, nostrEventId: result.eventId }
              : item
          )
        );
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    } catch (error) {
      console.warn('[Group Books] backfill publish error:', error);
    }
  }

  emitGroupBooksChanged(input.groupId);
}

export async function getBookSummaryForGroup(groupId: string): Promise<GroupBookSummary> {
  const entries = await getBookEntriesForGroup(groupId);

  const confirmedEntries = entries.filter(entry => entry.status === 'confirmed');
  const pendingEntries = entries.filter(entry => entry.status === 'pending');

  const confirmedIncomeCents = confirmedEntries
    .filter(entry => entry.type === 'income')
    .reduce((sum, entry) => sum + entry.amountCents, 0);

  const confirmedExpenseCents = confirmedEntries
    .filter(entry => entry.type === 'expense')
    .reduce((sum, entry) => sum + entry.amountCents, 0);

  const pendingIncomeCents = pendingEntries
    .filter(entry => entry.type === 'income')
    .reduce((sum, entry) => sum + entry.amountCents, 0);

  const pendingExpenseCents = pendingEntries
    .filter(entry => entry.type === 'expense')
    .reduce((sum, entry) => sum + entry.amountCents, 0);

  const incomeCents = confirmedIncomeCents;
  const expenseCents = confirmedExpenseCents;
  const balanceCents = confirmedIncomeCents - confirmedExpenseCents;

  return {
    groupId,
    entries,
    incomeCents,
    expenseCents,
    pendingIncomeCents,
    pendingExpenseCents,
    confirmedIncomeCents,
    confirmedExpenseCents,
    balanceCents,
    entryCount: entries.length,
    updatedAt: entries[0]?.createdAt ?? 0,
  };
}

export async function clearGroupBookEntriesForGroup(groupId: string): Promise<void> {
  const entries = await readEntries();
  await writeEntries(entries.filter(entry => entry.groupId !== groupId));
  emitGroupBooksChanged(groupId);
}

export async function clearGroupBooks(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GROUP_BOOK_ENTRIES_KEY);
  } catch (error) {
    console.warn('[Group Books] failed to clear:', error);
  }
}