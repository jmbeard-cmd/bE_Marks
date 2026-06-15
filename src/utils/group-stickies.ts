import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchGroupStickies,
  getStoredIdentity,
  publishGroupSticky,
} from './nostr';
const GROUP_STICKIES_KEY = 'be_group_stickies_v1';
const GROUP_HIDDEN_STICKIES_KEY = 'be_group_hidden_stickies_v1';
const GROUP_DELETED_STICKIES_KEY = 'be_group_deleted_stickies_v1';

export type GroupStickyMedia = {
  id: string;
  uri: string;
  type: 'image' | 'video' | 'file';
  name?: string;
  thumbnailUri?: string;
};

export type GroupBoardDisplayMode = 'pin' | 'announcement' | 'alert';

export type GroupBoardPriority = 'normal' | 'high';

export type GroupStickyTrustedAuthor = {
  npub?: string;
  pubkeyHex?: string;
};

export type GroupSticky = {
  id: string;
  groupId: string;
  title: string;
  body: string;
  media?: GroupStickyMedia[];

  // Board / Bulletin presentation.
  // Kept optional so existing Sticky/Highlight events remain valid.
  displayMode?: GroupBoardDisplayMode;
  priority?: GroupBoardPriority;
  expiresAt?: number;

  authorName?: string;
  authorNpub?: string;
  relayUrl?: string;
  status?: 'active' | 'deleted';
  deletedAt?: number;
  deletedByNpub?: string;
  createdAt: number;
  updatedAt: number;
};

type GroupStickyDeletion = {
  id: string;
  groupId: string;
  deletedAt: number;
  deletedByNpub?: string;
  relayUrl?: string;
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[Group Stickies] write failed:', error);
  }
}

function isTrustedStickyAuthor(
  eventPubkey: string | undefined,
  authorNpub: string | undefined,
  trustedAuthors?: GroupStickyTrustedAuthor[]
): boolean {
  if (!trustedAuthors) return true;

  const trustedNpubs = new Set(
    trustedAuthors
      .map(author => author.npub)
      .filter((value): value is string => !!value)
  );

  const trustedPubkeys = new Set(
    trustedAuthors
      .map(author => author.pubkeyHex?.toLowerCase())
      .filter((value): value is string => !!value)
  );

  const normalizedEventPubkey = eventPubkey?.toLowerCase();

  if (normalizedEventPubkey) {
    return trustedPubkeys.has(normalizedEventPubkey);
  }

  const normalizedAuthorNpub = authorNpub?.trim();

  return !!normalizedAuthorNpub && trustedNpubs.has(normalizedAuthorNpub);
}

function getLatestDeletionMapForGroup(
  deletions: GroupStickyDeletion[],
  groupId: string
): Map<string, GroupStickyDeletion> {
  const deletionMap = new Map<string, GroupStickyDeletion>();

  deletions
    .filter(deletion => deletion.groupId === groupId)
    .forEach(deletion => {
      const existing = deletionMap.get(deletion.id);

      if (!existing || deletion.deletedAt >= existing.deletedAt) {
        deletionMap.set(deletion.id, deletion);
      }
    });

  return deletionMap;
}

function isStickyDeleted(
  sticky: GroupSticky,
  deletionMap: Map<string, GroupStickyDeletion>
): boolean {
  const deletion = deletionMap.get(sticky.id);

  if (!deletion) return false;

  return deletion.deletedAt >= (sticky.updatedAt || sticky.createdAt || 0);
}

async function rememberDeletedSticky(deletion: GroupStickyDeletion): Promise<void> {
  const deletions = await readJson<GroupStickyDeletion[]>(GROUP_DELETED_STICKIES_KEY, []);
  const deletionMap = getLatestDeletionMapForGroup(deletions, deletion.groupId);
  const existing = deletionMap.get(deletion.id);

  if (existing && existing.deletedAt >= deletion.deletedAt) return;

  const next = [
    ...deletions.filter(item => !(item.groupId === deletion.groupId && item.id === deletion.id)),
    deletion,
  ];

  await writeJson(GROUP_DELETED_STICKIES_KEY, next);
}

export async function getStickiesForGroup(groupId: string): Promise<GroupSticky[]> {
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  const hiddenIds = await readJson<string[]>(GROUP_HIDDEN_STICKIES_KEY, []);
  const deletions = await readJson<GroupStickyDeletion[]>(GROUP_DELETED_STICKIES_KEY, []);
  const deletionMap = getLatestDeletionMapForGroup(deletions, groupId);

  return all
    .filter(sticky => sticky.groupId === groupId)
    .filter(sticky => sticky.status !== 'deleted')
    .filter(sticky => !hiddenIds.includes(sticky.id))
    .filter(sticky => !isStickyDeleted(sticky, deletionMap))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createGroupSticky(input: {
  groupId: string;
  title: string;
  body: string;
  media?: GroupStickyMedia[];
  displayMode?: GroupBoardDisplayMode;
  priority?: GroupBoardPriority;
  expiresAt?: number;
  authorName?: string;
  authorNpub?: string;
  nsec: string;
  relayUrl: string;
  relayUrls?: string[];
}): Promise<GroupSticky> {
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  const now = Math.floor(Date.now() / 1000);

  const sticky: GroupSticky = {
    id: `sticky_${Date.now()}`,
    groupId: input.groupId,
    title: input.title.trim(),
    body: input.body.trim(),
    media: input.media ?? [],
    displayMode: input.displayMode ?? 'pin',
    priority: input.priority ?? 'normal',
    expiresAt: input.expiresAt,
    authorName: input.authorName,
    authorNpub: input.authorNpub,
    relayUrl: input.relayUrl,
    createdAt: now,
    updatedAt: now,
  };

  all.push(sticky);
  await writeJson(GROUP_STICKIES_KEY, all);

  if (input.relayUrl) {
    const identity = await getStoredIdentity();

    if (identity?.nsec) {
      publishGroupSticky({
        stickyId: sticky.id,
        groupId: sticky.groupId,
        title: sticky.title,
        body: sticky.body,
        media: sticky.media ?? [],
        displayMode: sticky.displayMode,
        priority: sticky.priority,
        expiresAt: sticky.expiresAt,
        authorName: sticky.authorName,
        authorNpub: sticky.authorNpub,
        nsec: identity.nsec,
        relayUrl: input.relayUrl,
        relayUrls: input.relayUrls,
      }).catch(error => {
        console.warn('[Group Stickies] publish failed:', error);
      });
    }
  }

  return sticky;
}

export async function deleteGroupSticky(stickyId: string): Promise<void> {
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  await writeJson(
    GROUP_STICKIES_KEY,
    all.filter(sticky => sticky.id !== stickyId)
  );
}

export async function hideGroupSticky(stickyId: string): Promise<void> {
  const hiddenIds = await readJson<string[]>(GROUP_HIDDEN_STICKIES_KEY, []);

  if (!hiddenIds.includes(stickyId)) {
    await writeJson(GROUP_HIDDEN_STICKIES_KEY, [...hiddenIds, stickyId]);
  }

  await deleteGroupSticky(stickyId);
}

export async function removeGroupStickyFromSpace(input: {
  stickyId: string;
  groupId: string;
  relayUrl?: string;
  relayUrls?: string[];
  deletedByNpub?: string;
}): Promise<boolean> {
  const relayUrls = Array.from(new Set([
    ...(input.relayUrl ? [input.relayUrl] : []),
    ...(input.relayUrls ?? []),
  ])).filter(relayUrl => relayUrl.startsWith('wss://') || relayUrl.startsWith('ws://'));

  const primaryRelayUrl = relayUrls[0];

  if (!primaryRelayUrl) {
    console.warn('[Group Stickies] shared delete skipped; no relay URL configured.');
    return false;
  }

  const identity = await getStoredIdentity();

  if (!identity?.nsec) {
    console.warn('[Group Stickies] shared delete skipped; missing nsec.');
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  const result = await publishGroupSticky({
    stickyId: input.stickyId,
    groupId: input.groupId,
    title: '',
    body: '',
    media: [],
    displayMode: 'pin',
    priority: 'normal',
    authorNpub: input.deletedByNpub,
    status: 'deleted',
    deletedAt: now,
    deletedByNpub: input.deletedByNpub,
    nsec: identity.nsec,
    relayUrl: primaryRelayUrl,
    relayUrls,
  });

  if (!result.success) {
    console.warn('[Group Stickies] shared delete publish failed:', result.error);
    return false;
  }

  await rememberDeletedSticky({
    id: input.stickyId,
    groupId: input.groupId,
    deletedAt: now,
    deletedByNpub: input.deletedByNpub,
    relayUrl: primaryRelayUrl,
  });

  await hideGroupSticky(input.stickyId);

  return true;
}

export async function publishHiddenGroupStickyDeletesForGroup(input: {
  groupId: string;
  relayUrl?: string;
  relayUrls?: string[];
  deletedByNpub?: string;
  limit?: number;
}): Promise<number> {
  const hiddenIds = await readJson<string[]>(GROUP_HIDDEN_STICKIES_KEY, []);
  const deletions = await readJson<GroupStickyDeletion[]>(GROUP_DELETED_STICKIES_KEY, []);
  const deletionMap = getLatestDeletionMapForGroup(deletions, input.groupId);
  const limit = input.limit ?? 50;

  const candidates = hiddenIds
    .filter(stickyId => !!stickyId && !deletionMap.has(stickyId))
    .slice(0, limit);

  if (candidates.length === 0) return 0;

  let publishedCount = 0;

  for (const stickyId of candidates) {
    const removed = await removeGroupStickyFromSpace({
      stickyId,
      groupId: input.groupId,
      relayUrl: input.relayUrl,
      relayUrls: input.relayUrls,
      deletedByNpub: input.deletedByNpub,
    });

    if (removed) {
      publishedCount += 1;
    }

    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return publishedCount;
}

export async function syncGroupStickiesFromRelay(
  groupId: string,
  relayUrl: string,
  trustedAuthors?: GroupStickyTrustedAuthor[],
): Promise<GroupSticky[]> {
  const remoteEvents = await fetchGroupStickies(groupId, relayUrl);
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  const hiddenIds = await readJson<string[]>(GROUP_HIDDEN_STICKIES_KEY, []);
  const storedDeletions = await readJson<GroupStickyDeletion[]>(GROUP_DELETED_STICKIES_KEY, []);

  const deletionMap = getLatestDeletionMapForGroup(storedDeletions, groupId);

  for (const event of remoteEvents) {
    try {
      const parsed = JSON.parse(event.content || '{}');

      if (!parsed.id || parsed.groupId !== groupId) continue;

      const isDeleted =
        parsed.status === 'deleted' ||
        typeof parsed.deletedAt === 'number';

      if (!isDeleted) continue;

      if (!isTrustedStickyAuthor(event.pubkey, parsed.deletedByNpub || parsed.authorNpub, trustedAuthors)) {
        continue;
      }

      const deletedAt =
        parsed.deletedAt ||
        parsed.updatedAt ||
        event.created_at ||
        Math.floor(Date.now() / 1000);

      const existing = deletionMap.get(parsed.id);

      if (!existing || deletedAt >= existing.deletedAt) {
        deletionMap.set(parsed.id, {
          id: parsed.id,
          groupId,
          deletedAt,
          deletedByNpub: parsed.deletedByNpub || parsed.authorNpub,
          relayUrl,
        });
      }
    } catch {
      // ignore bad deletion events
    }
  }

  const nextDeletions = [
    ...storedDeletions.filter(deletion => deletion.groupId !== groupId),
    ...Array.from(deletionMap.values()),
  ];

  await writeJson(GROUP_DELETED_STICKIES_KEY, nextDeletions);

  const localForGroup = all
    .filter(sticky => sticky.groupId === groupId)
    .filter(sticky => sticky.status !== 'deleted')
    .filter(sticky => !hiddenIds.includes(sticky.id))
    .filter(sticky => !isStickyDeleted(sticky, deletionMap))
    .filter(sticky => isTrustedStickyAuthor(undefined, sticky.authorNpub, trustedAuthors));

  const otherStickies = all.filter(sticky => sticky.groupId !== groupId);

  const stickyMap = new Map<string, GroupSticky>();

  for (const sticky of localForGroup) {
    stickyMap.set(sticky.id, sticky);
  }

  for (const event of remoteEvents) {
    try {
      const parsed = JSON.parse(event.content || '{}');

      if (!parsed.id || parsed.groupId !== groupId) continue;
      if (parsed.status === 'deleted' || typeof parsed.deletedAt === 'number') continue;
      if (hiddenIds.includes(parsed.id)) continue;

      if (!isTrustedStickyAuthor(event.pubkey, parsed.authorNpub, trustedAuthors)) {
        continue;
      }

      const remoteSticky: GroupSticky = {
        id: parsed.id,
        groupId: parsed.groupId,
        title: parsed.title || '',
        body: parsed.body || '',
        media: Array.isArray(parsed.media) ? parsed.media : [],
        displayMode:
          parsed.displayMode === 'announcement' || parsed.displayMode === 'alert'
            ? parsed.displayMode
            : 'pin',
        priority: parsed.priority === 'high' ? 'high' : 'normal',
        expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
        authorName: parsed.authorName,
        authorNpub: parsed.authorNpub,
        relayUrl,
        status: parsed.status === 'active' ? 'active' : undefined,
        createdAt: parsed.createdAt || event.created_at,
        updatedAt: parsed.updatedAt || event.created_at,
      };

      if (isStickyDeleted(remoteSticky, deletionMap)) {
        continue;
      }

      const existing = stickyMap.get(parsed.id);

      if (!existing || remoteSticky.updatedAt >= existing.updatedAt) {
        stickyMap.set(remoteSticky.id, remoteSticky);
      }
    } catch {
      // ignore bad events
    }
  }

  const merged = Array.from(stickyMap.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  await writeJson(GROUP_STICKIES_KEY, [...otherStickies, ...merged]);

  return merged;
}