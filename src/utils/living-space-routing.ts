import { DEFAULT_RELAY } from './nostr';
import type { Milestone } from './storage';
import type {
  LivingMarkCaptureSource,
  LivingMarkMetadata,
  LivingMarkPerson,
  LivingMarkPlacement,
  LivingMarkPlacementConfidence,
  LivingMarkPlacementReason,
  LivingMarkPlace,
  LivingMarkPrompt,
  LivingMarkPromptStatus,
  LivingMarkPromptType,
  LivingMarkResolutionInput,
  LivingMarkView,
  LivingRouteDestination,
  LivingRoutingDecision,
  LivingRelayTarget,
  LivingSpace,
  LivingSpaceDefaultsInput,
  LivingSpaceGroupSeed,
  LivingSpaceIndexes,
  LivingSpaceType,
  MarkPrivacy,
} from '../types/living-spaces';

export const SYSTEM_LIVING_SPACE_IDS = {
  profile: 'space_profile',
  family: 'space_family',
  messages: 'space_messages',
  livingBook: 'space_living_book',
  places: 'space_places',
} as const;

const PROMPT_STATUS_VALUES: LivingMarkPromptStatus[] = ['open', 'answered', 'dismissed', 'snoozed'];

export function normalizeLivingTag(tag: string): string {
  return tag
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function normalizeLivingTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const normalized = normalizeLivingTag(tag);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function splitMarkTitleAndCaption(note: string): { title?: string; caption?: string } {
  const cleanNote = note.trim();
  if (!cleanNote) return {};

  const parts = cleanNote.split(/\n\s*\n/);

  if (parts.length === 1) {
    return { caption: cleanNote };
  }

  return {
    title: parts[0].trim() || undefined,
    caption: parts.slice(1).join('\n\n').trim() || undefined,
  };
}

function parseExifDate(value: unknown): number | undefined {
  if (!value) return undefined;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value !== 'string') return undefined;

  const cleaned = value.trim();
  if (!cleaned) return undefined;

  const exifMatch = cleaned.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  const parsedDate = exifMatch
    ? new Date(
        Number(exifMatch[1]),
        Number(exifMatch[2]) - 1,
        Number(exifMatch[3]),
        Number(exifMatch[4]),
        Number(exifMatch[5]),
        Number(exifMatch[6])
      )
    : new Date(cleaned);

  const time = parsedDate.getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

function parseRational(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const parts = value.split('/');
    if (parts.length === 2) {
      const numerator = Number(parts[0]);
      const denominator = Number(parts[1]);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        return numerator / denominator;
      }
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (value && typeof value === 'object') {
    const rational = value as { numerator?: number; denominator?: number };
    if (
      Number.isFinite(rational.numerator) &&
      Number.isFinite(rational.denominator) &&
      rational.denominator !== 0
    ) {
      return Number(rational.numerator) / Number(rational.denominator);
    }
  }

  return undefined;
}

function parseGpsCoordinate(value: unknown, ref: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return applyGpsRef(value, ref);
  }

  if (Array.isArray(value)) {
    const degrees = parseRational(value[0]);
    const minutes = parseRational(value[1]) ?? 0;
    const seconds = parseRational(value[2]) ?? 0;

    if (degrees === undefined) return undefined;

    return applyGpsRef(degrees + minutes / 60 + seconds / 3600, ref);
  }

  if (typeof value === 'string') {
    const parts = value.split(',').map(part => part.trim());

    if (parts.length >= 2) {
      const degrees = parseRational(parts[0]);
      const minutes = parseRational(parts[1]) ?? 0;
      const seconds = parseRational(parts[2]) ?? 0;

      if (degrees !== undefined) {
        return applyGpsRef(degrees + minutes / 60 + seconds / 3600, ref);
      }
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? applyGpsRef(parsed, ref) : undefined;
  }

  return undefined;
}

function applyGpsRef(value: number, ref: unknown): number {
  const normalizedRef = String(ref ?? '').trim().toUpperCase();
  return normalizedRef === 'S' || normalizedRef === 'W' ? -Math.abs(value) : value;
}

export function extractLivingCaptureFromExif(
  exif?: Record<string, any> | null
): { place?: LivingMarkPlace; occurredAt?: number } {
  if (!exif) return {};

  const latitude = parseGpsCoordinate(
    exif.GPSLatitude ?? exif.latitude ?? exif.Latitude,
    exif.GPSLatitudeRef ?? exif.latitudeRef
  );
  const longitude = parseGpsCoordinate(
    exif.GPSLongitude ?? exif.longitude ?? exif.Longitude,
    exif.GPSLongitudeRef ?? exif.longitudeRef
  );
  const occurredAt = parseExifDate(
    exif.DateTimeOriginal ?? exif.DateTimeDigitized ?? exif.DateTime ?? exif.CreationDate
  );
  const place =
    latitude !== undefined && longitude !== undefined
      ? {
          latitude,
          longitude,
          source: 'device' as const,
        }
      : undefined;

  return {
    place,
    occurredAt,
  };
}

function nowSeconds(input?: number): number {
  return input ?? Math.floor(Date.now() / 1000);
}

function cleanOptionalText(value?: string): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function normalizePeopleIds(peopleIds: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawId of peopleIds) {
    const clean = rawId.trim();
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(clean);
  }

  return result;
}

function createPeopleFromIds(peopleIds: string[]): LivingMarkPerson[] {
  return peopleIds.map(id => ({
    id,
    displayName: id,
    role: 'subject' as const,
  }));
}

function inferSpaceType(group: LivingSpaceGroupSeed): LivingSpaceType {
  const text = normalizeLivingTag(`${group.sport ?? ''} ${group.name} ${group.description ?? ''}`);

  if (text.includes('family')) return 'family';
  if (text.includes('church') || text.includes('ministry')) return 'church';
  if (text.includes('school') || text.includes('class') || text.includes('pto')) return 'school';
  if (
    text.includes('team') ||
    text.includes('basketball') ||
    text.includes('baseball') ||
    text.includes('softball') ||
    text.includes('football') ||
    text.includes('soccer') ||
    text.includes('track') ||
    text.includes('volleyball')
  ) {
    return 'team';
  }
  if (text.includes('friend')) return 'friends';

  return 'group';
}

function createSystemSpace(input: {
  id: string;
  type: LivingSpaceType;
  name: string;
  description: string;
  privacyDefault: MarkPrivacy;
  now: number;
}): LivingSpace {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    description: input.description,
    privacyDefault: input.privacyDefault,
    source: 'system',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createLivingSpaceFromGroup(group: LivingSpaceGroupSeed, now = nowSeconds()): LivingSpace {
  return {
    id: `group:${group.id}`,
    type: inferSpaceType(group),
    name: group.name,
    description: group.description,
    icon: group.icon,
    imageUri: group.coverImage,
    privacyDefault: 'space',
    source: 'group',
    sourceId: group.id,
    relayUrl: group.relayUrl,
    relayMode: group.relayMode,
    createdAt: group.createdAt ?? now,
    updatedAt: group.updatedAt ?? now,
  };
}

export function createDefaultLivingSpaces(input: LivingSpaceDefaultsInput = {}): LivingSpace[] {
  const now = nowSeconds(input.now);
  const spaces: LivingSpace[] = [
    createSystemSpace({
      id: SYSTEM_LIVING_SPACE_IDS.profile,
      type: 'personal',
      name: 'Home',
      description: 'Your personal world and private Marks.',
      privacyDefault: 'private',
      now,
    }),
    createSystemSpace({
      id: SYSTEM_LIVING_SPACE_IDS.family,
      type: 'family',
      name: input.family?.name || 'Family',
      description: 'Family Marks and shared memories.',
      privacyDefault: 'family',
      now,
    }),
    createSystemSpace({
      id: SYSTEM_LIVING_SPACE_IDS.messages,
      type: 'group',
      name: 'Messages',
      description: 'DMs and group conversations.',
      privacyDefault: 'space',
      now,
    }),
    createSystemSpace({
      id: SYSTEM_LIVING_SPACE_IDS.livingBook,
      type: 'book',
      name: 'Living Book',
      description: 'Preserved chapters and legacy collections.',
      privacyDefault: 'private',
      now,
    }),
    createSystemSpace({
      id: SYSTEM_LIVING_SPACE_IDS.places,
      type: 'place',
      name: 'Places',
      description: 'Map-ready places where life happens.',
      privacyDefault: 'private',
      now,
    }),
  ];

  if (input.family?.relayUrl) {
    spaces[1] = {
      ...spaces[1],
      source: 'family',
      sourceId: input.family.id,
      relayUrl: input.family.relayUrl,
      relayMode: input.family.relayMode,
    };
  }

  for (const group of input.groups ?? []) {
    spaces.push(createLivingSpaceFromGroup(group, now));
  }

  return spaces;
}

export function createLivingMarkMetadata(
  milestone: Milestone,
  input: {
    privacy?: MarkPrivacy;
    currentNpub?: string | null;
    peopleIds?: string[];
    people?: LivingMarkPerson[];
    lifeStage?: string;
    eventId?: string;
    relayTargets?: LivingRelayTarget[];
    savedToBook?: boolean;
    now?: number;
    captureSource?: LivingMarkCaptureSource;
    place?: LivingMarkPlace;
    occurredAt?: number;
    capturedAt?: number;
  } = {}
): LivingMarkMetadata {
  const { title, caption } = splitMarkTitleAndCaption(milestone.note);
  const createdAt = milestone.createdAt || nowSeconds(input.now);
  const authorName = milestone.authorName?.trim();
  const privacy = input.privacy ?? inferPrivacyForMilestone(milestone);
  const peopleIds = normalizePeopleIds(input.peopleIds);
  const authorPeople: LivingMarkPerson[] = milestone.authorNpub
    ? [
        {
          npub: milestone.authorNpub,
          displayName: authorName || undefined,
          role: 'author',
        },
      ]
    : [];
  const subjectPeople = input.people?.length ? input.people : createPeopleFromIds(peopleIds);

  return {
    markId: milestone.id,
    title,
    caption,
    normalizedTags: normalizeLivingTags(milestone.tags ?? []),
    peopleIds,
    people: [...authorPeople, ...subjectPeople],
    place: input.place,
    occurredAt: input.occurredAt ?? milestone.createdAt,
    capturedAt: input.capturedAt ?? input.occurredAt ?? milestone.createdAt,
    lifeStage: cleanOptionalText(input.lifeStage),
    eventId: cleanOptionalText(input.eventId),
    privacy,
    relayTargets: input.relayTargets ?? [],
    savedToBook: input.savedToBook ?? false,
    captureSource: input.captureSource,
    enrichment: {
      isComplete: false,
      promptCount: 0,
      completedPromptTypes: [],
      dismissedPromptTypes: [],
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function inferPrivacyForMilestone(milestone: Milestone): MarkPrivacy {
  if (milestone.familyId) return 'family';
  if (milestone.publishedToRelay) return 'public';
  return 'private';
}

function addSpaceId(ids: string[], id?: string): void {
  if (!id || ids.includes(id)) return;
  ids.push(id);
}

function findSpaceByType(spaces: LivingSpace[], type: LivingSpaceType): LivingSpace | undefined {
  return spaces.find(space => space.type === type && !space.archivedAt);
}

function findFamilySpace(spaces: LivingSpace[], familyId?: string): LivingSpace | undefined {
  if (familyId) {
    const exact = spaces.find(space => space.sourceId === familyId && space.type === 'family');
    if (exact) return exact;
  }

  return findSpaceByType(spaces, 'family');
}

function findSpacesForTags(spaces: LivingSpace[], normalizedTags: string[]): LivingSpace[] {
  if (normalizedTags.length === 0) return [];

  return spaces.filter(space => {
    const search = normalizeLivingTag(`${space.name} ${space.description ?? ''} ${space.type}`);
    return normalizedTags.some(tag => search.includes(tag) || tag.includes(search));
  });
}

function getFirstMatchingTagForSpace(space: LivingSpace, normalizedTags: string[]): string | undefined {
  const search = normalizeLivingTag(`${space.name} ${space.description ?? ''} ${space.type}`);
  return normalizedTags.find(tag => search.includes(tag) || tag.includes(search));
}

function createPlacementReason(input: {
  type: LivingMarkPlacementReason['type'];
  confidence: LivingMarkPlacementConfidence;
  createdAt: number;
  spaceId?: string;
  tag?: string;
  sourceValue?: string;
}): LivingMarkPlacementReason {
  return {
    type: input.type,
    confidence: input.confidence,
    createdAt: input.createdAt,
    spaceId: input.spaceId,
    tag: input.tag,
    sourceValue: input.sourceValue,
  };
}

export function deriveLivingMarkPlacement(input: LivingMarkResolutionInput): LivingMarkPlacement {
  if (input.explicitPlacement) return input.explicitPlacement;

  const milestone = input.milestone;
  const metadata =
    input.explicitMetadata ??
    createLivingMarkMetadata(milestone, {
      currentNpub: input.currentNpub,
      now: input.now,
    });

  const now = nowSeconds(input.now);
  const privacy = metadata.privacy;
  const spaceIds: string[] = [];
  const reasons: LivingMarkPlacementReason[] = [];

  if (milestone.familyId || privacy === 'family') {
    const familySpace = findFamilySpace(input.spaces, milestone.familyId);
    addSpaceId(spaceIds, familySpace?.id);

    if (familySpace) {
      reasons.push(
        createPlacementReason({
          type: 'family-share',
          confidence: 'suggested',
          createdAt: now,
          spaceId: familySpace.id,
          sourceValue: milestone.familyId,
        })
      );
    }
  }

  for (const matchedSpace of findSpacesForTags(input.spaces, metadata.normalizedTags)) {
    addSpaceId(spaceIds, matchedSpace.id);
    reasons.push(
      createPlacementReason({
        type: 'tag-match',
        confidence: 'suggested',
        createdAt: now,
        spaceId: matchedSpace.id,
        tag: getFirstMatchingTagForSpace(matchedSpace, metadata.normalizedTags),
      })
    );
  }

  if (metadata.place) {
    addSpaceId(spaceIds, SYSTEM_LIVING_SPACE_IDS.places);
    reasons.push(
      createPlacementReason({
        type: 'exif-place',
        confidence: 'suggested',
        createdAt: now,
        spaceId: SYSTEM_LIVING_SPACE_IDS.places,
        sourceValue: metadata.place.name,
      })
    );
  }

  if (metadata.savedToBook) {
    addSpaceId(spaceIds, SYSTEM_LIVING_SPACE_IDS.livingBook);
    reasons.push(
      createPlacementReason({
        type: 'book-save',
        confidence: 'confirmed',
        createdAt: now,
        spaceId: SYSTEM_LIVING_SPACE_IDS.livingBook,
      })
    );
  }

  if (spaceIds.length === 0) {
    addSpaceId(spaceIds, SYSTEM_LIVING_SPACE_IDS.profile);
    reasons.push(
      createPlacementReason({
        type: 'default-profile',
        confidence: 'suggested',
        createdAt: now,
        spaceId: SYSTEM_LIVING_SPACE_IDS.profile,
      })
    );
  }

  const primarySpaceId =
    spaceIds.find(id => id === findFamilySpace(input.spaces, milestone.familyId)?.id) ??
    spaceIds[0];

  return {
    markId: milestone.id,
    spaceIds,
    primarySpaceId,
    privacy,
    source: 'derived',
    confidence: 'suggested',
    reasons,
    createdAt: milestone.createdAt || now,
    updatedAt: milestone.createdAt || now,
  };
}

export function createLivingMarkView(input: LivingMarkResolutionInput): LivingMarkView {
  const metadata =
    input.explicitMetadata ??
    createLivingMarkMetadata(input.milestone, {
      currentNpub: input.currentNpub,
      now: input.now,
    });
  const placement = deriveLivingMarkPlacement({
    ...input,
    explicitMetadata: metadata,
  });
  const spaceSet = new Set(placement.spaceIds);

  return {
    milestone: input.milestone,
    metadata,
    placement,
    spaces: input.spaces.filter(space => spaceSet.has(space.id)),
  };
}

export function createLockedLivingMarkPlacement(input: {
  markId: string;
  spaceId: string;
  privacy: MarkPrivacy;
  now?: number;
  reason?: LivingMarkPlacementReason['type'];
}): LivingMarkPlacement {
  const now = nowSeconds(input.now);

  return {
    markId: input.markId,
    spaceIds: [input.spaceId],
    primarySpaceId: input.spaceId,
    privacy: input.privacy,
    source: 'explicit',
    confidence: 'locked',
    reasons: [
      createPlacementReason({
        type: input.reason ?? 'selected-chip',
        confidence: 'locked',
        createdAt: now,
        spaceId: input.spaceId,
      }),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildLivingSpaceIndexes(
  placements: LivingMarkPlacement[],
  metadataByMarkId: Record<string, LivingMarkMetadata> = {},
  prompts: LivingMarkPrompt[] = [],
  now = nowSeconds()
): LivingSpaceIndexes {
  const bySpaceId: Record<string, string[]> = {};
  const byTag: Record<string, string[]> = {};
  const byPeopleId: Record<string, string[]> = {};
  const byYear: Record<string, string[]> = {};
  const byPlaceKey: Record<string, string[]> = {};
  const byPrivacy: Record<MarkPrivacy, string[]> = {
    private: [],
    space: [],
    family: [],
    public: [],
  };
  const byPromptStatus = PROMPT_STATUS_VALUES.reduce(
    (acc, status) => {
      acc[status] = [];
      return acc;
    },
    {} as Record<LivingMarkPromptStatus, string[]>
  );

  const sortedPlacements = [...placements].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const placement of sortedPlacements) {
    for (const spaceId of placement.spaceIds) {
      bySpaceId[spaceId] = bySpaceId[spaceId] ?? [];
      addSpaceId(bySpaceId[spaceId], placement.markId);
    }

    byPrivacy[placement.privacy].push(placement.markId);

    const metadata = metadataByMarkId[placement.markId];
    for (const tag of metadata?.normalizedTags ?? []) {
      byTag[tag] = byTag[tag] ?? [];
      addSpaceId(byTag[tag], placement.markId);
    }

    for (const peopleId of metadata?.peopleIds ?? []) {
      byPeopleId[peopleId] = byPeopleId[peopleId] ?? [];
      addSpaceId(byPeopleId[peopleId], placement.markId);
    }

    const yearSource = metadata?.occurredAt ?? metadata?.capturedAt ?? placement.createdAt;
    if (yearSource) {
      const year = new Date(yearSource * 1000).getFullYear().toString();
      byYear[year] = byYear[year] ?? [];
      addSpaceId(byYear[year], placement.markId);
    }

    const place = metadata?.place;
    const placeKey =
      place?.id ||
      place?.name ||
      (place?.latitude !== undefined && place?.longitude !== undefined
        ? `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`
        : undefined);

    if (placeKey) {
      byPlaceKey[placeKey] = byPlaceKey[placeKey] ?? [];
      addSpaceId(byPlaceKey[placeKey], placement.markId);
    }
  }

  for (const prompt of prompts) {
    if (!byPromptStatus[prompt.status].includes(prompt.markId)) {
      byPromptStatus[prompt.status].push(prompt.markId);
    }
  }

  return {
    bySpaceId,
    byTag,
    byPeopleId,
    byYear,
    byPlaceKey,
    byPrivacy,
    byPromptStatus,
    updatedAt: sortedPlacements.map(placement => placement.markId),
    rebuiltAt: now,
  };
}

function createPromptId(markId: string, type: LivingMarkPromptType, now: number): string {
  return `prompt_${markId}_${type}_${now}`;
}

function startOfLocalDay(unixSeconds: number): number {
  const date = new Date(unixSeconds * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function hasPromptForMarkType(
  prompts: LivingMarkPrompt[],
  markId: string,
  type: LivingMarkPromptType
): boolean {
  return prompts.some(prompt => prompt.markId === markId && prompt.type === type);
}

export function hasLivingPromptQueuedToday(prompts: LivingMarkPrompt[], now = nowSeconds()): boolean {
  const dayStart = startOfLocalDay(now);
  return prompts.some(prompt => prompt.createdAt >= dayStart);
}

export function createGentleLivingPromptForView(
  view: LivingMarkView,
  existingPrompts: LivingMarkPrompt[] = [],
  now = nowSeconds()
): LivingMarkPrompt | null {
  const markId = view.milestone.id;

  if (
    view.placement.confidence === 'suggested' &&
    view.placement.spaceIds.length > 0 &&
    !hasPromptForMarkType(existingPrompts, markId, 'confirm-space')
  ) {
    const firstSpace = view.spaces.find(space => space.id === view.placement.primarySpaceId) ?? view.spaces[0];

    return {
      id: createPromptId(markId, 'confirm-space', now),
      markId,
      type: 'confirm-space',
      status: 'open',
      question: firstSpace
        ? `Should this Mark live in ${firstSpace.name}?`
        : 'Where should this Mark live?',
      suggestedSpaceIds: view.placement.spaceIds,
      dueAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!view.metadata.place && !hasPromptForMarkType(existingPrompts, markId, 'add-place')) {
    return {
      id: createPromptId(markId, 'add-place', now),
      markId,
      type: 'add-place',
      status: 'open',
      question: 'Where did this happen?',
      dueAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (view.metadata.peopleIds.length === 0 && !hasPromptForMarkType(existingPrompts, markId, 'add-people')) {
    return {
      id: createPromptId(markId, 'add-people', now),
      markId,
      type: 'add-people',
      status: 'open',
      question: 'Who was part of this moment?',
      dueAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!view.metadata.occurredAt && !hasPromptForMarkType(existingPrompts, markId, 'confirm-date')) {
    return {
      id: createPromptId(markId, 'confirm-date', now),
      markId,
      type: 'confirm-date',
      status: 'open',
      question: 'When did this happen?',
      dueAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!view.metadata.caption && !hasPromptForMarkType(existingPrompts, markId, 'add-caption')) {
    return {
      id: createPromptId(markId, 'add-caption', now),
      markId,
      type: 'add-caption',
      status: 'open',
      question: 'Want to add one sentence to remember this?',
      dueAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (
    !view.metadata.savedToBook &&
    !view.placement.spaceIds.includes(SYSTEM_LIVING_SPACE_IDS.livingBook) &&
    !hasPromptForMarkType(existingPrompts, markId, 'add-to-book')
  ) {
    return {
      id: createPromptId(markId, 'add-to-book', now),
      markId,
      type: 'add-to-book',
      status: 'open',
      question: 'Should this be saved into your Living Book?',
      suggestedSpaceIds: [SYSTEM_LIVING_SPACE_IDS.livingBook],
      dueAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  return null;
}

export function resolveLivingSpaceRoutes(input: {
  markId?: string;
  privacy: MarkPrivacy;
  placement?: LivingMarkPlacement | null;
  spaces?: LivingSpace[];
  familyId?: string;
  familyRelayUrl?: string;
  defaultRelayUrls?: string[];
  publicRelayUrls?: string[];
  now?: number;
}): LivingRoutingDecision {
  const defaultRelayUrls = input.defaultRelayUrls?.length ? input.defaultRelayUrls : [DEFAULT_RELAY];
  const destinations: LivingRouteDestination[] = [
    {
      kind: 'local',
      reason: 'Always cache the Mark locally first.',
    },
  ];

  if (input.privacy === 'family') {
    destinations.push({
      kind: 'family-relay',
      familyId: input.familyId,
      relayUrls: input.familyRelayUrl ? [input.familyRelayUrl] : defaultRelayUrls,
      reason: 'Family Marks use the existing family milestone relay path.',
    });
  }

  if (input.privacy === 'space') {
    const selectedSpaceIds = new Set(input.placement?.spaceIds ?? []);
    const routedSpaces = (input.spaces ?? []).filter(space =>
      selectedSpaceIds.has(space.id) && !!space.relayUrl
    );

    for (const space of routedSpaces) {
      destinations.push({
        kind: 'space-relay',
        spaceId: space.id,
        relayUrls: space.relayUrl ? [space.relayUrl] : defaultRelayUrls,
        reason: 'Space Marks publish to the selected Space relay.',
      });
    }
  }

  if (input.privacy === 'public') {
    destinations.push({
      kind: 'public-relay',
      relayUrls: input.publicRelayUrls?.length ? input.publicRelayUrls : defaultRelayUrls,
      reason: 'Public Marks use the profile/public relay path.',
    });
  }

  return {
    markId: input.markId,
    privacy: input.privacy,
    destinations,
    createdAt: nowSeconds(input.now),
  };
}

export function livingRelayTargetsFromRoutingDecision(
  decision: LivingRoutingDecision,
  spaces: LivingSpace[] = []
): LivingRelayTarget[] {
  return decision.destinations.map((destination, index) => {
    const spaceName = destination.spaceId
      ? spaces.find(space => space.id === destination.spaceId)?.name
      : undefined;

    return {
      id: `${decision.markId ?? 'mark'}_${destination.kind}_${destination.spaceId ?? destination.familyId ?? index}`,
      kind: destination.kind,
      relayUrls: destination.relayUrls,
      familyId: destination.familyId,
      spaceId: destination.spaceId,
      label: spaceName ?? destination.reason,
    };
  });
}
