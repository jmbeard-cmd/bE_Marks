import AsyncStorage from '@react-native-async-storage/async-storage';

const GROUP_STICKIES_KEY = 'be_group_stickies_v1';

export type GroupSticky = {
  id: string;
  groupId: string;
  title: string;
  body: string;
  authorName?: string;
  authorNpub?: string;
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

  return all
    .filter(sticky => sticky.groupId === groupId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createGroupSticky(input: {
  groupId: string;
  title: string;
  body: string;
  authorName?: string;
  authorNpub?: string;
}): Promise<GroupSticky> {
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  const now = Math.floor(Date.now() / 1000);

  const sticky: GroupSticky = {
    id: `sticky_${Date.now()}`,
    groupId: input.groupId,
    title: input.title.trim(),
    body: input.body.trim(),
    authorName: input.authorName,
    authorNpub: input.authorNpub,
    createdAt: now,
    updatedAt: now,
  };

  all.push(sticky);
  await writeJson(GROUP_STICKIES_KEY, all);

  return sticky;
}

export async function deleteGroupSticky(stickyId: string): Promise<void> {
  const all = await readJson<GroupSticky[]>(GROUP_STICKIES_KEY, []);
  await writeJson(
    GROUP_STICKIES_KEY,
    all.filter(sticky => sticky.id !== stickyId)
  );
}