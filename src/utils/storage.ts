import AsyncStorage from '@react-native-async-storage/async-storage';

const MILESTONES_KEY = 'milestones_v1';
const FAMILY_KEY = 'family_v1';

export interface Milestone {
  id: string;
  note: string;
  tags: string[];
  photoUri?: string;
  audioUri?: string;
  videoUri?: string;
  createdAt: number;
  nostrEventId?: string;
  publishedToRelay: boolean;
  reflections?: { text: string; createdAt: number }[];
  familyId?: string;
  authorNpub?: string;
}

export interface Family {
  id: string;
  name: string;
  createdAt: number;
  role: 'admin' | 'member';
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

export async function getMilestones(): Promise<Milestone[]> {
  const raw = await AsyncStorage.getItem(MILESTONES_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
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
  await AsyncStorage.setItem(FAMILY_KEY, JSON.stringify(family));
}

export async function getFamily(): Promise<Family | null> {
  const raw = await AsyncStorage.getItem(FAMILY_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function leaveFamily(): Promise<void> {
  await AsyncStorage.removeItem(FAMILY_KEY);
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