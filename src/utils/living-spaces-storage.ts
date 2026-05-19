import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildLivingSpaceIndexes,
  createGentleLivingPromptForView,
  createDefaultLivingSpaces,
  createLockedLivingMarkPlacement,
  createLivingMarkMetadata,
  createLivingSpaceFromGroup,
  createLivingMarkView,
  deriveLivingMarkPlacement,
  hasLivingPromptQueuedToday,
  livingRelayTargetsFromRoutingDecision,
  normalizeLivingMarkPermissions,
  resolveLivingSpaceRoutes,
  SYSTEM_LIVING_SPACE_IDS,
} from './living-space-routing';
import { createLivingPerson, getLivingPersonId, normalizeLivingPeople } from './living-people';
import { getFamily, getMilestones, saveRemoteMilestone, type Family, type Milestone } from './storage';
import { getGroups, type BEGroup } from './group-storage';
import {
  applySchoolConsentDecisionToPermissions,
  getSchoolConsentDecisionForMark,
} from './school-consent-storage';
import type {
  LivingMarkCaptureInput,
  LivingMarkMetadata,
  LivingMarkPermissions,
  LivingMarkPerson,
  LivingMarkPlacement,
  LivingMarkPlacementReason,
  LivingMarkPrompt,
  LivingMarkPromptCard,
  LivingMarkPromptStatus,
  LivingMarkView,
  LivingRoutingDecision,
  LivingSpace,
  LivingSpaceDefaultsInput,
  LivingSpaceIndexes,
} from '../types/living-spaces';

export const LIVING_SPACES_KEY = 'living_spaces_v1';
export const LIVING_MARK_PLACEMENTS_KEY = 'living_mark_placements_v1';
export const LIVING_MARK_METADATA_KEY = 'living_mark_metadata_v1';
export const LIVING_MARK_PROMPTS_KEY = 'living_mark_prompts_v1';
export const LIVING_SPACE_INDEXES_KEY = 'living_space_indexes_v1';
export const LIVING_SPACE_ROUTING_KEY = 'living_space_routing_v1';

type RoutingCache = Record<string, LivingRoutingDecision>;

type LivingMarkContextUpdateInput = {
  milestone: Milestone;
  currentNpub?: string | null;
  peopleIds?: string[];
  people?: LivingMarkPerson[];
  lifeStage?: string;
  eventId?: string;
  placeName?: string;
  selectedSpaceId?: string | null;
  spaceChanged?: boolean;
  savedToBook?: boolean;
  markPermissions?: LivingMarkPermissions;
  now?: number;
};

type LivingMarkPromptActionInput = {
  promptId: string;
  action: 'done' | 'snooze';
  currentNpub?: string | null;
  now?: number;
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.warn(`[Living Spaces] failed to read ${key}:`, error);
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[Living Spaces] failed to write ${key}:`, error);
  }
}

function sortSpaces(spaces: LivingSpace[]): LivingSpace[] {
  return [...spaces].sort((a, b) => {
    if (!!a.archivedAt !== !!b.archivedAt) return a.archivedAt ? 1 : -1;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });
}

function sortPlacements(placements: LivingMarkPlacement[]): LivingMarkPlacement[] {
  return [...placements].sort((a, b) => b.updatedAt - a.updatedAt);
}

function sortMetadata(items: LivingMarkMetadata[]): LivingMarkMetadata[] {
  return [...items].map(normalizeLivingMarkMetadata).sort((a, b) => b.updatedAt - a.updatedAt);
}

function normalizeLivingMarkMetadata(item: LivingMarkMetadata): LivingMarkMetadata {
  const authorPeople = (item.people ?? []).filter(person => person.role === 'author');
  const subjectPeople = normalizeLivingPeople({
    people: (item.people ?? []).filter(person => person.role !== 'author'),
    peopleIds: item.peopleIds ?? [],
    fallbackRole: 'subject',
  });

  return {
    ...item,
    peopleIds: subjectPeople.peopleIds,
    people: [...authorPeople, ...subjectPeople.people],
    relayTargets: item.relayTargets ?? [],
    markPermissions: normalizeLivingMarkPermissions(item.markPermissions),
    savedToBook: item.savedToBook ?? false,
    enrichment: {
      isComplete: item.enrichment?.isComplete ?? false,
      promptCount: item.enrichment?.promptCount ?? 0,
      lastPromptedAt: item.enrichment?.lastPromptedAt,
      completedPromptTypes: item.enrichment?.completedPromptTypes ?? [],
      dismissedPromptTypes: item.enrichment?.dismissedPromptTypes ?? [],
    },
  };
}

function sortPrompts(prompts: LivingMarkPrompt[]): LivingMarkPrompt[] {
  return [...prompts].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'open' ? -1 : b.status === 'open' ? 1 : 0;
    }

    return a.dueAt - b.dueAt;
  });
}

function isRemoteMediaUri(uri?: string): boolean {
  return !uri || /^https?:\/\//i.test(uri.trim());
}

function milestoneHasOnlyRemoteMedia(milestone: Milestone): boolean {
  const mediaItems = milestone.media ?? [];
  return (
    isRemoteMediaUri(milestone.photoUri) &&
    isRemoteMediaUri(milestone.videoUri) &&
    isRemoteMediaUri(milestone.audioUri) &&
    mediaItems.every(item =>
      isRemoteMediaUri(item.uri) &&
      isRemoteMediaUri(item.thumbnailUri)
    )
  );
}

function metadataRecordFromList(items: LivingMarkMetadata[]): Record<string, LivingMarkMetadata> {
  return items.reduce(
    (acc, item) => {
      acc[item.markId] = item;
      return acc;
    },
    {} as Record<string, LivingMarkMetadata>
  );
}

function cleanOptionalText(value?: string): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function splitMarkTitleAndPreview(note: string): { title?: string; preview: string } {
  const cleanNote = note.trim();
  if (!cleanNote) return { preview: 'Untitled Mark' };

  const hasTitle = cleanNote.includes('\n\n');
  const title = hasTitle ? cleanNote.split('\n\n')[0].trim() : undefined;
  const preview = hasTitle
    ? cleanNote.split('\n\n').slice(1).join('\n\n').trim()
    : cleanNote;

  return {
    title,
    preview: preview || title || 'Untitled Mark',
  };
}

function mergePeopleForContext(input: {
  metadata: LivingMarkMetadata;
  milestone: Milestone;
  peopleIds: string[];
  people?: LivingMarkPerson[];
}): LivingMarkPerson[] {
  const authorPeople = input.metadata.people.filter(person => person.role === 'author');
  const hasAuthor = authorPeople.length > 0;
  const authorFallback: LivingMarkPerson[] =
    !hasAuthor && input.milestone.authorNpub
      ? [
          createLivingPerson({
            npub: input.milestone.authorNpub,
            displayName: input.milestone.authorName?.trim() || undefined,
            source: 'derived',
            role: 'author',
          }),
        ]
      : [];
  const normalizedSubjects = normalizeLivingPeople({
    people: input.people,
    peopleIds: input.peopleIds,
    fallbackRole: 'subject',
  });

  return [...authorPeople, ...authorFallback, ...normalizedSubjects.people];
}

function syncBookPlacement(input: {
  placement: LivingMarkPlacement;
  savedToBook: boolean;
  now: number;
}): LivingMarkPlacement {
  const bookSpaceId = SYSTEM_LIVING_SPACE_IDS.livingBook;
  const spaceIds = input.savedToBook
    ? Array.from(new Set([...input.placement.spaceIds, bookSpaceId]))
    : input.placement.spaceIds.filter(spaceId => spaceId !== bookSpaceId);
  const nextSpaceIds = spaceIds.length > 0 ? spaceIds : [SYSTEM_LIVING_SPACE_IDS.profile];
  const hasBookReason = input.placement.reasons.some(reason => reason.type === 'book-save');
  const reasons: LivingMarkPlacementReason[] =
    input.savedToBook && !hasBookReason
      ? [
          ...input.placement.reasons,
          {
            type: 'book-save',
            confidence: 'confirmed',
            createdAt: input.now,
            spaceId: bookSpaceId,
          },
        ]
      : input.savedToBook
        ? input.placement.reasons
        : input.placement.reasons.filter(reason => reason.type !== 'book-save');

  return {
    ...input.placement,
    spaceIds: nextSpaceIds,
    primarySpaceId:
      input.placement.primarySpaceId && nextSpaceIds.includes(input.placement.primarySpaceId)
        ? input.placement.primarySpaceId
        : nextSpaceIds[0],
    reasons,
    updatedAt: input.now,
  };
}

export async function getLivingSpaces(): Promise<LivingSpace[]> {
  return sortSpaces(await readJson<LivingSpace[]>(LIVING_SPACES_KEY, []));
}

export async function saveLivingSpaces(spaces: LivingSpace[]): Promise<void> {
  await writeJson(LIVING_SPACES_KEY, sortSpaces(spaces));
}

export async function ensureDefaultLivingSpaces(input: LivingSpaceDefaultsInput = {}): Promise<LivingSpace[]> {
  const existing = await getLivingSpaces();
  const defaults = createDefaultLivingSpaces(input);
  const byId = new Map(existing.map(space => [space.id, space]));

  for (const defaultSpace of defaults) {
    const current = byId.get(defaultSpace.id);
    byId.set(defaultSpace.id, current ? { ...defaultSpace, ...current } : defaultSpace);
  }

  const merged = sortSpaces(Array.from(byId.values()));
  await saveLivingSpaces(merged);
  return merged;
}

export async function syncLivingSpacesFromGroups(input: {
  groups?: BEGroup[];
  now?: number;
} = {}): Promise<LivingSpace[]> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const [family, groups] = await Promise.all([
    getFamily(),
    input.groups ? Promise.resolve(input.groups) : getGroups(),
  ]);
  const baseSpaces = await ensureDefaultLivingSpaces({
    family: familyToSeed(family),
    groups: groups.map(groupToSeed),
    now,
  });
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const syncedSpaces = baseSpaces.map(space => {
    if (space.source !== 'group' || !space.sourceId) {
      return space;
    }

    const group = groupsById.get(space.sourceId);

    if (!group) {
      return {
        ...space,
        archivedAt: space.archivedAt ?? now,
        updatedAt: now,
      };
    }

    const mirrored = createLivingSpaceFromGroup(groupToSeed(group), now);

    return {
      ...space,
      ...mirrored,
      id: space.id,
      createdAt: space.createdAt ?? mirrored.createdAt,
      archivedAt: group.status === 'archived' ? space.archivedAt ?? group.updatedAt ?? now : undefined,
      updatedAt: group.updatedAt ?? mirrored.updatedAt ?? now,
    };
  });

  await saveLivingSpaces(syncedSpaces);
  return sortSpaces(syncedSpaces);
}

export async function upsertLivingSpace(space: LivingSpace): Promise<LivingSpace[]> {
  const spaces = await getLivingSpaces();
  const existingIndex = spaces.findIndex(item => item.id === space.id);

  const next =
    existingIndex >= 0
      ? spaces.map(item => (item.id === space.id ? { ...item, ...space } : item))
      : [...spaces, space];

  await saveLivingSpaces(next);
  return sortSpaces(next);
}

export async function getLivingMarkPlacements(): Promise<LivingMarkPlacement[]> {
  return sortPlacements(await readJson<LivingMarkPlacement[]>(LIVING_MARK_PLACEMENTS_KEY, []));
}

export async function saveLivingMarkPlacements(placements: LivingMarkPlacement[]): Promise<void> {
  await writeJson(LIVING_MARK_PLACEMENTS_KEY, sortPlacements(placements));
}

export async function getLivingMarkPlacement(markId: string): Promise<LivingMarkPlacement | null> {
  const placements = await getLivingMarkPlacements();
  return placements.find(placement => placement.markId === markId) ?? null;
}

export async function upsertLivingMarkPlacement(placement: LivingMarkPlacement): Promise<LivingMarkPlacement[]> {
  const placements = await getLivingMarkPlacements();
  const existingIndex = placements.findIndex(item => item.markId === placement.markId);

  const next =
    existingIndex >= 0
      ? placements.map(item => (item.markId === placement.markId ? { ...item, ...placement } : item))
      : [...placements, placement];

  await saveLivingMarkPlacements(next);
  return sortPlacements(next);
}

export async function removeLivingMarkPlacement(markId: string): Promise<void> {
  const placements = await getLivingMarkPlacements();
  await saveLivingMarkPlacements(placements.filter(placement => placement.markId !== markId));
}

export async function getLivingMarkMetadataItems(): Promise<LivingMarkMetadata[]> {
  return sortMetadata(await readJson<LivingMarkMetadata[]>(LIVING_MARK_METADATA_KEY, []));
}

export async function saveLivingMarkMetadataItems(items: LivingMarkMetadata[]): Promise<void> {
  await writeJson(LIVING_MARK_METADATA_KEY, sortMetadata(items));
}

export async function getLivingMarkMetadata(markId: string): Promise<LivingMarkMetadata | null> {
  const metadata = await getLivingMarkMetadataItems();
  return metadata.find(item => item.markId === markId) ?? null;
}

export async function upsertLivingMarkMetadata(metadata: LivingMarkMetadata): Promise<LivingMarkMetadata[]> {
  const items = await getLivingMarkMetadataItems();
  const existingIndex = items.findIndex(item => item.markId === metadata.markId);

  const next =
    existingIndex >= 0
      ? items.map(item => (item.markId === metadata.markId ? { ...item, ...metadata } : item))
      : [...items, metadata];

  await saveLivingMarkMetadataItems(next);
  return sortMetadata(next);
}

export async function getLivingMarkPrompts(): Promise<LivingMarkPrompt[]> {
  return sortPrompts(await readJson<LivingMarkPrompt[]>(LIVING_MARK_PROMPTS_KEY, []));
}

export async function saveLivingMarkPrompts(prompts: LivingMarkPrompt[]): Promise<void> {
  await writeJson(LIVING_MARK_PROMPTS_KEY, sortPrompts(prompts));
}

export async function getOpenLivingMarkPrompts(now = Math.floor(Date.now() / 1000)): Promise<LivingMarkPrompt[]> {
  const prompts = await getLivingMarkPrompts();

  return prompts.filter(prompt => {
    if (prompt.status === 'open') return prompt.dueAt <= now;
    if (prompt.status === 'snoozed') return (prompt.snoozedUntil ?? 0) <= now;
    return false;
  });
}

export async function upsertLivingMarkPrompt(prompt: LivingMarkPrompt): Promise<LivingMarkPrompt[]> {
  const prompts = await getLivingMarkPrompts();
  const existingIndex = prompts.findIndex(item => item.id === prompt.id);

  const next =
    existingIndex >= 0
      ? prompts.map(item => (item.id === prompt.id ? { ...item, ...prompt } : item))
      : [...prompts, prompt];

  await saveLivingMarkPrompts(next);
  return sortPrompts(next);
}

export async function updateLivingMarkPromptStatus(input: {
  promptId: string;
  status: LivingMarkPromptStatus;
  snoozedUntil?: number;
  now?: number;
}): Promise<void> {
  const prompts = await getLivingMarkPrompts();
  const now = input.now ?? Math.floor(Date.now() / 1000);

  await saveLivingMarkPrompts(
    prompts.map(prompt => {
      if (prompt.id !== input.promptId) return prompt;

      return {
        ...prompt,
        status: input.status,
        updatedAt: now,
        answeredAt: input.status === 'answered' ? now : prompt.answeredAt,
        dismissedAt: input.status === 'dismissed' ? now : prompt.dismissedAt,
        snoozedUntil: input.status === 'snoozed' ? input.snoozedUntil : undefined,
      };
    })
  );
}

function promptIsSatisfiedByContext(
  prompt: LivingMarkPrompt,
  metadata: LivingMarkMetadata,
  placement: LivingMarkPlacement
): boolean {
  if (prompt.type === 'add-people') {
    return metadata.peopleIds.length > 0;
  }

  if (prompt.type === 'add-place') {
    return !!metadata.place;
  }

  if (prompt.type === 'confirm-space') {
    return placement.confidence === 'confirmed' || placement.confidence === 'locked';
  }

  if (prompt.type === 'add-to-book') {
    return metadata.savedToBook || placement.spaceIds.includes(SYSTEM_LIVING_SPACE_IDS.livingBook);
  }

  return false;
}

function resolveSatisfiedPromptsForContext(input: {
  prompts: LivingMarkPrompt[];
  markId: string;
  metadata: LivingMarkMetadata;
  placement: LivingMarkPlacement;
  now: number;
}): { prompts: LivingMarkPrompt[]; changed: boolean } {
  let changed = false;

  const prompts = input.prompts.map(prompt => {
    if (
      prompt.markId !== input.markId ||
      (prompt.status !== 'open' && prompt.status !== 'snoozed') ||
      !promptIsSatisfiedByContext(prompt, input.metadata, input.placement)
    ) {
      return prompt;
    }

    changed = true;

    return {
      ...prompt,
      status: 'answered' as const,
      answeredAt: input.now,
      updatedAt: input.now,
      snoozedUntil: undefined,
    };
  });

  return { prompts, changed };
}

export async function getLivingSpaceIndexes(): Promise<LivingSpaceIndexes> {
  const fallback: LivingSpaceIndexes = {
    bySpaceId: {},
    byTag: {},
    byPeopleId: {},
    byYear: {},
    byPlaceKey: {},
    byPrivacy: {
      private: [],
      space: [],
      family: [],
      public: [],
    },
    byPromptStatus: {
      open: [],
      answered: [],
      dismissed: [],
      snoozed: [],
    },
    updatedAt: [],
    rebuiltAt: 0,
  };
  const stored = await readJson<LivingSpaceIndexes>(LIVING_SPACE_INDEXES_KEY, fallback);

  return {
    ...fallback,
    ...stored,
    byPrivacy: {
      ...fallback.byPrivacy,
      ...(stored.byPrivacy ?? {}),
    },
    byPromptStatus: {
      ...fallback.byPromptStatus,
      ...(stored.byPromptStatus ?? {}),
    },
    byPeopleId: stored.byPeopleId ?? {},
    byYear: stored.byYear ?? {},
    byPlaceKey: stored.byPlaceKey ?? {},
  };
}

export async function saveLivingSpaceIndexes(indexes: LivingSpaceIndexes): Promise<void> {
  await writeJson(LIVING_SPACE_INDEXES_KEY, indexes);
}

export async function getLivingMarkIdsForPerson(input: {
  npub?: string;
  displayName?: string;
  id?: string;
}): Promise<string[]> {
  const personId = getLivingPersonId(input);
  const indexes = await getLivingSpaceIndexes();
  return indexes.byPeopleId[personId] ?? indexes.byPeopleId[personId.toLowerCase()] ?? [];
}

export async function rebuildLivingSpaceIndexes(
  metadataByMarkId: Record<string, LivingMarkMetadata> = {}
): Promise<LivingSpaceIndexes> {
  const placements = await getLivingMarkPlacements();
  const prompts = await getLivingMarkPrompts();
  const indexes = buildLivingSpaceIndexes(placements, metadataByMarkId, prompts);

  await saveLivingSpaceIndexes(indexes);
  return indexes;
}

async function rebuildLivingSpaceIndexesFromStorage(now = Math.floor(Date.now() / 1000)): Promise<LivingSpaceIndexes> {
  const [placements, metadataItems, prompts] = await Promise.all([
    getLivingMarkPlacements(),
    getLivingMarkMetadataItems(),
    getLivingMarkPrompts(),
  ]);
  const indexes = buildLivingSpaceIndexes(
    placements,
    metadataRecordFromList(metadataItems),
    prompts,
    now
  );

  await saveLivingSpaceIndexes(indexes);
  return indexes;
}

export async function getLivingRoutingCache(): Promise<RoutingCache> {
  return readJson<RoutingCache>(LIVING_SPACE_ROUTING_KEY, {});
}

export async function saveLivingRoutingCache(cache: RoutingCache): Promise<void> {
  await writeJson(LIVING_SPACE_ROUTING_KEY, cache);
}

export async function upsertLivingRoutingDecision(
  cacheKey: string,
  decision: LivingRoutingDecision
): Promise<RoutingCache> {
  const cache = await getLivingRoutingCache();
  const next = {
    ...cache,
    [cacheKey]: decision,
  };

  await saveLivingRoutingCache(next);
  return next;
}

export async function getResolvedLivingPlacementForMilestone(input: {
  milestone: Milestone;
  spaces?: LivingSpace[];
  currentNpub?: string | null;
  now?: number;
}): Promise<LivingMarkPlacement> {
  const explicitPlacement = await getLivingMarkPlacement(input.milestone.id);
  const spaces = input.spaces ?? (await getLivingSpaces());

  return deriveLivingMarkPlacement({
    milestone: input.milestone,
    spaces,
    explicitPlacement,
    currentNpub: input.currentNpub,
    now: input.now,
  });
}

export async function getLivingMarkViewForMilestone(input: {
  milestone: Milestone;
  spaces?: LivingSpace[];
  currentNpub?: string | null;
  now?: number;
}): Promise<LivingMarkView> {
  const spaces = input.spaces ?? (await getLivingSpaces());
  const explicitPlacement = await getLivingMarkPlacement(input.milestone.id);
  const metadata =
    (await getLivingMarkMetadata(input.milestone.id)) ??
    createLivingMarkMetadata(input.milestone, {
      currentNpub: input.currentNpub,
      now: input.now,
    });

  return createLivingMarkView({
    milestone: input.milestone,
    spaces,
    explicitPlacement,
    explicitMetadata: metadata,
    currentNpub: input.currentNpub,
    now: input.now,
  });
}

export async function getLivingMarkViewsForMilestones(input: {
  milestones: Milestone[];
  spaces?: LivingSpace[];
  currentNpub?: string | null;
  now?: number;
}): Promise<LivingMarkView[]> {
  const spaces = input.spaces ?? (await getLivingSpaces());
  const placements = await getLivingMarkPlacements();
  const metadataItems = await getLivingMarkMetadataItems();
  const placementByMarkId = new Map(placements.map(placement => [placement.markId, placement]));
  const metadataByMarkId = new Map(metadataItems.map(metadata => [metadata.markId, metadata]));

  return input.milestones.map(milestone => {
    const metadata =
      metadataByMarkId.get(milestone.id) ??
      createLivingMarkMetadata(milestone, {
        currentNpub: input.currentNpub,
        now: input.now,
      });

    return createLivingMarkView({
      milestone,
      spaces,
      explicitPlacement: placementByMarkId.get(milestone.id) ?? null,
      explicitMetadata: metadata,
      currentNpub: input.currentNpub,
      now: input.now,
    });
  });
}

export async function getLivingMarkPromptCards(input: {
  currentNpub?: string | null;
  now?: number;
  limit?: number;
} = {}): Promise<LivingMarkPromptCard[]> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const limit = input.limit ?? 1;
  const [prompts, milestones, spaces] = await Promise.all([
    getOpenLivingMarkPrompts(now),
    getMilestones(),
    getLivingSpaces(),
  ]);
  const milestoneById = new Map(milestones.map(milestone => [milestone.id, milestone]));
  const cards: LivingMarkPromptCard[] = [];

  for (const prompt of prompts) {
    const milestone = milestoneById.get(prompt.markId);
    if (!milestone) continue;

    const view = await getLivingMarkViewForMilestone({
      milestone,
      spaces,
      currentNpub: input.currentNpub,
      now,
    });
    const markCopy = splitMarkTitleAndPreview(milestone.note);

    cards.push({
      prompt,
      view,
      markTitle: markCopy.title,
      markPreview: markCopy.preview,
      canCompleteInline: prompt.type === 'confirm-space' || prompt.type === 'add-to-book',
    });

    if (cards.length >= limit) break;
  }

  return cards;
}

export async function applyLivingMarkPromptAction(input: LivingMarkPromptActionInput): Promise<{
  handledInline: boolean;
  card?: LivingMarkPromptCard;
}> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const prompts = await getLivingMarkPrompts();
  const prompt = prompts.find(item => item.id === input.promptId);

  if (!prompt) {
    return { handledInline: false };
  }

  if (input.action === 'snooze') {
    await updateLivingMarkPromptStatus({
      promptId: input.promptId,
      status: 'snoozed',
      snoozedUntil: now + 86400,
      now,
    });
    await rebuildLivingSpaceIndexesFromStorage(now);
    return { handledInline: true };
  }

  const [milestones, spaces] = await Promise.all([getMilestones(), getLivingSpaces()]);
  const milestone = milestones.find(item => item.id === prompt.markId);

  if (!milestone) {
    await updateLivingMarkPromptStatus({
      promptId: input.promptId,
      status: 'dismissed',
      now,
    });
    await rebuildLivingSpaceIndexesFromStorage(now);
    return { handledInline: true };
  }

  const currentView = await getLivingMarkViewForMilestone({
    milestone,
    spaces,
    currentNpub: input.currentNpub,
    now,
  });

  if (prompt.type === 'confirm-space') {
    const selectedSpaceId =
      currentView.placement.primarySpaceId ?? prompt.suggestedSpaceIds?.[0] ?? currentView.placement.spaceIds[0];

    if (!selectedSpaceId) {
      return { handledInline: false };
    }

    const view = await updateLivingMarkContext({
      milestone,
      currentNpub: input.currentNpub,
      selectedSpaceId,
      spaceChanged: true,
      savedToBook: currentView.metadata.savedToBook,
      now,
    });
    await updateLivingMarkPromptStatus({
      promptId: input.promptId,
      status: 'answered',
      now,
    });
    await rebuildLivingSpaceIndexesFromStorage(now);
    const markCopy = splitMarkTitleAndPreview(milestone.note);

    return {
      handledInline: true,
      card: {
        prompt: {
          ...prompt,
          status: 'answered',
          answeredAt: now,
          updatedAt: now,
        },
        view,
        markTitle: markCopy.title,
        markPreview: markCopy.preview,
        canCompleteInline: true,
      },
    };
  }

  if (prompt.type === 'add-to-book') {
    const view = await updateLivingMarkContext({
      milestone,
      currentNpub: input.currentNpub,
      savedToBook: true,
      now,
    });
    await updateLivingMarkPromptStatus({
      promptId: input.promptId,
      status: 'answered',
      now,
    });
    await rebuildLivingSpaceIndexesFromStorage(now);

    const markCopy = splitMarkTitleAndPreview(milestone.note);
    return {
      handledInline: true,
      card: {
        prompt: {
          ...prompt,
          status: 'answered',
          answeredAt: now,
          updatedAt: now,
        },
        view,
        markTitle: markCopy.title,
        markPreview: markCopy.preview,
        canCompleteInline: true,
      },
    };
  }

  return {
    handledInline: false,
    card: {
      prompt,
      view: currentView,
      markTitle: splitMarkTitleAndPreview(milestone.note).title,
      markPreview: splitMarkTitleAndPreview(milestone.note).preview,
      canCompleteInline: false,
    },
  };
}

function familyToSeed(family: Family | null) {
  return family
    ? {
        id: family.id,
        name: family.name,
        relayUrl: family.relayUrl,
        relayMode: family.relayMode,
      }
    : null;
}

function groupToSeed(group: BEGroup) {
  return {
    id: group.id,
    name: group.name,
    spaceType: group.spaceType,
    description: group.description,
    sport: group.sport,
    icon: group.icon,
    coverImage: group.coverImage,
    schoolId: group.schoolId,
    relayUrl: group.relayUrl,
    relayMode: group.relayMode,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function inferPrivacyForSelectedSpace(input: {
  selectedSpace?: LivingSpace;
  milestone: Milestone;
}) {
  if (!input.selectedSpace) return undefined;
  if (input.selectedSpace.type === 'family' || input.milestone.familyId) return 'family' as const;
  if (input.selectedSpace.type === 'personal' || input.selectedSpace.type === 'book') return 'private' as const;
  return input.selectedSpace.privacyDefault;
}

function familyRelayUrlForPlacement(spaces: LivingSpace[], placement: LivingMarkPlacement): string | undefined {
  const selectedSpaceIds = new Set(placement.spaceIds);
  return spaces.find(space => selectedSpaceIds.has(space.id) && space.type === 'family')?.relayUrl;
}

async function applySchoolConsentSafety(input: {
  metadata: LivingMarkMetadata;
  placement: LivingMarkPlacement;
  spaces: LivingSpace[];
}): Promise<LivingMarkMetadata> {
  const selectedSpaceIds = new Set(input.placement.spaceIds);
  const groupSpace = input.spaces.find(space =>
    selectedSpaceIds.has(space.id) &&
    space.source === 'group' &&
    !!space.sourceId
  );

  if (!groupSpace?.sourceId) return input.metadata;

  const groups = await getGroups();
  const group = groups.find(item => item.id === groupSpace.sourceId);

  if (!group) return input.metadata;

  const decision = await getSchoolConsentDecisionForMark({
    group,
    people: input.metadata.people.filter(person => person.role !== 'author'),
    permissions: input.metadata.markPermissions,
  });

  const nextPermissions = applySchoolConsentDecisionToPermissions(
    input.metadata.markPermissions,
    decision
  );

  return {
    ...input.metadata,
    markPermissions: nextPermissions,
  };
}

async function queuePromptForViewIfAllowed(
  view: LivingMarkView,
  prompts: LivingMarkPrompt[],
  now: number
): Promise<LivingMarkPrompt[]> {
  if (hasLivingPromptQueuedToday(prompts, now)) return prompts;

  const nextPrompt = createGentleLivingPromptForView(view, prompts, now);
  if (!nextPrompt) return prompts;

  return sortPrompts([...prompts, nextPrompt]);
}

export async function persistLivingMarkCapture(input: LivingMarkCaptureInput): Promise<{
  metadata: LivingMarkMetadata;
  placement: LivingMarkPlacement;
  prompts: LivingMarkPrompt[];
}> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const spaces = input.spaces ?? (await getLivingSpaces());
  const selectedSpace = input.selectedSpaceId
    ? spaces.find(space => space.id === input.selectedSpaceId)
    : undefined;
  const privacy =
    input.privacy ??
    inferPrivacyForSelectedSpace({
      selectedSpace,
      milestone: input.milestone,
    }) ?? undefined;
  let metadata = createLivingMarkMetadata(input.milestone, {
    currentNpub: input.currentNpub,
    peopleIds: input.peopleIds,
    people: input.people,
    lifeStage: input.lifeStage,
    eventId: input.eventId,
    savedToBook: input.savedToBook,
    markPermissions: input.markPermissions,
    relayTargets: input.relayTargets,
    now,
    captureSource: input.captureSource,
    place: input.place,
    occurredAt: input.occurredAt,
    capturedAt: input.capturedAt,
    privacy,
  });
  const placement = input.selectedSpaceId
    ? createLockedLivingMarkPlacement({
        markId: input.milestone.id,
        spaceId: input.selectedSpaceId,
        privacy: metadata.privacy,
        now,
        reason: 'selected-chip',
      })
    : deriveLivingMarkPlacement({
        milestone: input.milestone,
        spaces,
        explicitMetadata: metadata,
        currentNpub: input.currentNpub,
        now,
      });
  const routingDecision = resolveLivingSpaceRoutes({
    markId: input.milestone.id,
    privacy: metadata.privacy,
    placement,
    spaces,
    familyId: input.milestone.familyId,
    familyRelayUrl: familyRelayUrlForPlacement(spaces, placement),
    now,
  });

  metadata = await applySchoolConsentSafety({
    metadata,
    placement,
    spaces,
  });

  metadata = {
    ...metadata,
    relayTargets: input.relayTargets ?? livingRelayTargetsFromRoutingDecision(routingDecision, spaces),
    updatedAt: now,
  };

  const allMetadata = await upsertLivingMarkMetadata(metadata);
  await upsertLivingMarkPlacement(placement);
  await upsertLivingRoutingDecision(input.milestone.id, routingDecision);

  const view = createLivingMarkView({
    milestone: input.milestone,
    spaces,
    explicitMetadata: metadata,
    explicitPlacement: placement,
    currentNpub: input.currentNpub,
    now,
  });
  const prompts = await queuePromptForViewIfAllowed(
    view,
    await getLivingMarkPrompts(),
    now
  );

  await saveLivingMarkPrompts(prompts);
  await saveLivingSpaceIndexes(
    buildLivingSpaceIndexes(
      await getLivingMarkPlacements(),
      metadataRecordFromList(allMetadata),
      prompts,
      now
    )
  );

  return {
    metadata,
    placement,
    prompts,
  };
}

export async function importLivingSpaceMarkSnapshot(input: {
  groupId: string;
  milestone: Milestone;
  metadata?: LivingMarkMetadata;
  placement?: LivingMarkPlacement;
  spaces?: LivingSpace[];
  currentNpub?: string | null;
  now?: number;
}): Promise<void> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const spaces = input.spaces ?? (await getLivingSpaces());
  const spaceId = `group:${input.groupId}`;
  const milestone: Milestone = {
    ...input.milestone,
    publishedToRelay: input.milestone.publishedToRelay === true,
    spaceRelayPublishedAt: input.milestone.spaceRelayPublishedAt ?? now,
    spaceRelayGroupIds: Array.from(new Set([
      ...(input.milestone.spaceRelayGroupIds ?? []),
      input.groupId,
    ])),
  };
  const existingLocalMilestone = (await getMilestones()).find(item => item.id === milestone.id);

  if (!milestone.authorNpub) {
    console.warn('[Space Marks] skipped snapshot without author identity:', milestone.id);
    return;
  }

  if (!milestoneHasOnlyRemoteMedia(milestone)) {
    console.warn('[Space Marks] skipped local-media snapshot:', milestone.id);
    return;
  }

  if (
    existingLocalMilestone &&
    (
      !existingLocalMilestone.authorNpub ||
      existingLocalMilestone.authorNpub !== milestone.authorNpub
    )
  ) {
    console.warn('[Space Marks] skipped id collision with different local Mark:', milestone.id);
    return;
  }

  const isSelfImport =
    !!input.currentNpub &&
    !!milestone.authorNpub &&
    milestone.authorNpub === input.currentNpub &&
    !!existingLocalMilestone;

  if (isSelfImport) return;

  if (!isSelfImport) {
    await saveRemoteMilestone(milestone);
  }

  if (input.metadata && input.placement) {
    const placement = {
      ...input.placement,
      spaceIds: Array.from(new Set([...(input.placement.spaceIds ?? []), spaceId])),
      primarySpaceId: input.placement.primarySpaceId ?? spaceId,
      updatedAt: input.placement.updatedAt ?? now,
    };
    const metadata = await applySchoolConsentSafety({
      metadata: {
        ...input.metadata,
        updatedAt: input.metadata.updatedAt ?? now,
      },
      placement,
      spaces,
    });
    const allMetadata = await upsertLivingMarkMetadata(metadata);
    await upsertLivingMarkPlacement(placement);

    const routingDecision = resolveLivingSpaceRoutes({
      markId: milestone.id,
      privacy: metadata.privacy,
      placement,
      spaces,
      familyId: milestone.familyId,
      familyRelayUrl: familyRelayUrlForPlacement(spaces, placement),
      now,
    });

    await upsertLivingRoutingDecision(milestone.id, routingDecision);
    await saveLivingSpaceIndexes(
      buildLivingSpaceIndexes(
        await getLivingMarkPlacements(),
        metadataRecordFromList(allMetadata),
        await getLivingMarkPrompts(),
        now
      )
    );
    return;
  }

  await persistLivingMarkCapture({
    milestone,
    spaces,
    selectedSpaceId: spaceId,
    currentNpub: input.currentNpub,
    privacy: 'space',
    now,
  });
}

export async function updateLivingMarkContext(input: LivingMarkContextUpdateInput): Promise<LivingMarkView> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const spaces = await getLivingSpaces();
  const currentMetadata =
    (await getLivingMarkMetadata(input.milestone.id)) ??
    createLivingMarkMetadata(input.milestone, {
      currentNpub: input.currentNpub,
      now,
    });
  const currentPlacement =
    (await getLivingMarkPlacement(input.milestone.id)) ??
    deriveLivingMarkPlacement({
      milestone: input.milestone,
      spaces,
      explicitMetadata: currentMetadata,
      currentNpub: input.currentNpub,
      now,
    });
  const normalizedPeople = normalizeLivingPeople({
    people: input.people ?? currentMetadata.people.filter(person => person.role !== 'author'),
    peopleIds: input.peopleIds ?? currentMetadata.peopleIds,
    fallbackRole: 'subject',
  });
  const selectedSpace = input.selectedSpaceId
    ? spaces.find(space => space.id === input.selectedSpaceId)
    : undefined;
  const privacy =
    input.spaceChanged && selectedSpace
      ? inferPrivacyForSelectedSpace({
          selectedSpace,
          milestone: input.milestone,
        }) ?? currentMetadata.privacy
      : currentMetadata.privacy;
  const nextMetadata: LivingMarkMetadata = {
    ...currentMetadata,
    peopleIds: normalizedPeople.peopleIds,
    people: mergePeopleForContext({
      metadata: currentMetadata,
      milestone: input.milestone,
      peopleIds: normalizedPeople.peopleIds,
      people: normalizedPeople.people,
    }),
    lifeStage: input.lifeStage !== undefined ? cleanOptionalText(input.lifeStage) : currentMetadata.lifeStage,
    eventId: input.eventId !== undefined ? cleanOptionalText(input.eventId) : currentMetadata.eventId,
    place:
      input.placeName !== undefined
        ? cleanOptionalText(input.placeName)
          ? {
              ...(currentMetadata.place ?? {}),
              name: cleanOptionalText(input.placeName),
              source: 'manual' as const,
            }
          : undefined
        : currentMetadata.place,
    savedToBook: input.savedToBook ?? currentMetadata.savedToBook,
    markPermissions:
      input.markPermissions !== undefined
        ? normalizeLivingMarkPermissions(input.markPermissions)
        : normalizeLivingMarkPermissions(currentMetadata.markPermissions),
    privacy,
    updatedAt: now,
  };
  const basePlacement =
    input.spaceChanged && input.selectedSpaceId
      ? createLockedLivingMarkPlacement({
          markId: input.milestone.id,
          spaceId: input.selectedSpaceId,
          privacy,
          now,
          reason: 'user-confirmed',
        })
      : {
          ...currentPlacement,
          privacy,
          updatedAt: now,
        };
  const placement = syncBookPlacement({
    placement: basePlacement,
    savedToBook: nextMetadata.savedToBook,
    now,
  });
  const consentCheckedMetadata = await applySchoolConsentSafety({
    metadata: nextMetadata,
    placement,
    spaces,
  });
  const routingDecision = resolveLivingSpaceRoutes({
    markId: input.milestone.id,
    privacy: consentCheckedMetadata.privacy,
    placement,
    spaces,
    familyId: input.milestone.familyId,
    familyRelayUrl: familyRelayUrlForPlacement(spaces, placement),
    now,
  });
  const metadata: LivingMarkMetadata = {
    ...consentCheckedMetadata,
    relayTargets: livingRelayTargetsFromRoutingDecision(routingDecision, spaces),
  };
  const allMetadata = await upsertLivingMarkMetadata(metadata);

  await upsertLivingMarkPlacement(placement);
  await upsertLivingRoutingDecision(input.milestone.id, routingDecision);
  const resolvedPrompts = resolveSatisfiedPromptsForContext({
    prompts: await getLivingMarkPrompts(),
    markId: input.milestone.id,
    metadata,
    placement,
    now,
  });

  if (resolvedPrompts.changed) {
    await saveLivingMarkPrompts(resolvedPrompts.prompts);
  }

  await saveLivingSpaceIndexes(
    buildLivingSpaceIndexes(
      await getLivingMarkPlacements(),
      metadataRecordFromList(allMetadata),
      resolvedPrompts.prompts,
      now
    )
  );

  return createLivingMarkView({
    milestone: input.milestone,
    spaces,
    explicitMetadata: metadata,
    explicitPlacement: placement,
    currentNpub: input.currentNpub,
    now,
  });
}

export async function bootstrapLivingSpacesModel(input: {
  currentNpub?: string | null;
  now?: number;
} = {}): Promise<{
  spaces: number;
  marks: number;
  placements: number;
  metadata: number;
  prompts: number;
}> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const [milestones, family, groups] = await Promise.all([
    getMilestones(),
    getFamily(),
    getGroups(),
  ]);
  const spaces = await ensureDefaultLivingSpaces({
    family: familyToSeed(family),
    groups: groups.map(groupToSeed),
    now,
  });
  const existingPlacements = await getLivingMarkPlacements();
  const existingMetadata = await getLivingMarkMetadataItems();
  let prompts = await getLivingMarkPrompts();
  const placementByMarkId = new Map(existingPlacements.map(placement => [placement.markId, placement]));
  const metadataByMarkId = new Map(existingMetadata.map(metadata => [metadata.markId, metadata]));
  const nextPlacements = [...existingPlacements];
  const nextMetadata = [...existingMetadata];

  for (const milestone of milestones) {
    const baseMetadata =
      metadataByMarkId.get(milestone.id) ??
      createLivingMarkMetadata(milestone, {
        currentNpub: input.currentNpub,
        now,
      });
    const placement =
      placementByMarkId.get(milestone.id) ??
      deriveLivingMarkPlacement({
        milestone,
        spaces,
        explicitMetadata: baseMetadata,
        currentNpub: input.currentNpub,
        now,
      });
    const routingDecision = resolveLivingSpaceRoutes({
      markId: milestone.id,
      privacy: baseMetadata.privacy,
      placement,
      spaces,
      familyId: milestone.familyId,
      familyRelayUrl: familyRelayUrlForPlacement(spaces, placement),
      now,
    });
    const metadata =
      baseMetadata.relayTargets.length > 0
        ? baseMetadata
        : {
            ...baseMetadata,
            relayTargets: livingRelayTargetsFromRoutingDecision(routingDecision, spaces),
            updatedAt: now,
          };

    if (!metadataByMarkId.has(milestone.id)) {
      metadataByMarkId.set(milestone.id, metadata);
      nextMetadata.push(metadata);
    } else if (baseMetadata.relayTargets.length === 0) {
      metadataByMarkId.set(milestone.id, metadata);
      const metadataIndex = nextMetadata.findIndex(item => item.markId === milestone.id);
      if (metadataIndex >= 0) nextMetadata[metadataIndex] = metadata;
    }

    if (!placementByMarkId.has(milestone.id)) {
      placementByMarkId.set(milestone.id, placement);
      nextPlacements.push(placement);
    }

    const view = createLivingMarkView({
      milestone,
      spaces,
      explicitMetadata: metadata,
      explicitPlacement: placement,
      currentNpub: input.currentNpub,
      now,
    });

    prompts = await queuePromptForViewIfAllowed(view, prompts, now);
    await upsertLivingRoutingDecision(milestone.id, routingDecision);
  }

  await saveLivingMarkMetadataItems(nextMetadata);
  await saveLivingMarkPlacements(nextPlacements);
  await saveLivingMarkPrompts(prompts);
  await saveLivingSpaceIndexes(
    buildLivingSpaceIndexes(
      nextPlacements,
      metadataRecordFromList(nextMetadata),
      prompts,
      now
    )
  );

  return {
    spaces: spaces.length,
    marks: milestones.length,
    placements: nextPlacements.length,
    metadata: nextMetadata.length,
    prompts: prompts.length,
  };
}
