import type { Milestone } from '../utils/storage';

export type MarkPrivacy = 'private' | 'space' | 'family' | 'public';

export type LivingSpaceType =
  | 'personal'
  | 'family'
  | 'school'
  | 'team'
  | 'church'
  | 'friends'
  | 'group'
  | 'place'
  | 'book';

export type LivingSpaceSource = 'system' | 'family' | 'group' | 'manual' | 'derived';

export type LivingSpace = {
  id: string;
  type: LivingSpaceType;
  name: string;
  description?: string;
  icon?: string;
  imageUri?: string;
  privacyDefault: MarkPrivacy;
  source: LivingSpaceSource;
  sourceId?: string;
  relayUrl?: string;
  relayMode?: 'default' | 'custom' | 'both';
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

export type LivingMarkPlacementSource = 'explicit' | 'derived' | 'system';
export type LivingMarkPlacementConfidence = 'suggested' | 'confirmed' | 'locked';
export type LivingMarkPlacementReasonType =
  | 'tag-match'
  | 'exif-place'
  | 'family-share'
  | 'selected-chip'
  | 'group-context'
  | 'user-confirmed'
  | 'default-profile'
  | 'book-save'
  | 'manual';

export type LivingMarkPlacementReason = {
  type: LivingMarkPlacementReasonType;
  spaceId?: string;
  tag?: string;
  sourceValue?: string;
  confidence: LivingMarkPlacementConfidence;
  createdAt: number;
};

export type LivingMarkPlacement = {
  markId: string;
  spaceIds: string[];
  primarySpaceId?: string;
  privacy: MarkPrivacy;
  source: LivingMarkPlacementSource;
  confidence: LivingMarkPlacementConfidence;
  reasons: LivingMarkPlacementReason[];
  createdAt: number;
  updatedAt: number;
};

export type LivingMarkPerson = {
  id?: string;
  npub?: string;
  displayName?: string;
  avatarUrl?: string;
  source?: 'current-user' | 'space-member' | 'family-member' | 'contact' | 'manual' | 'derived';
  role?: 'author' | 'subject' | 'mentioned';
};

export type LivingMarkPlace = {
  id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  geohash?: string;
  source?: 'manual' | 'device' | 'derived';
};

export type LivingMarkMediaRole = 'primary' | 'supporting' | 'voice-note' | 'document';

export type LivingMarkMediaMetadata = {
  mediaId: string;
  role: LivingMarkMediaRole;
  caption?: string;
};

export type LivingMarkCaptureSource = 'manual' | 'camera' | 'library' | 'voice' | 'derived';

export type LivingRelayTarget = {
  id: string;
  kind: LivingRouteKind;
  relayUrls?: string[];
  familyId?: string;
  spaceId?: string;
  label?: string;
};

export type LivingMarkEnrichmentStatus = {
  isComplete: boolean;
  promptCount: number;
  lastPromptedAt?: number;
  completedPromptTypes: LivingMarkPromptType[];
  dismissedPromptTypes: LivingMarkPromptType[];
};

export type LivingMarkMetadata = {
  markId: string;
  title?: string;
  caption?: string;
  normalizedTags: string[];
  peopleIds: string[];
  people: LivingMarkPerson[];
  place?: LivingMarkPlace;
  occurredAt?: number;
  capturedAt?: number;
  lifeStage?: string;
  eventId?: string;
  mediaRoles?: LivingMarkMediaMetadata[];
  privacy: MarkPrivacy;
  relayTargets: LivingRelayTarget[];
  savedToBook: boolean;
  captureSource?: LivingMarkCaptureSource;
  enrichment: LivingMarkEnrichmentStatus;
  createdAt: number;
  updatedAt: number;
};

export type LivingMarkPromptType =
  | 'confirm-space'
  | 'add-place'
  | 'add-people'
  | 'confirm-date'
  | 'add-caption'
  | 'add-to-book';

export type LivingMarkPromptStatus = 'open' | 'answered' | 'dismissed' | 'snoozed';

export type LivingMarkPrompt = {
  id: string;
  markId: string;
  type: LivingMarkPromptType;
  status: LivingMarkPromptStatus;
  question: string;
  suggestedSpaceIds?: string[];
  suggestedPlace?: LivingMarkPlace;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
  answeredAt?: number;
  dismissedAt?: number;
  snoozedUntil?: number;
};

export type LivingMarkPromptCard = {
  prompt: LivingMarkPrompt;
  view: LivingMarkView;
  markTitle?: string;
  markPreview: string;
  canCompleteInline: boolean;
};

export type LivingMarkView = {
  milestone: Milestone;
  metadata: LivingMarkMetadata;
  placement: LivingMarkPlacement;
  spaces: LivingSpace[];
};

export type LivingSpaceIndexes = {
  bySpaceId: Record<string, string[]>;
  byTag: Record<string, string[]>;
  byPeopleId: Record<string, string[]>;
  byYear: Record<string, string[]>;
  byPlaceKey: Record<string, string[]>;
  byPrivacy: Record<MarkPrivacy, string[]>;
  byPromptStatus: Record<LivingMarkPromptStatus, string[]>;
  updatedAt: string[];
  rebuiltAt: number;
};

export type LivingRouteKind = 'local' | 'family-relay' | 'space-relay' | 'public-relay';

export type LivingRouteDestination = {
  kind: LivingRouteKind;
  relayUrls?: string[];
  familyId?: string;
  spaceId?: string;
  reason?: string;
};

export type LivingRoutingDecision = {
  markId?: string;
  privacy: MarkPrivacy;
  destinations: LivingRouteDestination[];
  createdAt: number;
};

export type LivingMarkLogFilter = 'all' | 'people' | 'spaces' | 'years' | 'tags' | 'places';

export type LivingSpaceFamilySeed = {
  id: string;
  name: string;
  relayUrl?: string;
  relayMode?: 'default' | 'custom' | 'both';
};

export type LivingSpaceGroupSeed = {
  id: string;
  name: string;
  description?: string;
  sport?: string;
  icon?: string;
  coverImage?: string;
  schoolId?: string;
  relayUrl?: string;
  relayMode?: 'default' | 'custom' | 'both';
  createdAt?: number;
  updatedAt?: number;
};

export type LivingSpaceDefaultsInput = {
  npub?: string | null;
  family?: LivingSpaceFamilySeed | null;
  groups?: LivingSpaceGroupSeed[];
  now?: number;
};

export type LivingMarkResolutionInput = {
  milestone: Milestone;
  spaces: LivingSpace[];
  explicitPlacement?: LivingMarkPlacement | null;
  explicitMetadata?: LivingMarkMetadata | null;
  currentNpub?: string | null;
  family?: LivingSpaceFamilySeed | null;
  now?: number;
};

export type LivingMarkCaptureInput = {
  milestone: Milestone;
  spaces?: LivingSpace[];
  selectedSpaceId?: string | null;
  currentNpub?: string | null;
  peopleIds?: string[];
  people?: LivingMarkPerson[];
  lifeStage?: string;
  eventId?: string;
  relayTargets?: LivingRelayTarget[];
  savedToBook?: boolean;
  captureSource?: LivingMarkCaptureSource;
  place?: LivingMarkPlace;
  occurredAt?: number;
  capturedAt?: number;
  privacy?: MarkPrivacy;
  now?: number;
};
