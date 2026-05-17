import GroupBookTab from '@/components/GroupBookTab';
import GroupCalendarTab from '@/components/GroupCalendarTab';
import {
  getUpcomingEventsForGroup,
  syncCalendarEventsFromRelay,
} from '@/src/utils/group-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
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
import {
  getContactByNpub,
  saveContact,
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
  getStickiesForGroup,
  hideGroupSticky,
  syncGroupStickiesFromRelay,
  type GroupSticky
} from '../src/utils/group-stickies';
import {
  archiveGroup,
  getGroupById,
  getGroupMembers,
  isGroupAdmin,
  isGroupMember,
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
import { compressMediaForUpload } from '../src/utils/media-compression';
import type {
  LivingMarkCaptureSource,
  LivingMarkPlace,
  LivingMarkView,
  LivingSpace,
} from '../src/types/living-spaces';
import {
  extractLivingCaptureFromExif,
} from '../src/utils/living-space-routing';
import {
  getLivingMarkViewsForMilestones,
  persistLivingMarkCapture,
  syncLivingSpacesFromGroups,
} from '../src/utils/living-spaces-storage';
import {
  DEFAULT_RELAY,
  fetchGroupMessageDeletes,
  fetchGroupMessages,
  fetchNostrProfile,
  publishGroupMembership,
  publishGroupMessage,
} from '../src/utils/nostr';
import { normalizeNostrIdentity } from '../src/utils/nostr-identity';
import {
  notifyGroupEvent,
  registerGroupMemberForPush,
  removeGroupMemberFromPush,
} from '../src/utils/push-notifications';
import { uploadMilestoneMedia } from '../src/utils/r2';
import {
  getMilestones,
  saveMilestone,
  type MarkMedia,
  type Milestone,
} from '../src/utils/storage';
import { useIdentity } from './_layout';

type Tab = 'stickies' | 'calendar' | 'gallery' | 'members' | 'book';
type MainTab = 'chat' | 'stickies' | 'calendar' | 'gallery' | 'book';
const GROUP_LOCAL_GALLERY_KEY = 'be_group_local_gallery_v1';
const SPACE_FAVORITES_KEY = 'be_space_favorite_ids_v1';
const SPACE_MARK_PRESET_TAGS = ['Family', 'School', 'Team', 'Church', 'Event', 'Memory'];
const SPACE_MARK_LIFE_STAGE_OPTIONS = ['Elementary', 'Middle School', 'High School', 'Season', 'Trip', 'Family'];

type LocalGalleryItem = {
  id: string;
  groupId: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string;
  createdAt: number;
  source: 'highlight';
};

type SpaceMarkDraftMedia = {
  id: string;
  uri: string;
  type: 'image' | 'video';
  thumbnailUri?: string;
  place?: LivingMarkPlace;
  occurredAt?: number;
  captureSource: Extract<LivingMarkCaptureSource, 'camera' | 'library'>;
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

function getGroupTypeIcon(group: BEGroup): string | null {
  const directKey = normalizeGroupType(group.sport);

  if (directKey && GROUP_TYPE_ICONS[directKey]) {
    return GROUP_TYPE_ICONS[directKey];
  }

  return null;
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

function parseSpaceMarkPeople(input: string): string[] {
  return input
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function getSpaceMarkCaptureMetadata(media: SpaceMarkDraftMedia[]): {
  place?: LivingMarkPlace;
  occurredAt?: number;
  captureSource?: LivingMarkCaptureSource;
} {
  const mediaWithPlace = media.find(item => item.place);
  const mediaWithDate = media.find(item => item.occurredAt);
  const firstMedia = media[0];

  if (!firstMedia) {
    return { captureSource: 'manual' };
  }

  return {
    place: mediaWithPlace?.place,
    occurredAt: mediaWithDate?.occurredAt,
    captureSource: firstMedia.captureSource,
  };
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
  const [galleryItems, setGalleryItems] = useState<any[]>([]);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<string | null>(null);
  const [activeViewerImages, setActiveViewerImages] = useState<ViewerImage[]>([]);
  const [showSpaceMarkModal, setShowSpaceMarkModal] = useState(false);
  const [spaceMarkTitle, setSpaceMarkTitle] = useState('');
  const [spaceMarkNote, setSpaceMarkNote] = useState('');
  const [spaceMarkTags, setSpaceMarkTags] = useState<string[]>([]);
  const [spaceMarkTagInput, setSpaceMarkTagInput] = useState('');
  const [spaceMarkMedia, setSpaceMarkMedia] = useState<SpaceMarkDraftMedia[]>([]);
  const [spaceMarkShowContext, setSpaceMarkShowContext] = useState(false);
  const [spaceMarkPeopleInput, setSpaceMarkPeopleInput] = useState('');
  const [spaceMarkLifeStage, setSpaceMarkLifeStage] = useState('');
  const [spaceMarkEventInput, setSpaceMarkEventInput] = useState('');
  const [spaceMarkSavedToBook, setSpaceMarkSavedToBook] = useState(false);
  const [spaceMarkSaving, setSpaceMarkSaving] = useState(false);
  const [spaceMarkSaveStatus, setSpaceMarkSaveStatus] = useState<string | null>(null);
  const [spaceMarkProgress, setSpaceMarkProgress] = useState(0);
  const [tab, setTab] = useState<Tab>(
  routeTab === 'calendar' ||
  routeTab === 'gallery' ||
  routeTab === 'members' ||
  routeTab === 'book'
    ? routeTab
    : 'stickies'
);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSpaceSettingsMenu, setShowSpaceSettingsMenu] = useState(false);
  const [spaceSettingsRelayOpen, setSpaceSettingsRelayOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [editingGroupRelay, setEditingGroupRelay] = useState(false);
  const [groupRelayMode, setGroupRelayMode] = useState<GroupRelayMode>('default');
  const [groupRelayUrl, setGroupRelayUrl] = useState('');
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [selectedMemberAction, setSelectedMemberAction] = useState<BEGroupMember | null>(null);
  const [favoriteSpaceIds, setFavoriteSpaceIds] = useState<string[]>([]);
  const groupDetailLoadRunIdRef = useRef(0);

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

  const loadSpaceMarks = useCallback(async (groupId: string, spaces: LivingSpace[]) => {
    const livingSpaceId = getGroupLivingSpaceId(groupId);
    const milestones = await getMilestones();
    const views = await getLivingMarkViewsForMilestones({
      milestones,
      spaces,
      currentNpub: npub,
    });

    setSpaceMarkViews(
      views
        .filter(view => view.placement.spaceIds.includes(livingSpaceId))
        .sort((a, b) => b.milestone.createdAt - a.milestone.createdAt)
    );
  }, [npub]);

  const load = useCallback(async () => {
    if (!id) return;

    const runId = groupDetailLoadRunIdRef.current + 1;
    groupDetailLoadRunIdRef.current = runId;

    const g = await getGroupById(id);

    if (!g) return;

    setGroup(g);

    let spaces: LivingSpace[] = [];
    try {
      spaces = await syncLivingSpacesFromGroups();
      setLivingSpaces(spaces);
      await loadSpaceMarks(id, spaces);
    } catch (error) {
      console.warn('[Space Detail] failed to sync Living Space mirror:', error);
    }

    const buildGalleryItemsFromMessages = (messages: any[], source: 'local-chat' | 'chat') => {
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
    };

    const mergeGalleryItems = (items: any[]) => {
      const galleryMap = new Map<string, any>();

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
          createdAt: Math.max(existing.createdAt || 0, item.createdAt || 0),
        });
      });

      return Array.from(galleryMap.values()).sort(
        (a, b) => b.createdAt - a.createdAt
      );
    };

    // FAST LOCAL LOAD FIRST
    try {
      const [localMembers, localStickies, upcoming, localMessages, localGalleryItems] = await Promise.all([
        getGroupMembers(id),
        getStickiesForGroup(id),
        getUpcomingEventsForGroup(id),
        getMessagesForGroup(id),
        readLocalGalleryItems(),
      ]);

      setMembers(localMembers);
      setStickies(localStickies);
      setUpcomingCount(upcoming.length);

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
      try {
        const syncedMembers = await syncGroupMembersFromRelay(
          id,
          g.relayUrl ? [g.relayUrl] : []
        );

        if (groupDetailLoadRunIdRef.current !== runId) return;

        setMembers(syncedMembers);
        syncedMembers
          .filter(member => member.status === 'active')
          .forEach(member => {
            registerGroupMemberForPush({
              groupId: g.id,
              groupName: g.name,
              relayUrl: g.relayUrl,
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
        const syncedStickies = g.relayUrl
          ? await syncGroupStickiesFromRelay(id, g.relayUrl)
          : await getStickiesForGroup(id);

        setStickies(syncedStickies);
        await loadSpaceMarks(id, spaces.length > 0 ? spaces : await syncLivingSpacesFromGroups());
      } catch (error) {
        console.warn('[Group Detail] background highlight sync failed:', error);
      }

      if (groupDetailLoadRunIdRef.current !== runId) return;

      try {
        if (g.relayUrl) {
          await syncCalendarEventsFromRelay(id, g.relayUrl);
        }

        const upcoming = await getUpcomingEventsForGroup(id);
        setUpcomingCount(upcoming.length);
      } catch (error) {
        console.warn('[Group Detail] background calendar sync failed:', error);
      }

      if (groupDetailLoadRunIdRef.current !== runId) return;

      try {
        const localMessages = await getMessagesForGroup(id);
        const localChatMediaItems = buildGalleryItemsFromMessages(localMessages, 'local-chat');

        let relayChatMediaItems: any[] = [];

        if (g.relayUrl) {
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
  }, [id, npub, hydrateMemberProfiles, loadSpaceMarks]);

  useEffect(() => {
    load();

    return () => {
      groupDetailLoadRunIdRef.current += 1;
    };
  }, [load]);

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
  if (
    routeTab === 'stickies' ||
    routeTab === 'calendar' ||
    routeTab === 'gallery' ||
    routeTab === 'members' ||
    routeTab === 'book'
  ) {
    setTab(routeTab);
  }
}, [routeTab]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openGroupRelayEditor = () => {
    if (!group) return;

    setGroupRelayMode(group.relayMode ?? 'default');
    setGroupRelayUrl(group.relayMode === 'default' ? '' : group.relayUrl ?? '');
    setEditingGroupRelay(true);
  };

  const saveGroupRelaySettings = async () => {
    if (!group) return;

    const trimmedUrl = groupRelayUrl.trim();

    if ((groupRelayMode === 'custom' || groupRelayMode === 'both') && !trimmedUrl) {
      Alert.alert('Relay required', 'Enter the Space or school relay URL.');
      return;
    }

    if (trimmedUrl && !trimmedUrl.startsWith('wss://') && !trimmedUrl.startsWith('ws://')) {
      Alert.alert('Invalid relay', 'Relay URL must start with wss:// or ws://');
      return;
    }

    await updateGroup(group.id, {
      relayMode: groupRelayMode,
      relayUrl: groupRelayMode === 'default' ? DEFAULT_RELAY : trimmedUrl,
    });
    await syncLivingSpacesFromGroups();

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

  const closeSpaceSettingsMenu = () => {
    setShowSpaceSettingsMenu(false);
    setSpaceSettingsRelayOpen(false);
    setEditingGroupRelay(false);
  };

  const toggleSpaceSettingsMenu = () => {
    setShowSpaceSettingsMenu(prev => {
      const next = !prev;

      if (next) {
        setShowInvite(false);
      } else {
        setSpaceSettingsRelayOpen(false);
        setEditingGroupRelay(false);
      }

      return next;
    });
  };

  const handleRegenerateCode = () => {
    Alert.alert(
      'Regenerate invite code?',
      'The old code will stop working immediately. Share the new code with your Space.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate', onPress: async () => {
            if (!group) return;
            const newCode = await regenerateInviteCode(group.id);
            await load();
            Alert.alert('New code ready', `Your new invite code is: ${newCode}`);
          }
        }
      ]
    );
  };

  const handleArchive = () => {
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
            await load();
          }
        }
      ]
    );
  };

  const handlePickSpaceMarkMedia = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to add media to a Mark.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.85,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
        allowsMultipleSelection: true,
        selectionLimit: 10,
        exif: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const pickedAt = Date.now();
      const newItems: SpaceMarkDraftMedia[] = result.assets
        .filter(asset => !!asset.uri)
        .map((asset, index) => {
          const capture = extractLivingCaptureFromExif(asset.exif);

          return {
            id: `space_mark_media_${pickedAt}_${index}_${Math.random().toString(36).slice(2, 7)}`,
            uri: asset.uri,
            type: asset.type === 'video' ? 'video' : 'image',
            place: capture.place,
            occurredAt: capture.occurredAt,
            captureSource: 'library',
          };
        });

      setSpaceMarkMedia(prev => [...prev, ...newItems]);
    } catch (e) {
      console.warn('[Space Mark media picker] failed', e);
      Alert.alert('Media error', 'Could not open your photo library.');
    }
  };

  const resetSpaceMarkDraft = () => {
    setSpaceMarkTitle('');
    setSpaceMarkNote('');
    setSpaceMarkTags([]);
    setSpaceMarkTagInput('');
    setSpaceMarkMedia([]);
    setSpaceMarkShowContext(false);
    setSpaceMarkPeopleInput('');
    setSpaceMarkLifeStage('');
    setSpaceMarkEventInput('');
    setSpaceMarkSavedToBook(false);
    setSpaceMarkSaveStatus(null);
    setSpaceMarkProgress(0);
  };

  const addSpaceMarkTag = (tag: string) => {
    const clean = tag.trim();
    if (!clean) return;

    setSpaceMarkTags(prev => (
      prev.some(existing => existing.toLowerCase() === clean.toLowerCase())
        ? prev
        : [...prev, clean]
    ));
    setSpaceMarkTagInput('');
  };

  const removeSpaceMarkTag = (tag: string) => {
    setSpaceMarkTags(prev => prev.filter(existing => existing !== tag));
  };

  const handleCreateSpaceMark = async () => {
  if (!group || spaceMarkSaving) return;

  const title = spaceMarkTitle.trim();
  const note = spaceMarkNote.trim();

  if (!title && !note && spaceMarkMedia.length === 0) {
    Alert.alert('Nothing to save', 'Add a title, note, photo, or video first.');
    return;
  }

  const mediaToUpload = spaceMarkMedia;

  setSpaceMarkSaving(true);
  setSpaceMarkSaveStatus(
    mediaToUpload.length > 0 ? 'Preparing media...' : 'Saving Mark...'
  );
  setSpaceMarkProgress(0);

  try {
    const fullNote = title ? `${title}\n\n${note}`.trim() : note;
    const uploadedMedia: MarkMedia[] = [];
    const total = Math.max(mediaToUpload.length, 1);

    for (let i = 0; i < mediaToUpload.length; i++) {
      const item = mediaToUpload[i];

      setSpaceMarkSaveStatus(
        item.type === 'video'
          ? `Compressing video ${i + 1} of ${mediaToUpload.length}...`
          : `Optimizing photo ${i + 1} of ${mediaToUpload.length}...`
      );

      const compressed = await compressMediaForUpload({
        uri: item.uri,
        type: item.type,
        onStatus: setSpaceMarkSaveStatus,
        onProgress: compressionProgress => {
          const baseProgress = Math.floor((i / total) * 45);
          const itemProgress = Math.floor(compressionProgress * (45 / total));
          setSpaceMarkProgress(Math.min(45, baseProgress + itemProgress));
        },
      });

      let thumbnailUri: string | undefined;

      if (item.type === 'video') {
        try {
          setSpaceMarkSaveStatus(`Creating video thumbnail ${i + 1} of ${mediaToUpload.length}...`);
          const thumbnail = await VideoThumbnails.getThumbnailAsync(compressed.uri, {
            time: 1000,
          });

          setSpaceMarkSaveStatus(`Uploading video thumbnail ${i + 1} of ${mediaToUpload.length}...`);
          const thumbUpload = await uploadMilestoneMedia({
            photoUri: thumbnail.uri,
          });
          thumbnailUri = thumbUpload.photoUri || thumbnail.uri;
        } catch (error) {
          console.warn('[Space Mark thumbnail] failed:', error);
        }
      }

      setSpaceMarkSaveStatus(
        item.type === 'video'
          ? `Uploading video ${i + 1} of ${mediaToUpload.length}...`
          : `Uploading photo ${i + 1} of ${mediaToUpload.length}...`
      );

      const upload = await uploadMilestoneMedia({
        photoUri: item.type === 'image' ? compressed.uri : undefined,
        videoUri: item.type === 'video' ? compressed.uri : undefined,
      });
      const uploadedUri =
        item.type === 'image'
          ? upload.photoUri || item.uri
          : upload.videoUri || item.uri;

      uploadedMedia.push({
        id: item.id,
        uri: uploadedUri,
        type: item.type,
        source: uploadedUri.startsWith('http') ? 'r2' : 'local',
        thumbnailUri,
      });

      setSpaceMarkProgress(45 + Math.floor(((i + 1) / total) * 35));
    }

    setSpaceMarkSaveStatus('Saving Mark...');
    setSpaceMarkProgress(85);

    const uploadedPhoto = uploadedMedia.find(item => item.type === 'image')?.uri;
    const uploadedVideo = uploadedMedia.find(item => item.type === 'video')?.uri;
    const savedMilestone = await saveMilestone({
      note: fullNote,
      tags: spaceMarkTags,
      photoUri: uploadedPhoto,
      videoUri: uploadedVideo,
      media: uploadedMedia,
      publishedToRelay: false,
      authorNpub: npub ?? undefined,
      authorName: myDisplayName,
    });

    setSpaceMarkSaveStatus('Placing Mark in this Space...');
    setSpaceMarkProgress(95);

    const spaces = livingSpaces.length > 0 ? livingSpaces : await syncLivingSpacesFromGroups();
    const capture = getSpaceMarkCaptureMetadata(spaceMarkMedia);

    await persistLivingMarkCapture({
      milestone: savedMilestone,
      spaces,
      selectedSpaceId: getGroupLivingSpaceId(group.id),
      currentNpub: npub,
      peopleIds: parseSpaceMarkPeople(spaceMarkPeopleInput),
      lifeStage: spaceMarkLifeStage || undefined,
      eventId: spaceMarkEventInput.trim() || undefined,
      savedToBook: spaceMarkSavedToBook,
      captureSource: capture.captureSource,
      place: capture.place,
      occurredAt: capture.occurredAt,
      capturedAt: capture.occurredAt ?? savedMilestone.createdAt,
      privacy: 'space',
    });

    setSpaceMarkProgress(100);
    resetSpaceMarkDraft();
    setShowSpaceMarkModal(false);

    await load();
  } catch (e: any) {
    console.warn('[Space Mark create] failed', e);
    Alert.alert('Error', e?.message || 'Could not save Mark.');
  } finally {
    setSpaceMarkSaving(false);
    setSpaceMarkSaveStatus(null);
  }
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

const openMarkDetail = (markId: string) => {
  router.push({
    pathname: '/mark-detail',
    params: { id: markId, returnToGroupId: group?.id },
  } as any);
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

  if (!group) return (
    <SafeAreaView style={s.safe}>
      <View style={s.loading}>
        <Text style={s.loadingText}>Loading…</Text>
      </View>
    </SafeAreaView>
  );

const deepLink = `https://beginningend.com/join/${group.inviteCode}`;

const highlightViewerImages: ViewerImage[] = stickies
  .flatMap(sticky => {
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

const galleryViewerImages: ViewerImage[] = [
  ...galleryItems
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
    }),
  ...highlightViewerImages,
];

const openViewerForGalleryItem = (mediaUrl: string) => {
  const galleryOnlyViewerImages: ViewerImage[] = galleryItems
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

  setActiveViewerImages(galleryOnlyViewerImages);
  setSelectedGalleryImage(mediaUrl);
};

const openSpaceChat = () => {
  if (!group?.id) return;
  router.push({ pathname: '/group-thread', params: { id: group.id } } as any);
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
  if (showSpaceSettingsMenu) {
    closeSpaceSettingsMenu();
    return;
  }

  if (showInvite) {
    setShowInvite(false);
    return;
  }

  if (tab !== 'stickies') {
    setTab('stickies');
    return;
  }

  router.replace('/(tabs)/messages' as any);
};

const headerGroupTypeIcon = getGroupTypeIcon(group);
const spaceRelayLabel =
  (group.relayMode ?? 'default') === 'default'
    ? 'bE Relay'
    : group.relayMode === 'custom'
      ? 'Space Relay'
      : 'Both';
const spaceCategoryLabel = group.sport
  ? group.sport.charAt(0).toUpperCase() + group.sport.slice(1)
  : 'No badge';
const spaceHomeMeta = [
  `${members.length} ${members.length === 1 ? 'member' : 'members'}`,
  group.season,
  spaceRelayLabel,
].filter(Boolean).join(' - ');
const spaceHomeSummary =
  group.description?.trim() ||
  `${spaceCategoryLabel === 'No badge' ? 'Living' : spaceCategoryLabel} Space for chat, Marks, calendar, gallery, and book.`;
const isFavoriteSpace = favoriteSpaceIds.includes(group.id);
const relaySettingsCard = (
  <View style={s.groupRelayCard}>
    <View style={s.groupRelayHeader}>
      <View style={{ flex: 1 }}>
        <Text style={s.groupRelayTitle}>Space Relay</Text>
        <Text style={s.groupRelayHint}>
          Choose where Space messages, media, and Marks are saved.
        </Text>
      </View>

      {isAdmin && !editingGroupRelay && (
        <TouchableOpacity onPress={openGroupRelayEditor}>
          <Text style={s.groupRelayManage}>Manage</Text>
        </TouchableOpacity>
      )}
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

      {/* Space profile hero */}
      <View style={s.hiddenHeader}>
        <TouchableOpacity
          onPress={handleSpaceDetailBack}
          style={s.backBtn}
        >
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.groupTitleRow}>
            <View style={s.groupHeaderIcon}>
              {group.coverImage ? (
                <Image source={{ uri: group.coverImage }} style={s.groupHeaderImage} />
              ) : (
                <Text style={s.groupHeaderIconText}>{getGroupAvatarText(group)}</Text>
              )}
            </View>

            {headerGroupTypeIcon ? (
              <View style={s.groupHeaderCategoryBadge}>
                <Text style={s.groupHeaderCategoryText}>{headerGroupTypeIcon}</Text>
              </View>
            ) : null}

            <Text style={s.headerTitle} numberOfLines={1}>{group.name}</Text>
          </View>

          <TouchableOpacity
            onPress={toggleSpaceSettingsMenu}
            activeOpacity={0.75}
            style={[s.memberHeaderPill, showSpaceSettingsMenu && s.memberHeaderPillActive]}
          >
            <Text style={s.memberHeaderText}>
              {members.length} {members.length === 1 ? 'member' : 'members'}
              {group.season ? ` · ${group.season}` : ''}
              {'  '}
              {showSpaceSettingsMenu ? '^' : 'v'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ width: 58 }} />
      </View>

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
              <Text style={[s.spaceChromeIconText, isFavoriteSpace && s.spaceChromeIconTextActive]}>
                {isFavoriteSpace ? '★' : '☆'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleSpaceSettingsMenu}
              style={[s.spaceChromeIconBtn, showSpaceSettingsMenu && s.spaceChromeIconBtnActive]}
              activeOpacity={0.82}
            >
              <Text style={s.spaceChromeIconText}>...</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.spaceProfileTray}>
          <Text style={s.spaceProfileTitle} numberOfLines={2}>{group.name}</Text>
          <Text style={s.spaceProfileMeta} numberOfLines={1}>{spaceHomeMeta}</Text>

          <View style={s.spaceProfilePills}>
            <TouchableOpacity style={s.spaceProfilePill} onPress={openSpaceChat} activeOpacity={0.86}>
              <Text style={s.spaceProfilePillText}>Chat</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.spaceProfilePill, tab === 'stickies' && s.spaceProfilePillActive]}
              onPress={() => setTab('stickies')}
              activeOpacity={0.86}
            >
              <Text style={[s.spaceProfilePillText, tab === 'stickies' && s.spaceProfilePillTextActive]}>
                Marks
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.spaceProfilePill, tab === 'calendar' && s.spaceProfilePillActive]}
              onPress={() => setTab('calendar')}
              activeOpacity={0.86}
            >
              <Text style={[s.spaceProfilePillText, tab === 'calendar' && s.spaceProfilePillTextActive]}>
                Calendar
              </Text>
            </TouchableOpacity>

            {group.bookEnabled === true && (
              <TouchableOpacity
                style={[s.spaceProfilePill, tab === 'book' && s.spaceProfilePillActive]}
                onPress={() => setTab('book')}
                activeOpacity={0.86}
              >
                <Text style={[s.spaceProfilePillText, tab === 'book' && s.spaceProfilePillTextActive]}>
                  Book
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Header settings and invite panels */}
      {showSpaceSettingsMenu && (
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
              <Text style={s.spaceSettingsTitle}>{group.name}</Text>
              <Text style={s.spaceSettingsHint} numberOfLines={2}>
                {group.description || 'Chat, Marks, calendar, gallery, and book work for this Space.'}
              </Text>
            </View>
          </View>

          <View style={s.spaceSettingsChips}>
            <Text style={s.spaceSettingsChip}>{members.length} members</Text>
            <Text style={s.spaceSettingsChip}>{spaceMarkViews.length} Marks</Text>
            <Text style={s.spaceSettingsChip}>{spaceCategoryLabel}</Text>
            <Text style={s.spaceSettingsChip}>{spaceRelayLabel}</Text>
          </View>

          <TouchableOpacity
            style={s.spaceSettingsRow}
            onPress={() => {
              closeSpaceSettingsMenu();
              setTab('members');
            }}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.spaceSettingsRowTitle}>People and Access</Text>
              <Text style={s.spaceSettingsRowHint}>View members, roles, and member actions.</Text>
            </View>
            <Text style={s.spaceSettingsRowAction}>Open</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.spaceSettingsRow}
            onPress={() => {
              closeSpaceSettingsMenu();
              setTab('gallery');
            }}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.spaceSettingsRowTitle}>Files and Gallery</Text>
              <Text style={s.spaceSettingsRowHint}>View shared photos, videos, and Space media.</Text>
            </View>
            <Text style={s.spaceSettingsRowAction}>Open</Text>
          </TouchableOpacity>

          {isAdmin && (
            <TouchableOpacity
              style={s.spaceSettingsRow}
              onPress={() => {
                closeSpaceSettingsMenu();
                setShowInvite(true);
              }}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.spaceSettingsRowTitle}>Invite and Share</Text>
                <Text style={s.spaceSettingsRowHint}>Show invite code, QR, copy, or share.</Text>
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
              <Text style={s.spaceSettingsRowHint}>Current route: {spaceRelayLabel}</Text>
            </View>
            <Text style={s.spaceSettingsRowAction}>{spaceSettingsRelayOpen ? 'Hide' : 'Open'}</Text>
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
      )}

      {showInvite && isAdmin && (
        <View style={s.invitePanel}>
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
      )}

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabRow}
        contentContainerStyle={s.tabRowContent}
      >
        {(['chat', 'stickies', 'calendar', 'gallery', 'book'] as MainTab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tabBtn, tab === t && s.tabBtnActive]}
            onPress={() => {
              if (t === 'chat') {
                openSpaceChat();
                return;
              }

              setTab(t);
            }}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'chat'
                ? 'Chat'
                : t === 'stickies'
                ? `Marks (${spaceMarkViews.length + stickies.length})`
                : t === 'calendar'
                  ? `Calendar${upcomingCount > 0 ? ` (${upcomingCount})` : ''}`
                  : t === 'gallery'
                    ? `Gallery (${galleryItems.length})`
                    : 'Book'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Stickies tab */}
      {tab === 'stickies' && (
        <ScrollView
          contentContainerStyle={s.timelineContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.gold} />}
        >
    <View style={s.hiddenHeader}>
      <View style={s.spaceHeroMedia}>
        {group.coverImage ? (
          <Image source={{ uri: group.coverImage }} style={s.spaceHeroImage} />
        ) : (
          <View style={s.spaceHeroFallback}>
            <Text style={s.spaceHeroFallbackText}>{getGroupAvatarText(group)}</Text>
          </View>
        )}
        <View style={s.spaceHeroShade} />
        <View style={s.spaceHeroContent}>
          <Text style={s.spaceHeroEyebrow}>
            {spaceCategoryLabel === 'No badge' ? 'Living Space' : `${spaceCategoryLabel} Space`}
          </Text>
          <Text style={s.spaceHeroTitle} numberOfLines={2}>{group.name}</Text>
          <Text style={s.spaceHeroMeta} numberOfLines={1}>{spaceHomeMeta}</Text>
        </View>
      </View>

      <View style={s.spaceHeroBody}>
        <Text style={s.spaceHeroSummary} numberOfLines={3}>{spaceHomeSummary}</Text>

        <View style={s.spaceHeroStats}>
          <View style={s.spaceHeroStat}>
            <Text style={s.spaceHeroStatValue}>{spaceMarkViews.length}</Text>
            <Text style={s.spaceHeroStatLabel}>Marks</Text>
          </View>
          <View style={s.spaceHeroStat}>
            <Text style={s.spaceHeroStatValue}>{galleryItems.length}</Text>
            <Text style={s.spaceHeroStatLabel}>Media</Text>
          </View>
          <View style={s.spaceHeroStat}>
            <Text style={s.spaceHeroStatValue}>{upcomingCount}</Text>
            <Text style={s.spaceHeroStatLabel}>Events</Text>
          </View>
        </View>

        <View style={s.spaceHeroActions}>
          <TouchableOpacity style={[s.spaceHeroAction, s.spaceHeroActionPrimary]} onPress={openSpaceChat} activeOpacity={0.86}>
            <Text style={[s.spaceHeroActionText, s.spaceHeroActionTextPrimary]}>Chat</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.spaceHeroAction,
              (group.status !== 'active' || !isAdmin || !isMember) && s.spaceHeroActionDisabled,
            ]}
            onPress={() => {
              if (group.status === 'active' && isAdmin && isMember) {
                setShowSpaceMarkModal(true);
              }
            }}
            disabled={group.status !== 'active' || !isAdmin || !isMember}
            activeOpacity={0.86}
          >
            <Text style={s.spaceHeroActionText}>+ Mark</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.spaceHeroAction} onPress={() => setTab('calendar')} activeOpacity={0.86}>
            <Text style={s.spaceHeroActionText}>Calendar</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.spaceHeroAction} onPress={() => setTab('gallery')} activeOpacity={0.86}>
            <Text style={s.spaceHeroActionText}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.spaceHeroAction} onPress={() => setTab('book')} activeOpacity={0.86}>
            <Text style={s.spaceHeroActionText}>Book</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>

    <View style={s.spaceMarksOverview}>
      <View style={{ flex: 1 }}>
        <Text style={s.spaceMarksTitle}>Space Marks</Text>
        <Text style={s.spaceMarksHint}>
          Real Marks created here stay attached to this Space. Legacy notes remain visible below.
        </Text>
      </View>

      <View style={s.spaceMarksStats}>
        <Text style={s.spaceMarksStatText}>{spaceMarkViews.length} Marks</Text>
        {stickies.length > 0 && (
          <Text style={s.spaceMarksLegacyText}>{stickies.length} legacy</Text>
        )}
      </View>
    </View>

    {group.status === 'archived' && (
      <View style={s.archivedBanner}>
        <Text style={s.archivedBannerText}>
          📦 This Space is archived. Marks can still be viewed.
        </Text>
      </View>
    )}

    {spaceMarkViews.length === 0 && stickies.length === 0 ? (
      <View style={s.empty}>
        <Text style={s.emptyIcon}>📌</Text>
        <Text style={s.emptyText}>No Marks yet</Text>
        <Text style={s.emptyHint}>
          Admins can add Marks, reminders, or important notes here.
        </Text>
      </View>
    ) : (
      <>
        {spaceMarkViews.map(view => {
          const mark = view.milestone;
          const markText = getMilestoneText(mark);
          const markMedia = getMilestoneMediaItems(mark);
          const markMeta = [
            formatStickyDate(mark.createdAt),
            view.metadata.privacy === 'space' ? 'Space' : view.metadata.privacy,
            view.metadata.savedToBook ? 'Book' : null,
          ].filter(Boolean).join(' - ');

          return (
            <TouchableOpacity
              key={mark.id}
              style={s.spaceMarkCard}
              onPress={() => openMarkDetail(mark.id)}
              activeOpacity={0.86}
            >
              <View style={s.spaceMarkCardTop}>
                <View style={s.spaceMarkAvatar}>
                  <Text style={s.spaceMarkAvatarText}>M</Text>
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.spaceMarkTitle} numberOfLines={2}>{markText.title}</Text>
                  <Text style={s.spaceMarkMeta} numberOfLines={1}>{markMeta}</Text>
                </View>

                <Text style={s.spaceMarkBadge}>Mark</Text>
              </View>

              {markText.body ? (
                <Text style={s.spaceMarkBody}>{markText.body}</Text>
              ) : null}

              {markMedia.length > 0 && (
                <MediaCollage
                  media={markMedia}
                  onPressMedia={(index) => openViewerForMilestone(mark, index)}
                />
              )}

              {mark.tags.length > 0 && (
                <View style={s.markTagRow}>
                  {mark.tags.map(tag => (
                    <Text key={`${mark.id}_${tag}`} style={s.markTag}>
                      {tag}
                    </Text>
                  ))}
                </View>
              )}

              <Text style={s.spaceMarkOpenHint}>Open Mark Detail</Text>
            </TouchableOpacity>
          );
        })}

        {stickies.map(sticky => (
          <View key={sticky.id} style={s.stickyCard}>
            <View style={s.stickyTop}>
              <Text style={s.stickyTitle}>{sticky.title}</Text>
              {isAdmin && (
                <TouchableOpacity onPress={() => handleDeleteSticky(sticky)}>
                  <Text style={s.stickyDelete}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {sticky.body ? (
              <Text style={s.stickyBody}>{sticky.body}</Text>
            ) : null}

            {getStickyVisualMediaItems(sticky).length > 0 && (
              <MediaCollage
                media={getStickyVisualMediaItems(sticky)}
                onPressMedia={(index) => openViewerForSticky(sticky, index)}
              />
            )}

            {getStickyFileItems(sticky).length > 0 && (
              <View style={s.stickyFileList}>
                {getStickyFileItems(sticky).map((file, index) => (
        <TouchableOpacity
          key={`${sticky.id}_file_${index}`}
          style={s.stickyFileRow}
          onPress={() => handleOpenHighlightFile(file.mediaUrl || file.uri)}
          activeOpacity={0.82}
        >
          <Text style={s.stickyFileIcon}>📎</Text>

          <View style={{ flex: 1 }}>
            <Text style={s.stickyFileName} numberOfLines={1}>
              {file.fileName || file.name || 'Attached file'}
            </Text>

            {!!file.mimeType && (
              <Text style={s.stickyFileMeta} numberOfLines={1}>
                {file.mimeType}
              </Text>
            )}
          </View>

          <Text style={s.stickyFileOpen}>Open</Text>
        </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={s.stickyMeta}>
              Legacy note - {formatStickyDate(sticky.createdAt)}
            </Text>
          </View>
        ))}
      </>
    )}
        </ScrollView>
      )}

      {/* Calendar tab */}
      {tab === 'calendar' && (
        <GroupCalendarTab
          group={group}
          isAdmin={isAdmin}
          isMember={isMember}
          npub={npub ?? undefined}
          displayName={npub ? `${npub.slice(0, 12)}…` : undefined}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}

      {tab === 'gallery' && (
        <FlatList
          data={galleryItems}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={s.galleryGrid}
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
                    source={{ uri: item.mediaUrl }}
                    style={s.galleryTileImage}
                    resizeMode="cover"
                  />
                )}
              </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🖼️</Text>
              <Text style={s.emptyText}>No media yet</Text>
              <Text style={s.emptyHint}>
                Photos and videos posted in chat will appear here.
              </Text>
            </View>
          }
        />
      )}

            {/* Book tab */}
      {tab === 'book' && (
        <GroupBookTab
          group={group}
          npub={npub ?? undefined}
          nsec={nsec ?? undefined}
          displayName={myDisplayName}
          theme={theme}
          onGroupUpdated={load}
        />
      )}

      {/* Members tab */}
      {tab === 'members' && (
        <FlatList
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
            <View style={s.empty}>
              <Text style={s.emptyIcon}>👥</Text>
              <Text style={s.emptyText}>No members yet</Text>
              <Text style={s.emptyHint}>
                Members will appear here after they join this Space.
              </Text>
            </View>
          }
        />
      )}
      {/* Group actions bar */}
      {group.status === 'active' && isAdmin && isMember && (
        <View style={s.adminBar}>
          <TouchableOpacity
            style={s.adminBtnGold}
            onPress={() => setShowSpaceMarkModal(true)}
            activeOpacity={0.88}
          >
            <Text style={s.adminBtnGoldText}>+ Mark</Text>
          </TouchableOpacity>
        </View>
      )}

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

      <ImageViewerModal
        images={activeViewerImages.length > 0 ? activeViewerImages : galleryViewerImages}
        selectedUri={selectedGalleryImage}
        onClose={() => {
          setSelectedGalleryImage(null);
          setActiveViewerImages([]);
        }}
      />

      <Modal
        visible={showSpaceMarkModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (spaceMarkSaving) return;
          resetSpaceMarkDraft();
          setShowSpaceMarkModal(false);
        }}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.modalScrollContent}
          >
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>New Mark in {group.name}</Text>

              <Text style={s.inputLabel}>TITLE</Text>
              <TextInput
                style={s.input}
                value={spaceMarkTitle}
                onChangeText={setSpaceMarkTitle}
                placeholder="Name this Mark..."
                placeholderTextColor={theme.textMuted}
              />

              <Text style={s.inputLabel}>NOTE</Text>
              <TextInput
                style={[s.input, s.inputMulti]}
                value={spaceMarkNote}
                onChangeText={setSpaceMarkNote}
                placeholder="What happened?"
                placeholderTextColor={theme.textMuted}
                multiline
                textAlignVertical="top"
              />

              <Text style={s.inputLabel}>MEDIA</Text>
              {spaceMarkMedia.length > 0 ? (
                <View>
                  <MediaCollage
                    media={spaceMarkMedia}
                    onPressMedia={() => {}}
                  />

                  <TouchableOpacity
                    style={s.highlightRemoveMediaBtn}
                    onPress={() => setSpaceMarkMedia([])}
                  >
                    <Text style={s.highlightRemoveMediaText}>Remove media</Text>
                  </TouchableOpacity>

                  <View style={s.highlightAttachmentRow}>
                    <TouchableOpacity
                      style={[s.highlightAddMediaBtn, s.highlightAttachmentHalf]}
                      onPress={handlePickSpaceMarkMedia}
                      activeOpacity={0.85}
                    >
                      <Text style={s.highlightAddMediaText}>+ Media</Text>
                      <Text style={s.highlightAddMediaHint}>Photos/videos</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={s.highlightAttachmentRow}>
                  <TouchableOpacity
                    style={[s.highlightAddMediaBtn, s.highlightAttachmentHalf]}
                    onPress={handlePickSpaceMarkMedia}
                    activeOpacity={0.85}
                  >
                    <Text style={s.highlightAddMediaText}>+ Add media</Text>
                    <Text style={s.highlightAddMediaHint}>Photos/videos</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={s.inputLabel}>TAGS</Text>
              <View style={s.markTagRow}>
                {SPACE_MARK_PRESET_TAGS.map(tag => {
                  const active = spaceMarkTags.some(existing => existing.toLowerCase() === tag.toLowerCase());

                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[s.markTagChip, active && s.markTagChipActive]}
                      onPress={() => active ? removeSpaceMarkTag(tag) : addSpaceMarkTag(tag)}
                      activeOpacity={0.82}
                    >
                      <Text style={[s.markTagChipText, active && s.markTagChipTextActive]}>
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {spaceMarkTags.length > 0 && (
                <View style={s.markTagRow}>
                  {spaceMarkTags.map(tag => (
                    <TouchableOpacity
                      key={tag}
                      style={s.markTag}
                      onPress={() => removeSpaceMarkTag(tag)}
                    >
                      <Text style={s.markTagText}>{tag} x</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={s.markTagInputRow}>
                <TextInput
                  style={[s.input, s.markTagInput]}
                  value={spaceMarkTagInput}
                  onChangeText={setSpaceMarkTagInput}
                  placeholder="Custom tag..."
                  placeholderTextColor={theme.textMuted}
                  onSubmitEditing={() => addSpaceMarkTag(spaceMarkTagInput)}
                />
                <TouchableOpacity
                  style={s.markTagAddBtn}
                  onPress={() => addSpaceMarkTag(spaceMarkTagInput)}
                  activeOpacity={0.82}
                >
                  <Text style={s.markTagAddText}>+</Text>
                </TouchableOpacity>
              </View>

              <Text style={s.inputLabel}>CONTEXT</Text>
              <TouchableOpacity
                style={s.markContextToggle}
                onPress={() => setSpaceMarkShowContext(prev => !prev)}
                activeOpacity={0.82}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.markContextTitle}>Optional details</Text>
                  <Text style={s.markContextHint}>People, life stage, event, or Living Book.</Text>
                </View>
                <Text style={s.markContextAction}>{spaceMarkShowContext ? 'Hide' : 'Add'}</Text>
              </TouchableOpacity>

              {spaceMarkShowContext && (
                <View style={s.markContextPanel}>
                  <TextInput
                    style={s.input}
                    value={spaceMarkPeopleInput}
                    onChangeText={setSpaceMarkPeopleInput}
                    placeholder="People in this Mark, separated by commas"
                    placeholderTextColor={theme.textMuted}
                  />

                  <Text style={s.inputLabel}>LIFE STAGE</Text>
                  <View style={s.markTagRow}>
                    {SPACE_MARK_LIFE_STAGE_OPTIONS.map(option => {
                      const active = spaceMarkLifeStage === option;

                      return (
                        <TouchableOpacity
                          key={option}
                          style={[s.markTagChip, active && s.markTagChipActive]}
                          onPress={() => setSpaceMarkLifeStage(active ? '' : option)}
                          activeOpacity={0.82}
                        >
                          <Text style={[s.markTagChipText, active && s.markTagChipTextActive]}>
                            {option}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TextInput
                    style={s.input}
                    value={spaceMarkEventInput}
                    onChangeText={setSpaceMarkEventInput}
                    placeholder="Event, season, trip, or ceremony"
                    placeholderTextColor={theme.textMuted}
                  />

                  <TouchableOpacity
                    style={[s.visibilityOption, spaceMarkSavedToBook && s.visibilityOptionActive]}
                    onPress={() => setSpaceMarkSavedToBook(prev => !prev)}
                    activeOpacity={0.82}
                  >
                    <Text style={s.visibilityIcon}>Book</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.visibilityTitle}>Save toward Living Book</Text>
                      <Text style={s.visibilityHint}>Add this Mark to the future book view.</Text>
                    </View>
                    <Text style={s.visibilityStatus}>{spaceMarkSavedToBook ? 'ON' : 'OFF'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={s.inputLabel}>PLACEMENT</Text>
              <View style={[s.visibilityOption, s.visibilityOptionActive]}>
                <Text style={s.visibilityIcon}>Space</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.visibilityTitle}>{group.name}</Text>
                  <Text style={s.visibilityHint}>Locked to this Space as a real Mark.</Text>
                </View>
                <Text style={s.visibilityStatus}>ON</Text>
              </View>

              {spaceMarkSaveStatus && (
                <View style={{ marginTop: 12 }}>
                  <Text style={s.highlightUploadStatus}>{spaceMarkSaveStatus}</Text>
                  <View style={s.markProgressTrack}>
                    <View
                      style={[
                        s.markProgressFill,
                        { width: `${Math.max(spaceMarkProgress, 5)}%` },
                      ]}
                    />
                  </View>
                  <Text style={s.markProgressText}>{Math.round(spaceMarkProgress)}%</Text>
                </View>
              )}

              <View style={s.modalActions}>
                <TouchableOpacity
                  style={[s.cancelBtn, spaceMarkSaving && s.confirmBtnDisabled]}
                  disabled={spaceMarkSaving}
                  onPress={() => {
                    resetSpaceMarkDraft();
                    setShowSpaceMarkModal(false);
                  }}
                >
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.confirmBtn, spaceMarkSaving && s.confirmBtnDisabled]}
                  onPress={handleCreateSpaceMark}
                  disabled={spaceMarkSaving}
                >
                  {spaceMarkSaving ? (
                    <ActivityIndicator size="small" color={theme.bg} />
                  ) : (
                    <Text style={s.confirmText}>Save Mark</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

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
  safe: { flex: 1, backgroundColor: theme.bg },
  hiddenHeader: { display: 'none' },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg,
  },
  loadingText: { color: theme.textMuted, fontSize: 15 },

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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    backgroundColor: theme.bg,
  },
  backBtn: { width: 58 },
  backText: { color: theme.gold, fontSize: 14, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  groupHeaderIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.gold + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupHeaderIconText: {
    fontSize: 16,
  },
  groupHeaderImage: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  groupHeaderCategoryBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.gold + '55',
  },
  groupHeaderCategoryText: {
    fontSize: 12,
  },
  headerTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  headerSub: { color: theme.textMuted, fontSize: 11, marginTop: 2, fontWeight: '600' },
  memberHeaderPill: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  memberHeaderPillActive: {
    backgroundColor: theme.raised,
    borderColor: theme.gold + '66',
  },
  memberHeaderText: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '800',
  },
  inviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.gold,
  },
  inviteBtnText: {
    color: theme.bg,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  spaceProfileHero: {
    height: 336,
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
    lineHeight: 20,
  },
  spaceChromeIconTextActive: {
    color: theme.bg,
  },
  spaceProfileTray: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 16,
    borderRadius: 22,
    padding: 16,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.94)'
      : 'rgba(18,18,18,0.92)',
    borderWidth: 0.5,
    borderColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.72)'
      : 'rgba(255,255,255,0.10)',
  },
  spaceProfileTitle: {
    color: theme.text,
    fontSize: 23,
    fontWeight: '900',
  },
  spaceProfileMeta: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  spaceProfilePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 13,
  },
  spaceProfilePill: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  spaceProfilePillActive: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  spaceProfilePillText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '900',
  },
  spaceProfilePillTextActive: {
    color: theme.bg,
  },
  spaceHomeHero: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginBottom: 14,
  },
  spaceHeroMedia: {
    height: 188,
    position: 'relative',
    backgroundColor: theme.raised,
  },
  spaceHeroImage: {
    width: '100%',
    height: '100%',
  },
  spaceHeroFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
  },
  spaceHeroFallbackText: {
    color: theme.gold,
    fontSize: 54,
    fontWeight: '900',
  },
  spaceHeroShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(17, 24, 28, 0.24)'
      : 'rgba(0, 0, 0, 0.42)',
  },
  spaceHeroContent: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  spaceHeroEyebrow: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  spaceHeroTitle: {
    color: '#fff',
    fontSize: 27,
    fontWeight: '900',
    marginTop: 4,
  },
  spaceHeroMeta: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    opacity: 0.9,
  },
  spaceHeroBody: {
    padding: 14,
    gap: 12,
  },
  spaceHeroSummary: {
    color: theme.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  spaceHeroStats: {
    flexDirection: 'row',
    gap: 8,
  },
  spaceHeroStat: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: theme.raised,
    alignItems: 'center',
  },
  spaceHeroStatValue: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '900',
  },
  spaceHeroStatLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  spaceHeroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  spaceHeroAction: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
  },
  spaceHeroActionPrimary: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  spaceHeroActionDisabled: {
    opacity: 0.45,
  },
  spaceHeroActionText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '900',
  },
  spaceHeroActionTextPrimary: {
    color: theme.bg,
  },
  stickyCard: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
    marginBottom: 13,
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
  stickyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 9,
  },
  stickyTitle: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  stickyDelete: {
    color: '#555',
    fontSize: 16,
    paddingHorizontal: 4,
    fontWeight: '700',
  },
  stickyBody: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 21,
  },
  stickyMeta: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 12,
    fontWeight: '600',
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
  stickyFileList: {
    gap: 8,
    marginTop: 12,
  },
  stickyFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
  },
  stickyFileIcon: {
    fontSize: 17,
  },
  stickyFileName: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '800',
  },
  stickyFileMeta: {
    color: theme.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  stickyFileOpen: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
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
  inviteMeta: { fontSize: 11, color: '#444', marginTop: 10, lineHeight: 16 },

  // Tabs
  tabRow: {
    display: 'none',
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    backgroundColor: theme.bg,
  },
  tabRowContent: {
    paddingHorizontal: 12,
  },
  tabBtn: {
    minWidth: 86,
    paddingVertical: 13,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: theme.gold,
  },
  tabText: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  tabTextActive: {
    color: theme.gold,
    fontWeight: '800',
  },

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
  timelineContainer: { padding: 20, paddingBottom: 100 },
  archivedBanner: { backgroundColor: theme.raised, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 0.5, borderColor: '#3a3a00' },
  archivedBannerText: { color: theme.textMuted,fontSize: 13, textAlign: 'center' },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyText: { fontSize: 17, color: theme.text, fontWeight: '500' },
  emptyHint: { fontSize: 13, color: theme.textMuted, marginTop: 6, textAlign: 'center' },

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
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    padding: 20,
  },
  modalTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  highlightUploadStatus: {
    color: '#c9973a',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.65,
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
  inputMulti: {
    minHeight: 120,
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
});
