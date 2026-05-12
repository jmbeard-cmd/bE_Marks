import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  fetchGroupById,
  fetchGroupByInviteCode,
  fetchGroupMemberships,
  fetchGroupMembershipsForPubkey,
  npubToHex,
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
  icon?: string;              // owner-selected emoji/icon for group avatar
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
  ownerNpub?: string;

  // Counts (cached locally)
  memberCount: number;
  postCount: number;

  // Book / transparent group ledger
  bookEnabled?: boolean;
  bookOfficerNpubs?: string[];
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

export type BEGroupVisibilitySnapshot = {
  activeGroups: BEGroup[];
  archivedGroups: BEGroup[];
};

// ─── Storage Helpers ──────────────────────────────────────────────
// AsyncStorage is the primary storage for groups/members.
// SecureStore is used only as a one-time fallback for older installs
// that previously saved this data there.

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
        console.log(`[Group Storage] migrated ${key} from SecureStore to AsyncStorage`);
      } catch (migrationError) {
        console.warn(`[Group Storage] failed to migrate ${key}:`, migrationError);
      }

      return parsed;
    }

    return fallback;
  } catch (error) {
    console.warn(`[Group Storage] failed to read ${key}:`, error);
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[Group Storage] failed to write ${key}:`, error);
  }
}

async function removeJson(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(`[Group Storage] failed to remove AsyncStorage key ${key}:`, error);
  }

  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Ignore old SecureStore cleanup failures.
  }
}

async function readGroups(): Promise<BEGroup[]> {
  return readJson<BEGroup[]>(GROUPS_KEY, []);
}

async function writeGroups(groups: BEGroup[]): Promise<void> {
  await writeJson(GROUPS_KEY, groups);
}

async function readMembers(): Promise<BEGroupMember[]> {
  return readJson<BEGroupMember[]>(MEMBERS_KEY, []);
}

async function writeMembers(members: BEGroupMember[]): Promise<void> {
  await writeJson(MEMBERS_KEY, members);
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
  const relaysToUse = relayUrls.length > 0 ? relayUrls : ['wss://relay.beginningend.com'];
  const membershipEvents = await fetchGroupMemberships(groupId, relaysToUse);
  const allMembers = await readMembers();
  const existingGroupMembers = allMembers.filter(m => m.groupId === groupId);

  const memberMap = new Map<string, BEGroupMember>();

  for (const member of existingGroupMembers) {
    memberMap.set(member.npub, member);
  }

  const sortedMembershipEvents = [...membershipEvents].sort(
    (a, b) => a.created_at - b.created_at
  );

  for (const event of sortedMembershipEvents) {
    const npubTag = event.tags.find(tag => tag[0] === 'npub');
    const roleTag = event.tags.find(tag => tag[0] === 'role');
    const actionTag = event.tags.find(tag => tag[0] === 'action');
    const statusTag = event.tags.find(tag => tag[0] === 'status');
    const pTag = event.tags.find(tag => tag[0] === 'p');

    const memberNpub = npubTag?.[1];
    if (!memberNpub) continue;

    let content: any = null;

    try {
      content = event.content ? JSON.parse(event.content) : null;
    } catch {
      content = null;
    }

    const rawRole =
      roleTag?.[1] ||
      content?.role;

    const rawAction =
      actionTag?.[1] ||
      content?.action;

    const rawStatus =
      statusTag?.[1] ||
      content?.status;

    const isRemovedEvent =
      rawAction === 'remove' ||
      rawAction === 'leave' ||
      rawRole === 'removed' ||
      rawStatus === 'removed';

    const relayRole: MemberRole =
      rawRole === 'owner' || rawRole === 'admin' || rawRole === 'member'
        ? rawRole
        : 'member';

    const existing = memberMap.get(memberNpub);

    const resolvedRole: MemberRole =
      existing?.role === 'owner'
        ? 'owner'
        : relayRole === 'owner'
          ? 'owner'
          : relayRole;

    memberMap.set(memberNpub, {
      id: existing?.id ?? `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      groupId,
      npub: memberNpub,
      pubkeyHex: existing?.pubkeyHex ?? pTag?.[1] ?? event.pubkey,
      displayName: existing?.displayName,
      avatarUrl: existing?.avatarUrl,
      role: resolvedRole,
      status: isRemovedEvent ? 'removed' : 'active',
      joinedAt: existing?.joinedAt ?? event.created_at,
      removedAt: isRemovedEvent ? event.created_at : undefined,
      removedBy: isRemovedEvent ? event.pubkey : undefined,
    });
  }

  try {
    const localGroup = await getGroupById(groupId);
    const remoteGroup = await fetchGroupById(groupId, localGroup?.relayUrl || relaysToUse[0]);
    const ownerNpub = localGroup?.ownerNpub || remoteGroup?.ownerNpub;

    if (ownerNpub) {
      const existingOwner = memberMap.get(ownerNpub);

      let ownerPubkeyHex = existingOwner?.pubkeyHex;

      if (!ownerPubkeyHex) {
        try {
          ownerPubkeyHex = npubToHex(ownerNpub);
        } catch {
          ownerPubkeyHex = '';
        }
      }

      memberMap.set(ownerNpub, {
        id: existingOwner?.id ?? `member_owner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        groupId,
        npub: ownerNpub,
        pubkeyHex: ownerPubkeyHex,
        displayName: existingOwner?.displayName,
        avatarUrl: existingOwner?.avatarUrl,
        role: 'owner',
        status: 'active',
        joinedAt: existingOwner?.joinedAt ?? remoteGroup?.createdAt ?? localGroup?.createdAt ?? Math.floor(Date.now() / 1000),
      });

      if (localGroup && !localGroup.ownerNpub) {
        await updateGroup(groupId, {
          ownerNpub,
        });
      }
    }
  } catch (ownerRepairError) {
    console.warn('[Groups] owner repair during member sync failed:', ownerRepairError);
  }

  const mergedGroupMembers = Array.from(memberMap.values());
  const activeGroupMembers = mergedGroupMembers.filter(m => m.status === 'active');
  const otherMembers = allMembers.filter(m => m.groupId !== groupId);

  await writeMembers([...otherMembers, ...mergedGroupMembers]);

  await updateGroup(groupId, {
    memberCount: activeGroupMembers.length,
  });

  return activeGroupMembers.sort((a, b) => {
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

export async function getVisibleGroupsForNpub(
  npub: string
): Promise<BEGroupVisibilitySnapshot> {
  const [groups, members] = await Promise.all([
    readGroups(),
    readMembers(),
  ]);

  const activeMembershipGroupIds = new Set(
    members
      .filter(member => member.npub === npub && member.status === 'active')
      .map(member => member.groupId)
  );

  const isVisible = (group: BEGroup) => {
    return group.ownerNpub === npub || activeMembershipGroupIds.has(group.id);
  };

  const visibleGroups = groups.filter(isVisible);

  return {
    activeGroups: visibleGroups
      .filter(group => group.status === 'active')
      .sort((a, b) => (b.lastPostAt ?? b.updatedAt) - (a.lastPostAt ?? a.updatedAt)),

    archivedGroups: visibleGroups
      .filter(group => group.status === 'archived')
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
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
  icon?: string;
  schoolId?: string;
  relayUrl: string;
  ownerNpub: string;
  ownerPubkeyHex: string;
  ownerDisplayName?: string;
  bookEnabled?: boolean;
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
    icon: input.icon?.trim() || undefined,
    schoolId: input.schoolId,
    inviteCode: generateInviteCode(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    relayUrl: input.relayUrl,
    ownerNpub: input.ownerNpub,
    memberCount: 1,
    postCount: 0,
    bookEnabled: input.bookEnabled === true,
    bookOfficerNpubs: [],
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
      icon: group.icon,
      schoolId: group.schoolId,
      inviteCode: group.inviteCode,
      status: group.status,
      relayUrl: group.relayUrl,
      createdAt: group.createdAt,
      ownerNpub: input.ownerNpub,
      bookEnabled: group.bookEnabled === true,
      bookOfficerNpubs: group.bookOfficerNpubs ?? [],
    };

    const publishResult = await publishGroup(payload, input.nsec);

    console.log('[Groups] publish result:', publishResult);
    console.log('[Groups] created group invite code:', group.inviteCode);
    console.log('[Groups] created group relayUrl:', group.relayUrl);

    if (!publishResult.success) {
      console.warn('[Groups] Failed to publish group to relay:', publishResult.error);
    }

    const ownerMembershipResult = await publishGroupMembership({
      groupId: group.id,
      memberNpub: input.ownerNpub,
      memberPubkeyHex: input.ownerPubkeyHex,
      action: 'join',
      role: 'owner',
      nsec: input.nsec,
      relayUrl: group.relayUrl,
    });

    console.log('[Groups] owner membership publish result:', ownerMembershipResult);

    if (!ownerMembershipResult.success) {
      console.warn(
        '[Groups] Failed to publish owner membership to relay:',
        ownerMembershipResult.error
      );
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

export async function isGroupBookEnabled(groupId: string): Promise<boolean> {
  const group = await getGroupById(groupId);
  return group?.bookEnabled === true;
}

export async function updateGroupBookSettings(
  groupId: string,
  updates: {
    bookEnabled?: boolean;
    bookOfficerNpubs?: string[];
  }
): Promise<void> {
  await updateGroup(groupId, {
    bookEnabled: updates.bookEnabled,
    bookOfficerNpubs: updates.bookOfficerNpubs,
  });
}

export async function canManageGroupBook(
  groupId: string,
  npub: string
): Promise<boolean> {
  const group = await getGroupById(groupId);

  if (!group) return false;

  if (group.ownerNpub === npub) return true;

  const member = await getMemberByNpub(groupId, npub);

  if (!member || member.status !== 'active') return false;

  if (member.role === 'owner' || member.role === 'admin') return true;

  return !!group.bookOfficerNpubs?.includes(npub);
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

export async function updateGroupMemberProfile(
  groupId: string,
  npub: string,
  updates: {
    displayName?: string;
    avatarUrl?: string;
  }
): Promise<void> {
  const members = await readMembers();

  const updated = members.map(member =>
    member.groupId === groupId && member.npub === npub
      ? {
          ...member,
          displayName: updates.displayName ?? member.displayName,
          avatarUrl: updates.avatarUrl ?? member.avatarUrl,
        }
      : member
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
        icon: remoteGroup.icon,
        schoolId: remoteGroup.schoolId,
        inviteCode: remoteGroup.inviteCode,
        status: remoteGroup.status,
        createdAt: remoteGroup.createdAt,
        updatedAt: now,
        relayUrl: remoteGroup.relayUrl,
        ownerNpub: remoteGroup.ownerNpub,
        memberCount: remoteGroup.ownerNpub ? 1 : 0,
        postCount: 0,
        bookEnabled: remoteGroup.bookEnabled === true,
        bookOfficerNpubs: remoteGroup.bookOfficerNpubs ?? [],
      };

      groups.push(newGroup);
      await writeGroups(groups);
      group = newGroup;

      if (remoteGroup.ownerNpub) {
        try {
          await addGroupMember({
            groupId: remoteGroup.id,
            npub: remoteGroup.ownerNpub,
            pubkeyHex: npubToHex(remoteGroup.ownerNpub),
            role: 'owner',
          });
        } catch (ownerSeedError) {
          console.warn('[Groups] failed to seed remote group owner:', ownerSeedError);
        }
      }
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
      role: 'member',
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

// ─────────────────────────────────────────────
// CLEAR GROUP STORAGE (FOR NEW IDENTITY)
// ─────────────────────────────────────────────

export async function clearGroupStorage(): Promise<void> {
  try {
    await Promise.all([
      removeJson(GROUPS_KEY),
      removeJson(MEMBERS_KEY),
    ]);

    console.log('[Group Storage] Cleared for new identity');
  } catch (error) {
    console.warn('[Group Storage] Failed to clear:', error);
  }
}

export async function restoreGroupsFromRelay(input: {
  pubkeyHex: string;
  relayUrls: string[];
}): Promise<void> {
  console.log('[Groups] restoreGroupsFromRelay start');

  try {
    const membershipEvents = await fetchGroupMembershipsForPubkey(
      input.pubkeyHex,
      input.relayUrls
    );

    console.log('[Groups] membership events found:', membershipEvents.length);

    const groupIds = new Set<string>();

    for (const event of membershipEvents) {
      const dTag = event.tags.find(tag => tag[0] === 'd');
      const groupId = dTag?.[1];

      if (groupId) {
        groupIds.add(groupId);
      }
    }

    console.log('[Groups] unique groupIds:', Array.from(groupIds));

    const existingGroups = await readGroups();
    const now = Math.floor(Date.now() / 1000);

    for (const groupId of groupIds) {
      const groupEvent = await fetchGroupById(groupId);

      if (!groupEvent) {
        console.warn('[Groups] group not found on relay:', groupId);
        continue;
      }

      const alreadyExists = existingGroups.find(g => g.id === groupId);

      if (!alreadyExists) {
        const newGroup: BEGroup = {
          id: groupEvent.id,
          name: groupEvent.name,
          description: groupEvent.description,
          season: groupEvent.season,
          sport: groupEvent.sport,
          icon: groupEvent.icon,
          schoolId: groupEvent.schoolId,
          inviteCode: groupEvent.inviteCode,
          status: groupEvent.status,
          createdAt: groupEvent.createdAt,
          updatedAt: now,
          relayUrl: groupEvent.relayUrl,
          ownerNpub: groupEvent.ownerNpub,
          memberCount: groupEvent.ownerNpub ? 1 : 0,
          postCount: 0,
          bookEnabled: groupEvent.bookEnabled === true,
          bookOfficerNpubs: groupEvent.bookOfficerNpubs ?? [],
        };

        existingGroups.push(newGroup);
      } else {
        Object.assign(alreadyExists, {
          name: groupEvent.name,
          description: groupEvent.description,
          season: groupEvent.season,
          sport: groupEvent.sport,
          icon: groupEvent.icon,
          schoolId: groupEvent.schoolId,
          inviteCode: groupEvent.inviteCode,
          status: groupEvent.status,
          relayUrl: groupEvent.relayUrl,
          ownerNpub: groupEvent.ownerNpub,
          bookEnabled: groupEvent.bookEnabled === true,
          bookOfficerNpubs: groupEvent.bookOfficerNpubs ?? [],
          updatedAt: now,
        });
      }

      await syncGroupMembersFromRelay(groupId, input.relayUrls);
    }

    await writeGroups(existingGroups);

    console.log('[Groups] restore complete');
  } catch (error) {
    console.warn('[Groups] restore failed:', error);
  }
}