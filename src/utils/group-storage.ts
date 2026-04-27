import * as SecureStore from 'expo-secure-store';
import {
  fetchGroupByInviteCode,
  fetchGroupMemberships,
  publishGroup,
  publishGroupMembership,
  type NostrGroupPayload,
} from './nostr';

const GROUPS_KEY = 'be_groups_v1';
const MEMBERS_KEY = 'be_group_members_v1';

// ─── Types ────────────────────────────────────────────────────────

export type GroupStatus = 'active' | 'archived';
export type MemberRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'removed';
export type GroupRelayMode = 'default' | 'custom' | 'both';

export type BEGroup = {
  id: string;
  name: string;
  description?: string;
  season?: string;            // e.g. "2025-2026"
  sport?: string;             // for theming e.g. "softball", "basketball"
  schoolId?: string;          // "washington" | "rush_springs" | custom
  coverImage?: string;        // R2 URL
  inviteCode: string;         // 6-char alphanumeric
  inviteCodeExpiry?: number;  // unix timestamp, optional
  status: GroupStatus;
  createdAt: number;
  updatedAt: number;
  lastPostAt?: number;
  lastPostPreview?: string;

  // Nostr relay routing
  relayUrl: string;
  relayMode?: GroupRelayMode;

  // Nostr
  nostrEventId?: string;

  // Counts (cached locally)
  memberCount: number;
  postCount: number;
};

export type BEGroupMember = {
  id: string;
  groupId: string;
  npub: string;
  pubkeyHex: string;
  displayName?: string;
  avatarUrl?: string;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: number;
  removedAt?: number;
  removedBy?: string;   // npub of admin who removed them
};

// ─── Storage Helpers ──────────────────────────────────────────────

async function readGroups(): Promise<BEGroup[]> {
  try {
    const raw = await SecureStore.getItemAsync(GROUPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function writeGroups(groups: BEGroup[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(GROUPS_KEY, JSON.stringify(groups));
  } catch {}
}

async function readMembers(): Promise<BEGroupMember[]> {
  try {
    const raw = await SecureStore.getItemAsync(MEMBERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function writeMembers(members: BEGroupMember[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(MEMBERS_KEY, JSON.stringify(members));
  } catch {}
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ─── Group CRUD ───────────────────────────────────────────────────

export async function getGroups(): Promise<BEGroup[]> {
  const groups = await readGroups();
  return groups.sort((a, b) => {
    // Active groups first, then by last post
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return (b.lastPostAt ?? b.updatedAt) - (a.lastPostAt ?? a.updatedAt);
  });
}

export async function syncGroupMembersFromRelay(
  groupId: string,
  relayUrls: string[],
): Promise<BEGroupMember[]> {
  const membershipEvents = await fetchGroupMemberships(groupId, relayUrls);
  const allMembers = await readMembers();
  const existingGroupMembers = allMembers.filter(m => m.groupId === groupId);

  const memberMap = new Map<string, BEGroupMember>();

  for (const member of existingGroupMembers) {
    memberMap.set(member.npub, member);
  }

  for (const event of membershipEvents) {
    const npubTag = event.tags.find(tag => tag[0] === 'npub');
    const roleTag = event.tags.find(tag => tag[0] === 'role');

    const memberNpub = npubTag?.[1];
    if (!memberNpub) continue;

    const existing = memberMap.get(memberNpub);

    memberMap.set(memberNpub, {
      id: existing?.id ?? `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      groupId,
      npub: memberNpub,
      pubkeyHex: existing?.pubkeyHex ?? event.pubkey,
      displayName: existing?.displayName,
      avatarUrl: existing?.avatarUrl,
      role: existing?.role ?? (roleTag?.[1] as MemberRole) ?? 'member',
      status: 'active',
      joinedAt: existing?.joinedAt ?? event.created_at,
    });
  }

  const mergedGroupMembers = Array.from(memberMap.values());

  const otherMembers = allMembers.filter(m => m.groupId !== groupId);

  await writeMembers([...otherMembers, ...mergedGroupMembers]);

  await updateGroup(groupId, {
    memberCount: mergedGroupMembers.filter(m => m.status === 'active').length,
  });

  return mergedGroupMembers.sort((a, b) => {
    const roleOrder = { owner: 0, admin: 1, member: 2 };
    return roleOrder[a.role] - roleOrder[b.role];
  });
}

export async function getActiveGroups(): Promise<BEGroup[]> {
  const groups = await readGroups();
  return groups
    .filter(g => g.status === 'active')
    .sort((a, b) => (b.lastPostAt ?? b.updatedAt) - (a.lastPostAt ?? a.updatedAt));
}

export async function getArchivedGroups(): Promise<BEGroup[]> {
  const groups = await readGroups();
  return groups
    .filter(g => g.status === 'archived')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getGroupById(id: string): Promise<BEGroup | null> {
  const groups = await readGroups();
  return groups.find(g => g.id === id) ?? null;
}

export async function getGroupByInviteCode(code: string): Promise<BEGroup | null> {
  const groups = await readGroups();
  return groups.find(g =>
    g.inviteCode.toUpperCase() === code.toUpperCase() &&
    g.status === 'active'
  ) ?? null;
}

export async function createGroup(input: {
  name: string;
  description?: string;
  season?: string;
  sport?: string;
  schoolId?: string;
  relayUrl: string;
  ownerNpub: string;
  ownerPubkeyHex: string;
  ownerDisplayName?: string;
  nsec?: string;           // needed to sign and publish to relay
}): Promise<BEGroup> {
  const groups = await readGroups();
  const now = Math.floor(Date.now() / 1000);

  const group: BEGroup = {
    id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim(),
    description: input.description?.trim(),
    season: input.season?.trim(),
    sport: input.sport,
    schoolId: input.schoolId,
    inviteCode: generateInviteCode(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    relayUrl: input.relayUrl,
    memberCount: 1,
    postCount: 0,
  };

  groups.push(group);
  await writeGroups(groups);

  // Add owner as first member
  await addGroupMember({
    groupId: group.id,
    npub: input.ownerNpub,
    pubkeyHex: input.ownerPubkeyHex,
    displayName: input.ownerDisplayName,
    role: 'owner',
  });

  // Publish to relay so others can find and join by invite code
  if (input.nsec) {
  const payload: NostrGroupPayload = {
    id: group.id,
    name: group.name,
    description: group.description,
    season: group.season,
    sport: group.sport,
    schoolId: group.schoolId,
    inviteCode: group.inviteCode,
    status: group.status,
    relayUrl: group.relayUrl,
    createdAt: group.createdAt,
    ownerNpub: input.ownerNpub,
  };

  const publishResult = await publishGroup(payload, input.nsec);

  console.log('[Groups] publish result:', publishResult);
console.log('[Groups] created group invite code:', group.inviteCode);
console.log('[Groups] created group relayUrl:', group.relayUrl);

if (!publishResult.success) {
  console.warn('[Groups] Failed to publish group to relay:', publishResult.error);
}
}

  return group;
}

export async function updateGroup(id: string, updates: Partial<BEGroup>): Promise<void> {
  const groups = await readGroups();
  const updated = groups.map(g =>
    g.id === id
      ? { ...g, ...updates, updatedAt: Math.floor(Date.now() / 1000) }
      : g
  );
  await writeGroups(updated);
}

export async function archiveGroup(id: string): Promise<void> {
  await updateGroup(id, { status: 'archived' });
}

export async function regenerateInviteCode(id: string): Promise<string> {
  const newCode = generateInviteCode();
  await updateGroup(id, { inviteCode: newCode, inviteCodeExpiry: undefined });
  return newCode;
}

export async function deleteGroup(id: string): Promise<void> {
  const groups = await readGroups();
  await writeGroups(groups.filter(g => g.id !== id));
  // Also remove all members
  const members = await readMembers();
  await writeMembers(members.filter(m => m.groupId !== id));
}

// ─── Member CRUD ──────────────────────────────────────────────────

export async function getGroupMembers(
  groupId: string,
  includeRemoved = false
): Promise<BEGroupMember[]> {
  const members = await readMembers();
  return members
    .filter(m => m.groupId === groupId && (includeRemoved || m.status === 'active'))
    .sort((a, b) => {
      // Owners first, then admins, then members
      const roleOrder = { owner: 0, admin: 1, member: 2 };
      return roleOrder[a.role] - roleOrder[b.role];
    });
}

export async function getMemberByNpub(
  groupId: string,
  npub: string
): Promise<BEGroupMember | null> {
  const members = await readMembers();
  return members.find(m => m.groupId === groupId && m.npub === npub) ?? null;
}

export async function addGroupMember(input: {
  groupId: string;
  npub: string;
  pubkeyHex: string;
  displayName?: string;
  avatarUrl?: string;
  role?: MemberRole;
}): Promise<BEGroupMember> {
  const members = await readMembers();
  const now = Math.floor(Date.now() / 1000);

  // Check if already a member (could be rejoining after removal)
  const existing = members.find(
    m => m.groupId === input.groupId && m.npub === input.npub
  );

  if (existing) {
    // Reinstate if removed
    const updated = members.map(m =>
      m.id === existing.id
        ? { ...m, status: 'active' as MemberStatus, removedAt: undefined, removedBy: undefined, joinedAt: now }
        : m
    );
    await writeMembers(updated);
    return { ...existing, status: 'active', joinedAt: now };
  }

  const member: BEGroupMember = {
    id: `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId: input.groupId,
    npub: input.npub,
    pubkeyHex: input.pubkeyHex,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    role: input.role ?? 'member',
    status: 'active',
    joinedAt: now,
  };

  members.push(member);
  await writeMembers(members);

  // Update group member count
  const activeMembers = members.filter(
  m => m.groupId === input.groupId && m.status === 'active'
);
await updateGroup(input.groupId, { memberCount: activeMembers.length });

  return member;
}

export async function removeMember(
  groupId: string,
  npub: string,
  removedByNpub: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const members = await readMembers();
  const updated = members.map(m =>
    m.groupId === groupId && m.npub === npub
      ? { ...m, status: 'removed' as MemberStatus, removedAt: now, removedBy: removedByNpub }
      : m
  );
  await writeMembers(updated);

  // Update member count
  const activeCount = updated.filter(
    m => m.groupId === groupId && m.status === 'active'
  ).length;
  await updateGroup(groupId, { memberCount: activeCount });
}

export async function updateMemberRole(
  groupId: string,
  npub: string,
  role: MemberRole
): Promise<void> {
  const members = await readMembers();
  const updated = members.map(m =>
    m.groupId === groupId && m.npub === npub ? { ...m, role } : m
  );
  await writeMembers(updated);
}

export async function isGroupAdmin(groupId: string, npub: string): Promise<boolean> {
  const member = await getMemberByNpub(groupId, npub);
  return member?.status === 'active' && (member.role === 'owner' || member.role === 'admin');
}

export async function isGroupMember(groupId: string, npub: string): Promise<boolean> {
  const member = await getMemberByNpub(groupId, npub);
  return member !== null && member !== undefined && member.status === 'active';
}

// ─── Join via invite code ─────────────────────────────────────────

export async function joinGroupByCode(input: {
  code: string;
  npub: string;
  pubkeyHex: string;
  displayName?: string;
  avatarUrl?: string;
  relayUrl?: string;
  nsec?: string;
}): Promise<{ success: boolean; group?: BEGroup; error?: string }> {
  console.log('[Groups] joinGroupByCode start:', input.code);

  // Step 1: Check local storage first (fast path)
  let group = await getGroupByInviteCode(input.code);
  console.log('[Groups] local group found:', group);

  // Step 2: If not found locally, query the relay
  if (!group) {
    const relayUrl = input.relayUrl ?? 'wss://relay.beginningend.com';
    console.log('[Groups] trying relay lookup on:', relayUrl);

    const remoteGroup = await fetchGroupByInviteCode(input.code, relayUrl);
    console.log('[Groups] remote group result:', remoteGroup);

    if (remoteGroup) {
      const groups = await readGroups();
      const now = Math.floor(Date.now() / 1000);
      const newGroup: BEGroup = {
        id: remoteGroup.id,
        name: remoteGroup.name,
        description: remoteGroup.description,
        season: remoteGroup.season,
        sport: remoteGroup.sport,
        schoolId: remoteGroup.schoolId,
        inviteCode: remoteGroup.inviteCode,
        status: remoteGroup.status,
        createdAt: remoteGroup.createdAt,
        updatedAt: now,
        relayUrl: remoteGroup.relayUrl,
        memberCount: 1,
        postCount: 0,
      };
      groups.push(newGroup);
      await writeGroups(groups);
      group = newGroup;
    }
  }

  console.log('[Groups] final group before validation:', group);

  if (!group) {
    return { success: false, error: 'Invalid or expired invite code. Make sure you have the right code from your group admin.' };
  }

  if (group.inviteCodeExpiry && group.inviteCodeExpiry < Math.floor(Date.now() / 1000)) {
    return { success: false, error: 'This invite code has expired. Ask an admin for a new one.' };
  }

  const existing = await getMemberByNpub(group.id, input.npub);
  if (existing?.status === 'active') {
    return { success: true, group };
  }

  await addGroupMember({
    groupId: group.id,
    npub: input.npub,
    pubkeyHex: input.pubkeyHex,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    role: 'member',
  });

  if (input.nsec) {
    publishGroupMembership({
      groupId: group.id,
      memberNpub: input.npub,
      memberPubkeyHex: input.pubkeyHex,
      action: 'join',
      nsec: input.nsec,
      relayUrl: group.relayUrl,
    }).catch(e => console.warn('[Groups] Failed to publish membership:', e));
  }

  return { success: true, group };
}

// ─── Post tracking ────────────────────────────────────────────────

export async function recordGroupPost(
  groupId: string,
  preview: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const group = await getGroupById(groupId);
  if (!group) return;
  await updateGroup(groupId, {
    lastPostAt: now,
    lastPostPreview: preview.slice(0, 80),
    postCount: (group.postCount ?? 0) + 1,
  });
}