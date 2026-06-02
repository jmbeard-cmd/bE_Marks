import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearDMStorage } from './dm-storage';
import { clearGroupStorage } from './group-storage';

const MILESTONES_KEY = 'milestones_v1';
const MILESTONES_BACKUP_INDEX_KEY = 'milestones_v1_emergency_backups_index_v1';
const MILESTONES_BACKUP_PREFIX = 'milestones_v1_emergency_backup_';
const FAMILY_KEY = 'family_v1';
const FAMILY_MEMBERS_KEY = 'family_members_v1';
const ACCOUNT_SAFETY_KEY = 'account_safety_v1';

export type MilestoneBackupIndexEntry = {
  key: string;
  createdAt: number;
  reason: string;
  markCount?: number;
};

export type MilestoneEmergencyBackup = MilestoneBackupIndexEntry & {
  raw: string;
};

export type MarkMedia = {
  id: string;
  uri: string;
  type: 'image' | 'video';
  source?: 'local' | 'cloud' | 'r2';
  thumbnailUri?: string;
};

export type MilestoneLiftUp = {
  id: string;
  type: 'lifted' | 'cheered' | 'proud' | 'grateful' | 'celebrating' | 'encouraged';
  label: string;
  emoji: string;
  createdAt: number;
  authorNpub?: string;
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
  liftUps?: MilestoneLiftUp[];
  familyId?: string;
  authorNpub?: string;
  authorName?: string;
  spaceRelayEventId?: string;
  spaceRelayPublishedAt?: number;
  spaceRelayGroupIds?: string[];
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

export interface AccountSafetySettings {
  isChildAccount: boolean;
  childUnder13: boolean;
  guardianManaged: boolean;
  publicPostingAllowed: boolean;
  updatedAt: number;
}

function hasText(value?: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hashText(value: string): string {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function getMediaStableKey(media: Partial<MarkMedia>): string {
  return [
    media.type ?? 'image',
    media.uri ?? '',
    media.thumbnailUri ?? '',
  ].join('|');
}

function normalizeMilestoneMedia(
  markId: string,
  mediaItems?: MarkMedia[]
): { media: MarkMedia[] | undefined; changed: boolean; deduped: number; regenerated: number } {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
    return { media: mediaItems, changed: false, deduped: 0, regenerated: 0 };
  }

  const seenKeys = new Set<string>();
  const seenIds = new Map<string, string>();
  let changed = false;
  let deduped = 0;
  let regenerated = 0;

  const media = mediaItems.flatMap((item, index) => {
    if (!item?.uri) {
      changed = true;
      deduped += 1;
      return [];
    }

    const stableKey = getMediaStableKey(item);

    if (seenKeys.has(stableKey)) {
      changed = true;
      deduped += 1;
      return [];
    }

    seenKeys.add(stableKey);

    const currentId = hasText(item.id) ? item.id : '';
    const previousKeyForId = currentId ? seenIds.get(currentId) : undefined;
    const needsNewId = !currentId || (previousKeyForId !== undefined && previousKeyForId !== stableKey);
    const id = needsNewId
      ? `${markId}_media_${index}_${hashText(stableKey)}`
      : currentId;

    if (needsNewId) {
      changed = true;
      regenerated += 1;
    }

    seenIds.set(id, stableKey);
    return [{ ...item, id }];
  });

  return { media, changed, deduped, regenerated };
}

function normalizeMilestoneForWrite(milestone: Milestone): Milestone {
  const normalizedMedia = normalizeMilestoneMedia(milestone.id, milestone.media);
  return {
    ...milestone,
    media: normalizedMedia.media,
  };
}

function mergeReflections(
  existing?: Milestone['reflections'],
  incoming?: Milestone['reflections']
): Milestone['reflections'] {
  return [
    ...(existing ?? []),
    ...(incoming ?? []),
  ].filter((reflection, index, arr) => (
    index === arr.findIndex(r =>
      r.text === reflection.text &&
      r.createdAt === reflection.createdAt &&
      r.authorNpub === reflection.authorNpub
    )
  ));
}

function mergeLiftUps(
  existing?: Milestone['liftUps'],
  incoming?: Milestone['liftUps']
): Milestone['liftUps'] {
  return [
    ...(existing ?? []),
    ...(incoming ?? []),
  ].filter((liftUp, index, arr) => (
    index === arr.findIndex(item =>
      item.id === liftUp.id ||
      (
        item.type === liftUp.type &&
        item.createdAt === liftUp.createdAt &&
        item.authorNpub === liftUp.authorNpub
      )
    )
  ));
}

function mergeSameIdMilestones(existing: Milestone, incoming: Milestone): Milestone {
  const normalizedExisting = normalizeMilestoneMedia(existing.id, existing.media);
  const normalizedIncoming = normalizeMilestoneMedia(incoming.id, incoming.media);
  const mergedMediaInput = [
    ...(normalizedExisting.media ?? []),
    ...(normalizedIncoming.media ?? []),
  ];
  const normalizedMerged = normalizeMilestoneMedia(existing.id, mergedMediaInput);

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    media: normalizedMerged.media ?? normalizedExisting.media ?? [],
    reflections: mergeReflections(existing.reflections, incoming.reflections),
    liftUps: mergeLiftUps(existing.liftUps, incoming.liftUps),
  };
}

export type MilestoneIntegrityAudit = {
  total: number;
  duplicateIds: string[];
  duplicateMediaUris: { uri: string; markIds: string[] }[];
  repeatedTitles: { title: string; markIds: string[] }[];
  missingIds: number;
  invalidItems: number;
};

function getMilestoneTitle(note?: string): string {
  const firstLine = (note ?? '').split('\n\n')[0]?.trim();
  return firstLine || '(untitled)';
}

function sortMilestones(milestones: Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => b.createdAt - a.createdAt);
}

export function auditMilestonesForCorruption(input: unknown): MilestoneIntegrityAudit {
  const audit: MilestoneIntegrityAudit = {
    total: Array.isArray(input) ? input.length : 0,
    duplicateIds: [],
    duplicateMediaUris: [],
    repeatedTitles: [],
    missingIds: 0,
    invalidItems: 0,
  };

  if (!Array.isArray(input)) {
    return audit;
  }

  const ids = new Map<string, number>();
  const mediaUris = new Map<string, Set<string>>();
  const titles = new Map<string, Set<string>>();

  input.forEach(raw => {
    const item = raw as Partial<Milestone>;

    if (!item || typeof item !== 'object') {
      audit.invalidItems += 1;
      return;
    }

    if (!hasText(item.id)) {
      audit.missingIds += 1;
      return;
    }

    const markId = item.id;

    ids.set(markId, (ids.get(markId) ?? 0) + 1);

    const title = getMilestoneTitle(item.note).toLowerCase();
    const titleMarks = titles.get(title) ?? new Set<string>();
    titleMarks.add(markId);
    titles.set(title, titleMarks);

    (item.media ?? []).forEach(media => {
      if (!hasText(media.uri)) return;

      const marks = mediaUris.get(media.uri) ?? new Set<string>();
      marks.add(markId);
      mediaUris.set(media.uri, marks);
    });
  });

  audit.duplicateIds = Array.from(ids.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  audit.duplicateMediaUris = Array.from(mediaUris.entries())
    .filter(([, markIds]) => markIds.size > 1)
    .map(([uri, markIds]) => ({ uri, markIds: Array.from(markIds) }));
  audit.repeatedTitles = Array.from(titles.entries())
    .filter(([, markIds]) => markIds.size > 1)
    .map(([title, markIds]) => ({ title, markIds: Array.from(markIds) }));

  return audit;
}

async function readMilestoneBackupIndex(): Promise<MilestoneBackupIndexEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(MILESTONES_BACKUP_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureMilestonesEmergencyBackup(reason: string): Promise<void> {
  const existingBackups = await readMilestoneBackupIndex();
  if (existingBackups.length > 0) return;

  const raw = await AsyncStorage.getItem(MILESTONES_KEY);
  if (!raw) return;

  const createdAt = Date.now();
  const key = `${MILESTONES_BACKUP_PREFIX}${createdAt}`;
  let markCount: number | undefined;

  try {
    const parsed = JSON.parse(raw);
    markCount = Array.isArray(parsed) ? parsed.length : undefined;
  } catch {
    markCount = undefined;
  }

  const entry: MilestoneBackupIndexEntry = { key, createdAt, reason, markCount };
  const backup: MilestoneEmergencyBackup = { ...entry, raw };

  await AsyncStorage.setItem(key, JSON.stringify(backup));
  await AsyncStorage.setItem(MILESTONES_BACKUP_INDEX_KEY, JSON.stringify([entry]));
}

async function writeMilestones(milestones: Milestone[], reason = 'milestone-write'): Promise<void> {
  await ensureMilestonesEmergencyBackup(reason);
  await AsyncStorage.setItem(MILESTONES_KEY, JSON.stringify(milestones));
}

export async function listMilestoneEmergencyBackups(): Promise<MilestoneBackupIndexEntry[]> {
  return readMilestoneBackupIndex();
}

export async function getMilestoneEmergencyBackup(key: string): Promise<MilestoneEmergencyBackup | null> {
  if (!key.startsWith(MILESTONES_BACKUP_PREFIX)) return null;

  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveMilestone(m: Omit<Milestone, 'id' | 'createdAt'>): Promise<Milestone> {
  const all = await getMilestones();
  const milestone: Milestone = {
    ...m,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Math.floor(Date.now() / 1000),
  };
  all.unshift(normalizeMilestoneForWrite(milestone));
  await writeMilestones(all, 'save-milestone');
  return milestone;
}

export async function saveRemoteMilestone(m: Milestone): Promise<void> {
  const all = await getMilestones();
  const incomingEventId = hasText(m.nostrEventId) ? m.nostrEventId.trim() : undefined;

  const existingIndex = all.findIndex(existing =>
    existing.id === m.id ||
    (
      incomingEventId !== undefined &&
      hasText(existing.nostrEventId) &&
      existing.nostrEventId.trim() === incomingEventId
    )
  );

  if (existingIndex !== -1) {
    const existing = all[existingIndex];
    const sameMarkId = existing.id === m.id;

    if (sameMarkId) {
      all[existingIndex] = mergeSameIdMilestones(existing, m);
    } else {
      all[existingIndex] = {
        ...existing,
        ...m,
        id: existing.id,
        media: normalizeMilestoneMedia(existing.id, existing.media).media ?? [],
        reflections: mergeReflections(existing.reflections, m.reflections),
        liftUps: mergeLiftUps(existing.liftUps, m.liftUps),
      };
    }

    const sorted = sortMilestones(all);
    await writeMilestones(sorted, 'save-remote-milestone');
    return;
  }

  const normalized = normalizeMilestoneForWrite(m);
  all.unshift(normalized);
  await writeMilestones(sortMilestones(all), 'save-remote-milestone');
}

export async function getMilestones(): Promise<Milestone[]> {
  const raw = await AsyncStorage.getItem(MILESTONES_KEY);
  if (!raw) return [];

  const parsed = JSON.parse(raw);

  return Array.isArray(parsed)
    ? sortMilestones(parsed as Milestone[])
    : [];
}

export async function updateMilestone(id: string, patch: Partial<Milestone>): Promise<void> {
  const all = await getMilestones();
  const idx = all.findIndex(m => m.id === id);
  if (idx === -1) return;
  all[idx] = normalizeMilestoneForWrite({ ...all[idx], ...patch });
  await writeMilestones(all, 'update-milestone');
}

export async function deleteMilestone(id: string): Promise<void> {
  const all = await getMilestones();
  const filtered = all.filter(m => m.id !== id);
  await writeMilestones(filtered, 'delete-milestone');
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

function getDefaultAccountSafetySettings(): AccountSafetySettings {
  return {
    isChildAccount: false,
    childUnder13: false,
    guardianManaged: false,
    publicPostingAllowed: true,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

export async function getAccountSafetySettings(): Promise<AccountSafetySettings> {
  const fallback = getDefaultAccountSafetySettings();

  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_SAFETY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }

    const childUnder13 = parsed.childUnder13 === true;
    const isChildAccount = parsed.isChildAccount === true || childUnder13;

    return {
      isChildAccount,
      childUnder13,
      guardianManaged: parsed.guardianManaged === true,
      publicPostingAllowed: childUnder13
        ? false
        : parsed.publicPostingAllowed !== false,
      updatedAt:
        typeof parsed.updatedAt === 'number'
          ? parsed.updatedAt
          : fallback.updatedAt,
    };
  } catch {
    return fallback;
  }
}

export async function saveAccountSafetySettings(
  input: Partial<AccountSafetySettings>
): Promise<AccountSafetySettings> {
  const current = await getAccountSafetySettings();
  const childUnder13 = input.childUnder13 ?? current.childUnder13;
  const isChildAccount = input.isChildAccount ?? current.isChildAccount ?? childUnder13;

  const next: AccountSafetySettings = {
    ...current,
    ...input,
    isChildAccount: isChildAccount || childUnder13,
    childUnder13,
    publicPostingAllowed: childUnder13
      ? false
      : input.publicPostingAllowed ?? current.publicPostingAllowed,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  await AsyncStorage.setItem(ACCOUNT_SAFETY_KEY, JSON.stringify(next));
  return next;
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
    await ensureMilestonesEmergencyBackup('identity-reset-clear');
    await AsyncStorage.removeItem(MILESTONES_KEY);

    // 🔥 Clear family + members (extra safety)
    await AsyncStorage.removeItem(FAMILY_KEY);
    await AsyncStorage.removeItem(FAMILY_MEMBERS_KEY);

    // 🔥 Clear local account safety settings for the new identity
    await AsyncStorage.removeItem(ACCOUNT_SAFETY_KEY);

    console.log('[Identity Reset] Local data cleared successfully');
  } catch (error) {
    console.warn('[Identity Reset] Failed to clear local data:', error);
  }
}
