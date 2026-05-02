import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearDMStorage } from './dm-storage';
import { clearGroupStorage } from './group-storage';

const MILESTONES_KEY = 'milestones_v1';
const FAMILY_KEY = 'family_v1';
const FAMILY_MEMBERS_KEY = 'family_members_v1';

export type MarkMedia = {
  id: string;
  uri: string;
  type: 'image' | 'video';
  source?: 'local' | 'cloud' | 'r2';
  thumbnailUri?: string;
};

export interface Milestone {
  id: string;
  note: string;
  tags: string[];
  photoUri?: string; // old single-photo support
media?: MarkMedia[]; // new multi-media support
audioUri?: string;
videoUri?: string;
  createdAt: number;
  nostrEventId?: string;
  publishedToRelay: boolean;
  reflections?: { text: string; createdAt: number; authorNpub?: string }[];
  familyId?: string;
  authorNpub?: string;
}

export type FamilyRelayMode = 'default' | 'custom' | 'both';

export interface Family {
  id: string;
  name: string;
  createdAt: number;
  role: 'admin' | 'member';
  relayMode?: FamilyRelayMode;
  relayUrl?: string;
}

export type FamilyMemberRole = 'admin' | 'member';

export interface FamilyMember {
  id: string;
  familyId: string;
  npub: string;
  displayName?: string;
  role: FamilyMemberRole;
  joinedAt: number;
  status: 'active' | 'removed';
}

export async function saveMilestone(m: Omit<Milestone, 'id' | 'createdAt'>): Promise<Milestone> {
  const all = await getMilestones();
  const milestone: Milestone = {
    ...m,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Math.floor(Date.now() / 1000),
  };
  all.unshift(milestone);
  await AsyncStorage.setItem(MILESTONES_KEY, JSON.stringify(all));
  return milestone;
}

export async function saveRemoteMilestone(m: Milestone): Promise<void> {
  const all = await getMilestones();

  const existingIndex = all.findIndex(existing =>
    existing.id === m.id || existing.nostrEventId === m.nostrEventId
  );

  if (existingIndex !== -1) {
    const existing = all[existingIndex];

    const mergedReflections = [
      ...(existing.reflections ?? []),
      ...(m.reflections ?? []),
    ].filter((reflection, index, arr) => {
      return index === arr.findIndex(r =>
        r.text === reflection.text && r.createdAt === reflection.createdAt
      );
    });

    const mergedMedia = [
  ...(existing.media ?? []),
  ...(m.media ?? []),
].filter((media, index, arr) => {
  return index === arr.findIndex(x => x.id === media.id);
});

all[existingIndex] = {
  ...existing,
  ...m,
  media: mergedMedia.length > 0 ? mergedMedia : existing.media ?? [],
  reflections: mergedReflections,
};

    all.sort((a, b) => b.createdAt - a.createdAt);
    await AsyncStorage.setItem(MILESTONES_KEY, JSON.stringify(all));
    return;
  }

  all.unshift(m);
  all.sort((a, b) => b.createdAt - a.createdAt);
  await AsyncStorage.setItem(MILESTONES_KEY, JSON.stringify(all));
}

export async function getMilestones(): Promise<Milestone[]> {
  const raw = await AsyncStorage.getItem(MILESTONES_KEY);
  if (!raw) return [];

  const parsed = JSON.parse(raw);

  return Array.isArray(parsed)
    ? parsed.sort((a, b) => b.createdAt - a.createdAt)
    : [];
}

export async function updateMilestone(id: string, patch: Partial<Milestone>): Promise<void> {
  const all = await getMilestones();
  const idx = all.findIndex(m => m.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  await AsyncStorage.setItem(MILESTONES_KEY, JSON.stringify(all));
}

export async function deleteMilestone(id: string): Promise<void> {
  const all = await getMilestones();
  const filtered = all.filter(m => m.id !== id);
  await AsyncStorage.setItem(MILESTONES_KEY, JSON.stringify(filtered));
}

export async function saveFamily(family: Family): Promise<void> {
  const normalized: Family = {
    ...family,
    relayMode: family.relayMode ?? 'default',
    relayUrl: family.relayUrl?.trim() || undefined,
  };

  await AsyncStorage.setItem(FAMILY_KEY, JSON.stringify(normalized));
}

export async function getFamily(): Promise<Family | null> {
  const raw = await AsyncStorage.getItem(FAMILY_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function leaveFamily(): Promise<void> {
  const family = await getFamily();

  await AsyncStorage.removeItem(FAMILY_KEY);

  if (family?.id) {
    const members = await readFamilyMembers();
    const filtered = members.filter(member => member.familyId !== family.id);
    await writeFamilyMembers(filtered);
  }
}

async function readFamilyMembers(): Promise<FamilyMember[]> {
  const raw = await AsyncStorage.getItem(FAMILY_MEMBERS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFamilyMembers(members: FamilyMember[]): Promise<void> {
  await AsyncStorage.setItem(FAMILY_MEMBERS_KEY, JSON.stringify(members));
}

export async function getFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  const members = await readFamilyMembers();

  return members
    .filter(member => member.familyId === familyId && member.status === 'active')
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      return a.joinedAt - b.joinedAt;
    });
}

export async function getFamilyMemberCount(familyId: string): Promise<number> {
  const members = await getFamilyMembers(familyId);
  return members.length;
}

export async function upsertFamilyMember(input: {
  familyId: string;
  npub: string;
  displayName?: string;
  role?: FamilyMemberRole;
  joinedAt?: number;
  status?: 'active' | 'removed';
}): Promise<FamilyMember> {
  const members = await readFamilyMembers();

  const normalizedNpub = input.npub.trim();
  const existingIndex = members.findIndex(member =>
    member.familyId === input.familyId && member.npub === normalizedNpub
  );

  const nextMember: FamilyMember = {
    id:
      existingIndex >= 0
        ? members[existingIndex].id
        : `${input.familyId}-${normalizedNpub}`,
    familyId: input.familyId,
    npub: normalizedNpub,
    displayName: input.displayName?.trim() || members[existingIndex]?.displayName,
    role: input.role ?? members[existingIndex]?.role ?? 'member',
    joinedAt: input.joinedAt ?? members[existingIndex]?.joinedAt ?? Math.floor(Date.now() / 1000),
    status: input.status ?? 'active',
  };

  if (existingIndex >= 0) {
    members[existingIndex] = {
      ...members[existingIndex],
      ...nextMember,
    };
  } else {
    members.push(nextMember);
  }

  await writeFamilyMembers(members);
  return nextMember;
}

export async function removeFamilyMember(familyId: string, npub: string): Promise<void> {
  const members = await readFamilyMembers();

  const nextMembers = members.map(member => {
    if (member.familyId === familyId && member.npub === npub) {
      return {
        ...member,
        status: 'removed' as const,
      };
    }

    return member;
  });

  await writeFamilyMembers(nextMembers);
}

export function generateFamilyId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

const FAMILY_CHECK_KEY = 'family_last_check_';

export async function getLastFamilyCheck(familyId: string): Promise<number> {
  const raw = await AsyncStorage.getItem(FAMILY_CHECK_KEY + familyId);
  if (!raw) return 0;
  return parseInt(raw, 10);
}

export async function setLastFamilyCheck(familyId: string, timestamp: number): Promise<void> {
  await AsyncStorage.setItem(FAMILY_CHECK_KEY + familyId, String(timestamp));
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
// ─────────────────────────────────────────────
// CLEAR ALL LOCAL DATA FOR NEW IDENTITY
// ─────────────────────────────────────────────

export async function clearNewIdentityLocalData(): Promise<void> {
  try {
    console.log('[Identity Reset] Starting local data clear...');

    // Clear DM data
    await clearDMStorage();

    // Clear group data
    await clearGroupStorage();

    // 🔥 Clear timeline (Marks)
    await AsyncStorage.removeItem(MILESTONES_KEY);

    // 🔥 Clear family + members (extra safety)
    await AsyncStorage.removeItem(FAMILY_KEY);
    await AsyncStorage.removeItem(FAMILY_MEMBERS_KEY);

    console.log('[Identity Reset] Local data cleared successfully');
  } catch (error) {
    console.warn('[Identity Reset] Failed to clear local data:', error);
  }
}