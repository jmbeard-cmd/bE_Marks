import GroupBookTab from '@/components/GroupBookTab';
import GroupCalendarTab from '@/components/GroupCalendarTab';
import SpaceArchivedBanner from '@/components/SpaceArchivedBanner';
import SpaceBoardComposerModal from '@/components/SpaceBoardComposerModal';
import SpaceBoardEmptyState from '@/components/SpaceBoardEmptyState';
import SpaceBoardItemCard from '@/components/SpaceBoardItemCard';
import SpaceDetailLoadingState from '@/components/SpaceDetailLoadingState';
import SpaceEmptyState from '@/components/SpaceEmptyState';
import SpaceStickyHighlightCard from '@/components/SpaceStickyHighlightCard';
import SpaceTrayHeader from '@/components/SpaceTrayHeader';
import {
  getCalendarEventsForGroup,
  getUpcomingEventsForGroup,
  syncCalendarEventsFromRelay,
  type GroupCalendarEvent,
} from '@/src/utils/group-calendar';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  InteractionManager,
  Keyboard,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageViewerModal, { ViewerImage } from '../components/ImageViewerModal';
import MediaCollage from '../components/MediaCollage';
import { Colors } from '../src/constants/theme';
import type {
  LivingMarkView,
  LivingSpace
} from '../src/types/living-spaces';
import {
  getContactByNpub,
  saveContact
} from '../src/utils/contacts-storage';
import {
  createThread,
  getDMThreads,
} from '../src/utils/dm-storage';
import {
  getMessagesForGroup,
  saveLocalGroupSystemMessage,
} from '../src/utils/group-messages';
import {
  createGroupSticky,
  getStickiesForGroup,
  hideGroupSticky,
  syncGroupStickiesFromRelay,
  type GroupBoardDisplayMode,
  type GroupSticky,
  type GroupStickyTrustedAuthor
} from '../src/utils/group-stickies';
import {
  archiveGroup,
  getGroupById,
  getGroupMembers,
  getMemberByNpub,
  isGroupAdmin,
  isGroupMember,
  normalizeRelayUrls,
  publishGroupMetadataSnapshot,
  refreshGroupMetadataFromRelay,
  regenerateInviteCode,
  removeMember,
  syncGroupMembersFromRelay,
  updateGroup,
  updateGroupMemberProfile,
  updateMemberRole,
  type BEGroup,
  type BEGroupMember,
  type GroupRelayMode,
} from '../src/utils/group-storage';
import {
  getPersonDisplayName
} from '../src/utils/living-people';
import {
  getLivingMarkViewsForMilestones,
  importLivingSpaceMarkSnapshot,
  syncLivingSpacesFromGroups
} from '../src/utils/living-spaces-storage';
import {
  compressImageForUpload,
  compressVideoForUpload,
} from '../src/utils/media-compression';
import {
  DEFAULT_RELAY,
  fetchGroupMarks,
  fetchGroupMessageDeletes,
  fetchGroupMessages,
  fetchNostrProfile,
  publishGroupMark,
  publishGroupMembership,
  publishGroupMessage,
} from '../src/utils/nostr';
import { normalizeNostrIdentity } from '../src/utils/nostr-identity';
import {
  notifyGroupEvent,
  registerGroupMemberForPush,
  removeGroupMemberFromPush,
} from '../src/utils/push-notifications';
import { uploadToR2 } from '../src/utils/r2';
import {
  SCHOOL_CONSENT_NOTICE_VERSION,
  getSchoolSpaceConsentSummary,
  isSchoolConsentSpace,
  upsertSchoolConsentRecord,
  upsertSchoolStudentProfile,
  type SchoolConsentSummary,
} from '../src/utils/school-consent-storage';
import {
  getMilestones,
  updateMilestone,
  type MarkMedia,
  type Milestone
} from '../src/utils/storage';
import { useIdentity } from './_layout';
import { GroupChatPanel } from './group-thread';

type Tab = 'overview' | 'chat' | 'stickies' | 'board' | 'mantle' | 'calendar' | 'gallery' | 'members' | 'legacy' | 'book';
const GROUP_LOCAL_GALLERY_KEY = 'be_group_local_gallery_v1';
const SPACE_GALLERY_CACHE_KEY_PREFIX = 'be_space_gallery_cache_v1:';
const SPACE_FAVORITES_KEY = 'be_space_favorite_ids_v1';
const SPACE_MARK_RELAY_SYNC_ENABLED = true;

function buildCalendarEventTitleMap(events: GroupCalendarEvent[]): Record<string, string> {
  return events.reduce<Record<string, string>>((acc, event) => {
    const title = event.title?.trim();

    if (event.id && title) {
      acc[event.id] = title;
    }

    return acc;
  }, {});
}
const LIFT_UP_TAG = 'Lift Up';
const SPORTS_SPACE_KEYS = new Set([
  'softball',
  'baseball',
  'basketball',
  'football',
  'volleyball',
  'track',
  'crosscountry',
  'soccer',
  'wrestling',
  'golf',
  'tennis',
  'swimming',
  'cheer',
]);

type LocalGalleryItem = {
  id: string;
  groupId: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string;
  createdAt: number;
  source: 'highlight';
};

type SpaceGalleryItem = {
  id: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string;
  thumbnailUri?: string;
  videoThumbnailUrl?: string;
  previewUrl?: string;
  createdAt?: number;
  source?: 'local-chat' | 'chat' | 'highlight';
};

type BoardDraftAttachment = {
  id: string;
  uri: string;
  type: 'image' | 'video' | 'file';
  name?: string;
  mimeType?: string;
};

const GROUP_TYPE_ICONS: Record<string, string> = {
  softball: '🥎',
  baseball: '⚾',
  basketball: '🏀',
  football: '🏈',
  volleyball: '🏐',
  track: '🏃',
  crosscountry: '🏃',
  soccer: '⚽',
  wrestling: '🤼',
  golf: '⛳',
  tennis: '🎾',
  swimming: '🏊',
  cheer: '📣',
  band: '🎵',
  choir: '🎶',
  theater: '🎭',
  nhs: '🎓',
  class: '📚',
  classroom: '📚',
  booster: '⭐',
  faculty: '🧑‍🏫',
  staff: '🧑‍🏫',
  teacher: '🧑‍🏫',
  teachers: '🧑‍🏫',
  default: '👥',
};

function normalizeGroupType(value?: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getGroupInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'SP';
  return clean.slice(0, 2).toUpperCase();
}

function getGroupAvatarText(group: BEGroup): string {
  const customIcon = group.icon?.trim();
  return customIcon || getGroupInitials(group.name);
}

function getPersonInitials(value?: string): string {
  const clean = value?.trim();

  if (!clean) return 'M';

  const parts = clean
    .split(/\s+/)
    .map(part => part[0])
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]}${parts[1]}`.toUpperCase();
  }

  return clean.slice(0, 2).toUpperCase();
}

function getGroupTypeIcon(group: BEGroup): string | null {
  const directKey = normalizeGroupType(group.sport);

  if (directKey && GROUP_TYPE_ICONS[directKey]) {
    return GROUP_TYPE_ICONS[directKey];
  }

  return null;
}

function isSportsSpace(group: BEGroup): boolean {
  const directKey = normalizeGroupType(group.sport);
  return directKey ? SPORTS_SPACE_KEYS.has(directKey) : false;
}

function getMantleMarkTimestamp(view: LivingMarkView): number {
  return view.metadata.occurredAt ?? view.metadata.capturedAt ?? view.milestone.createdAt;
}

function getMantleMediaImageUri(media?: MarkMedia): string | undefined {
  if (!media) return undefined;
  return media.type === 'image' ? media.uri : media.thumbnailUri;
}

async function readLocalGalleryItems(): Promise<LocalGalleryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(GROUP_LOCAL_GALLERY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveHighlightMediaToLocalGallery(groupId: string, sticky: GroupSticky): Promise<LocalGalleryItem[]> {
  const media = (sticky as any).media;

  if (!media) return [];

  const mediaItems = Array.isArray(media) ? media : [media];

  const validItems = mediaItems
    .filter(item => !!(item.mediaUrl || item.uri))
    .map(item => {
      const mediaUrl = item.mediaUrl || item.uri;
      const mediaType: 'image' | 'video' =
        item.mediaType === 'video' || item.type === 'video' ? 'video' : 'image';

      return {
        id: `highlight_gallery_${sticky.id}_${mediaUrl}`,
        groupId,
        mediaUrl,
        mediaType,
        thumbnailUrl: item.thumbnailUrl || item.thumbnailUri,
        createdAt: Math.floor(Date.now() / 1000),
        source: 'highlight' as const,
      };
    });

  if (validItems.length === 0) return [];

  const existing = await readLocalGalleryItems();
  const existingIds = new Set(existing.map(item => item.id));

  const merged = [
    ...existing,
    ...validItems.filter(item => !existingIds.has(item.id)),
  ];

  await AsyncStorage.setItem(GROUP_LOCAL_GALLERY_KEY, JSON.stringify(merged));

  return validItems;
}

function buildGalleryItemsFromMessages(messages: any[], source: 'local-chat' | 'chat'): SpaceGalleryItem[] {
  return messages.flatMap(message => {
    if (message.isDeleted) return [];

    const mediaItems = Array.isArray(message.media)
      ? message.media
      : [];

    if (mediaItems.length > 0) {
      return mediaItems
        .filter((item: any) => {
          const mediaType = item.type || item.mediaType;
          return !!item.uri && (mediaType === 'image' || mediaType === 'video');
        })
        .map((item: any, index: number) => {
          const mediaType: 'image' | 'video' =
            item.type === 'video' || item.mediaType === 'video' ? 'video' : 'image';

          const stableId =
            message.clientMessageId ||
            message.id ||
            `${source}_${index}_${item.uri}`;

          return {
            id: `chat_gallery_${stableId}_${item.id || index}_${item.uri}`,
            mediaUrl: item.uri,
            mediaType,
            thumbnailUrl: item.thumbnailUrl || item.thumbnailUri || message.thumbnailUrl,
            thumbnailUri: item.thumbnailUri,
            createdAt: message.createdAt,
            source,
          };
        });
    }

    const legacyUrl = message.mediaUrl || message.imageUrl;

    if (!legacyUrl) return [];

    const legacyType: 'image' | 'video' =
      message.mediaType === 'video' ? 'video' : 'image';

    const stableId =
      message.clientMessageId ||
      message.id ||
      `${source}_${legacyUrl}`;

    return [
      {
        id: `chat_gallery_${stableId}_${legacyUrl}`,
        mediaUrl: legacyUrl,
        mediaType: legacyType,
        thumbnailUrl: message.thumbnailUrl,
        createdAt: message.createdAt,
        source,
      },
    ];
  });
}

function mergeGalleryItems(items: SpaceGalleryItem[]): SpaceGalleryItem[] {
  const galleryMap = new Map<string, SpaceGalleryItem>();

  items.forEach(item => {
    const key = item.mediaUrl || item.id;
    const existing = galleryMap.get(key);

    if (!existing) {
      galleryMap.set(key, item);
      return;
    }

    galleryMap.set(key, {
      ...existing,
      ...item,
      thumbnailUrl: item.thumbnailUrl || existing.thumbnailUrl,
      thumbnailUri: item.thumbnailUri || existing.thumbnailUri,
      videoThumbnailUrl: item.videoThumbnailUrl || existing.videoThumbnailUrl,
      previewUrl: item.previewUrl || existing.previewUrl,
      createdAt: Math.max(existing.createdAt || 0, item.createdAt || 0),
    });
  });

  return Array.from(galleryMap.values()).sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
}

function getSpaceGalleryCacheKey(groupId: string): string {
  return `${SPACE_GALLERY_CACHE_KEY_PREFIX}${groupId}`;
}

async function readCachedSpaceGalleryItems(groupId: string): Promise<SpaceGalleryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(getSpaceGalleryCacheKey(groupId));
    const parsed = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(item =>
      item &&
      typeof item.id === 'string' &&
      typeof item.mediaUrl === 'string'
    );
  } catch {
    return [];
  }
}

async function writeCachedSpaceGalleryItems(
  groupId: string,
  items: SpaceGalleryItem[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      getSpaceGalleryCacheKey(groupId),
      JSON.stringify(items.slice(0, 500))
    );
  } catch (error) {
    console.warn('[Gallery] cache write failed:', error);
  }
}

function getMilestoneMediaItems(mark: Milestone): MarkMedia[] {
  const mediaItems = Array.isArray(mark.media) ? [...mark.media] : [];

  if (mark.photoUri && !mediaItems.some(item => item.uri === mark.photoUri)) {
    mediaItems.push({
      id: `${mark.id}_legacy_photo`,
      uri: mark.photoUri,
      type: 'image',
      source: mark.photoUri.startsWith('http') ? 'r2' : 'local',
    });
  }

  if (mark.videoUri && !mediaItems.some(item => item.uri === mark.videoUri)) {
    mediaItems.push({
      id: `${mark.id}_legacy_video`,
      uri: mark.videoUri,
      type: 'video',
      source: mark.videoUri.startsWith('http') ? 'r2' : 'local',
    });
  }

  return mediaItems;
}

function getMilestoneText(mark: Milestone): { title: string; body: string } {
  const note = mark.note?.trim() ?? '';
  const parts = note.split(/\n\s*\n/);

  if (parts.length > 1) {
    return {
      title: parts[0].trim() || 'Untitled Mark',
      body: parts.slice(1).join('\n\n').trim(),
    };
  }

  return {
    title: note || 'Untitled Mark',
    body: '',
  };
}

function getGroupLivingSpaceId(groupId: string): string {
  return `group:${groupId}`;
}

function getGroupPublishRelayUrls(group: BEGroup): string[] {
  return normalizeRelayUrls([
    group.relayUrl || DEFAULT_RELAY,
    ...(group.backupRelayUrls ?? []),
  ]);
}

function getTrustedBoardAuthors(groupMembers: BEGroupMember[]): GroupStickyTrustedAuthor[] {
  return groupMembers
    .filter(member =>
      member.status === 'active' &&
      (member.role === 'owner' || member.role === 'admin')
    )
    .map(member => ({
      npub: member.npub,
      pubkeyHex: member.pubkeyHex,
    }));
}

export default function GroupDetailScreen() {
const { id, tab: routeTab } = useLocalSearchParams<{
  id: string;
  tab?: Tab;
  highlightId?: string;
  calendarEventId?: string;
  memberNpub?: string;
}>();
  const router = useRouter();
  const { npub, nsec, profile, theme } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);

  const [group, setGroup] = useState<BEGroup | null>(null);
  const [members, setMembers] = useState<BEGroupMember[]>([]);
  const [stickies, setStickies] = useState<GroupSticky[]>([]);
  const [spaceMarkViews, setSpaceMarkViews] = useState<LivingMarkView[]>([]);
  const [livingSpaces, setLivingSpaces] = useState<LivingSpace[]>([]);
  const [galleryItems, setGalleryItems] = useState<SpaceGalleryItem[]>([]);
  const [chatMessageCount, setChatMessageCount] = useState(0);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<string | null>(null);
  const [activeViewerImages, setActiveViewerImages] = useState<ViewerImage[]>([]);
  const [tab, setTab] = useState<Tab>(() => {
    if (
      routeTab === 'chat' ||
      routeTab === 'stickies' ||
      routeTab === 'board' ||
      routeTab === 'calendar' ||
      routeTab === 'gallery' ||
      routeTab === 'members' ||
      routeTab === 'legacy' ||
      routeTab === 'book'
    ) {
      return routeTab;
    }

    return 'stickies';
  });
  const tabRef = useRef<Tab>(tab);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSpaceSettingsMenu, setShowSpaceSettingsMenu] = useState(false);
  const [spaceSettingsRelayOpen, setSpaceSettingsRelayOpen] = useState(false);
  const [spaceSettingsConsentOpen, setSpaceSettingsConsentOpen] = useState(false);
  const [schoolConsentSummary, setSchoolConsentSummary] = useState<SchoolConsentSummary | null>(null);
  const [childNameInput, setChildNameInput] = useState('');
  const [childGradeInput, setChildGradeInput] = useState('');
  const [childUnder13, setChildUnder13] = useState(true);
  const [childConsentMedia, setChildConsentMedia] = useState(false);
  const [childConsentName, setChildConsentName] = useState(false);
  const [childConsentMantle, setChildConsentMantle] = useState(false);
  const [childConsentLegacy, setChildConsentLegacy] = useState(false);
  const [savingSchoolConsent, setSavingSchoolConsent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [spaceKeyboardHeight, setSpaceKeyboardHeight] = useState(0);

  const [editingGroupRelay, setEditingGroupRelay] = useState(false);
  const [groupRelayMode, setGroupRelayMode] = useState<GroupRelayMode>('default');
  const [groupRelayUrl, setGroupRelayUrl] = useState('');
  const [groupBackupRelayInput, setGroupBackupRelayInput] = useState('');
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [calendarEventTitles, setCalendarEventTitles] = useState<Record<string, string>>({});
  const [selectedMemberAction, setSelectedMemberAction] = useState<BEGroupMember | null>(null);
  const [favoriteSpaceIds, setFavoriteSpaceIds] = useState<string[]>([]);
  const [activeSpaceVideoMarkId, setActiveSpaceVideoMarkId] = useState<string | null>(null);

  const [showBoardComposer, setShowBoardComposer] = useState(false);
  const [boardDisplayMode, setBoardDisplayMode] = useState<GroupBoardDisplayMode>('pin');
  const [boardTitle, setBoardTitle] = useState('');
  const [boardBody, setBoardBody] = useState('');
  const [boardAttachments, setBoardAttachments] = useState<BoardDraftAttachment[]>([]);
  const [boardUploadStatus, setBoardUploadStatus] = useState<string | null>(null);
  const [savingBoardItem, setSavingBoardItem] = useState(false);

  const groupDetailLoadRunIdRef = useRef(0);

  const spaceMarksViewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 35,
    minimumViewTime: 0,
  });

  const spaceMarksViewabilityRef = useRef((info: { viewableItems: Array<{ item: any }> }) => {
    const firstVisibleVideoMark = info.viewableItems.find(viewable => {
      if (viewable.item?.itemType !== 'mark') return false;

      const mark = viewable.item.view?.milestone as Milestone | undefined;
      if (!mark) return false;

      return getMilestoneMediaItems(mark).some(media => media.type === 'video');
    });

    setActiveSpaceVideoMarkId(firstVisibleVideoMark?.item?.id ?? null);
  });

  const myDisplayName = useMemo(() => {
    return (
      profile?.display_name ||
      profile?.name ||
      (npub ? `${npub.slice(0, 12)}…` : 'Admin')
    );
  }, [profile, npub]);

  const currentMember = useMemo(() => {
    if (!npub) return null;

    return members.find(member => member.npub === npub) ?? null;
  }, [members, npub]);

  const getSpaceMarkAuthorProfile = useCallback((mark: Milestone) => {
    const authorMember = mark.authorNpub
      ? members.find(member => member.npub === mark.authorNpub)
      : null;
    const isMine = !!mark.authorNpub && !!npub && mark.authorNpub === npub;
    const displayName =
      authorMember?.displayName ||
      mark.authorName ||
      (isMine ? myDisplayName : undefined) ||
      (mark.authorNpub ? `${mark.authorNpub.slice(0, 12)}...` : 'Member');
    const avatarUrl =
      authorMember?.avatarUrl ||
      (isMine ? (profile as any)?.picture : undefined);

    return {
      displayName,
      avatarUrl,
      initials: getPersonInitials(displayName),
    };
  }, [members, myDisplayName, npub, profile]);

  const canLeaveGroup = useMemo(() => {
    return (
      !!group &&
      group.status === 'active' &&
      !!npub &&
      !!currentMember &&
      currentMember.status === 'active' &&
      currentMember.role !== 'owner'
    );
  }, [group, npub, currentMember]);

  const hydrateMemberProfiles = useCallback(async (groupId: string, groupMembers: BEGroupMember[]) => {
  const activeMembers = groupMembers.filter(member => member.status === 'active');

  if (activeMembers.length === 0) return;

  const hydratedMembers = [...groupMembers];

  for (const member of activeMembers) {
    try {
      const profile = await fetchNostrProfile(member.npub);

      if (!profile) continue;

      const displayName =
        profile.display_name ||
        profile.name ||
        member.displayName;

      const avatarUrl =
        profile.picture ||
        member.avatarUrl;

      if (!displayName && !avatarUrl) continue;

      await updateGroupMemberProfile(groupId, member.npub, {
        displayName,
        avatarUrl,
      });

      const index = hydratedMembers.findIndex(item => item.id === member.id);

      if (index >= 0) {
        hydratedMembers[index] = {
          ...hydratedMembers[index],
          displayName,
          avatarUrl,
        };
      }

      setMembers([...hydratedMembers]);

      await new Promise(resolve => setTimeout(resolve, 0));
    } catch (error) {
      console.warn('[Group Members] failed to hydrate profile:', error);
    }
  }
  }, []);

  const refreshMembersOnly = useCallback(async (targetGroup: BEGroup) => {
    const syncedMembers = await syncGroupMembersFromRelay(
      targetGroup.id,
      targetGroup.relayUrl ? [targetGroup.relayUrl] : []
    );

    setMembers(syncedMembers);
    setGroup(current => current
      ? { ...current, memberCount: syncedMembers.filter(member => member.status === 'active').length }
      : current
    );
    hydrateMemberProfiles(targetGroup.id, syncedMembers).catch(error => {
      console.warn('[Group Members] profile hydration failed:', error);
    });
  }, [hydrateMemberProfiles]);

  const loadSpaceMarks = useCallback(async (groupId: string, spaces: LivingSpace[]) => {
    const livingSpaceId = getGroupLivingSpaceId(groupId);
    const activeSelfMember = npub ? await getMemberByNpub(groupId, npub) : null;
    const activeSelfJoinedAt =
      activeSelfMember?.status === 'active'
        ? activeSelfMember.joinedAt ?? 0
        : 0;

    const milestones = await getMilestones();
    const views = await getLivingMarkViewsForMilestones({
      milestones,
      spaces,
      currentNpub: npub,
    });

    const filteredViews = views
      .filter(view => {
        if (!view.placement.spaceIds.includes(livingSpaceId)) return false;

        const relayBackedGroupIds = view.milestone.spaceRelayGroupIds ?? [];
        if (relayBackedGroupIds.includes(groupId)) return true;

        const isCurrentAuthor = !!npub && view.milestone.authorNpub === npub;
        if (!isCurrentAuthor) return false;

        if (!activeSelfMember || activeSelfMember.status !== 'active') return false;

        return (view.milestone.createdAt ?? 0) >= activeSelfJoinedAt;
      })
      .sort((a, b) => b.milestone.createdAt - a.milestone.createdAt);

    setSpaceMarkViews(filteredViews);
    return filteredViews;
  }, [npub]);

  const publishSpaceMarkSnapshot = useCallback(async (
    targetGroup: BEGroup,
    view: LivingMarkView
  ) => {
    if (!SPACE_MARK_RELAY_SYNC_ENABLED || !nsec) return;

    const relayUrls = normalizeRelayUrls([
      targetGroup.relayUrl || DEFAULT_RELAY,
      ...(targetGroup.backupRelayUrls ?? []),
    ]);

    const result = await publishGroupMark({
      groupId: targetGroup.id,
      milestone: view.milestone,
      metadata: view.metadata,
      placement: view.placement,
      nsec,
      relayUrl: targetGroup.relayUrl || DEFAULT_RELAY,
      relayUrls: relayUrls.length > 0 ? relayUrls : [targetGroup.relayUrl || DEFAULT_RELAY],
    });

    if (!result.success) {
      console.warn('[Space Marks] publish failed:', result.error);
      return;
    }

    await updateMilestone(view.milestone.id, {
      spaceRelayEventId: result.eventId,
      spaceRelayPublishedAt: Math.floor(Date.now() / 1000),
      spaceRelayGroupIds: Array.from(new Set([
        ...(view.milestone.spaceRelayGroupIds ?? []),
        targetGroup.id,
      ])),
    });
  }, [nsec]);

  const syncSpaceMarksFromRelay = useCallback(async (
    targetGroup: BEGroup,
    spaces: LivingSpace[]
  ) => {
    if (!SPACE_MARK_RELAY_SYNC_ENABLED) return [] as LivingMarkView[];

    const snapshots = await fetchGroupMarks(targetGroup.id, targetGroup.relayUrl || DEFAULT_RELAY);
    if (snapshots.length === 0) return [] as LivingMarkView[];

    for (const snapshot of snapshots) {
      await importLivingSpaceMarkSnapshot({
        groupId: targetGroup.id,
        milestone: snapshot.milestone,
        metadata: snapshot.metadata,
        placement: snapshot.placement,
        spaces,
        currentNpub: npub,
      });
    }

    return loadSpaceMarks(targetGroup.id, spaces);
  }, [loadSpaceMarks, npub]);

  const backfillSpaceMarksToRelay = useCallback(async (
    targetGroup: BEGroup,
    views: LivingMarkView[],
    canPublish: boolean
  ) => {
    if (!SPACE_MARK_RELAY_SYNC_ENABLED || !canPublish || !nsec) return;

    const candidates = views
      .filter(view => {
        const publishedToGroup = (view.milestone.spaceRelayGroupIds ?? []).includes(targetGroup.id);
        const publishedAt = view.milestone.spaceRelayPublishedAt ?? 0;
        return !publishedToGroup || view.metadata.updatedAt > publishedAt;
      })
      .slice(0, 8);

    for (const view of candidates) {
      await publishSpaceMarkSnapshot(targetGroup, view);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }, [nsec, publishSpaceMarkSnapshot]);

  const load = useCallback(async () => {
    if (!id) return;

    const runId = groupDetailLoadRunIdRef.current + 1;
    groupDetailLoadRunIdRef.current = runId;

    const g = await getGroupById(id);

    if (!g) return;

    setGroup(g);
    getSchoolSpaceConsentSummary(g.id, npub)
      .then(setSchoolConsentSummary)
      .catch(error => console.warn('[School Consent] summary load failed:', error));

    let spaces: LivingSpace[] = [];
    try {
      spaces = await syncLivingSpacesFromGroups();
      setLivingSpaces(spaces);
      await loadSpaceMarks(id, spaces);
    } catch (error) {
      console.warn('[Space Detail] failed to sync Living Space mirror:', error);
    }

    // FAST LOCAL LOAD FIRST
    try {
      const [localMembers, localStickies, upcoming, calendarEvents, localMessages, localGalleryItems] = await Promise.all([
        getGroupMembers(id),
        getStickiesForGroup(id),
        getUpcomingEventsForGroup(id),
        getCalendarEventsForGroup(id),
        getMessagesForGroup(id),
        readLocalGalleryItems(),
      ]);

      setMembers(localMembers);
      setStickies(localStickies);
      setChatMessageCount(localMessages.filter(message => !message.isDeleted).length);
      setUpcomingCount(upcoming.length);
      setCalendarEventTitles(buildCalendarEventTitleMap(calendarEvents));

      const localChatMediaItems = buildGalleryItemsFromMessages(localMessages, 'local-chat');
      const savedHighlightItems = localGalleryItems.filter((item: LocalGalleryItem) => item.groupId === id);

      setGalleryItems(mergeGalleryItems([
        ...localChatMediaItems,
        ...savedHighlightItems,
      ]));

      if (npub) {
        const [admin, member] = await Promise.all([
          isGroupAdmin(id, npub),
          isGroupMember(id, npub),
        ]);

        setIsAdmin(admin);
        setIsMember(member);
      }
    } catch (error) {
      console.warn('[Group Detail] local cache load failed:', error);
    }

    // BACKGROUND RELAY SYNC AFTER SCREEN IS USABLE
    InteractionManager.runAfterInteractions(() => {
      Promise.resolve().then(async () => {
        if (groupDetailLoadRunIdRef.current !== runId) return;
        let relayGroup = g;

        try {
          const refreshedGroup = await refreshGroupMetadataFromRelay(
            id,
            g.relayUrl || DEFAULT_RELAY
          );

          if (groupDetailLoadRunIdRef.current !== runId) return;

          if (refreshedGroup) {
            relayGroup = refreshedGroup;
            setGroup(current => current
              ? {
                  ...current,
                  ...refreshedGroup,
                  memberCount: Math.max(current.memberCount ?? 0, refreshedGroup.memberCount ?? 0),
                }
              : refreshedGroup
            );
          }
        } catch (error) {
          console.warn('[Space Detail] metadata refresh failed:', error);
        }

        try {
          const syncedMembers = await syncGroupMembersFromRelay(
            id,
            relayGroup.relayUrl ? [relayGroup.relayUrl] : []
          );

          if (groupDetailLoadRunIdRef.current !== runId) return;

          setMembers(syncedMembers);
          setGroup(current => current
            ? { ...current, memberCount: syncedMembers.filter(member => member.status === 'active').length }
            : current
          );
          syncedMembers
            .filter(member => member.status === 'active')
            .forEach(member => {
              registerGroupMemberForPush({
                groupId: relayGroup.id,
                groupName: relayGroup.name,
                relayUrl: relayGroup.relayUrl,
                memberNpub: member.npub,
                role: member.role,
                status: 'active',
                displayName: member.displayName,
              }).catch(error => {
                console.warn('[Group Detail] push member backfill failed:', error);
              });
            });

          hydrateMemberProfiles(id, syncedMembers).catch(error => {
            console.warn('[Group Members] profile hydration failed:', error);
          });
        } catch (error) {
          console.warn('[Group Detail] background member sync failed:', error);
        }

      if (groupDetailLoadRunIdRef.current !== runId) return;

      try {
        const trustedBoardAuthors = getTrustedBoardAuthors(await getGroupMembers(id));

        const syncedStickies = relayGroup.relayUrl
          ? await syncGroupStickiesFromRelay(id, relayGroup.relayUrl, trustedBoardAuthors)
          : await getStickiesForGroup(id);

        setStickies(syncedStickies);
        const syncedSpaces = spaces.length > 0 ? spaces : await syncLivingSpacesFromGroups();
        let currentSpaceMarks = await syncSpaceMarksFromRelay(relayGroup, syncedSpaces);

        if (currentSpaceMarks.length === 0) {
          currentSpaceMarks = await loadSpaceMarks(id, syncedSpaces);
        }

        const canPublishMarks = !!npub && await isGroupAdmin(id, npub);
        if (canPublishMarks && nsec) {
          publishGroupMetadataSnapshot(id, nsec).catch(error => {
            console.warn('[Space Detail] metadata backfill publish failed:', error);
          });
        }
        await backfillSpaceMarksToRelay(relayGroup, currentSpaceMarks, canPublishMarks);
      } catch (error) {
        console.warn('[Group Detail] background highlight sync failed:', error);
      }

      if (groupDetailLoadRunIdRef.current !== runId) return;

      try {
        if (g.relayUrl) {
          await syncCalendarEventsFromRelay(id, g.relayUrl);
        }

        const [upcoming, calendarEvents] = await Promise.all([
          getUpcomingEventsForGroup(id),
          getCalendarEventsForGroup(id),
        ]);
        setUpcomingCount(upcoming.length);
        setCalendarEventTitles(buildCalendarEventTitleMap(calendarEvents));
      } catch (error) {
        console.warn('[Group Detail] background calendar sync failed:', error);
      }

      if (groupDetailLoadRunIdRef.current !== runId) return;

      try {
        const localMessages = await getMessagesForGroup(id);
        setChatMessageCount(localMessages.filter(message => !message.isDeleted).length);
        const localChatMediaItems = buildGalleryItemsFromMessages(localMessages, 'local-chat');

        let relayChatMediaItems: any[] = [];
        const shouldFetchRelayGallery = tabRef.current === 'gallery';

        if (g.relayUrl && shouldFetchRelayGallery) {
          const [events, deleteEvents] = await Promise.all([
            fetchGroupMessages(id, g.relayUrl),
            fetchGroupMessageDeletes(id, g.relayUrl),
          ]);

          const deletedMessageIds = new Set<string>();
          const deletedClientMessageIds = new Set<string>();

          deleteEvents.forEach(deleteEvent => {
            if (deleteEvent.messageId) {
              deletedMessageIds.add(deleteEvent.messageId);
              deletedMessageIds.add(`nostr_group_${deleteEvent.messageId}`);
            }

            if (deleteEvent.clientMessageId) {
              deletedClientMessageIds.add(deleteEvent.clientMessageId);
            }
          });

          relayChatMediaItems = events
            .filter(event => {
              const eventClientMessageId = (event as any).clientMessageId;

              return (
                !deletedMessageIds.has(event.id) &&
                !deletedMessageIds.has(`nostr_group_${event.id}`) &&
                (!eventClientMessageId || !deletedClientMessageIds.has(eventClientMessageId))
              );
            })
            .flatMap(event => buildGalleryItemsFromMessages([event], 'chat'));
        }

        const localGalleryItems = await readLocalGalleryItems();
        const savedHighlightItems = localGalleryItems.filter((item: LocalGalleryItem) => item.groupId === id);

        setGalleryItems(mergeGalleryItems([
          ...relayChatMediaItems,
          ...localChatMediaItems,
          ...savedHighlightItems,
        ]));
      } catch (error) {
        console.warn('[Group Detail] background gallery sync failed:', error);
      }
      });
    });
  }, [
    id,
    nsec,
    npub,
    backfillSpaceMarksToRelay,
    hydrateMemberProfiles,
    loadSpaceMarks,
    syncSpaceMarksFromRelay,
  ]);

  const refreshLocalGalleryFromCache = useCallback(async () => {
    if (!id) return;

    try {
      const cachedGalleryItems = await readCachedSpaceGalleryItems(id);

      if (cachedGalleryItems.length > 0) {
        setGalleryItems(cachedGalleryItems);
      }

      const [localMessages, localGalleryItems] = await Promise.all([
        getMessagesForGroup(id),
        readLocalGalleryItems(),
      ]);
      const localChatMediaItems = buildGalleryItemsFromMessages(localMessages, 'local-chat');
      const savedHighlightItems = localGalleryItems.filter(item => item.groupId === id);
      const mergedGalleryItems = mergeGalleryItems([
        ...localChatMediaItems,
        ...savedHighlightItems,
      ]);

      setChatMessageCount(localMessages.filter(message => !message.isDeleted).length);
      setGalleryItems(mergedGalleryItems);
      await writeCachedSpaceGalleryItems(id, mergedGalleryItems);
    } catch (error) {
      console.warn('[Gallery] local refresh failed:', error);
    }
  }, [id]);

  useEffect(() => {
    load();

    return () => {
      groupDetailLoadRunIdRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!group?.id || !group.relayUrl) return;

    const timer = setInterval(() => {
      refreshMembersOnly(group).catch(error => {
        console.warn('[Group Members] focused refresh failed:', error);
      });
    }, 20000);

    return () => clearInterval(timer);
  }, [group, refreshMembersOnly]);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(SPACE_FAVORITES_KEY)
      .then(raw => {
        if (!mounted || !raw) return;

        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setFavoriteSpaceIds(parsed.filter(id => typeof id === 'string').slice(0, 5));
        }
      })
      .catch(error => {
        console.warn('[Space Detail] failed to load favorite Spaces:', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!routeTab) return;

    if (routeTab === 'overview' || routeTab === 'mantle') {
      setTab('stickies');
      return;
    }

    if (
      routeTab === 'chat' ||
      routeTab === 'stickies' ||
      routeTab === 'board' ||
      routeTab === 'calendar' ||
      routeTab === 'gallery' ||
      routeTab === 'members' ||
      routeTab === 'legacy' ||
      routeTab === 'book'
    ) {
      setTab(routeTab);
    }
  }, [routeTab]);

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    if (tab === 'gallery') {
      refreshLocalGalleryFromCache();
    }
  }, [tab, refreshLocalGalleryFromCache]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, event => {
      const nextHeight = Math.max(0, Math.round(event.endCoordinates?.height ?? 0));

      setSpaceKeyboardHeight(current => (
        Math.abs(current - nextHeight) > 2 ? nextHeight : current
      ));
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setSpaceKeyboardHeight(current => (current === 0 ? current : 0));
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const publishCurrentGroupMetadata = async (groupId: string) => {
    if (!nsec) return;

    try {
      const result = await publishGroupMetadataSnapshot(groupId, nsec);
      if (!result.success) {
        console.warn('[Space Detail] metadata publish failed:', result.error);
      }
    } catch (error) {
      console.warn('[Space Detail] metadata publish error:', error);
    }
  };

  const refreshBookGroupState = useCallback(async () => {
    if (!group?.id) return;

    try {
      const updatedGroup = await getGroupById(group.id);

      if (updatedGroup) {
        setGroup(updatedGroup);
      }

      await syncLivingSpacesFromGroups();
    } catch (error) {
      console.warn('[Book] group refresh failed:', error);
    }
  }, [group?.id]);

  const resetBoardComposer = () => {
    setBoardDisplayMode('pin');
    setBoardTitle('');
    setBoardBody('');
    setBoardAttachments([]);
    setBoardUploadStatus(null);
    setSavingBoardItem(false);
  };

  const openBoardComposer = (displayMode: GroupBoardDisplayMode = 'pin') => {
    if (!group) return;

    if (group.status !== 'active') {
      Alert.alert('Space archived', 'This Space is archived. Board items can still be viewed, but new ones cannot be added.');
      return;
    }

    if (!isAdmin) {
      Alert.alert('Admins only', 'Only a Space owner or admin can add Bulletin Board items.');
      return;
    }

    setBoardDisplayMode(displayMode);
    setBoardTitle('');
    setBoardBody('');
    setSavingBoardItem(false);
    setShowBoardComposer(true);
  };

    const handlePickBoardMedia = async () => {
    if (savingBoardItem) return;

    const remainingSlots = Math.max(0, 5 - boardAttachments.length);

    if (remainingSlots === 0) {
      Alert.alert('Limit reached', 'You can attach up to 5 items to a Bulletin Board item.');
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permission.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow media access to attach photos or videos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.length) return;

      const newItems: BoardDraftAttachment[] = result.assets
        .filter(asset => !!asset.uri)
        .map((asset, index) => ({
          id: `board_media_${Date.now()}_${index}`,
          uri: asset.uri,
          type: asset.type === 'video' ? 'video' : 'image',
          name: asset.fileName ?? undefined,
          mimeType: asset.mimeType ?? undefined,
        }));

      setBoardAttachments(current => [...current, ...newItems].slice(0, 5));
    } catch (error) {
      console.warn('[Bulletin Board] media picker failed:', error);
      Alert.alert('Media error', 'Could not open your photo library.');
    }
  };

  const handlePickBoardFiles = async () => {
    if (savingBoardItem) return;

    const remainingSlots = Math.max(0, 5 - boardAttachments.length);

    if (remainingSlots === 0) {
      Alert.alert('Limit reached', 'You can attach up to 5 items to a Bulletin Board item.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const newFiles: BoardDraftAttachment[] = result.assets
        .filter(asset => !!asset.uri)
        .slice(0, remainingSlots)
        .map((asset, index) => ({
          id: `board_file_${Date.now()}_${index}`,
          uri: asset.uri,
          type: 'file',
          name: asset.name,
          mimeType: asset.mimeType,
        }));

      setBoardAttachments(current => [...current, ...newFiles].slice(0, 5));
    } catch (error) {
      console.warn('[Bulletin Board] file picker failed:', error);
      Alert.alert('File error', 'Could not open the file picker.');
    }
  };

  const removeBoardAttachment = (attachmentId: string) => {
    if (savingBoardItem) return;

    setBoardAttachments(current =>
      current.filter(item => item.id !== attachmentId)
    );
  };

  const handleSaveBoardItem = async () => {
    if (!group || savingBoardItem) return;

    if (!isAdmin) {
      Alert.alert('Admins only', 'Only a Space owner or admin can save Bulletin Board items.');
      return;
    }

    if (!npub) {
      Alert.alert('Sign in required', 'Sign in before adding to the Bulletin Board.');
      return;
    }

    const title = boardTitle.trim();
    const body = boardBody.trim();

    if (!title || !body) {
      Alert.alert('Missing info', 'Add a title and message for the Bulletin Board item.');
      return;
    }

    setSavingBoardItem(true);
    setBoardUploadStatus(
      boardAttachments.length > 0
        ? 'Preparing attachments...'
        : 'Posting Bulletin Board item...'
    );

    try {
      const uploadedBoardMedia: any[] = [];

      for (let i = 0; i < boardAttachments.length; i++) {
        const item = boardAttachments[i];
        let uploadUri = item.uri;

        if (item.type === 'image') {
          setBoardUploadStatus(`Optimizing photo ${i + 1} of ${boardAttachments.length}.`);

          const compressionResult = await compressImageForUpload({
            uri: item.uri,
            onStatus: setBoardUploadStatus,
          });

          uploadUri = compressionResult.uri;

          setBoardUploadStatus(
            compressionResult.wasCompressed
              ? `Uploading optimized photo ${i + 1} of ${boardAttachments.length}.`
              : `Uploading photo ${i + 1} of ${boardAttachments.length}.`
          );
        } else if (item.type === 'video') {
          const compressionResult = await compressVideoForUpload({
            uri: item.uri,
            onStatus: setBoardUploadStatus,
            onProgress: progress => {
              setBoardUploadStatus(
                `Compressing video ${i + 1} of ${boardAttachments.length}… ${Math.round(progress * 100)}%`
              );
            },
          });

          uploadUri = compressionResult.uri;

          setBoardUploadStatus(
            compressionResult.wasCompressed
              ? `Uploading compressed video ${i + 1} of ${boardAttachments.length}.`
              : `Uploading video ${i + 1} of ${boardAttachments.length}.`
          );
        } else {
          setBoardUploadStatus(`Uploading file ${i + 1} of ${boardAttachments.length}.`);
        }

        const uploadedUrl = await uploadToR2(
          uploadUri,
          item.type === 'video' ? 'video' : item.type === 'image' ? 'photo' : 'file'
        );

        if (!uploadedUrl) {
          console.warn('[Bulletin Board] skipped failed attachment:', item.uri);
          continue;
        }

        let thumbnailUrl: string | undefined;

        if (item.type === 'video') {
          try {
            setBoardUploadStatus(`Creating thumbnail ${i + 1} of ${boardAttachments.length}.`);

            const thumbnail = await VideoThumbnails.getThumbnailAsync(uploadUri, {
              time: 1000,
            });

            setBoardUploadStatus(`Uploading thumbnail ${i + 1} of ${boardAttachments.length}.`);

            const uploadedThumbnail = await uploadToR2(thumbnail.uri, 'photo');
            thumbnailUrl = uploadedThumbnail || undefined;
          } catch (thumbError) {
            console.warn('[Bulletin Board] thumbnail failed:', thumbError);
          }
        }

        uploadedBoardMedia.push({
          id: `board_uploaded_${Date.now()}_${i}`,
          uri: uploadedUrl,
          type: item.type,
          mediaUrl: uploadedUrl,
          mediaType: item.type,
          thumbnailUri: thumbnailUrl,
          thumbnailUrl,
          imageUrl: item.type === 'image' ? uploadedUrl : undefined,
          name: item.name,
          fileName: item.name,
          mimeType: item.mimeType,
        });
      }

      if (boardAttachments.length > 0 && uploadedBoardMedia.length === 0) {
        Alert.alert('Upload failed', 'Could not upload the selected attachments.');
        setSavingBoardItem(false);
        setBoardUploadStatus(null);
        return;
      }

      setBoardUploadStatus('Posting Bulletin Board item...');

      const createdBoardItem = await createGroupSticky({
        groupId: group.id,
        title,
        body,
        media: uploadedBoardMedia,
        displayMode: boardDisplayMode,
        priority: boardDisplayMode === 'alert' ? 'high' : 'normal',
        relayUrl: group.relayUrl,
        relayUrls: getGroupPublishRelayUrls(group),
        authorName: myDisplayName,
        authorNpub: npub,
      } as any);

      setStickies(current => {
        const withoutDuplicate = current.filter(item => item.id !== createdBoardItem.id);

        return [createdBoardItem, ...withoutDuplicate].sort(
          (a, b) => b.updatedAt - a.updatedAt
        );
      });

      setShowBoardComposer(false);
      resetBoardComposer();
    } catch (error) {
      console.warn('[Bulletin Board] save failed:', error);
      Alert.alert('Could not save', 'The Bulletin Board item could not be saved.');
      setSavingBoardItem(false);
      setBoardUploadStatus(null);
    }
  };

  const openGroupRelayEditor = () => {
    if (!group) return;
    if (!isAdmin) {
      Alert.alert('Admin only', 'Only a Space owner or admin can manage relay routing.');
      return;
    }

    setShowInvite(false);
    setShowSpaceSettingsMenu(true);
    setSpaceSettingsRelayOpen(true);
    setGroupRelayMode(group.relayMode ?? 'default');
    setGroupRelayUrl(group.relayMode === 'default' ? '' : group.relayUrl ?? '');
    setGroupBackupRelayInput((group.backupRelayUrls ?? []).join('\n'));
    setEditingGroupRelay(true);
  };

  const saveGroupRelaySettings = async () => {
    if (!group) return;
    if (!isAdmin) {
      Alert.alert('Admin only', 'Only a Space owner or admin can save relay routing.');
      return;
    }

    const trimmedUrl = groupRelayUrl.trim();
    const rawBackupRelayUrls = groupBackupRelayInput
      .split(/[\s,]+/)
      .map(relayUrl => relayUrl.trim())
      .filter(Boolean);

    if ((groupRelayMode === 'custom' || groupRelayMode === 'both') && !trimmedUrl) {
      Alert.alert('Relay required', 'Enter the Space or school relay URL.');
      return;
    }

    if (trimmedUrl && !trimmedUrl.startsWith('wss://') && !trimmedUrl.startsWith('ws://')) {
      Alert.alert('Invalid relay', 'Relay URL must start with wss:// or ws://');
      return;
    }

    const invalidBackupRelayUrl = rawBackupRelayUrls.find(
      relayUrl => !relayUrl.startsWith('wss://') && !relayUrl.startsWith('ws://')
    );

    if (invalidBackupRelayUrl) {
      Alert.alert('Invalid backup relay', 'Each backup relay URL must start with wss:// or ws://');
      return;
    }

    const primaryRelayUrl = groupRelayMode === 'default' ? DEFAULT_RELAY : trimmedUrl;
    const backupRelayUrls = normalizeRelayUrls([
      ...(groupRelayMode === 'both' ? [DEFAULT_RELAY] : []),
      ...rawBackupRelayUrls,
    ]).filter(relayUrl => relayUrl !== primaryRelayUrl);

    await updateGroup(group.id, {
      relayMode: groupRelayMode,
      relayUrl: primaryRelayUrl,
      backupRelayUrls,
    });
    await syncLivingSpacesFromGroups();
    await publishCurrentGroupMetadata(group.id);

    setEditingGroupRelay(false);
    await load();

    Alert.alert('Saved', 'Space relay settings updated.');
  };

  const handleShareInvite = async () => {
    if (!group) return;

    try {
      await Share.share({
        message: `Join "${group.name}" on bE Marks!\n\nInvite code: ${group.inviteCode}\n\nOr tap: ${deepLink}`,
        title: `Join ${group.name}`,
      });
    } catch {}
  };

  const handleCopyCode = async () => {
    if (!group) return;
    await Clipboard.setStringAsync(group.inviteCode);
    Alert.alert('Copied', 'Invite code copied to clipboard.');
  };

  const closeSpacePanels = () => {
    setShowInvite(false);
    setShowSpaceSettingsMenu(false);
    setSpaceSettingsRelayOpen(false);
    setSpaceSettingsConsentOpen(false);
    setEditingGroupRelay(false);
    setGroupBackupRelayInput('');
  };

  const closeSpaceSettingsMenu = () => {
    setShowSpaceSettingsMenu(false);
    setSpaceSettingsRelayOpen(false);
    setSpaceSettingsConsentOpen(false);
    setEditingGroupRelay(false);
    setGroupBackupRelayInput('');
  };

  const selectSpaceTab = (nextTab: Tab) => {
    closeSpacePanels();
    setTab(nextTab);
  };

  const openSpaceControlCenter = () => {
    setShowInvite(false);
    setSpaceSettingsRelayOpen(false);
    setSpaceSettingsConsentOpen(false);
    setEditingGroupRelay(false);
    setShowSpaceSettingsMenu(true);
  };

  const handleRegenerateCode = () => {
    if (!isAdmin) {
      Alert.alert('Admin only', 'Only a Space owner or admin can regenerate invite codes.');
      return;
    }

    Alert.alert(
      'Regenerate invite code?',
      'The old code will stop working immediately. Share the new code with your Space.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate', onPress: async () => {
            if (!group) return;
            const newCode = await regenerateInviteCode(group.id);
            await publishCurrentGroupMetadata(group.id);
            await load();
            Alert.alert('New code ready', `Your new invite code is: ${newCode}`);
          }
        }
      ]
    );
  };

  const handleArchive = () => {
    if (!isAdmin) {
      Alert.alert('Admin only', 'Only a Space owner or admin can archive this Space.');
      return;
    }

    Alert.alert(
      'Archive this Space?',
      'Members can still view past messages and Marks, but no new posts will be allowed. You can start a new season anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive', style: 'destructive', onPress: async () => {
            if (!group) return;
            await archiveGroup(group.id);
            await syncLivingSpacesFromGroups();
            await publishCurrentGroupMetadata(group.id);
            await load();
          }
        }
      ]
    );
  };

  const refreshSchoolConsentSummary = async (groupId = group?.id) => {
    if (!groupId) return;

    const summary = await getSchoolSpaceConsentSummary(groupId, npub);
    setSchoolConsentSummary(summary);
  };

  const enableSchoolConsentDefaults = async () => {
    if (!group || !isAdmin) return;

    await updateGroup(group.id, {
      schoolConsentMode: 'hybrid',
      requiresGuardianConsent: true,
      defaultMinorMarkPolicy: group.defaultMinorMarkPolicy ?? 'restricted',
      directoryInfoAllowed: group.directoryInfoAllowed === true,
      consentNoticeVersion: group.consentNoticeVersion ?? SCHOOL_CONSENT_NOTICE_VERSION,
    });
    await publishCurrentGroupMetadata(group.id);
    await load();
    await refreshSchoolConsentSummary(group.id);
  };

  const toggleSchoolMinorPolicy = async () => {
    if (!group || !isAdmin) return;

    await updateGroup(group.id, {
      defaultMinorMarkPolicy:
        group.defaultMinorMarkPolicy === 'privateSpaceOnly'
          ? 'restricted'
          : 'privateSpaceOnly',
      schoolConsentMode: 'hybrid',
      requiresGuardianConsent: true,
      consentNoticeVersion: group.consentNoticeVersion ?? SCHOOL_CONSENT_NOTICE_VERSION,
    });
    await publishCurrentGroupMetadata(group.id);
    await load();
  };

  const toggleDirectoryInfoAllowed = async () => {
    if (!group || !isAdmin) return;

    await updateGroup(group.id, {
      directoryInfoAllowed: group.directoryInfoAllowed !== true,
      schoolConsentMode: 'hybrid',
      requiresGuardianConsent: true,
      consentNoticeVersion: group.consentNoticeVersion ?? SCHOOL_CONSENT_NOTICE_VERSION,
    });
    await publishCurrentGroupMetadata(group.id);
    await load();
  };

  const saveChildConsentProfile = async () => {
    if (!group) return;

    const childName = childNameInput.trim();
    if (!childName) {
      Alert.alert('Child name required', 'Add the child or student name before saving consent settings.');
      return;
    }

    if (!npub) {
      Alert.alert('Guardian identity required', 'Sign in with a Nostr identity before linking a child profile.');
      return;
    }

    setSavingSchoolConsent(true);

    try {
      const student = await upsertSchoolStudentProfile({
        spaceId: group.id,
        displayName: childName,
        grade: childGradeInput,
        under13: childUnder13,
        guardianNpub: npub,
      });

      await upsertSchoolConsentRecord({
        spaceId: group.id,
        studentId: student.id,
        guardianNpub: npub,
        permissions: {
          media: childConsentMedia,
          name: childConsentName,
          mantle: childConsentMantle,
          legacy: childConsentLegacy,
          restricted: !childConsentMedia && !childConsentName && !childConsentMantle && !childConsentLegacy,
        },
        consentStatus: 'granted',
        noticeVersion: group.consentNoticeVersion ?? SCHOOL_CONSENT_NOTICE_VERSION,
        source: isAdmin ? 'school-admin' : 'guardian',
      });

      setChildNameInput('');
      setChildGradeInput('');
      setChildUnder13(true);
      setChildConsentMedia(false);
      setChildConsentName(false);
      setChildConsentMantle(false);
      setChildConsentLegacy(false);
      await refreshSchoolConsentSummary(group.id);
    } catch (error: any) {
      Alert.alert('Consent not saved', error?.message ?? 'Could not save the child consent profile.');
    } finally {
      setSavingSchoolConsent(false);
    }
  };

  const revokeStudentConsent = async (studentId: string) => {
    if (!group) return;

    await upsertSchoolConsentRecord({
      spaceId: group.id,
      studentId,
      guardianNpub: npub,
      permissions: {
        media: false,
        name: false,
        mantle: false,
        legacy: false,
        restricted: true,
      },
      consentStatus: 'revoked',
      noticeVersion: group.consentNoticeVersion ?? SCHOOL_CONSENT_NOTICE_VERSION,
      source: isAdmin ? 'school-admin' : 'guardian',
    });
    await refreshSchoolConsentSummary(group.id);
  };

const openViewerForSticky = (sticky: GroupSticky, startIndex: number) => {
  const media = (sticky as any).media;
  const mediaItems = media ? (Array.isArray(media) ? media : [media]) : [];

  const visualItems = mediaItems.filter(item => {
    const mediaType = item.mediaType || item.type;
    return mediaType === 'image' || mediaType === 'video';
  });

  const images: ViewerImage[] = visualItems
    .filter(item => !!(item.mediaUrl || item.uri))
    .map((item, index) => {
      const viewerType: 'image' | 'video' =
        item.mediaType === 'video' || item.type === 'video' ? 'video' : 'image';

      return {
        id: `${sticky.id}_${index}`,
        uri: item.mediaUrl || item.uri,
        type: viewerType,
        thumbnailUrl: item.thumbnailUrl || item.thumbnailUri,
      };
    });

    if (images.length === 0) return;

  setActiveViewerImages(images);
  setSelectedGalleryImage(images[startIndex]?.uri ?? null);
};

const openViewerForMilestone = (mark: Milestone, startIndex: number) => {
  const images: ViewerImage[] = getMilestoneMediaItems(mark)
    .filter(item => item.type === 'image' || item.type === 'video')
    .map((item, index) => ({
      id: `${mark.id}_${index}`,
      uri: item.uri,
      type: item.type,
      thumbnailUrl: item.thumbnailUri,
    }));

  if (images.length === 0) return;

  setActiveViewerImages(images);
  setSelectedGalleryImage(images[startIndex]?.uri ?? null);
};

const openMarkDetail = (markId: string, returnToGroupTab: Tab = 'stickies') => {
  router.push({
    pathname: '/mark-detail',
    params: { id: markId, returnToGroupId: group?.id, returnToGroupTab },
  } as any);
};

const openUnifiedMarkComposer = (returnTab: Tab = tab, calendarEvent?: GroupCalendarEvent) => {
  if (!group) return;

  router.push({
    pathname: '/(tabs)/log',
    params: {
      selectedSpaceId: getGroupLivingSpaceId(group.id),
      returnToGroupId: group.id,
      returnToGroupTab: returnTab,
      ...(calendarEvent
        ? {
            calendarEventId: calendarEvent.id,
            calendarEventTitle: calendarEvent.title,
            savedToBook: calendarEvent.legacyEligible ? '1' : undefined,
          }
        : {}),
    },
  } as any);
};

const getBoardItemAuthorLabel = (sticky: GroupSticky): string => {
  const authorMember = sticky.authorNpub
    ? members.find(member => member.npub === sticky.authorNpub)
    : null;

  const displayName =
    authorMember?.displayName ||
    sticky.authorName ||
    (sticky.authorNpub ? `${sticky.authorNpub.slice(0, 12)}…` : 'Space admin');

  const roleLabel =
    authorMember?.role === 'owner'
      ? 'Owner'
      : authorMember?.role === 'admin'
        ? 'Admin'
        : 'Admin';

  return `Signed by ${displayName} • ${roleLabel} • ${formatStickyDate(sticky.updatedAt || sticky.createdAt)}`;
};

const handleOpenHighlightFile = async (fileUrl?: string) => {
  if (!fileUrl) {
    Alert.alert('File unavailable', 'This file does not have a saved URL.');
    return;
  }

  try {
    const supported = await Linking.canOpenURL(fileUrl);

    if (!supported) {
      Alert.alert('Cannot open file', 'No app is available to open this file.');
      return;
    }

    await Linking.openURL(fileUrl);
  } catch (error) {
    console.warn('[Highlight file open] failed:', error);
    Alert.alert('File error', 'Could not open this attachment.');
  }
};

const handleDeleteSticky = (sticky: GroupSticky) => {
  const media = (sticky as any).media;
  const mediaItems = media ? (Array.isArray(media) ? media : [media]) : [];
  const hasMedia = mediaItems.some(item => !!(item.mediaUrl || item.uri));

  if (!hasMedia || !group) {
    Alert.alert(
      'Delete Mark?',
      'This removes the Mark from this device. Relay deletion will be handled later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await hideGroupSticky(sticky.id);

            setStickies(current =>
              current.filter(item => item.id !== sticky.id)
            );
          },
        },
      ]
    );

    return;
  }

  Alert.alert(
    'Delete Mark?',
    'This Mark has media. Do you want to keep the media in Gallery?',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete only',
        style: 'destructive',
        onPress: async () => {
          await hideGroupSticky(sticky.id);

          setStickies(current =>
            current.filter(item => item.id !== sticky.id)
          );
        },
      },
      {
        text: 'Delete + Save media',
        onPress: async () => {
          const savedItems = await saveHighlightMediaToLocalGallery(group.id, sticky);

          await hideGroupSticky(sticky.id);

          setStickies(current =>
            current.filter(item => item.id !== sticky.id)
          );

          if (savedItems.length > 0) {
            setGalleryItems(current => {
              const galleryMap = new Map<string, any>();

              [...current, ...savedItems].forEach(item => {
                galleryMap.set(item.id, item);
              });

              return Array.from(galleryMap.values()).sort(
                (a, b) => b.createdAt - a.createdAt
              );
            });
          }
        },
      },
    ]
  );
};

  const handleAddMemberToContacts = async (member: BEGroupMember) => {
    const displayName = member.displayName || `${member.npub.slice(0, 12)}…`;

    try {
      const existing = await getContactByNpub(member.npub);

      if (existing) {
        Alert.alert('Already saved', `${displayName} is already in your contacts.`);
        return;
      }

      const normalized = normalizeNostrIdentity(member.npub);

      await saveContact({
        name: displayName,
        npub: normalized.npub,
        pubkeyHex: normalized.pubkey,
        nostrName: member.displayName,
        nostrAvatar: member.avatarUrl,
      });

      Alert.alert('Contact saved', `${displayName} was added to your contacts.`);
    } catch (error: any) {
      console.warn('[Group Members] add contact failed:', error);
      Alert.alert('Contact failed', error?.message || 'Could not add this member to contacts.');
    }
  };

  const handleMessageMember = async (member: BEGroupMember) => {
    try {
      const displayName = member.displayName || `${member.npub.slice(0, 12)}…`;
      const normalized = normalizeNostrIdentity(member.npub);
      const threads = await getDMThreads();

      const existingThread = threads.find(thread =>
        thread.participantNpub === normalized.npub ||
        thread.participantPubkey === normalized.pubkey
      );

      if (existingThread) {
        router.push({
          pathname: '/dm-thread',
          params: {
            id: existingThread.id,
            title: displayName,
          },
        } as any);

        return;
      }

      const thread = await createThread({
        title: displayName,
        participantPubkey: normalized.pubkey,
        participantNpub: normalized.npub,
      });

      router.push({
        pathname: '/dm-thread',
        params: {
          id: thread.id,
          title: displayName,
        },
      } as any);
    } catch (error: any) {
      console.warn('[Group Members] message member failed:', error);
      Alert.alert('Message failed', error?.message || 'Could not start a message with this member.');
    }
  };

  const handleCopyMemberNpub = async (member: BEGroupMember) => {
    await Clipboard.setStringAsync(member.npub);
    Alert.alert('Copied', 'Member npub copied to clipboard.');
  };

  const handleRemoveMember = (member: BEGroupMember) => {
    if (!npub) return;

    Alert.alert(
      `Remove ${member.displayName || member.npub.slice(0, 12)}?`,
      'Their past posts will remain but they will no longer be able to view or post in this Space.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!group) return;

            await removeMember(group.id, member.npub, npub);

            setMembers(current =>
              current.filter(item => item.npub !== member.npub)
            );

            if (nsec) {
              publishGroupMembership({
                groupId: group.id,
                memberNpub: member.npub,
                memberPubkeyHex: member.pubkeyHex,
                action: 'remove',
                role: member.role,
                nsec,
                relayUrl: group.relayUrl,
                relayUrls: getGroupPublishRelayUrls(group),
              }).then(result => {
                if (!result.success) {
                  console.warn('[Group Members] publish member removal failed:', result.error);
                }
              }).catch(error => {
                console.warn('[Group Members] publish member removal error:', error);
              });
            }

            removeGroupMemberFromPush({
              groupId: group.id,
              memberNpub: member.npub,
            }).catch(error => {
              console.warn('[Group Members] push member removal failed:', error);
            });

            const removedName =
              member.displayName ||
              `${member.npub.slice(0, 12)}…`;

            await saveLocalGroupSystemMessage({
              groupId: group.id,
              text: `${removedName} was removed from the space`,
              systemType: 'remove',
              actorNpub: member.npub,
              actorName: removedName,
            });

            if (nsec) {
              publishGroupMessage({
                groupId: group.id,
                clientMessageId: `system_remove_${group.id}_${member.npub}_${Date.now()}`,
                text: `${removedName} was removed from the space`,
                kind: 'system',
                systemType: 'remove',
                senderNpub: npub,
                senderName: myDisplayName,
                nsec,
                relayUrl: group.relayUrl,
                relayUrls: getGroupPublishRelayUrls(group),
              }).then(result => {
                if (!result.success) {
                  console.warn('[Group Members] publish remove system message failed:', result.error);
                }
              }).catch(error => {
                console.warn('[Group Members] publish remove system message error:', error);
              });
            }

            notifyGroupEvent({
              groupId: group.id,
              groupName: group.name,
              relayUrl: group.relayUrl,
              actorNpub: npub,
              actorName: myDisplayName,
              eventType: 'member_removed',
              memberNpub: member.npub,
              memberName: removedName,
              routeTarget: 'group-detail',
              groupTab: 'members',
            }).catch(error => {
              console.warn('[Group Members] remote remove notification failed:', error);
            });

            await load();
          },
        },
      ]
    );
  };

    const handleLeaveGroup = () => {
    if (!group || !npub || !currentMember || currentMember.role === 'owner') return;

    Alert.alert(
      `Leave ${group.name}?`,
      'You will lose access to this Space. Past messages may remain visible to other members.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            if (!group || !npub || !currentMember) return;

            const normalizedSelf = normalizeNostrIdentity(npub);
            const memberPubkeyHex = currentMember.pubkeyHex || normalizedSelf.pubkey;
            const leftName = myDisplayName;

            await removeMember(group.id, npub, npub);

            setMembers(current =>
              current.filter(item => item.npub !== npub)
            );
            setIsMember(false);
            setIsAdmin(false);

            removeGroupMemberFromPush({
              groupId: group.id,
              memberNpub: npub,
            }).catch(error => {
              console.warn('[Group Members] leave push removal failed:', error);
            });

            if (nsec) {
              publishGroupMembership({
                groupId: group.id,
                memberNpub: npub,
                memberPubkeyHex,
                action: 'leave',
                role: currentMember.role,
                nsec,
                relayUrl: group.relayUrl,
                relayUrls: getGroupPublishRelayUrls(group),
              }).then(result => {
                if (!result.success) {
                  console.warn('[Group Members] publish leave membership failed:', result.error);
                }
              }).catch(error => {
                console.warn('[Group Members] publish leave membership error:', error);
              });
            }

            await saveLocalGroupSystemMessage({
              groupId: group.id,
              text: `${leftName} left the space`,
              systemType: 'leave',
              actorNpub: npub,
              actorName: leftName,
            });

            if (nsec) {
              publishGroupMessage({
                groupId: group.id,
                clientMessageId: `system_leave_${group.id}_${npub}_${Date.now()}`,
                text: `${leftName} left the space`,
                kind: 'system',
                systemType: 'leave',
                senderNpub: npub,
                senderName: leftName,
                nsec,
                relayUrl: group.relayUrl,
                relayUrls: getGroupPublishRelayUrls(group),
              }).then(result => {
                if (!result.success) {
                  console.warn('[Group Members] publish leave system message failed:', result.error);
                }
              }).catch(error => {
                console.warn('[Group Members] publish leave system message error:', error);
              });
            }

            notifyGroupEvent({
              groupId: group.id,
              groupName: group.name,
              relayUrl: group.relayUrl,
              actorNpub: npub,
              actorName: leftName,
              eventType: 'member_left',
              memberNpub: npub,
              memberName: leftName,
              routeTarget: 'group-detail',
              groupTab: 'members',
            }).catch(error => {
              console.warn('[Group Members] leave notification failed:', error);
            });

            router.replace('/(tabs)/messages' as any);
          },
        },
      ]
    );
  };

    const handleChangeMemberRole = async (
    member: BEGroupMember,
    nextRole: 'admin' | 'member'
  ) => {
    if (!group || !npub) return;

    const memberName = member.displayName || `${member.npub.slice(0, 12)}…`;

    await updateMemberRole(group.id, member.npub, nextRole);

    setMembers(current =>
      current.map(item =>
        item.npub === member.npub
          ? { ...item, role: nextRole }
          : item
      )
    );

    if (nsec) {
      publishGroupMembership({
        groupId: group.id,
        memberNpub: member.npub,
        memberPubkeyHex: member.pubkeyHex,
        action: 'join',
        role: nextRole,
        nsec,
        relayUrl: group.relayUrl,
        relayUrls: getGroupPublishRelayUrls(group),
      }).then(result => {
        if (!result.success) {
          console.warn('[Group Members] publish role change failed:', result.error);
        }
      }).catch(error => {
        console.warn('[Group Members] publish role change error:', error);
      });
    }

    notifyGroupEvent({
      groupId: group.id,
      groupName: group.name,
      relayUrl: group.relayUrl,
      actorNpub: npub,
      actorName: myDisplayName,
      eventType: 'member_role_changed',
      memberNpub: member.npub,
      memberName,
      role: nextRole,
      routeTarget: 'group-detail',
      groupTab: 'members',
    }).catch(error => {
      console.warn('[Group Members] role-change notification failed:', error);
    });

    await load();
  };

  const handlePromoteAdmin = (member: BEGroupMember) => {
    Alert.alert(
      `Make ${member.displayName || 'this member'} an admin?`,
      'They will be able to manage members and the invite code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make admin',
          onPress: async () => {
            if (!group) return;

            await handleChangeMemberRole(member, 'admin');
          },
        },
      ]
    );
  };

  const openMemberActions = (member: BEGroupMember) => {
    setSelectedMemberAction(member);
  };

  const highlightViewerImages = useMemo<ViewerImage[]>(() => {
    return stickies.flatMap(sticky => {
      const media = (sticky as any).media;

      if (!media) return [];

      const mediaItems = Array.isArray(media) ? media : [media];

      return mediaItems
        .filter(item => !!(item.mediaUrl || item.uri))
        .map(item => {
          const viewerType: 'image' | 'video' =
            item.mediaType === 'video' || item.type === 'video' ? 'video' : 'image';

          return {
            id: `${sticky.id}_${item.mediaUrl || item.uri}`,
            uri: item.mediaUrl || item.uri,
            type: viewerType,
            thumbnailUrl: item.thumbnailUrl || item.thumbnailUri,
          };
        });
    });
  }, [stickies]);

  const galleryOnlyViewerImages = useMemo<ViewerImage[]>(() => {
    return galleryItems
      .filter(item => !!item.mediaUrl)
      .map(item => {
        const viewerType: 'image' | 'video' =
          item.mediaType === 'video' ? 'video' : 'image';

        return {
          id: item.id,
          uri: item.mediaUrl,
          type: viewerType,
          thumbnailUrl: item.thumbnailUrl,
        };
      });
  }, [galleryItems]);

  const galleryViewerImages = useMemo<ViewerImage[]>(() => {
    return [
      ...galleryOnlyViewerImages,
      ...highlightViewerImages,
    ];
  }, [galleryOnlyViewerImages, highlightViewerImages]);

  const spaceMarkListItems = useMemo(() => {
    return spaceMarkViews.map(view => ({
      itemType: 'mark' as const,
      id: view.milestone.id,
      view,
    }));
  }, [spaceMarkViews]);

  const mantleMarkViews = useMemo(() => {
    return spaceMarkViews
      .filter(view =>
        view.metadata.markPermissions.highlightApproved === true &&
        view.metadata.markPermissions.restricted !== true
      )
      .sort((a, b) => getMantleMarkTimestamp(b) - getMantleMarkTimestamp(a));
  }, [spaceMarkViews]);

  const leadMantleView = mantleMarkViews[0] ?? null;
  const supportingMantleViews = mantleMarkViews.slice(1, 4);
  const recapMantleViews = mantleMarkViews.slice(4);

  const legacyMarkViews = useMemo(() => {
    return spaceMarkViews
      .filter(view =>
        view.metadata.markPermissions.restricted !== true &&
        (
          view.metadata.savedToBook === true ||
          view.metadata.markPermissions.bookApproved === true
        )
      )
      .sort((a, b) => getMantleMarkTimestamp(b) - getMantleMarkTimestamp(a));
  }, [spaceMarkViews]);

  const leadLegacyView = legacyMarkViews[0] ?? null;
  const supportingLegacyViews = legacyMarkViews.slice(1, 4);
  const recapLegacyViews = legacyMarkViews.slice(4);

  if (!group) return (
    <SpaceDetailLoadingState theme={theme} />
  );

const deepLink = `https://beginningend.com/join/${group.inviteCode}`;
const canShowSchoolConsentSettings =
  isAdmin ||
  group.requiresGuardianConsent === true ||
  (schoolConsentSummary?.students ?? []).length > 0 ||
  !!schoolConsentSummary?.guardian;
const schoolConsentEnabled = isSchoolConsentSpace(group);
const schoolConsentNeedsCount = schoolConsentSummary?.needsConsentCount ?? 0;
const schoolConsentStatusLabel = schoolConsentEnabled
  ? schoolConsentNeedsCount > 0
    ? `${schoolConsentNeedsCount} need review`
    : 'Safeguards on'
  : 'Not enabled';

const sportsMantle = isSportsSpace(group);

const openRiverForMantle = (markId?: string) => {
  const targetMarkId = markId ?? mantleMarkViews[0]?.milestone.id;

  if (!targetMarkId) return;

  openMarkDetail(targetMarkId, 'mantle');
};

const openRiverForLegacy = (markId?: string) => {
  const targetMarkId = markId ?? legacyMarkViews[0]?.milestone.id;

  if (!targetMarkId) return;

  openMarkDetail(targetMarkId, 'legacy');
};

const renderMantleMarkCard = (
  view: LivingMarkView,
  variant: 'lead' | 'podium' | 'recap',
  index = 0
) => {
  const mark = view.milestone;
  const markText = getMilestoneText(mark);
  const markMedia = getMilestoneMediaItems(mark);
  const authorProfile = getSpaceMarkAuthorProfile(mark);
  const firstMedia = markMedia.find(item => item.type === 'image' || item.type === 'video');
  const mantleImageUri = getMantleMediaImageUri(firstMedia);
  const markDate = formatStickyDate(getMantleMarkTimestamp(view));

  if (variant === 'lead') {
    return (
      <TouchableOpacity
        key={`mantle_lead_${mark.id}`}
        style={[s.mantleFeatureCard, sportsMantle && s.mantleFeatureCardSports]}
        onPress={() => openRiverForMantle(mark.id)}
        activeOpacity={0.88}
      >
        <View style={s.mantleFeatureLabelRow}>
          <Text style={s.mantleFeatureLabel}>{sportsMantle ? 'Lead highlight' : 'Lead memory'}</Text>
          <Text style={s.mantleFeatureDate}>{markDate}</Text>
        </View>

        {mantleImageUri ? (
          <View style={s.mantleFeatureMediaFrame}>
            <Image
              source={{ uri: mantleImageUri }}
              style={s.mantleFeatureMediaImage}
              resizeMode="cover"
            />

            {firstMedia?.type === 'video' && (
              <View style={s.mantleVideoBadge}>
                <Text style={s.mantleVideoText}>Play</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.mantleFeatureTextFallback}>
            <Text style={s.mantleFeatureFallbackTitle} numberOfLines={3}>{markText.title}</Text>
          </View>
        )}

        <View style={s.mantleFeatureCopy}>
          <Text style={s.mantleFeatureTitle} numberOfLines={2}>{markText.title}</Text>
          {markText.body ? (
            <Text style={s.mantleFeatureBody} numberOfLines={3}>{markText.body}</Text>
          ) : null}
          <Text style={s.mantleFeatureMeta} numberOfLines={1}>
            {authorProfile.displayName}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  const isPodium = variant === 'podium';

  return (
    <TouchableOpacity
      key={`mantle_${variant}_${mark.id}`}
      style={isPodium ? s.mantlePodiumCard : s.mantleRecapCard}
      onPress={() => openRiverForMantle(mark.id)}
      activeOpacity={0.88}
    >
      <View style={isPodium ? s.mantlePodiumMediaWrap : s.mantleRecapMediaWrap}>
        {mantleImageUri ? (
          <Image
            source={{ uri: mantleImageUri }}
            style={s.mantleMiniMedia}
            resizeMode="cover"
          />
        ) : (
          <View style={s.mantleMiniFallback}>
            <Text style={s.mantleMiniFallbackLabel}>Mark</Text>
          </View>
        )}

        {isPodium && (
          <View style={s.mantlePodiumRank}>
            <Text style={s.mantlePodiumRankText}>{index + 2}</Text>
          </View>
        )}

        {firstMedia?.type === 'video' && (
          <View style={s.mantleVideoBadge}>
            <Text style={s.mantleVideoText}>Play</Text>
          </View>
        )}
      </View>

      <View style={isPodium ? s.mantlePodiumCopy : s.mantleRecapCopy}>
        <Text style={isPodium ? s.mantlePodiumTitle : s.mantleRecapTitle} numberOfLines={2}>
          {markText.title}
        </Text>
        <Text style={s.mantleCardMeta} numberOfLines={1}>
          {authorProfile.displayName} - {markDate}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const openViewerForGalleryItem = (mediaUrl: string) => {
  setActiveViewerImages(galleryOnlyViewerImages);
  setSelectedGalleryImage(mediaUrl);
};

const openSpaceChat = () => {
  selectSpaceTab('chat');
};

const toggleFavoriteSpace = async () => {
  if (!group?.id) return;

  const isFavorite = favoriteSpaceIds.includes(group.id);
  const nextFavoriteIds = isFavorite
    ? favoriteSpaceIds.filter(spaceId => spaceId !== group.id)
    : [group.id, ...favoriteSpaceIds.filter(spaceId => spaceId !== group.id)].slice(0, 5);

  setFavoriteSpaceIds(nextFavoriteIds);

  try {
    await AsyncStorage.setItem(SPACE_FAVORITES_KEY, JSON.stringify(nextFavoriteIds));
  } catch (error) {
    console.warn('[Space Detail] failed to save favorite Space:', error);
  }
};

const handleSpaceDetailBack = () => {
  if (editingGroupRelay) {
    setEditingGroupRelay(false);
    return;
  }

  if (spaceSettingsRelayOpen) {
    setSpaceSettingsRelayOpen(false);
    return;
  }

  if (showInvite) {
    setShowInvite(false);
    setShowSpaceSettingsMenu(true);
    return;
  }

  if (showSpaceSettingsMenu) {
    closeSpacePanels();
    return;
  }

  router.replace('/(tabs)/messages' as any);
};

const spaceRelayLabel =
  (group.relayMode ?? 'default') === 'default'
    ? 'bE Relay'
    : group.relayMode === 'custom'
      ? 'Space Relay'
      : 'Both';
const spaceCategoryLabel = group.sport
  ? group.sport.charAt(0).toUpperCase() + group.sport.slice(1)
  : 'No badge';
const spaceCategoryIcon = getGroupTypeIcon(group);
const spaceHomeMeta = [
  `${members.length} ${members.length === 1 ? 'member' : 'members'}`,
  group.season,
].filter(Boolean).join(' • ');
const isFavoriteSpace = favoriteSpaceIds.includes(group.id);
const shouldLiftSpaceChatTray =
  spaceKeyboardHeight > 0 &&
  (
    (tab === 'chat' && !showSpaceSettingsMenu && !showInvite && !editingGroupRelay) ||
    editingGroupRelay
  );
const liftedSpaceChatTrayStyle = shouldLiftSpaceChatTray
  ? {
      top: Platform.OS === 'ios' ? 78 : 72,
      bottom: Math.max(spaceKeyboardHeight + (Platform.OS === 'ios' ? 10 : 6), 6),
    }
  : null;
const relaySettingsCard = (
  <View style={s.groupRelayCard}>
    <View style={s.groupRelayHeader}>
      <View style={{ flex: 1 }}>
        <Text style={s.groupRelayTitle}>Space Relay</Text>
        <Text style={s.groupRelayHint}>
          Choose where Space messages, media, and Marks are saved.
        </Text>
      </View>

      <View style={s.groupRelayHeaderActions}>
        {isAdmin && !editingGroupRelay && (
          <TouchableOpacity onPress={openGroupRelayEditor} activeOpacity={0.85}>
            <Text style={s.groupRelayManage}>Manage</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => {
            setEditingGroupRelay(false);
            setSpaceSettingsRelayOpen(false);
          }}
          activeOpacity={0.85}
        >
          <Text style={s.groupRelayManage}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>

    {!editingGroupRelay ? (
      <View style={s.groupRelaySummary}>
        <Text style={s.groupRelaySummaryLabel}>Current setting</Text>
        <Text style={s.groupRelaySummaryValue}>{spaceRelayLabel}</Text>
        <Text style={s.groupRelayUrlText} numberOfLines={1}>
          {group.relayUrl || DEFAULT_RELAY}
        </Text>
        {!isAdmin && (
          <Text style={s.groupRelayReadOnly}>
            Space admins manage relay routing.
          </Text>
        )}
      </View>
    ) : (
      <View>
        <Text style={s.inputLabel}>WHERE SHOULD THIS SPACE SAVE?</Text>

        <TouchableOpacity
          style={[
            s.groupRelayOption,
            groupRelayMode === 'default' && s.groupRelayOptionActive,
          ]}
          onPress={() => setGroupRelayMode('default')}
          activeOpacity={0.85}
        >
          <Text style={s.groupRelayOptionTitle}>bE Relay</Text>
          <Text style={s.groupRelayOptionHint}>Easiest setup. Works automatically.</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            s.groupRelayOption,
            groupRelayMode === 'custom' && s.groupRelayOptionActive,
          ]}
          onPress={() => setGroupRelayMode('custom')}
          activeOpacity={0.85}
        >
          <Text style={s.groupRelayOptionTitle}>Space / School Relay</Text>
          <Text style={s.groupRelayOptionHint}>Use a private relay for this Space.</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            s.groupRelayOption,
            groupRelayMode === 'both' && s.groupRelayOptionActive,
          ]}
          onPress={() => setGroupRelayMode('both')}
          activeOpacity={0.85}
        >
          <Text style={s.groupRelayOptionTitle}>Both</Text>
          <Text style={s.groupRelayOptionHint}>Save to bE and the Space relay.</Text>
        </TouchableOpacity>

        {(groupRelayMode === 'custom' || groupRelayMode === 'both') && (
          <>
            <Text style={s.inputLabel}>SPACE RELAY URL</Text>
            <TextInput
              style={s.input}
              value={groupRelayUrl}
              onChangeText={setGroupRelayUrl}
              placeholder="wss://relay.school.org"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              keyboardType="url"
            />
          </>
        )}

        <Text style={s.inputLabel}>BACKUP RELAYS</Text>
        <TextInput
          style={[s.input, { minHeight: 86, textAlignVertical: 'top' }]}
          value={groupBackupRelayInput}
          onChangeText={setGroupBackupRelayInput}
          placeholder={`wss://relay.beginningend.com\nwss://relay.family.example`}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          keyboardType="url"
          multiline
        />
        <Text style={s.groupRelayHint}>
          Add one relay per line. Space metadata will be mirrored to these relays for redundancy.
        </Text>

        <View style={s.modalActions}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => setEditingGroupRelay(false)}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.confirmBtn}
            onPress={saveGroupRelaySettings}
            activeOpacity={0.85}
          >
            <Text style={s.confirmText}>Save relay</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}
  </View>
);

  return (
    <SafeAreaView style={s.safe}>

      <View style={s.spaceProfileHero}>
        {group.coverImage ? (
          <Image source={{ uri: group.coverImage }} style={s.spaceProfileImage} />
        ) : (
          <View style={s.spaceProfileFallback}>
            <Text style={s.spaceProfileFallbackText}>{getGroupAvatarText(group)}</Text>
          </View>
        )}

        <View style={s.spaceProfileShade} />

        <View style={s.spaceProfileTopControls}>
          <TouchableOpacity
            onPress={handleSpaceDetailBack}
            style={s.spaceChromeBtn}
            activeOpacity={0.82}
          >
            <Text style={s.spaceChromeText}>Back</Text>
          </TouchableOpacity>

          <View style={s.spaceProfileTopRight}>
            <TouchableOpacity
              onPress={toggleFavoriteSpace}
              style={[s.spaceChromeIconBtn, isFavoriteSpace && s.spaceChromeIconBtnActive]}
              activeOpacity={0.82}
            >
              <Ionicons
                name={isFavoriteSpace ? 'star' : 'star-outline'}
                size={20}
                color={isFavoriteSpace ? theme.bg : '#fff'}
              />
            </TouchableOpacity>
          </View>
        </View>

      </View>

      <View style={[s.spaceContentTray, liftedSpaceChatTrayStyle]}>
        <SpaceTrayHeader
          title={group.name}
          meta={spaceHomeMeta}
          activeTab={tab}
          theme={theme}
          onOpenControls={openSpaceControlCenter}
          onSelectTab={nextTab => selectSpaceTab(nextTab)}
        />

      {/* Header control center and invite panels */}
      {showSpaceSettingsMenu && (
        <ScrollView
          style={s.spaceSettingsPanelScroll}
          contentContainerStyle={s.spaceSettingsPanelContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.spaceSettingsDropdown}>
            <View style={s.spaceSettingsTop}>
              <View style={s.spaceSettingsAvatar}>
                {group.coverImage ? (
                  <Image source={{ uri: group.coverImage }} style={s.spaceSettingsAvatarImage} />
                ) : (
                  <Text style={s.spaceSettingsAvatarText}>{getGroupAvatarText(group)}</Text>
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.spaceSettingsTitle}>Space Control Center</Text>
                <Text style={s.spaceSettingsHint} numberOfLines={2}>
                  {group.name} - manage people, safety, sharing, files, and relay routing.
                </Text>
              </View>

              <TouchableOpacity
                style={s.spaceSettingsDoneBtn}
                onPress={closeSpacePanels}
                activeOpacity={0.85}
              >
                <Text style={s.spaceSettingsDoneText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={s.spaceSettingsChips}>
              <Text style={s.spaceSettingsChip}>{members.length} members</Text>
              <Text style={s.spaceSettingsChip}>{spaceMarkViews.length} Marks</Text>
              <Text style={s.spaceSettingsChip}>
                {spaceCategoryIcon ? `${spaceCategoryIcon} ${spaceCategoryLabel}` : spaceCategoryLabel}
              </Text>
              <Text style={s.spaceSettingsChip}>{upcomingCount} events</Text>
              <Text style={s.spaceSettingsChip}>{spaceRelayLabel}</Text>
            </View>

            <TouchableOpacity
              style={s.spaceSettingsRow}
              onPress={() => {
                selectSpaceTab('members');
              }}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.spaceSettingsRowTitle}>Members</Text>
                <Text style={s.spaceSettingsRowHint}>View members, roles, contacts, and member actions.</Text>
              </View>
              <Text style={s.spaceSettingsRowAction}>Open</Text>
            </TouchableOpacity>

            {canShowSchoolConsentSettings && (
              <>
                <TouchableOpacity
                  style={s.spaceSettingsRow}
                  onPress={() => setSpaceSettingsConsentOpen(prev => !prev)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.spaceSettingsRowTitle}>Safety & Consent</Text>
                    <Text style={s.spaceSettingsRowHint}>
                      Manage child profiles, guardian consent, and school-safe defaults.
                    </Text>
                  </View>
                  <Text style={s.spaceSettingsRowAction}>
                    {spaceSettingsConsentOpen ? 'Hide' : schoolConsentStatusLabel}
                  </Text>
                </TouchableOpacity>

                {spaceSettingsConsentOpen && (
                  <View style={s.schoolConsentPanel}>
                    <View style={s.schoolConsentHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.schoolConsentTitle}>School-safe settings</Text>
                        <Text style={s.schoolConsentHint}>
                          Hybrid mode lets the school authorize the Space while guardians control child-specific media use.
                        </Text>
                      </View>
                      <Text style={s.schoolConsentBadge}>{schoolConsentEnabled ? 'Hybrid' : 'Off'}</Text>
                    </View>

                    {!schoolConsentEnabled ? (
                      <TouchableOpacity
                        style={[s.schoolConsentPrimaryBtn, !isAdmin && s.schoolConsentDisabled]}
                        onPress={enableSchoolConsentDefaults}
                        disabled={!isAdmin}
                        activeOpacity={0.85}
                      >
                        <Text style={s.schoolConsentPrimaryText}>
                          {isAdmin ? 'Enable school safeguards' : 'Admin setup required'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <>
                        <View style={s.schoolConsentPolicyGrid}>
                          <TouchableOpacity
                            style={s.schoolConsentPolicyCard}
                            onPress={toggleSchoolMinorPolicy}
                            disabled={!isAdmin}
                            activeOpacity={0.85}
                          >
                            <Text style={s.schoolConsentPolicyLabel}>Minor default</Text>
                            <Text style={s.schoolConsentPolicyValue}>
                              {group.defaultMinorMarkPolicy === 'privateSpaceOnly' ? 'Private Space' : 'Restricted'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={s.schoolConsentPolicyCard}
                            onPress={toggleDirectoryInfoAllowed}
                            disabled={!isAdmin}
                            activeOpacity={0.85}
                          >
                            <Text style={s.schoolConsentPolicyLabel}>Directory info</Text>
                            <Text style={s.schoolConsentPolicyValue}>
                              {group.directoryInfoAllowed ? 'Allowed' : 'Off'}
                            </Text>
                          </TouchableOpacity>
                        </View>

                        <Text style={s.schoolConsentSectionLabel}>My Children</Text>
                        {(schoolConsentSummary?.students ?? []).length === 0 ? (
                          <Text style={s.schoolConsentEmpty}>No child profiles linked yet.</Text>
                        ) : (
                          <View style={s.schoolConsentChildList}>
                            {(schoolConsentSummary?.students ?? []).map(student => (
                              <View key={student.id} style={s.schoolConsentChildCard}>
                                <View style={{ flex: 1 }}>
                                  <Text style={s.schoolConsentChildName}>{student.displayName}</Text>
                                  <Text style={s.schoolConsentChildMeta}>
                                    {student.under13 ? 'Under 13' : '13+'}
                                    {student.grade ? ` - ${student.grade}` : ''}
                                    {student.consentStatus === 'granted' ? ' - consent on file' : ' - consent needed'}
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  style={s.schoolConsentRevokeBtn}
                                  onPress={() => revokeStudentConsent(student.id)}
                                  activeOpacity={0.85}
                                >
                                  <Text style={s.schoolConsentRevokeText}>Restrict</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        )}

                        <Text style={s.schoolConsentSectionLabel}>Add or Update Child</Text>
                        <TextInput
                          style={s.schoolConsentInput}
                          value={childNameInput}
                          onChangeText={setChildNameInput}
                          placeholder="Child / student name"
                          placeholderTextColor={theme.textMuted}
                        />
                        <TextInput
                          style={s.schoolConsentInput}
                          value={childGradeInput}
                          onChangeText={setChildGradeInput}
                          placeholder="Grade, class, or team"
                          placeholderTextColor={theme.textMuted}
                        />

                        <View style={s.schoolConsentToggleGrid}>
                          {[
                            { label: 'Under 13', active: childUnder13, onPress: () => setChildUnder13(prev => !prev) },
                            { label: 'Media', active: childConsentMedia, onPress: () => setChildConsentMedia(prev => !prev) },
                            { label: 'Name', active: childConsentName, onPress: () => setChildConsentName(prev => !prev) },
                            { label: 'Mantle', active: childConsentMantle, onPress: () => setChildConsentMantle(prev => !prev) },
                            { label: 'Legacy', active: childConsentLegacy, onPress: () => setChildConsentLegacy(prev => !prev) },
                          ].map(option => (
                            <TouchableOpacity
                              key={option.label}
                              style={[s.schoolConsentToggle, option.active && s.schoolConsentToggleActive]}
                              onPress={option.onPress}
                              activeOpacity={0.85}
                            >
                              <Text style={[s.schoolConsentToggleText, option.active && s.schoolConsentToggleTextActive]}>
                                {option.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>

                        <TouchableOpacity
                          style={[s.schoolConsentPrimaryBtn, savingSchoolConsent && s.schoolConsentDisabled]}
                          onPress={saveChildConsentProfile}
                          disabled={savingSchoolConsent}
                          activeOpacity={0.85}
                        >
                          <Text style={s.schoolConsentPrimaryText}>
                            {savingSchoolConsent ? 'Saving...' : 'Save consent settings'}
                          </Text>
                        </TouchableOpacity>

                        <Text style={s.schoolConsentNotice}>
                          Notice version: {group.consentNoticeVersion ?? SCHOOL_CONSENT_NOTICE_VERSION}
                        </Text>
                      </>
                    )}
                  </View>
                )}
              </>
            )}

            <TouchableOpacity
              style={s.spaceSettingsRow}
              onPress={() => {
                selectSpaceTab('gallery');
              }}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.spaceSettingsRowTitle}>Files and Gallery</Text>
                <Text style={s.spaceSettingsRowHint}>Open shared photos, videos, highlights, and Space media.</Text>
              </View>
              <Text style={s.spaceSettingsRowAction}>Open</Text>
            </TouchableOpacity>

            {isAdmin && (
              <TouchableOpacity
                style={s.spaceSettingsRow}
                onPress={() => {
                  setShowSpaceSettingsMenu(false);
                  setSpaceSettingsRelayOpen(false);
                  setEditingGroupRelay(false);
                  setShowInvite(true);
                }}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.spaceSettingsRowTitle}>Invite and Share</Text>
                  <Text style={s.spaceSettingsRowHint}>Show the invite code, QR code, copy link, or share this Space.</Text>
                </View>
                <Text style={s.spaceSettingsRowAction}>Open</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={s.spaceSettingsRow}
              onPress={() => setSpaceSettingsRelayOpen(prev => !prev)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.spaceSettingsRowTitle}>Relay Routing</Text>
                <Text style={s.spaceSettingsRowHint}>Choose where this Space saves messages, media, and Marks.</Text>
              </View>
              <Text style={s.spaceSettingsRowAction}>{spaceSettingsRelayOpen ? 'Hide' : spaceRelayLabel}</Text>
            </TouchableOpacity>

            {spaceSettingsRelayOpen && relaySettingsCard}

            {(isAdmin || canLeaveGroup) && (
              <View style={s.spaceSettingsDangerGroup}>
                {isAdmin && (
                  <TouchableOpacity
                    style={s.spaceSettingsDangerRow}
                    onPress={() => {
                      closeSpaceSettingsMenu();
                      handleArchive();
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={s.spaceSettingsDangerText}>Archive Space</Text>
                  </TouchableOpacity>
                )}

                {canLeaveGroup && (
                  <TouchableOpacity
                    style={s.spaceSettingsDangerRow}
                    onPress={() => {
                      closeSpaceSettingsMenu();
                      handleLeaveGroup();
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={s.spaceSettingsDangerText}>Leave Space</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {showInvite && isAdmin && (
        <ScrollView
          style={s.spaceSettingsPanelScroll}
          contentContainerStyle={s.spaceSettingsPanelContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={s.invitePanel}>
          <View style={s.invitePanelHeader}>
            <TouchableOpacity
              style={s.invitePanelHeaderBtn}
              onPress={() => {
                setShowInvite(false);
                setShowSpaceSettingsMenu(true);
              }}
              activeOpacity={0.85}
            >
              <Text style={s.invitePanelHeaderAction}>Settings</Text>
            </TouchableOpacity>

            <Text style={s.invitePanelTitle}>Invite and Share</Text>

            <TouchableOpacity
              style={s.invitePanelHeaderBtn}
              onPress={closeSpacePanels}
              activeOpacity={0.85}
            >
              <Text style={s.invitePanelHeaderAction}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={s.invitePanelTop}>
            <View style={s.inviteCodeBlock}>
              <Text style={s.inviteCodeLabel}>INVITE CODE</Text>
              <Text style={s.inviteCode}>{group.inviteCode}</Text>
              <View style={s.inviteCodeActions}>
                <TouchableOpacity style={s.inviteCodeBtn} onPress={handleCopyCode}>
                  <Text style={s.inviteCodeBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.inviteCodeBtn} onPress={handleShareInvite}>
                  <Text style={s.inviteCodeBtnText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.inviteCodeBtn, s.inviteCodeBtnDanger]} onPress={handleRegenerateCode}>
                  <Text style={[s.inviteCodeBtnText, { color: '#c00' }]}>Regenerate</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={s.qrBlock}>
<QRCode
  value={deepLink}
  size={100}
  backgroundColor={theme.surface}
  color={theme.gold}
/>
            </View>
          </View>
          <Text style={s.inviteMeta}>
            Members scan the QR or enter the code in Spaces. Regenerate if it gets shared with the wrong people.
          </Text>
        </View>
        </ScrollView>
      )}

      <View style={[
        s.spaceTrayBody,
        (showSpaceSettingsMenu || showInvite || editingGroupRelay) && s.spaceTrayBodyHidden,
      ]}>

      {tab === 'overview' && (
        <View style={s.spaceTabPanel}>
          <ScrollView
            style={s.spaceTabScroll}
            contentContainerStyle={s.overviewPageContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.gold} />}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.overviewHeroCard}>
              <Text style={s.overviewHeroKicker}>About this Space</Text>

              <Text style={s.overviewHeroTeaching} numberOfLines={5}>
                {group.description || 'No description has been added for this Space yet.'}
              </Text>
            </View>

              <View style={s.overviewFlowCard}>
                <View style={s.overviewFlowHeader}>
                <Text style={s.overviewFlowKicker}>Space tools</Text>
                <Text style={s.overviewFlowTitle}>Talk now. Capture memories. Build the story.</Text>
              </View>

              <View style={s.overviewFlowGrid}>
                <TouchableOpacity
                  style={s.overviewFlowItem}
                  onPress={() => selectSpaceTab('chat')}
                  activeOpacity={0.86}
                >
                  <View style={s.overviewFlowIcon}>
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.textSecondary} />
                  </View>
                  <Text style={s.overviewFlowAction}>Talk</Text>
                  <Text style={s.overviewFlowName}>Chat</Text>
                  <Text style={s.overviewFlowHint}>Share updates, quick plans, and daily conversation inside this Space.</Text>
                  <Text style={s.overviewFlowCount}>{chatMessageCount}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.overviewFlowItem}
                  onPress={() => openUnifiedMarkComposer('overview')}
                  activeOpacity={0.86}
                >

                  <View style={s.overviewFlowIcon}>
                    <Ionicons name="add-circle-outline" size={19} color={theme.textSecondary} />
                  </View>
                  <Text style={s.overviewFlowAction}>Add</Text>
                  <Text style={s.overviewFlowName}>Mark</Text>
                  <Text style={s.overviewFlowHint}>Capture a photo, video, voice note, or memory into this Space.</Text>
                  <Text style={s.overviewFlowCount}>{spaceMarkViews.length}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.overviewFlowItem}
                  onPress={() => selectSpaceTab('calendar')}
                  activeOpacity={0.86}
                >
                  <View style={s.overviewFlowIcon}>
                    <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} />
                  </View>
                  <Text style={s.overviewFlowAction}>Plan</Text>
                  <Text style={s.overviewFlowName}>Events</Text>
                  <Text style={s.overviewFlowHint}>Track games, meetings, dates, trips, ceremonies, and RSVP details.</Text>
                  <Text style={s.overviewFlowCount}>{upcomingCount}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.overviewFlowItem}
                  onPress={() => selectSpaceTab('mantle')}
                  activeOpacity={0.86}
                >
                  <View style={s.overviewFlowIcon}>
                    <Ionicons name="sparkles-outline" size={18} color={theme.textSecondary} />
                  </View>
                  <Text style={s.overviewFlowAction}>Feature</Text>
                  <Text style={s.overviewFlowName}>Mantle</Text>
                  <Text style={s.overviewFlowHint}>Showcase the best approved highlights from this Space.</Text>
                  <Text style={s.overviewFlowCount}>{mantleMarkViews.length}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.overviewFlowItem}
                  onPress={() => selectSpaceTab('legacy')}
                  activeOpacity={0.86}
                >
                  <View style={s.overviewFlowIcon}>
                    <Ionicons name="albums-outline" size={18} color={theme.textSecondary} />
                  </View>
                  <Text style={s.overviewFlowAction}>Save</Text>
                  <Text style={s.overviewFlowName}>Legacy</Text>
                  <Text style={s.overviewFlowHint}>Keep the important Marks for the season, year, or long-term story.</Text>
                  <Text style={s.overviewFlowCount}>{legacyMarkViews.length}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.overviewFlowItem}
                  onPress={() => selectSpaceTab('book')}
                  activeOpacity={0.86}
                >
                  <View style={s.overviewFlowIcon}>
                    <Ionicons name="book-outline" size={18} color={theme.textSecondary} />
                  </View>
                  <Text style={s.overviewFlowAction}>Print</Text>
                  <Text style={s.overviewFlowName}>Book</Text>
                  <Text style={s.overviewFlowHint}>Turn the best season, class, family, or group memories into a lasting book.</Text>
                  <Text style={s.overviewFlowCount}>{group.bookEnabled === true ? 'On' : legacyMarkViews.length}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {sportsMantle ? (
              <View style={s.overviewSportsPulseCard}>
                <View style={s.overviewSportsPulseTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.overviewSportsPulseKicker}>Season pulse</Text>
                    <Text style={s.overviewSportsPulseTitle} numberOfLines={1}>
                      {group.season || 'Current season'}
                    </Text>
                  </View>

                  <View style={s.overviewSportsPulseBadge}>
                    <Ionicons name="trophy-outline" size={15} color={theme.bg} />
                    <Text style={s.overviewSportsPulseBadgeText}>Team</Text>
                  </View>
                </View>

                <View style={s.overviewSportsPulseGrid}>
                  <View style={s.overviewSportsPulseStat}>
                    <Text style={s.overviewSportsPulseValue}>{spaceMarkViews.length}</Text>
                    <Text style={s.overviewSportsPulseLabel}>Marks</Text>
                  </View>

                  <View style={s.overviewSportsPulseStat}>
                    <Text style={s.overviewSportsPulseValue}>{galleryItems.length}</Text>
                    <Text style={s.overviewSportsPulseLabel}>Media</Text>
                  </View>

                  <View style={s.overviewSportsPulseStat}>
                    <Text style={s.overviewSportsPulseValue}>{upcomingCount}</Text>
                    <Text style={s.overviewSportsPulseLabel}>Upcoming</Text>
                  </View>

                  <View style={s.overviewSportsPulseStat}>
                    <Text style={s.overviewSportsPulseValue}>{members.length}</Text>
                    <Text style={s.overviewSportsPulseLabel}>Members</Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={s.overviewSnapshotCard}>
                <View style={s.overviewSnapshotHeader}>
                  <Text style={s.overviewSnapshotKicker}>At a glance</Text>
                  <Text style={s.overviewSnapshotTitle}>Current Space snapshot</Text>
                </View>

                <View style={s.overviewSnapshotGrid}>
                  <View style={s.overviewSnapshotItem}>
                    <Text style={s.overviewSnapshotValue}>{spaceMarkViews.length}</Text>
                    <Text style={s.overviewSnapshotLabel}>
                      {spaceMarkViews.length === 1 ? 'Mark' : 'Marks'}
                    </Text>
                  </View>

                  <View style={s.overviewSnapshotItem}>
                    <Text style={s.overviewSnapshotValue}>{members.length}</Text>
                    <Text style={s.overviewSnapshotLabel}>
                      {members.length === 1 ? 'Member' : 'Members'}
                    </Text>
                  </View>

                  <View style={s.overviewSnapshotItem}>
                    <Text style={s.overviewSnapshotValue}>{galleryItems.length}</Text>
                    <Text style={s.overviewSnapshotLabel}>Media</Text>
                  </View>

                  <View style={s.overviewSnapshotItem}>
                    <Text style={s.overviewSnapshotValue} numberOfLines={1}>
                      {group.bookEnabled === true ? 'On' : spaceRelayLabel}
                    </Text>
                    <Text style={s.overviewSnapshotLabel}>
                      {group.bookEnabled === true ? 'Book' : 'Relay'}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      )}



      {tab === 'chat' && (
        <View style={s.spaceTabPanel}>
          <GroupChatPanel
            groupId={group.id}
            variant="inline"
            onMediaMessagesChanged={refreshLocalGalleryFromCache}
          />
        </View>
      )}

      {tab === 'mantle' && (
        <View style={s.spaceTabPanel}>
          <ScrollView
            style={s.spaceTabScroll}
            contentContainerStyle={s.mantlePageContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.gold} />}
          >
            <View style={[s.mantleCompactHeader, sportsMantle && s.mantleCompactHeaderSports]}>
              <View style={s.mantleCompactTopRow}>
                <View style={s.mantleCompactBadge}>
                  <Text style={s.mantleCompactBadgeText}>
                    {spaceCategoryIcon ? `${spaceCategoryIcon} ` : ''}{sportsMantle ? 'Trophy case' : 'Living collage'}
                  </Text>
                </View>
                <Text style={s.mantleCompactCount}>
                  {mantleMarkViews.length} {mantleMarkViews.length === 1 ? 'Mark' : 'Marks'}
                </Text>
              </View>
              <Text style={s.mantleCompactTitle} numberOfLines={2}>
                {sportsMantle ? `${group.name} Showcase` : `${group.name} Mantle`}
              </Text>
              <Text style={s.mantleCompactSubtitle} numberOfLines={2}>
                Approved highlights from this Space.
              </Text>
              <TouchableOpacity
                style={[
                  s.mantleRiverButton,
                  mantleMarkViews.length === 0 && s.mantleRiverButtonDisabled,
                ]}
                onPress={() => openRiverForMantle()}
                disabled={mantleMarkViews.length === 0}
                activeOpacity={0.86}
              >
                <View style={s.mantleRiverIconWrap}>
                  <Ionicons name="play" size={13} color={theme.bg} />
                </View>
                <Text style={s.mantleRiverButtonText}>Open Lead Mark</Text>
              </TouchableOpacity>
            </View>

            {leadMantleView ? (
              <>
                {renderMantleMarkCard(leadMantleView, 'lead')}

                {supportingMantleViews.length > 0 && (
                  <View style={s.mantlePodiumSection}>
                    <View style={s.mantleSectionHeader}>
                      <Text style={s.mantleSectionKicker}>
                        {sportsMantle ? 'Top moments' : 'Featured memories'}
                      </Text>
                      <Text style={s.mantleSectionTitle}>
                        {sportsMantle ? 'The showcase stand' : 'The collage wall'}
                      </Text>
                    </View>
                    <View style={s.mantlePodiumGrid}>
                      {supportingMantleViews.map((view, index) => renderMantleMarkCard(view, 'podium', index))}
                    </View>
                  </View>
                )}

                {recapMantleViews.length > 0 && (
                  <View style={s.mantleRecapSection}>
                    <View style={s.mantleSectionHeader}>
                      <Text style={s.mantleSectionKicker}>Recap</Text>
                      <Text style={s.mantleSectionTitle}>More from this stretch</Text>
                    </View>
                    <View style={s.mantleRecapGrid}>
                      {recapMantleViews.map((view, index) => renderMantleMarkCard(view, 'recap', index))}
                    </View>
                  </View>
                )}
              </>
            ) : (
              <SpaceEmptyState
                theme={theme}
                icon="M"
                title="No Mantle highlights yet"
                hint="Approved, unrestricted Marks will appear here."
              />
            )}
          </ScrollView>
        </View>
      )}

      {/* Stickies tab */}
      {tab === 'stickies' && (
        <View style={s.spaceTabPanel}>
          <FlatList<any>
            style={s.spaceTabList}
            data={spaceMarkListItems}
            keyExtractor={item => `${item.itemType}_${item.id}`}
            contentContainerStyle={s.timelineContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.gold}
              />
            }
            initialNumToRender={4}
            maxToRenderPerBatch={4}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            viewabilityConfig={spaceMarksViewabilityConfigRef.current}
            onViewableItemsChanged={spaceMarksViewabilityRef.current}
            ListHeaderComponent={
              group.status === 'archived' ? (
                <SpaceArchivedBanner
                  theme={theme}
                  message="📦 This Space is archived. Marks can still be viewed."
                />
              ) : null
            }
            ListEmptyComponent={
              <SpaceEmptyState
                theme={theme}
                icon="📌"
                title="No Marks yet"
                hint="Members can add Marks, memories, media, or important notes here."
              />
            }
            renderItem={({ item }) => {
              if (item.itemType === 'sticky') {
                const sticky = item.sticky as GroupSticky;

                return (
                  <SpaceStickyHighlightCard
                    sticky={sticky}
                    theme={theme}
                    isAdmin={isAdmin}
                    createdAtLabel={formatStickyDate(sticky.createdAt)}
                    onDelete={() => handleDeleteSticky(sticky)}
                    onPressMedia={(index) => openViewerForSticky(sticky, index)}
                    onOpenFile={handleOpenHighlightFile}
                  />
                );
              }

              const view = item.view as LivingMarkView;
              const mark = view.milestone;
              const markText = getMilestoneText(mark);
              const markMedia = getMilestoneMediaItems(mark);
              const authorProfile = getSpaceMarkAuthorProfile(mark);
              const isLiftUpMark = mark.tags.some(tag => tag.toLowerCase() === LIFT_UP_TAG.toLowerCase());
              const markPeople = view.metadata.people.filter(person => person.role !== 'author');
              const markPeopleLabel = markPeople.map(person => getPersonDisplayName(person)).join(', ');
              const placeLabel =
                view.metadata.place?.name ||
                (view.metadata.place?.latitude !== undefined && view.metadata.place?.longitude !== undefined
                  ? `${view.metadata.place.latitude.toFixed(2)}, ${view.metadata.place.longitude.toFixed(2)}`
                  : undefined);
              const eventLabel =
                view.metadata.eventTitle ||
                (view.metadata.eventId?.startsWith('cal_')
                  ? calendarEventTitles[view.metadata.eventId]
                  : view.metadata.eventId);
              const contextLabels = [
                view.metadata.lifeStage,
                eventLabel,
                placeLabel,
                view.metadata.savedToBook ? 'Legacy' : null,
              ].filter(Boolean) as string[];
              const permissionLabels = [
                view.metadata.markPermissions.guardianConsentNeeded ? { label: 'Consent needed', tone: 'danger' as const } : null,
                view.metadata.markPermissions.restricted ? { label: 'Restricted', tone: 'danger' as const } : null,
                view.metadata.markPermissions.highlightApproved && !view.metadata.markPermissions.restricted
                  ? { label: 'Mantle', tone: 'gold' as const }
                  : null,
                view.metadata.markPermissions.bookApproved && !view.metadata.markPermissions.restricted
                  ? { label: 'Legacy', tone: 'gold' as const }
                  : null,
                view.metadata.markPermissions.privateSpaceOnly ? { label: 'Private Space', tone: 'neutral' as const } : null,
              ].filter(Boolean) as { label: string; tone: 'danger' | 'gold' | 'neutral' }[];
              const markDateLabel = formatStickyDate(mark.createdAt);
              const markScopeLabel = view.metadata.privacy === 'space'
                ? 'Space'
                : view.metadata.privacy;

              const markMeta = [
                `Logged by ${authorProfile.displayName}`,
                markDateLabel,
                markScopeLabel,
              ].filter(Boolean).join(' - ');

              const allTagLabels = Array.from(new Set(
                [
                  ...markPeople.map(person =>
                    isLiftUpMark
                      ? `For: ${getPersonDisplayName(person)}`
                      : getPersonDisplayName(person)
                  ),
                  ...contextLabels,
                  ...permissionLabels.map(permission => permission.label),
                  ...mark.tags,
                ]
                  .map(label => label?.trim())
                  .filter((label): label is string => !!label)
              ));

              const visibleTagLabels = allTagLabels.slice(0, 2);
              const hiddenTagCount = Math.max(0, allTagLabels.length - visibleTagLabels.length);

              return (
                <TouchableOpacity
                  style={[
                    s.spaceMarkCard,
                    markMedia.length > 0 && s.spaceMarkCardImmersive,
                  ]}
                  onPress={markMedia.length > 0 ? undefined : () => openMarkDetail(mark.id)}
                  activeOpacity={0.86}
                >
                  {markMedia.length > 0 ? (
                    <View style={s.spaceMarkImmersiveMediaFrame}>
                      <MediaCollage
                        media={markMedia}
                        fitMode="cover"
                        fixedHeight={460}
                        autoPlayVideos
                        playVideos={
                          tab === 'stickies' &&
                          !selectedGalleryImage &&
                          !showSpaceSettingsMenu &&
                          !showInvite &&
                          !editingGroupRelay &&
                          activeSpaceVideoMarkId === mark.id
                        }
                        videoMuted
                        videoLoop
                        onPressMedia={(index) => openViewerForMilestone(mark, index)}
                      />

                      <View pointerEvents="none" style={s.spaceMarkOverlayTop}>
                        <View style={s.spaceMarkOverlayAuthor}>
                          <View style={s.spaceMarkOverlayAvatar}>
                            {authorProfile.avatarUrl ? (
                              <Image source={{ uri: authorProfile.avatarUrl }} style={s.spaceMarkOverlayAvatarImage} />
                            ) : (
                              <Text style={s.spaceMarkOverlayAvatarText}>{authorProfile.initials}</Text>
                            )}
                          </View>

                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={s.spaceMarkOverlayAuthorName} numberOfLines={1}>
                              {authorProfile.displayName}
                            </Text>
                            <Text style={s.spaceMarkOverlayMeta} numberOfLines={1}>
                              {markDateLabel}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={s.spaceMarkOverlayBottom}
                        onPress={() => openMarkDetail(mark.id)}
                        activeOpacity={0.9}
                      >
                        <Text style={s.spaceMarkOverlayTitle} numberOfLines={2}>
                          {markText.title}
                        </Text>

                        {markText.body ? (
                          <Text style={s.spaceMarkOverlayBody} numberOfLines={1}>
                            {markText.body}
                          </Text>
                        ) : null}

                        {(allTagLabels.length > 0 || isLiftUpMark) && (
                          <View style={s.spaceMarkOverlayTagRow}>
                            <Text style={s.spaceMarkOverlayTagText} numberOfLines={1}>
                              {isLiftUpMark
                                ? `Lift Up ${markPeopleLabel || 'someone'}`
                                : visibleTagLabels.join(' · ')}
                            </Text>

                            {!isLiftUpMark && hiddenTagCount > 0 && (
                              <View style={s.spaceMarkOverlayTagBadge}>
                                <Text style={s.spaceMarkOverlayTagBadgeText}>+{hiddenTagCount}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={s.spaceMarkCardTop}>
                        <View style={s.spaceMarkAvatar}>
                          {authorProfile.avatarUrl ? (
                            <Image source={{ uri: authorProfile.avatarUrl }} style={s.spaceMarkAvatarImage} />
                          ) : (
                            <Text style={s.spaceMarkAvatarText}>{authorProfile.initials}</Text>
                          )}
                        </View>

                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.spaceMarkTitle} numberOfLines={2}>{markText.title}</Text>
                          <Text style={s.spaceMarkMeta} numberOfLines={1}>{markMeta}</Text>
                        </View>

                        <Text style={[s.spaceMarkBadge, isLiftUpMark && s.spaceMarkBadgeLiftUp]}>
                          {isLiftUpMark ? 'Lift Up' : 'Mark'}
                        </Text>
                      </View>

                      {isLiftUpMark && (
                        <View style={s.liftUpCue}>
                          <Text style={s.liftUpCueLabel}>Lifting up</Text>
                          <Text style={s.liftUpCueText} numberOfLines={1}>
                            {markPeopleLabel || 'Someone worth noticing'}
                          </Text>
                        </View>
                      )}

                      {markText.body ? (
                        <Text
                          style={s.spaceMarkBody}
                          numberOfLines={4}
                        >
                          {markText.body}
                        </Text>
                      ) : null}

                      {allTagLabels.length > 0 && (
                        <View style={s.spaceMarkTagSummaryRow}>
                          <Text style={s.spaceMarkTagSummaryText} numberOfLines={1}>
                            {visibleTagLabels.join(' · ')}
                          </Text>

                          {hiddenTagCount > 0 && (
                            <View style={s.spaceMarkTagSummaryBadge}>
                              <Text style={s.spaceMarkTagSummaryBadgeText}>+{hiddenTagCount}</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </TouchableOpacity>
              );
            }}
          />

          {group.status === 'active' && isMember && (
            <TouchableOpacity
              style={s.spaceMarkFab}
              onPress={() => openUnifiedMarkComposer('stickies')}
              activeOpacity={0.88}
            >
              <Text style={s.spaceMarkFabText}>+</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bulletin Board tab */}
      {tab === 'board' && (
        <View style={s.spaceTabPanel}>
          <FlatList<GroupSticky>
            style={s.spaceTabList}
            data={stickies}
            keyExtractor={item => item.id}
            contentContainerStyle={s.timelineContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.gold}
              />
            }
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            ListHeaderComponent={
              group.status === 'archived' ? (
                <SpaceArchivedBanner
                  theme={theme}
                  message="📦 This Space is archived. Board items can still be viewed."
                />
              ) : null
            }
            ListEmptyComponent={<SpaceBoardEmptyState theme={theme} />}
            renderItem={({ item: sticky }) => (
              <SpaceBoardItemCard
                sticky={sticky}
                theme={theme}
                isAdmin={isAdmin}
                authorLabel={getBoardItemAuthorLabel(sticky)}
                onDelete={() => handleDeleteSticky(sticky)}
                onPressMedia={(index) => openViewerForSticky(sticky, index)}
                onOpenFile={handleOpenHighlightFile}
              />
            )}
          />

          {group.status === 'active' && isAdmin && (
            <TouchableOpacity
              style={s.spaceMarkFab}
              onPress={() => openBoardComposer('pin')}
              activeOpacity={0.88}
            >
              <Text style={s.spaceMarkFabText}>+</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Calendar tab */}
      {tab === 'calendar' && (
        <View style={s.spaceTabPanel}>
        <GroupCalendarTab
          group={group}
          isAdmin={isAdmin}
          isMember={isMember}
          npub={npub ?? undefined}
          displayName={npub ? `${npub.slice(0, 12)}…` : undefined}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onCreateMarkForEvent={event => openUnifiedMarkComposer('calendar', event)}
        />
        </View>
      )}

      {tab === 'gallery' && (
        <FlatList
          style={s.spaceTabList}
          data={galleryItems}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={s.galleryGrid}
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.gold}
            />
          }
          renderItem={({ item }) => {
            const tileThumbnailUrl =
              item.thumbnailUrl ||
              item.thumbnailUri ||
              item.videoThumbnailUrl ||
              item.previewUrl;
            const tileImageUrl = tileThumbnailUrl || item.mediaUrl;

            return (
              <View style={s.galleryTileWrap}>
              <TouchableOpacity
                style={s.galleryTile}
                onPress={() => openViewerForGalleryItem(item.mediaUrl)}
                activeOpacity={0.86}
              >
                {item.mediaType === 'video' ? (
                  <View style={s.galleryVideoTile}>
                    {tileThumbnailUrl ? (
                      <Image
                        source={{ uri: tileThumbnailUrl }}
                        style={s.galleryTileImage}
                        resizeMode="cover"
                        onError={(error) => {
                          console.warn('[Gallery] thumbnail image failed:', {
                            thumbnailUrl: tileThumbnailUrl,
                            mediaUrl: item.mediaUrl,
                            error: error.nativeEvent,
                          });
                        }}
                      />
                    ) : null}

                    <View style={s.galleryVideoOverlay}>
                      <Text style={s.galleryVideoPlay}>▶</Text>
                    </View>
                  </View>
                ) : (
                  <Image
                    source={{ uri: tileImageUrl }}
                    style={s.galleryTileImage}
                    resizeMode="cover"
                  />
                )}
              </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <SpaceEmptyState
              theme={theme}
              icon="🖼️"
              title="No media yet"
              hint="Photos and videos posted in chat will appear here."
            />
          }
        />
      )}

      {/* Legacy tab */}
      {tab === 'legacy' && (
        <View style={s.spaceTabPanel}>
          <ScrollView
            style={s.spaceTabScroll}
            contentContainerStyle={s.mantlePageContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.gold} />}
          >
            <View style={[s.mantleCompactHeader, sportsMantle && s.mantleCompactHeaderSports]}>
              <View style={s.mantleCompactTopRow}>
                <View style={s.mantleCompactBadge}>
                  <Text style={s.mantleCompactBadgeText}>
                    {spaceCategoryIcon ? `${spaceCategoryIcon} ` : ''}Legacy builder
                  </Text>
                </View>
                <Text style={s.mantleCompactCount}>
                  {legacyMarkViews.length} {legacyMarkViews.length === 1 ? 'Mark' : 'Marks'}
                </Text>
              </View>

              <Text style={s.mantleCompactTitle} numberOfLines={2}>
                {group.name} Legacy
              </Text>

              <Text style={s.mantleCompactSubtitle} numberOfLines={3}>
                Saved Marks that can become a season recap, classroom memory, family keepsake, or year-end collection.
              </Text>

              <TouchableOpacity
                style={[
                  s.mantleRiverButton,
                  legacyMarkViews.length === 0 && s.mantleRiverButtonDisabled,
                ]}
                onPress={() => openRiverForLegacy()}
                disabled={legacyMarkViews.length === 0}
                activeOpacity={0.86}
              >
                <View style={s.mantleRiverIconWrap}>
                  <Ionicons name="play" size={13} color={theme.bg} />
                </View>
                <Text style={s.mantleRiverButtonText}>Open Legacy Mark</Text>
              </TouchableOpacity>
            </View>

            {leadLegacyView ? (
              <>
                {renderMantleMarkCard(leadLegacyView, 'lead')}

                {supportingLegacyViews.length > 0 && (
                  <View style={s.mantlePodiumSection}>
                    <View style={s.mantleSectionHeader}>
                      <Text style={s.mantleSectionKicker}>Saved for Legacy</Text>
                      <Text style={s.mantleSectionTitle}>Core memories</Text>
                    </View>

                    <View style={s.mantlePodiumGrid}>
                      {supportingLegacyViews.map((view, index) => renderMantleMarkCard(view, 'podium', index))}
                    </View>
                  </View>
                )}

                {recapLegacyViews.length > 0 && (
                  <View style={s.mantleRecapSection}>
                    <View style={s.mantleSectionHeader}>
                      <Text style={s.mantleSectionKicker}>More saved Marks</Text>
                      <Text style={s.mantleSectionTitle}>Building the collection</Text>
                    </View>

                    <View style={s.mantleRecapGrid}>
                      {recapLegacyViews.map((view, index) => renderMantleMarkCard(view, 'recap', index))}
                    </View>
                  </View>
                )}
              </>
            ) : (
              <SpaceEmptyState
                theme={theme}
                icon="L"
                title="No Legacy Marks yet"
                hint="Marks saved toward Legacy or approved for Legacy will appear here."
              />
            )}
          </ScrollView>
        </View>
      )}

      {/* Book tab */}
      {tab === 'book' && (
        <View style={s.spaceTabPanel}>
        <GroupBookTab
          group={group}
          npub={npub ?? undefined}
          nsec={nsec ?? undefined}
          displayName={myDisplayName}
          theme={theme}
          onGroupUpdated={refreshBookGroupState}
        />
        </View>
      )}

      {/* Members tab */}
      {tab === 'members' && (
        <FlatList
          style={s.spaceTabList}
          data={members}
          keyExtractor={m => m.id}
          contentContainerStyle={s.membersList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.gold}
            />
          }
          renderItem={({ item }) => {
            const displayName = item.displayName ?? `${item.npub.slice(0, 12)}…`;
            const shortNpub = `${item.npub.slice(0, 12)}…`;
            const roleLabel =
              item.role === 'owner'
                ? 'Owner'
                : item.role === 'admin'
                  ? 'Admin'
                  : 'Member';

            return (
              <TouchableOpacity
                style={s.memberCard}
                activeOpacity={0.82}
                onPress={() => openMemberActions(item)}
              >
                <View style={s.memberAvatar}>
                  {item.avatarUrl ? (
                    <Image source={{ uri: item.avatarUrl }} style={s.memberAvatarImg} />
                  ) : (
                    <View style={s.memberAvatarFallback}>
                      <Text style={s.memberAvatarLetter}>
                        {(item.displayName ?? item.npub)[0].toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={s.memberBody}>
                  <View style={s.memberHeaderRow}>
                    <Text style={s.memberName} numberOfLines={1}>
                      {displayName}
                    </Text>

                    <View
                      style={[
                        s.roleBadge,
                        item.role === 'owner' && s.roleBadgeOwner,
                        item.role === 'admin' && s.roleBadgeAdmin,
                      ]}
                    >
                      <Text
                        style={[
                          s.roleBadgeText,
                          item.role === 'owner' && s.roleBadgeTextOwner,
                          item.role === 'admin' && s.roleBadgeTextAdmin,
                        ]}
                      >
                        {roleLabel}
                      </Text>
                    </View>
                  </View>

                  <Text style={s.memberNpub} numberOfLines={1}>
                    {shortNpub}
                  </Text>
                </View>

                <TouchableOpacity
                  style={s.memberOptions}
                  activeOpacity={0.75}
                  onPress={() => openMemberActions(item)}
                >
                  <Text style={s.memberOptionsText}>⋯</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <SpaceEmptyState
              theme={theme}
              icon="👥"
              title="No members yet"
              hint="Members will appear here after they join this Space."
            />
          }
        />
      )}
      </View>
      </View>

      {/* Space navigation lives in the header dock. */}

      <Modal
        visible={!!selectedMemberAction}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMemberAction(null)}
      >
        <View style={s.memberActionOverlay}>
    <TouchableOpacity
      style={s.memberActionBackdrop}
      activeOpacity={1}
      onPress={() => setSelectedMemberAction(null)}
    />

    {selectedMemberAction && (
      <View style={s.memberActionSheet}>
        <View style={s.memberActionHandle} />

        <View style={s.memberActionHeader}>
          <View style={s.memberActionAvatar}>
            {selectedMemberAction.avatarUrl ? (
              <Image
                source={{ uri: selectedMemberAction.avatarUrl }}
                style={s.memberActionAvatarImg}
              />
            ) : (
              <Text style={s.memberActionAvatarLetter}>
                {(selectedMemberAction.displayName ?? selectedMemberAction.npub)[0].toUpperCase()}
              </Text>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.memberActionName} numberOfLines={1}>
              {selectedMemberAction.displayName || `${selectedMemberAction.npub.slice(0, 12)}…`}
            </Text>

            <Text style={s.memberActionNpub} numberOfLines={1}>
              {selectedMemberAction.npub}
            </Text>
          </View>

          <View style={s.memberActionRolePill}>
            <Text style={s.memberActionRoleText}>
              {selectedMemberAction.role === 'owner'
                ? 'Owner'
                : selectedMemberAction.role === 'admin'
                  ? 'Admin'
                  : 'Member'}
            </Text>
          </View>
        </View>

        <View style={s.memberActionList}>
          <TouchableOpacity
            style={s.memberActionRow}
            activeOpacity={0.78}
            onPress={() => {
              const member = selectedMemberAction;
              setSelectedMemberAction(null);
              handleAddMemberToContacts(member);
            }}
          >
            <Text style={s.memberActionIcon}>＋</Text>
            <View style={s.memberActionTextBlock}>
              <Text style={s.memberActionTitle}>Add to Contacts</Text>
              <Text style={s.memberActionHint}>Save this member for quick messaging.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.memberActionRow}
            activeOpacity={0.78}
            onPress={() => {
              const member = selectedMemberAction;
              setSelectedMemberAction(null);
              handleMessageMember(member);
            }}
          >
            <Text style={s.memberActionIcon}>✉️</Text>
            <View style={s.memberActionTextBlock}>
              <Text style={s.memberActionTitle}>Message</Text>
              <Text style={s.memberActionHint}>Open or start a private DM.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.memberActionRow}
            activeOpacity={0.78}
            onPress={() => {
              const member = selectedMemberAction;
              setSelectedMemberAction(null);
              handleCopyMemberNpub(member);
            }}
          >
            <Text style={s.memberActionIcon}>⧉</Text>
            <View style={s.memberActionTextBlock}>
              <Text style={s.memberActionTitle}>Copy npub</Text>
              <Text style={s.memberActionHint}>Copy this member’s Nostr address.</Text>
            </View>
          </TouchableOpacity>

          {isAdmin && selectedMemberAction.npub !== npub && selectedMemberAction.role !== 'owner' && (
            <>
              <TouchableOpacity
                style={s.memberActionRow}
                activeOpacity={0.78}
                onPress={() => {
                  const member = selectedMemberAction;
                  setSelectedMemberAction(null);

                  if (member.role === 'member') {
                    handlePromoteAdmin(member);
                  } else {
                    handleChangeMemberRole(member, 'member');
                  }
                }}
              >
                <Text style={s.memberActionIcon}>★</Text>
                <View style={s.memberActionTextBlock}>
                  <Text style={s.memberActionTitle}>
                    {selectedMemberAction.role === 'member' ? 'Make admin' : 'Remove admin'}
                  </Text>
                  <Text style={s.memberActionHint}>Manage this member role for the Space.</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.memberActionRow, s.memberActionDangerRow]}
                activeOpacity={0.78}
                onPress={() => {
                  const member = selectedMemberAction;
                  setSelectedMemberAction(null);
                  handleRemoveMember(member);
                }}
              >
                <Text style={[s.memberActionIcon, s.memberActionDangerText]}>⌫</Text>
                <View style={s.memberActionTextBlock}>
                  <Text style={[s.memberActionTitle, s.memberActionDangerText]}>
                    Remove from Space
                  </Text>
                  <Text style={s.memberActionHint}>Remove access for this Space.</Text>
                </View>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity
          style={s.memberActionCancel}
          activeOpacity={0.8}
          onPress={() => setSelectedMemberAction(null)}
        >
          <Text style={s.memberActionCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    )}
        </View>
      </Modal>

      <SpaceBoardComposerModal
        visible={showBoardComposer}
        theme={theme}
        displayMode={boardDisplayMode}
        title={boardTitle}
        body={boardBody}
        attachments={boardAttachments}
        uploadStatus={boardUploadStatus}
        saving={savingBoardItem}
        onClose={() => {
          setShowBoardComposer(false);
          resetBoardComposer();
        }}
        onChangeDisplayMode={setBoardDisplayMode}
        onChangeTitle={setBoardTitle}
        onChangeBody={setBoardBody}
        onPickMedia={handlePickBoardMedia}
        onPickFiles={handlePickBoardFiles}
        onRemoveAttachment={removeBoardAttachment}
        onSave={handleSaveBoardItem}
      />

      <ImageViewerModal
        images={activeViewerImages.length > 0 ? activeViewerImages : galleryViewerImages}
        selectedUri={selectedGalleryImage}
        onClose={() => {
          setSelectedGalleryImage(null);
          setActiveViewerImages([]);
        }}
      />

      {/* Space Mark creation now routes through the unified Log composer. */}

    </SafeAreaView>
  );
}

function getStickyMediaItems(sticky: GroupSticky): any[] {
  const media = (sticky as any).media;

  if (!media) return [];

  return Array.isArray(media) ? media : [media];
}

function getStickyVisualMediaItems(sticky: GroupSticky): any[] {
  return getStickyMediaItems(sticky).filter(item => {
    const mediaType = item.mediaType || item.type;

    return mediaType === 'image' || mediaType === 'video';
  });
}

function getStickyFileItems(sticky: GroupSticky): any[] {
  return getStickyMediaItems(sticky).filter(item => {
    const mediaType = item.mediaType || item.type;

    return mediaType === 'file';
  });
}

function formatStickyDate(unix: number): string {
  const date = new Date(unix * 1000);
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const createStyles = (theme: typeof Colors.light) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg, position: 'relative' },

  visibilityBox: {
    gap: 8,
    marginTop: 4,
  },
  visibilityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  visibilityOptionActive: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  visibilityOptionDisabled: {
    opacity: 0.55,
  },
  visibilityIcon: {
    fontSize: 20,
  },
  visibilityTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  visibilityTitleDim: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  visibilityHint: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  visibilityStatus: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '800',
  },
  visibilitySoon: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },

  spaceProfileHero: {
    height: 330,
    backgroundColor: theme.raised,
    position: 'relative',
    overflow: 'hidden',
  },
  spaceProfileImage: {
    width: '100%',
    height: '100%',
  },
  spaceProfileFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
  },
  spaceProfileFallbackText: {
    color: theme.gold,
    fontSize: 68,
    fontWeight: '900',
  },
  spaceProfileShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(17, 24, 28, 0.22)'
      : 'rgba(0, 0, 0, 0.44)',
  },
  spaceProfileTopControls: {
    position: 'absolute',
    top: 12,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spaceProfileTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spaceChromeBtn: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceChromeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  spaceChromeIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceChromeIconBtnActive: {
    backgroundColor: theme.gold,
  },
  spaceChromeIconText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    width: 38,
    height: 38,
    lineHeight: 38,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  spaceChromeIconTextActive: {
    color: theme.bg,
  },
  spaceChromeDotsText: {
    fontSize: 20,
    letterSpacing: 1,
    marginTop: -3,
  },
  spaceProfileTray: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 16,
    borderRadius: 22,
    padding: 16,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.74)'
      : 'rgba(18,18,18,0.66)',
    borderWidth: 0.5,
    borderColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.46)'
      : 'rgba(255,255,255,0.08)',
  },
  spaceContentTray: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 226,
    bottom: 0,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.88)'
      : 'rgba(18,18,18,0.86)',
    borderWidth: 0.5,
    borderColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.82)'
      : 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
  },
  spaceTrayBody: {
    flex: 1,
    minHeight: 0,
  },
  spaceTrayBodyHidden: {
    display: 'none',
  },
  spaceTabPanel: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  spaceTabScroll: {
    flex: 1,
  },
  spaceTabList: {
    flex: 1,
  },
  spaceSettingsPanelScroll: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.bg,
  },
  spaceSettingsPanelContent: {
    paddingBottom: 26,
  },
  mantlePageContent: {
    padding: 14,
    paddingBottom: 28,
  },
  mantleCompactHeader: {
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  mantleCompactHeaderSports: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  mantleCompactTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  mantleCompactBadge: {
    maxWidth: '70%',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: theme.goldDim,
  },
  mantleCompactBadgeText: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
  },
  mantleCompactCount: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  mantleCompactTitle: {
    color: theme.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  mantleCompactSubtitle: {
    color: theme.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 5,
  },
  mantleRiverButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    borderRadius: 20,
    paddingLeft: 6,
    paddingRight: 15,
    marginTop: 14,
    backgroundColor: theme.gold,
  },
  mantleRiverButtonDisabled: {
    opacity: 0.48,
  },
  mantleRiverIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.goldLight,
  },
  mantleRiverButtonText: {
    color: theme.bg,
    fontSize: 13,
    fontWeight: '900',
  },
  mantleShowcaseHero: {
    minHeight: 190,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
  },
  mantleShowcaseHeroSports: {
    borderColor: theme.gold,
  },
  mantleShowcaseHeroGeneric: {
    borderColor: theme.border,
  },
  mantleShowcaseImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  mantleShowcaseFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.goldDim,
  },
  mantleShowcaseFallbackText: {
    color: theme.gold,
    fontSize: 54,
    fontWeight: '900',
  },
  mantleShowcaseShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  mantleShowcaseContent: {
    flex: 1,
    minHeight: 190,
    justifyContent: 'flex-end',
    padding: 18,
  },
  mantleHeroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  mantleHeroBadge: {
    maxWidth: '70%',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.34)',
  },
  mantleHeroBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  mantleHeroCount: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  mantleHeroTitle: {
    color: '#fff',
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '900',
  },
  mantleHeroSubtitle: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 6,
  },
  mantleFeatureCard: {
    borderRadius: 22,
    padding: 13,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  mantleFeatureCardSports: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  mantleFeatureLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  mantleFeatureLabel: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  mantleFeatureDate: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  mantleFeatureMediaFrame: {
    height: 260,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: theme.bg,
    marginBottom: 12,
    position: 'relative',
  },
  mantleFeatureMediaImage: {
    width: '100%',
    height: '100%',
  },
  mantleFeatureTextFallback: {
    minHeight: 170,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    backgroundColor: theme.goldDim,
    marginBottom: 12,
  },
  mantleFeatureFallbackTitle: {
    color: theme.gold,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  mantleFeatureCopy: {
    gap: 6,
  },
  mantleFeatureTitle: {
    color: theme.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
  },
  mantleFeatureBody: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  mantleFeatureMeta: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  mantlePodiumSection: {
    marginBottom: 14,
  },
  mantleSectionHeader: {
    marginBottom: 10,
  },
  mantleSectionKicker: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  mantleSectionTitle: {
    color: theme.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    marginTop: 2,
  },
  mantlePodiumGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  mantlePodiumCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  mantlePodiumMediaWrap: {
    height: 112,
    backgroundColor: theme.bg,
    position: 'relative',
  },
  mantleMiniMedia: {
    width: '100%',
    height: '100%',
  },
  mantleMiniFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.goldDim,
  },
  mantleMiniFallbackLabel: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  mantlePodiumRank: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.gold,
  },
  mantlePodiumRankText: {
    color: theme.bg,
    fontSize: 12,
    fontWeight: '900',
  },
  mantleVideoBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: theme.gold,
  },
  mantleVideoText: {
    color: theme.bg,
    fontSize: 10,
    fontWeight: '900',
  },
  mantlePodiumCopy: {
    padding: 10,
    gap: 4,
  },
  mantlePodiumTitle: {
    color: theme.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  mantleRecapSection: {
    marginTop: 2,
  },
  mantleRecapGrid: {
    gap: 10,
  },
  mantleRecapCard: {
    flexDirection: 'row',
    gap: 11,
    borderRadius: 18,
    padding: 10,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  mantleRecapMediaWrap: {
    width: 92,
    height: 78,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.bg,
    position: 'relative',
  },
  mantleRecapCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 5,
  },
  mantleRecapTitle: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  mantleCardMeta: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  spaceMarksOverview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginBottom: 13,
  },
  spaceMarksTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  spaceMarksHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 3,
  },
  spaceMarksStats: {
    alignItems: 'flex-end',
    gap: 5,
  },
  spaceMarksStatText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  spaceMarksLegacyText: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  spaceMarkCard: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
    spaceMarkCardImmersive: {
    padding: 0,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  spaceMarkImmersiveMediaFrame: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  spaceMarkOverlayTop: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  spaceMarkOverlayAuthor: {
    maxWidth: 156,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  spaceMarkOverlayAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  spaceMarkOverlayAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
  },
  spaceMarkOverlayAvatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  spaceMarkOverlayAuthorName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  spaceMarkOverlayMeta: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  spaceMarkOverlayBadge: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.58)',
    overflow: 'hidden',
  },
  spaceMarkOverlayBadgeLiftUp: {
    color: theme.bg,
    backgroundColor: theme.gold,
  },
  spaceMarkOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
    spaceMarkOverlayLiftUpBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 7,
    backgroundColor: theme.gold,
  },
  spaceMarkOverlayLiftUpText: {
    color: theme.bg,
    fontSize: 11,
    fontWeight: '900',
  },
  spaceMarkOverlayTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  spaceMarkOverlayBody: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 2,
  },
  spaceMarkOverlayTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 5,
  },
  spaceMarkOverlayTagText: {
    flex: 1,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '800',
  },
  spaceMarkOverlayTagBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  spaceMarkOverlayTagBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  spaceMarkCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  spaceMarkAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.gold + '44',
    overflow: 'hidden',
  },
  spaceMarkAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 17,
  },
  spaceMarkAvatarText: {
    color: theme.gold,
    fontSize: 14,
    fontWeight: '900',
  },
  spaceMarkTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 19,
  },
  spaceMarkMeta: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  spaceMarkBody: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 21,
  },
    spaceMarkBodyAfterMedia: {
    marginTop: 10,
  },
  spaceMarkMediaFrame: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  spaceMarkOpenHint: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 12,
  },
  highlightCollageWrap: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#000',
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: 220,
  },
  highlightCollageTileOne: {
    width: '100%',
    height: '100%',
  },
  highlightCollageTileTwo: {
    width: '50%',
    height: '100%',
  },
  highlightCollageTileThreeLarge: {
    width: '60%',
    height: '100%',
  },
  highlightCollageTileThreeSmall: {
    width: '40%',
    height: '50%',
  },
  highlightCollageTileFour: {
    width: '50%',
    height: '50%',
  },
  highlightCollageImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  highlightCollageVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  highlightCollagePlay: {
    color: '#c9973a',
    fontSize: 26,
    fontWeight: '900',
  },
  highlightMoreOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  highlightMoreText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },
  highlightMediaWrap: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
  },
  highlightMedia: {
    width: '100%',
    height: 180,
    backgroundColor: '#000',
  },
  highlightVideoWrap: {
    position: 'relative',
  },
  highlightVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  highlightVideoPlay: {
    color: '#c9973a',
    fontSize: 28,
    fontWeight: '800',
  },
  spaceMarkBadge: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.raised,
    overflow: 'hidden',
  },
  spaceMarkBadgeLiftUp: {
    color: theme.bg,
    backgroundColor: theme.gold,
  },
  liftUpCue: {
    borderWidth: 0.5,
    borderColor: theme.gold + '55',
    backgroundColor: theme.goldDim,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  liftUpCueLabel: {
    color: theme.gold,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  liftUpCueText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '900',
  },
    spaceMarkTagSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    minHeight: 28,
  },
  spaceMarkTagSummaryText: {
    flex: 1,
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  spaceMarkTagSummaryBadge: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: theme.raised,
  },
  spaceMarkTagSummaryBadgeText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  markTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  markTag: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.raised,
  },
  markTagText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '800',
  },
  markPersonMiniChip: {
    borderWidth: 0.5,
    borderColor: theme.gold,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.surface,
  },
  markPersonMiniChipLiftUp: {
    backgroundColor: theme.goldDim,
  },
  markPersonMiniText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  markPersonMiniTextLiftUp: {
    color: theme.text,
  },
  markContextMiniChip: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.raised,
  },
  markContextMiniText: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  markPermissionMiniChip: {
    borderWidth: 0.5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  markPermissionMiniText: {
    fontSize: 12,
    fontWeight: '900',
  },
  markTagChip: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markTagChipActive: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  markTagChipText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '800',
  },
  markTagChipTextActive: {
    color: theme.bg,
  },
  markPersonRow: {
    gap: 8,
    paddingRight: 20,
  },
  markPersonChip: {
    minHeight: 34,
    maxWidth: 190,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  markPersonChipActive: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  markPersonAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.border,
    color: theme.gold,
    textAlign: 'center',
    lineHeight: 19,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
  },
  markPersonAvatarActive: {
    borderColor: theme.bg,
    color: theme.bg,
  },
  markPersonChipText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 136,
  },
  markPersonChipTextActive: {
    color: theme.bg,
  },
  markTagInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  markTagInput: {
    flex: 1,
  },
  markTagAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markTagAddText: {
    color: theme.bg,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 26,
  },
  groupRelayCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginBottom: 13,
  },
  groupRelayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  groupRelayHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  groupRelayTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  groupRelayHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  groupRelayManage: {
    color: theme.gold,
    fontSize: 13,
    fontWeight: '800',
  },
  groupRelaySummary: {
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#282828',
  },
  groupRelaySummaryLabel: {
    fontSize: 10,
    color: theme.textMuted,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  groupRelaySummaryValue: {
    color: theme.gold,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 5,
  },
  groupRelayUrlText: {
    color: theme.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  groupRelayReadOnly: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
  },
  groupRelayOption: {
    padding: 13,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    marginBottom: 8,
  },
  groupRelayOptionActive: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  groupRelayOptionTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  groupRelayOptionHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  spaceSettingsDropdown: {
    padding: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    backgroundColor: theme.bg,
  },
  spaceSettingsCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginBottom: 13,
  },
  overviewPageContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
  },
  overviewHeroCard: {
    padding: 16,
    borderRadius: 26,
    backgroundColor: theme.raised,
    borderWidth: 1,
    borderColor: theme.gold + '55',
  },
  overviewHeroKicker: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  overviewHeroTeaching: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  overviewFlowCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 24,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  overviewFlowHeader: {
    marginBottom: 12,
  },
  overviewFlowKicker: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  overviewFlowTitle: {
    color: theme.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
    marginTop: 3,
  },
  overviewFlowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  overviewFlowItem: {
    width: '48.5%',
    minHeight: 142,
    padding: 12,
    borderRadius: 19,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  overviewFlowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    marginBottom: 8,
  },
  overviewFlowAction: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  overviewFlowName: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 2,
  },
  overviewFlowHint: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  overviewFlowCount: {
    position: 'absolute',
    right: 12,
    top: 12,
    color: theme.textMuted,
    fontSize: 16,
    fontWeight: '900',
  },
  overviewSportsPulseCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 26,
    backgroundColor: theme.gold,
    borderWidth: 0.5,
    borderColor: theme.goldLight,
  },
  overviewSportsPulseTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  overviewSportsPulseKicker: {
    color: theme.bg,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    opacity: 0.78,
  },
  overviewSportsPulseTitle: {
    color: theme.bg,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    marginTop: 2,
  },
  overviewSportsPulseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.goldLight,
  },
  overviewSportsPulseBadgeText: {
    color: theme.bg,
    fontSize: 11,
    fontWeight: '900',
  },
  overviewSportsPulseGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  overviewSportsPulseStat: {
    flex: 1,
    minHeight: 68,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.goldLight,
    borderWidth: 0.5,
    borderColor: theme.goldDim,
    paddingHorizontal: 6,
  },
  overviewSportsPulseValue: {
    color: theme.bg,
    fontSize: 22,
    fontWeight: '900',
  },
  overviewSportsPulseLabel: {
    color: theme.bg,
    fontSize: 10,
    fontWeight: '900',
    marginTop: 3,
    opacity: 0.78,
    textAlign: 'center',
  },
  overviewSnapshotCard: {
    borderRadius: 22,
    padding: 14,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    marginTop: 12,
  },
  overviewSnapshotHeader: {
    marginBottom: 10,
  },
  overviewSnapshotKicker: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  overviewSnapshotTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  overviewSnapshotGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  overviewSnapshotItem: {
    flex: 1,
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  overviewSnapshotValue: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '900',
  },
  overviewSnapshotLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 3,
    textAlign: 'center',
  },
  spaceSettingsTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  spaceSettingsAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.gold + '44',
    overflow: 'hidden',
  },
  spaceSettingsAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 27,
  },
  spaceSettingsAvatarText: {
    color: theme.gold,
    fontSize: 17,
    fontWeight: '900',
  },
  spaceSettingsTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  spaceSettingsHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 4,
  },
  spaceSettingsDoneBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.gold + '66',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceSettingsDoneText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  spaceSettingsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  spaceSettingsMetric: {
    flex: 1,
    padding: 10,
    borderRadius: 14,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  spaceSettingsMetricValue: {
    color: theme.gold,
    fontSize: 16,
    fontWeight: '900',
  },
  spaceSettingsMetricLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  spaceSettingsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  spaceSettingsChip: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.raised,
    overflow: 'hidden',
  },
  spaceSettingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginTop: 9,
  },
  spaceSettingsRowTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '900',
  },
  spaceSettingsRowHint: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  spaceSettingsRowAction: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'right',
    maxWidth: 92,
  },
    spaceControlTileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  spaceControlTile: {
    width: '48.2%',
    minHeight: 128,
    padding: 13,
    borderRadius: 22,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  spaceControlTileActive: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  spaceControlTileIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.gold + '55',
    marginBottom: 10,
  },
  spaceControlTileTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '900',
  },
  spaceControlTileHint: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  spaceControlTileAction: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 'auto',
    paddingTop: 10,
  },
  schoolConsentPanel: {
    marginTop: 9,
    padding: 13,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: theme.gold + '55',
    backgroundColor: theme.raised,
  },
  schoolConsentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  schoolConsentTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '900',
  },
  schoolConsentHint: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 3,
  },
  schoolConsentBadge: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.goldDim,
    overflow: 'hidden',
  },
  schoolConsentPrimaryBtn: {
    minHeight: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.gold,
    marginTop: 10,
  },
  schoolConsentPrimaryText: {
    color: theme.bg,
    fontSize: 13,
    fontWeight: '900',
  },
  schoolConsentDisabled: {
    opacity: 0.5,
  },
  schoolConsentPolicyGrid: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 12,
  },
  schoolConsentPolicyCard: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  schoolConsentPolicyLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  schoolConsentPolicyValue: {
    color: theme.gold,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 5,
  },
  schoolConsentSectionLabel: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 10,
    marginBottom: 7,
    textTransform: 'uppercase',
  },
  schoolConsentEmpty: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  schoolConsentChildList: {
    gap: 8,
  },
  schoolConsentChildCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  schoolConsentChildName: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '900',
  },
  schoolConsentChildMeta: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  schoolConsentRevokeBtn: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.danger,
  },
  schoolConsentRevokeText: {
    color: theme.danger,
    fontSize: 11,
    fontWeight: '900',
  },
  schoolConsentInput: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  schoolConsentToggleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  schoolConsentToggle: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  schoolConsentToggleActive: {
    borderColor: theme.gold,
    backgroundColor: theme.gold,
  },
  schoolConsentToggleText: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  schoolConsentToggleTextActive: {
    color: theme.bg,
  },
  schoolConsentNotice: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 9,
  },
  spaceSettingsDangerGroup: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  spaceSettingsDangerRow: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.danger,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  spaceSettingsDangerText: {
    color: theme.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  spaceSettingsActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  spaceSettingsAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
  },
  spaceSettingsActionGold: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  spaceSettingsActionText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '900',
  },
  spaceSettingsActionTextGold: {
    color: theme.bg,
  },
  
  // Invite panel
  invitePanel: {
    backgroundColor: theme.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    padding: 16,
  },
  invitePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  invitePanelHeaderBtn: {
    minWidth: 64,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitePanelHeaderAction: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  invitePanelTitle: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  invitePanelTop: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  inviteCodeBlock: { flex: 1 },
  inviteCodeLabel: { fontSize: 10, color: theme.textMuted, fontWeight: '600', letterSpacing: 0.8, marginBottom: 6 },
  inviteCode: { fontSize: 32, fontWeight: '700', color: theme.gold, letterSpacing: 6, marginBottom: 10 },
  inviteCodeActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  inviteCodeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  inviteCodeBtnDanger: { borderColor: '#3a1a1a' },
  inviteCodeBtnText: { fontSize: 12, color: theme.text, fontWeight: '500' },
  qrBlock: {
    padding: 8,
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  inviteMeta: { fontSize: 11, color: theme.textMuted, marginTop: 10, lineHeight: 16 },

  // Gallery
  galleryGrid: {
    padding: 8,
    paddingBottom: 100,
  },
  galleryTileWrap: {
    flex: 1 / 3,
    padding: 4,
  },
  galleryTile: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: theme.surface,
  },
  galleryTileImage: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.surface,
  },
  galleryVideoTile: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryVideoOverlay: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryVideoPlay: {
    color: theme.gold,
    fontSize: 28,
    fontWeight: '800',
  },

  // Timeline
  timelineContainer: { padding: 14, paddingBottom: 100 },

  // Members
  membersList: {
    padding: 16,
    paddingBottom: 100,
    gap: 10,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: 18,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  memberAvatar: {
    width: 44,
    height: 44,
  },
  memberAvatarImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  memberAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarLetter: {
    color: theme.gold,
    fontWeight: '900',
    fontSize: 17,
  },
  memberBody: {
    flex: 1,
    minWidth: 0,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  memberNpub: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  memberOptions: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberOptionsText: {
    fontSize: 20,
    color: theme.textMuted,
    fontWeight: '900',
    lineHeight: 22,
  },
  roleBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.raised,
  },
  roleBadgeOwner: {
    backgroundColor: theme.raised,
  },
  roleBadgeAdmin: {
    backgroundColor: theme.raised,
  },
  roleBadgeText: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  roleBadgeTextOwner: {
    color: theme.gold,
  },
  roleBadgeTextAdmin: {
    color: theme.gold,
  },

  memberActionOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  memberActionBackdrop: {
    flex: 1,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(17, 24, 28, 0.28)'
      : 'rgba(0,0,0,0.58)',
  },
  memberActionSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  memberActionHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  memberActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  memberActionAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberActionAvatarImg: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  memberActionAvatarLetter: {
    color: theme.gold,
    fontSize: 18,
    fontWeight: '900',
  },
  memberActionName: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  memberActionNpub: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  memberActionRolePill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  memberActionRoleText: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  memberActionList: {
    gap: 8,
  },
  memberActionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  memberActionDangerRow: {
    borderColor: theme.danger,
  },
  memberActionIcon: {
    width: 28,
    color: theme.gold,
    fontSize: 20,
    textAlign: 'center',
    fontWeight: '900',
  },
  memberActionTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  memberActionTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '900',
  },
  memberActionHint: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  memberActionDangerText: {
    color: theme.danger,
  },
  memberActionCancel: {
    minHeight: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    backgroundColor: theme.bg,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  memberActionCancelText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  // Admin bar
  adminBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: theme.bg,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
  },
  adminBtn: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminBtnText: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 16,
  },
  adminBtnGold: {
    minWidth: 148,
    minHeight: 46,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminBtnGoldText: {
    color: theme.bg,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.3,
  },
    adminBtnDanger: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 0.8,
    borderColor: theme.danger,
    backgroundColor: theme.surface,
    alignItems: 'center',
  },
  adminBtnDangerText: {
    color: theme.danger,
    fontWeight: '800',
    fontSize: 13,
  },
  inputLabel: {
    fontSize: 11,
    color: theme.textMuted,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: theme.text,
    backgroundColor: theme.surface,
  },
  markContextToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  markContextTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '800',
  },
  markContextHint: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  markContextAction: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  markContextPanel: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    gap: 10,
  },
  markProgressTrack: {
    height: 6,
    backgroundColor: theme.border,
    borderRadius: 999,
    marginTop: 8,
    overflow: 'hidden',
  },
  markProgressFill: {
    height: '100%',
    backgroundColor: theme.gold,
  },
  markProgressText: {
    color: theme.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
  },
  cancelText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBtn: {
    flex: 2,
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.gold,
    alignItems: 'center',
  },
  confirmText: {
    color: theme.bg,
    fontWeight: '700',
    fontSize: 14,
  },
  highlightAddMediaBtn: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: theme.surface,
    alignItems: 'center',
  },
  highlightAddMediaText: {
    color: theme.gold,
    fontSize: 14,
    fontWeight: '800',
  },
  highlightAddMediaHint: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  highlightRemoveMediaBtn: {
    padding: 11,
    alignItems: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 10,
  },
  highlightRemoveMediaText: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  highlightAttachmentRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  highlightAttachmentHalf: {
    flex: 1,
  },
  highlightFileList: {
    gap: 8,
    marginTop: 10,
    marginBottom: 10,
  },
  highlightFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
  },
  highlightFileIcon: {
    fontSize: 16,
  },
  highlightFileName: {
    flex: 1,
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  highlightMediaPreviewWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#181818',
  },
  highlightMediaPreview: {
    width: '100%',
    height: 180,
    backgroundColor: '#000',
  },
  highlightVideoBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  highlightVideoBadgeText: {
    color: '#c9973a',
    fontSize: 12,
    fontWeight: '800',
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 30,
    color: theme.bg,
    fontWeight: '300',
    lineHeight: 34,
  },
  spaceMarkFab: {
    position: 'absolute',
    right: 20,
    bottom: 78,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 7,
  },
  spaceMarkFabText: {
    color: theme.bg,
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 32,
  },
});
