import GroupBookTab from '@/components/GroupBookTab';
import GroupCalendarTab from '@/components/GroupCalendarTab';
import {
  getUpcomingEventsForGroup,
  syncCalendarEventsFromRelay,
} from '@/src/utils/group-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
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
  createGroupSticky,
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
import {
  compressImageForUpload,
  compressVideoForUpload,
} from '../src/utils/media-compression';
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
import { uploadToR2 } from '../src/utils/r2';
import { useIdentity } from './_layout';

type Tab = 'stickies' | 'calendar' | 'gallery' | 'members' | 'book';
type MainTab = 'stickies' | 'calendar' | 'gallery' | 'book';
const GROUP_LOCAL_GALLERY_KEY = 'be_group_local_gallery_v1';

type LocalGalleryItem = {
  id: string;
  groupId: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string;
  createdAt: number;
  source: 'highlight';
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

function getGroupIcon(group: BEGroup): string {
  const customIcon = group.icon?.trim();

  if (customIcon) {
    return customIcon;
  }

  const directKey = normalizeGroupType(group.sport);

  if (directKey && GROUP_TYPE_ICONS[directKey]) {
    return GROUP_TYPE_ICONS[directKey];
  }

  const searchText = normalizeGroupType(`${group.name} ${group.description ?? ''}`);

  if (searchText.includes('faculty') || searchText.includes('teacher') || searchText.includes('staff')) {
    return GROUP_TYPE_ICONS.faculty;
  }

  if (searchText.includes('class')) {
    return GROUP_TYPE_ICONS.class;
  }

  if (searchText.includes('booster')) {
    return GROUP_TYPE_ICONS.booster;
  }

  return GROUP_TYPE_ICONS.default;
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

export default function GroupDetailScreen() {
const { id, tab: routeTab } = useLocalSearchParams<{
  id: string;
  tab?: Tab;
  highlightId?: string;
  calendarEventId?: string;
  memberNpub?: string;
}>();
  const router = useRouter();
  const { npub, nsec, profile, theme, themeMode } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);

  const [group, setGroup] = useState<BEGroup | null>(null);
  const [members, setMembers] = useState<BEGroupMember[]>([]);
  const [stickies, setStickies] = useState<GroupSticky[]>([]);
  const [galleryItems, setGalleryItems] = useState<any[]>([]);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<string | null>(null);
  const [activeViewerImages, setActiveViewerImages] = useState<ViewerImage[]>([]);
  const [showStickyModal, setShowStickyModal] = useState(false);
  const [stickyTitle, setStickyTitle] = useState('');
  const [stickyBody, setStickyBody] = useState('');
  const [stickyVisibility, setStickyVisibility] = useState<'private' | 'organization' | 'public'>('private');
  type HighlightAttachment = {
    uri: string;
    type: 'image' | 'video' | 'file';
    name?: string;
    mimeType?: string;
  };

  const [selectedHighlightMedia, setSelectedHighlightMedia] = useState<HighlightAttachment | null>(null);

  const [selectedHighlightMediaList, setSelectedHighlightMediaList] = useState<HighlightAttachment[]>([]);
  const [highlightPosting, setHighlightPosting] = useState(false);
  const [highlightUploadStatus, setHighlightUploadStatus] = useState<string | null>(null);
  const [highlightProgress, setHighlightProgress] = useState(0);
  const [tab, setTab] = useState<Tab>(
  routeTab === 'calendar' || routeTab === 'gallery' || routeTab === 'members' || routeTab === 'book'
    ? routeTab
    : 'stickies'
);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [editingGroupRelay, setEditingGroupRelay] = useState(false);
  const [groupRelayMode, setGroupRelayMode] = useState<GroupRelayMode>('default');
  const [groupRelayUrl, setGroupRelayUrl] = useState('');
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [selectedMemberAction, setSelectedMemberAction] = useState<BEGroupMember | null>(null);
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

  const load = useCallback(async () => {
    if (!id) return;

    const runId = groupDetailLoadRunIdRef.current + 1;
    groupDetailLoadRunIdRef.current = runId;

    const g = await getGroupById(id);

    if (!g) return;

    setGroup(g);

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
  }, [id, npub, hydrateMemberProfiles]);

  useEffect(() => {
    load();

    return () => {
      groupDetailLoadRunIdRef.current += 1;
    };
  }, [load]);

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
      Alert.alert('Relay required', 'Enter the group or school relay URL.');
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

    setEditingGroupRelay(false);
    await load();

    Alert.alert('Saved', 'Group relay settings updated.');
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

  const handleRegenerateCode = () => {
    Alert.alert(
      'Regenerate invite code?',
      'The old code will stop working immediately. Share the new code with your group.',
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
      'Archive this group?',
      'Members can still view past posts but no new posts will be allowed. You can start a new season anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive', style: 'destructive', onPress: async () => {
            if (!group) return;
            await archiveGroup(group.id);
            await load();
          }
        }
      ]
    );
  };

  const handlePickHighlightMedia = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to add media to a highlight.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.75,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Low,
        allowsMultipleSelection: true,
        selectionLimit: 10,
      });

      if (result.canceled || !result.assets?.length) return;

      const newItems: HighlightAttachment[] = result.assets
        .filter(asset => !!asset.uri)
        .map(asset => ({
          uri: asset.uri,
          type: asset.type === 'video' ? 'video' : 'image',
          name: asset.fileName ?? undefined,
          mimeType: asset.mimeType ?? undefined,
        }));

      setSelectedHighlightMediaList(prev => [...prev, ...newItems]);
      setSelectedHighlightMedia(newItems[0] ?? null);
    } catch (e) {
      console.warn('[Highlight media picker] failed', e);
      Alert.alert('Media error', 'Could not open your photo library.');
    }
  };

  const handlePickHighlightFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const newFiles: HighlightAttachment[] = result.assets
        .filter(asset => !!asset.uri)
        .map(asset => ({
          uri: asset.uri,
          type: 'file',
          name: asset.name,
          mimeType: asset.mimeType,
        }));

      setSelectedHighlightMediaList(prev => [...prev, ...newFiles]);
      setSelectedHighlightMedia(newFiles[0] ?? null);
    } catch (e) {
      console.warn('[Highlight file picker] failed', e);
      Alert.alert('File error', 'Could not open the file picker.');
    }
  };
  
  const handleCreateSticky = async () => {
  if (!group || highlightPosting) return;

  const title = stickyTitle.trim();
  const body = stickyBody.trim() || '';

  if (!title) {
    Alert.alert('Missing title', 'Add a title for the highlight.');
    return;
  }

  const mediaToUpload =
    selectedHighlightMediaList.length > 0
      ? selectedHighlightMediaList
      : selectedHighlightMedia
        ? [selectedHighlightMedia]
        : [];

  setHighlightPosting(true);
  setHighlightUploadStatus(
    mediaToUpload.length > 0 ? 'Preparing media...' : 'Posting highlight...'
  );
  setHighlightProgress(0);

  try {
    const uploadedHighlightMedia: {
      mediaUrl: string;
      mediaType: 'image' | 'video' | 'file';
      thumbnailUrl?: string;
      imageUrl?: string;
      fileName?: string;
      mimeType?: string;
    }[] = [];

    const totalSteps = Math.max(mediaToUpload.length * 3, 1);
    let currentStep = 0;

    const advanceProgress = () => {
      currentStep++;
      setHighlightProgress(Math.min(currentStep / totalSteps, 0.98));
    };

    for (let i = 0; i < mediaToUpload.length; i++) {
      const item = mediaToUpload[i];
      let uploadUri = item.uri;

      if (item.type === 'image') {
        setHighlightUploadStatus(`Optimizing photo ${i + 1} of ${mediaToUpload.length}...`);

        const compressionResult = await compressImageForUpload({
          uri: item.uri,
          onStatus: setHighlightUploadStatus,
        });

        uploadUri = compressionResult.uri;
        advanceProgress();

        if (compressionResult.wasCompressed) {
          setHighlightUploadStatus(`Uploading optimized photo ${i + 1} of ${mediaToUpload.length}...`);
        } else {
          setHighlightUploadStatus(`Uploading photo ${i + 1} of ${mediaToUpload.length}...`);
        }
      } else if (item.type === 'video') {
        const compressionResult = await compressVideoForUpload({
          uri: item.uri,
          onStatus: setHighlightUploadStatus,
          onProgress: progress => {
            setHighlightUploadStatus(
              `Compressing video ${i + 1} of ${mediaToUpload.length}… ${Math.round(progress * 100)}%`
            );
          },
        });

        uploadUri = compressionResult.uri;
        advanceProgress();

        if (compressionResult.wasCompressed) {
          setHighlightUploadStatus(`Uploading compressed video ${i + 1} of ${mediaToUpload.length}...`);
        } else {
          setHighlightUploadStatus(`Uploading video ${i + 1} of ${mediaToUpload.length}...`);
        }
      } else {
        setHighlightUploadStatus(`Uploading file ${i + 1} of ${mediaToUpload.length}...`);
        advanceProgress();
      }

      const uploadedUrl = await uploadToR2(
        uploadUri,
        item.type === 'video' ? 'video' : item.type === 'image' ? 'photo' : 'file'
      );

      advanceProgress();

      if (!uploadedUrl) {
        console.warn('[Highlight upload] skipped failed item:', item.uri);
        continue;
      }

      let thumbnailUrl: string | undefined;

      if (item.type === 'video') {
        try {
          setHighlightUploadStatus(`Creating thumbnail ${i + 1} of ${mediaToUpload.length}...`);

          const thumbnail = await VideoThumbnails.getThumbnailAsync(uploadUri, {
            time: 1000,
          });

          setHighlightUploadStatus(`Uploading thumbnail ${i + 1} of ${mediaToUpload.length}...`);

          const uploadedThumbnail = await uploadToR2(thumbnail.uri, 'photo');
          thumbnailUrl = uploadedThumbnail || undefined;

          advanceProgress();
        } catch (thumbError) {
          console.warn('[Highlight thumbnail] failed:', thumbError);
          advanceProgress();
        }
      } else {
        advanceProgress();
      }

      uploadedHighlightMedia.push({
        mediaUrl: uploadedUrl,
        mediaType: item.type,
        thumbnailUrl,
        imageUrl: item.type === 'image' ? uploadedUrl : undefined,
        fileName: item.name,
        mimeType: item.mimeType,
      });
    }

    setHighlightProgress(1);
    setHighlightUploadStatus('Posting highlight...');

    const createdSticky = await createGroupSticky({
      groupId: group.id,
      title,
      body,
      authorName: myDisplayName,
      authorNpub: npub ?? undefined,
      relayUrl: group.relayUrl,
      media: uploadedHighlightMedia,
    } as any);

    if (npub) {
      notifyGroupEvent({
        groupId: group.id,
        groupName: group.name,
        relayUrl: group.relayUrl,
        actorNpub: npub,
        actorName: myDisplayName,
        eventType: 'highlight_created',
        title,
        highlightId: createdSticky.id,
        routeTarget: 'group-detail',
        groupTab: 'stickies',
      }).catch(error => {
        console.warn('[Group Detail] highlight notification failed:', error);
      });
    }

    setStickyTitle('');
    setStickyBody('');
    setStickyVisibility('private');
    setSelectedHighlightMedia(null);
    setSelectedHighlightMediaList([]);
    setShowStickyModal(false);

    await load();
  } catch (e: any) {
    console.warn('[Highlight create] failed', e);
    Alert.alert('Error', e?.message || 'Could not post highlight.');
  }

  setHighlightPosting(false);
  setHighlightUploadStatus(null);
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
      'Delete highlight?',
      'This removes the highlight from this device. Relay deletion will be handled later.',
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
    'Delete highlight?',
    'This highlight has media. Do you want to keep the media in Gallery?',
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
      'Their past posts will remain but they will no longer be able to view or post in this group.',
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
              text: `${removedName} was removed from the group`,
              systemType: 'remove',
              actorNpub: member.npub,
              actorName: removedName,
            });

            if (nsec) {
              publishGroupMessage({
                groupId: group.id,
                clientMessageId: `system_remove_${group.id}_${member.npub}_${Date.now()}`,
                text: `${removedName} was removed from the group`,
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
      'You will lose access to this group. Past messages may remain visible to other members.',
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
              text: `${leftName} left the group`,
              systemType: 'leave',
              actorNpub: npub,
              actorName: leftName,
            });

            if (nsec) {
              publishGroupMessage({
                groupId: group.id,
                clientMessageId: `system_leave_${group.id}_${npub}_${Date.now()}`,
                text: `${leftName} left the group`,
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

            router.replace('/(tabs)/groups' as any);
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

  return (
    <SafeAreaView style={s.safe}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/groups' as any);
          }}
          style={s.backBtn}
        >
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.groupTitleRow}>
            <View style={s.groupHeaderIcon}>
              <Text style={s.groupHeaderIconText}>{getGroupIcon(group)}</Text>
            </View>

            <Text style={s.headerTitle} numberOfLines={1}>{group.name}</Text>
          </View>

          <TouchableOpacity
            onPress={() => setTab('members')}
            activeOpacity={0.75}
            style={s.memberHeaderPill}
          >
            <Text style={s.memberHeaderText}>
              {members.length} {members.length === 1 ? 'member' : 'members'}
              {group.season ? ` · ${group.season}` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        {isAdmin && (
          <TouchableOpacity style={s.inviteBtn} onPress={() => setShowInvite(v => !v)}>
            <Text style={s.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        )}
        {!isAdmin && <View style={{ width: 50 }} />}
      </View>

      {/* Invite panel — slides in when admin taps Invite */}
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
            Members scan the QR or enter the code in Groups → Join. Regenerate if it gets shared with the wrong people.
          </Text>
        </View>
      )}

      {/* Tab bar */}
      <View style={s.tabRow}>
        {(['stickies', 'calendar', 'gallery', 'book'] as MainTab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tabBtn, tab === t && s.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'stickies'
                ? `Highlights (${stickies.length})`
                : t === 'calendar'
                  ? `Calendar${upcomingCount > 0 ? ` (${upcomingCount})` : ''}`
                  : t === 'gallery'
                    ? `Gallery (${galleryItems.length})`
                    : 'Book'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stickies tab */}
      {tab === 'stickies' && (
        <ScrollView
          contentContainerStyle={s.timelineContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.gold} />}
        >
    {isAdmin && (
      <View style={s.groupRelayCard}>
        <View style={s.groupRelayHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.groupRelayTitle}>Group Relay</Text>
            <Text style={s.groupRelayHint}>
              Choose where this group’s messages, media, and highlights are saved.
            </Text>
          </View>

          {!editingGroupRelay && (
            <TouchableOpacity onPress={openGroupRelayEditor}>
              <Text style={s.groupRelayManage}>Manage</Text>
            </TouchableOpacity>
          )}
        </View>

        {!editingGroupRelay ? (
          <View style={s.groupRelaySummary}>
            <Text style={s.groupRelaySummaryLabel}>Current setting</Text>
            <Text style={s.groupRelaySummaryValue}>
              {(group.relayMode ?? 'default') === 'default'
                ? 'bE Relay'
                : group.relayMode === 'custom'
                  ? 'Group Relay'
                  : 'Both'}
            </Text>
            <Text style={s.groupRelayUrlText} numberOfLines={1}>
              {group.relayUrl || DEFAULT_RELAY}
            </Text>
          </View>
        ) : (
          <View>
            <Text style={s.inputLabel}>WHERE SHOULD THIS GROUP SAVE?</Text>

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
              <Text style={s.groupRelayOptionTitle}>Group / School Relay</Text>
              <Text style={s.groupRelayOptionHint}>Use a private relay for this group.</Text>
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
              <Text style={s.groupRelayOptionHint}>Save to bE and the group relay.</Text>
            </TouchableOpacity>

            {(groupRelayMode === 'custom' || groupRelayMode === 'both') && (
              <>
                <Text style={s.inputLabel}>GROUP RELAY URL</Text>
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
    )}

    {group.status === 'archived' && (
      <View style={s.archivedBanner}>
        <Text style={s.archivedBannerText}>
          📦 This group is archived. Highlights can still be viewed.
        </Text>
      </View>
    )}

    {stickies.length === 0 ? (
      <View style={s.empty}>
        <Text style={s.emptyIcon}>📌</Text>
        <Text style={s.emptyText}>No highlights yet</Text>
        <Text style={s.emptyHint}>
          Admins can add highlights, reminders, or important notes here.
        </Text>
      </View>
    ) : (
      stickies.map(sticky => (
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
            {formatStickyDate(sticky.createdAt)}
          </Text>
        </View>
      ))
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
                Members will appear here after they join this group.
              </Text>
            </View>
          }
        />
      )}
      {/* Group actions bar */}
      {group.status === 'active' && (isAdmin || canLeaveGroup) && (
        <View style={s.adminBar}>
          {isAdmin && (
            <TouchableOpacity style={s.adminBtn} onPress={handleArchive}>
              <Text style={s.adminBtnText} numberOfLines={1}>
                📦 Archive
              </Text>
            </TouchableOpacity>
          )}

          {isAdmin && isMember && (
            <TouchableOpacity
              style={s.adminBtnGold}
              onPress={() => setShowStickyModal(true)}
            >
              <Text style={s.adminBtnGoldText}>+ Highlight</Text>
            </TouchableOpacity>
          )}

          {canLeaveGroup && (
            <TouchableOpacity
              style={s.adminBtnDanger}
              onPress={handleLeaveGroup}
              activeOpacity={0.85}
            >
              <Text style={s.adminBtnDangerText}>Leave Group</Text>
            </TouchableOpacity>
          )}
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
                  <Text style={s.memberActionHint}>Manage this member’s group role.</Text>
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
                    Remove from group
                  </Text>
                  <Text style={s.memberActionHint}>Remove access for this group.</Text>
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
        visible={showStickyModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStickyModal(false)}
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
            <Text style={s.modalTitle}>New Highlight</Text>

      <Text style={s.inputLabel}>TITLE</Text>
      <TextInput
        style={s.input}
        value={stickyTitle}
        onChangeText={setStickyTitle}
        placeholder="Practice reminder, team highlight..."
        placeholderTextColor={theme.textMuted}
      />

      <Text style={s.inputLabel}>MESSAGE</Text>
      <TextInput
        style={[s.input, s.inputMulti]}
        value={stickyBody}
        onChangeText={setStickyBody}
        placeholder="Write the highlight..."
        placeholderTextColor={theme.textMuted}
        multiline
        textAlignVertical="top"
      />

      <Text style={s.inputLabel}>MEDIA</Text>

      {selectedHighlightMediaList.length > 0 ? (
        <View>
          {selectedHighlightMediaList.some(item => item.type === 'image' || item.type === 'video') && (
            <MediaCollage
              media={selectedHighlightMediaList.filter(item => item.type === 'image' || item.type === 'video')}
              onPressMedia={() => {}}
            />
          )}

          {selectedHighlightMediaList.some(item => item.type === 'file') && (
            <View style={s.highlightFileList}>
              {selectedHighlightMediaList
                .filter(item => item.type === 'file')
                .map((item, index) => (
                  <View key={`${item.uri}_${index}`} style={s.highlightFileRow}>
                    <Text style={s.highlightFileIcon}>📎</Text>
                    <Text style={s.highlightFileName} numberOfLines={1}>
                      {item.name || 'Attached file'}
                    </Text>
                  </View>
                ))}
            </View>
          )}

          <TouchableOpacity
            style={s.highlightRemoveMediaBtn}
            onPress={() => {
              setSelectedHighlightMediaList([]);
              setSelectedHighlightMedia(null);
            }}
          >
            <Text style={s.highlightRemoveMediaText}>Remove all attachments</Text>
          </TouchableOpacity>

          <View style={s.highlightAttachmentRow}>
            <TouchableOpacity
              style={[s.highlightAddMediaBtn, s.highlightAttachmentHalf]}
              onPress={handlePickHighlightMedia}
              activeOpacity={0.85}
            >
              <Text style={s.highlightAddMediaText}>+ Media</Text>
              <Text style={s.highlightAddMediaHint}>Photos/videos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.highlightAddMediaBtn, s.highlightAttachmentHalf]}
              onPress={handlePickHighlightFiles}
              activeOpacity={0.85}
            >
              <Text style={s.highlightAddMediaText}>+ File</Text>
              <Text style={s.highlightAddMediaHint}>Docs/PDFs</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={s.highlightAttachmentRow}>
          <TouchableOpacity
            style={[s.highlightAddMediaBtn, s.highlightAttachmentHalf]}
            onPress={handlePickHighlightMedia}
            activeOpacity={0.85}
          >
            <Text style={s.highlightAddMediaText}>+ Add media</Text>
            <Text style={s.highlightAddMediaHint}>Photos/videos</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.highlightAddMediaBtn, s.highlightAttachmentHalf]}
            onPress={handlePickHighlightFiles}
            activeOpacity={0.85}
          >
            <Text style={s.highlightAddMediaText}>+ Attach file</Text>
            <Text style={s.highlightAddMediaHint}>Docs/PDFs</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={s.inputLabel}>VISIBILITY</Text>

      <View style={s.visibilityBox}>
        <TouchableOpacity
          style={[s.visibilityOption, stickyVisibility === 'private' && s.visibilityOptionActive]}
          onPress={() => setStickyVisibility('private')}
        >
    <Text style={s.visibilityIcon}>🔒</Text>
    <View style={{ flex: 1 }}>
      <Text style={s.visibilityTitle}>Private</Text>
      <Text style={s.visibilityHint}>Only this group can see it</Text>
    </View>
    <Text style={s.visibilityStatus}>ON</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[s.visibilityOption, s.visibilityOptionDisabled]}
    onPress={() => Alert.alert('Coming soon', 'Organization archives will be added later.')}
  >
    <Text style={s.visibilityIcon}>🏫</Text>
    <View style={{ flex: 1 }}>
      <Text style={s.visibilityTitleDim}>Organization</Text>
      <Text style={s.visibilityHint}>School, church, or team archive</Text>
    </View>
    <Text style={s.visibilitySoon}>Soon</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[s.visibilityOption, s.visibilityOptionDisabled]}
    onPress={() => Alert.alert('Coming soon', 'Public relay posting will stay opt-in only.')}
  >
    <Text style={s.visibilityIcon}>🌍</Text>
    <View style={{ flex: 1 }}>
      <Text style={s.visibilityTitleDim}>Public</Text>
      <Text style={s.visibilityHint}>Visible outside the group</Text>
    </View>
    <Text style={s.visibilitySoon}>Soon</Text>
  </TouchableOpacity>
      </View>

      {highlightUploadStatus && (
        <View style={{ marginTop: 12 }}>
          <Text style={s.highlightUploadStatus}>
            {highlightUploadStatus}
          </Text>

          <View
            style={{
              height: 6,
              backgroundColor: theme.border,
              borderRadius: 999,
              marginTop: 8,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.max(highlightProgress * 100, 5)}%`,
                height: '100%',
                backgroundColor: theme.gold,
              }}
            />
          </View>

          <Text
            style={{
              color: theme.textMuted,
              fontSize: 11,
              textAlign: 'center',
              marginTop: 4,
            }}
          >
            {Math.round(highlightProgress * 100)}%
          </Text>
        </View>
      )}

      <View style={s.modalActions}>
        <TouchableOpacity
          style={[s.cancelBtn, highlightPosting && s.confirmBtnDisabled]}
          disabled={highlightPosting}
          onPress={() => {
            setStickyTitle('');
            setStickyBody('');
            setStickyVisibility('private');
            setSelectedHighlightMedia(null);
            setSelectedHighlightMediaList([]);
            setHighlightUploadStatus(null);
            setHighlightProgress(0);
            setShowStickyModal(false);
          }}
        >
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.confirmBtn, highlightPosting && s.confirmBtnDisabled]}
          onPress={handleCreateSticky}
          disabled={highlightPosting}
        >
          {highlightPosting ? (
            <ActivityIndicator size="small" color={theme.bg} />
          ) : (
            <Text style={s.confirmText}>Post highlight</Text>
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
  stickyCard: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
    marginBottom: 13,
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
  groupRelayOption: {
    padding: 13,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.bg,
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
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    backgroundColor: theme.bg,
    paddingHorizontal: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 13,
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
    flex: 1.5,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
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