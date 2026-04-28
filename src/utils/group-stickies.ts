import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchGroupStickies,
  getStoredIdentity,
  publishGroupSticky,
} from './nostr';
const GROUP_STICKIES_KEY = 'be_group_stickies_v1';
const GROUP_HIDDEN_STICKIES_KEY = 'be_group_hidden_stickies_v1';

export type GroupStickyMedia = {
  id: string;
  uri: string;
  type: 'image' | 'video' | 'file';
  name?: string;
  thumbnailUri?: string;
};

export type GroupSticky = {
  id: string;
  groupId: string;
  title: string;
  body: string;
  media?: GroupStickyMedia[];
  authorName?: string;
  authorNpub?: string;
  relayUrl?: string;
  createdAt: number;
  updatedAt: number;
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

export async function getStickiesForGroup(groupId: string): Promise<GroupSticky[]> {
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  const hiddenIds = await readJson<string[]>(GROUP_HIDDEN_STICKIES_KEY, []);

  return all
    .filter(sticky => sticky.groupId === groupId)
    .filter(sticky => !hiddenIds.includes(sticky.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createGroupSticky(input: {
  groupId: string;
  title: string;
  body: string;
  media?: GroupStickyMedia[];
  authorName?: string;
  authorNpub?: string;
  relayUrl?: string;
}): Promise<GroupSticky> {
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  const now = Math.floor(Date.now() / 1000);

  const sticky: GroupSticky = {
    id: `sticky_${Date.now()}`,
    groupId: input.groupId,
    title: input.title.trim(),
    body: input.body.trim(),
    media: input.media ?? [],
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
        authorNpub: sticky.authorNpub,
        nsec: identity.nsec,
        relayUrl: input.relayUrl,
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

export async function syncGroupStickiesFromRelay(
  groupId: string,
  relayUrl: string,
): Promise<GroupSticky[]> {
  const remoteEvents = await fetchGroupStickies(groupId, relayUrl);
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  const hiddenIds = await readJson<string[]>(GROUP_HIDDEN_STICKIES_KEY, []);

  const localForGroup = all
    .filter(sticky => sticky.groupId === groupId)
    .filter(sticky => !hiddenIds.includes(sticky.id));

  const otherStickies = all.filter(sticky => sticky.groupId !== groupId);

  const stickyMap = new Map<string, GroupSticky>();

  for (const sticky of localForGroup) {
    stickyMap.set(sticky.id, sticky);
  }

  for (const event of remoteEvents) {
    try {
      const parsed = JSON.parse(event.content || '{}');

      if (!parsed.id || parsed.groupId !== groupId) continue;
      if (hiddenIds.includes(parsed.id)) continue;

      const existing = stickyMap.get(parsed.id);

      const remoteSticky: GroupSticky = {
        id: parsed.id,
        groupId: parsed.groupId,
        title: parsed.title || '',
        body: parsed.body || '',
        media: Array.isArray(parsed.media) ? parsed.media : [],
        authorName: parsed.authorName,
        authorNpub: parsed.authorNpub,
        relayUrl,
        createdAt: parsed.createdAt || event.created_at,
        updatedAt: parsed.updatedAt || event.created_at,
      };

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