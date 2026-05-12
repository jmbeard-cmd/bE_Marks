// src/utils/groups-index.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    getActiveGroups,
    getVisibleGroupsForNpub,
    syncGroupMembersFromRelay,
    type BEGroup,
} from './group-storage';
import { DEFAULT_RELAY } from './nostr';
import { enqueueStartupJob } from './startup-scheduler';

const GROUPS_INDEX_KEY = 'be_groups_index_v1';

type GroupsIndexSnapshot = {
  activeGroups: BEGroup[];
  archivedGroups: BEGroup[];
  updatedAt: number;
};

type GroupsIndexListener = (snapshot: GroupsIndexSnapshot) => void;

const listeners = new Set<GroupsIndexListener>();

function emptySnapshot(): GroupsIndexSnapshot {
  return {
    activeGroups: [],
    archivedGroups: [],
    updatedAt: 0,
  };
}

async function readGroupsIndex(): Promise<GroupsIndexSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(GROUPS_INDEX_KEY);
    return raw ? JSON.parse(raw) : emptySnapshot();
  } catch (error) {
    console.warn('[Groups Index] failed to read index:', error);
    return emptySnapshot();
  }
}

async function writeGroupsIndex(snapshot: GroupsIndexSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(GROUPS_INDEX_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[Groups Index] failed to write index:', error);
  }
}

function emitGroupsIndexChanged(snapshot: GroupsIndexSnapshot) {
  listeners.forEach(listener => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[Groups Index] listener failed:', error);
    }
  });
}

export function subscribeToGroupsIndex(
  listener: GroupsIndexListener
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export async function getCachedGroupsIndex(): Promise<GroupsIndexSnapshot> {
  return readGroupsIndex();
}

export async function rebuildGroupsIndexForNpub(
  npub: string
): Promise<GroupsIndexSnapshot> {
  const visibleGroups = await getVisibleGroupsForNpub(npub);

  const snapshot: GroupsIndexSnapshot = {
    activeGroups: visibleGroups.activeGroups,
    archivedGroups: visibleGroups.archivedGroups,
    updatedAt: Date.now(),
  };

  await writeGroupsIndex(snapshot);
  emitGroupsIndexChanged(snapshot);

  return snapshot;
}

export function scheduleGroupsMembershipRefresh(npub: string) {
  enqueueStartupJob({
    id: `groups-membership-refresh-${npub}`,
    label: 'Refresh group memberships',
    priority: 'idle',
    run: async () => {
      const activeGroups = await getActiveGroups();

      for (const group of activeGroups) {
        await syncGroupMembersFromRelay(
          group.id,
          group.relayUrl ? [group.relayUrl] : [DEFAULT_RELAY]
        );

        await new Promise(resolve => setTimeout(resolve, 0));
      }

      await rebuildGroupsIndexForNpub(npub);
    },
  });
}

export async function clearGroupsIndex(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GROUPS_INDEX_KEY);
    emitGroupsIndexChanged(emptySnapshot());
  } catch (error) {
    console.warn('[Groups Index] failed to clear index:', error);
  }
}