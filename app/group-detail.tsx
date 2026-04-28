import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
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
  isGroupAdmin,
  isGroupMember,
  regenerateInviteCode,
  removeMember,
  syncGroupMembersFromRelay,
  updateGroup,
  updateMemberRole,
  type BEGroup,
  type BEGroupMember,
  type GroupRelayMode,
} from '../src/utils/group-storage';
import { DEFAULT_RELAY, fetchGroupMessages } from '../src/utils/nostr';
import { uploadToR2 } from '../src/utils/r2';
import { useIdentity } from './_layout';

type Tab = 'stickies' | 'gallery' | 'members';
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { npub } = useIdentity();

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
const [selectedHighlightMedia, setSelectedHighlightMedia] = useState<{
  uri: string;
  type: 'image' | 'video';
} | null>(null);

const [selectedHighlightMediaList, setSelectedHighlightMediaList] = useState<
  {
    uri: string;
    type: 'image' | 'video';
  }[]
>([]);
const [highlightPosting, setHighlightPosting] = useState(false);
const [highlightUploadStatus, setHighlightUploadStatus] = useState<string | null>(null);
const [highlightProgress, setHighlightProgress] = useState(0);
  const [tab, setTab] = useState<Tab>('stickies');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
    const [showInvite, setShowInvite] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [editingGroupRelay, setEditingGroupRelay] = useState(false);
  const [groupRelayMode, setGroupRelayMode] = useState<GroupRelayMode>('default');
  const [groupRelayUrl, setGroupRelayUrl] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const g = await getGroupById(id);

if (!g) return;

setGroup(g);

// ✅ Members (already working)
const syncedMembers = await syncGroupMembersFromRelay(
  id,
  g.relayUrl ? [g.relayUrl] : []
);
setMembers(syncedMembers);

// 🔥 THIS is the NEW sticky sync
const syncedStickies = g.relayUrl
  ? await syncGroupStickiesFromRelay(id, g.relayUrl)
  : await getStickiesForGroup(id);

setStickies(syncedStickies);
// 🔥 GALLERY FROM CHAT IMAGES + LOCAL SAVED HIGHLIGHT MEDIA
try {
  let chatMediaItems: any[] = [];

  if (g.relayUrl) {
    const events = await fetchGroupMessages(id, g.relayUrl);

    chatMediaItems = events
      .filter(event => !!(event.mediaUrl || event.imageUrl))
      .map(event => ({
        id: event.id,
        mediaUrl: event.mediaUrl || event.imageUrl!,
        mediaType: event.mediaType || (event.imageUrl ? 'image' : 'image'),
        thumbnailUrl: event.thumbnailUrl,
        createdAt: event.createdAt,
        source: 'chat',
      }));
  }

  const localGalleryItems = await readLocalGalleryItems();

  const savedHighlightItems = localGalleryItems.filter(
    item => item.groupId === id
  );

  const galleryMap = new Map<string, any>();

  [...chatMediaItems, ...savedHighlightItems].forEach(item => {
    galleryMap.set(item.id, item);
  });

  const mediaItems = Array.from(galleryMap.values()).sort(
    (a, b) => b.createdAt - a.createdAt
  );

  setGalleryItems(mediaItems);
} catch (e) {
  console.warn('[Gallery] failed to load media', e);
}
    if (npub && g) {
      const [admin, member] = await Promise.all([
        isGroupAdmin(id, npub),
        isGroupMember(id, npub),
      ]);
      setIsAdmin(admin);
      setIsMember(member);
    }
  }, [id, npub]);

  useEffect(() => { load(); }, [load]);

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
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: false,
      quality: 0.75,
videoQuality: ImagePicker.UIImagePickerControllerQualityType.Low,
      allowsMultipleSelection: true,
      selectionLimit: 5, // adjust later if needed
    });

    if (result.canceled || !result.assets?.length) return;

    const newItems: {
  uri: string;
  type: 'image' | 'video';
}[] = result.assets
  .filter(asset => !!asset.uri)
  .map(asset => ({
    uri: asset.uri,
    type: asset.type === 'video' ? 'video' : 'image',
  }));

setSelectedHighlightMediaList(prev => [...prev, ...newItems]);

setSelectedHighlightMedia(newItems[0] ?? null);

  } catch (e) {
    console.warn('[Highlight media picker] failed', e);
    Alert.alert('Media error', 'Could not open your photo library.');
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
      mediaType: 'image' | 'video';
      thumbnailUrl?: string;
      imageUrl?: string;
    }[] = [];

    const totalSteps = mediaToUpload.length * 2; // upload + thumbnail
let currentStep = 0;

for (let i = 0; i < mediaToUpload.length; i++) {
  const item = mediaToUpload[i];

  setHighlightUploadStatus(`Uploading ${i + 1} of ${mediaToUpload.length}...`);

  const uploadedUrl = await uploadToR2(
    item.uri,
    item.type === 'video' ? 'video' : 'photo'
  );

  currentStep++;
  setHighlightProgress(currentStep / totalSteps);

  if (!uploadedUrl) {
    console.warn('[Highlight upload] skipped failed item:', item.uri);
    continue;
  }

  let thumbnailUrl: string | undefined;

  if (item.type === 'video') {
    try {
      setHighlightUploadStatus(`Creating thumbnail ${i + 1}...`);

      const thumbnail = await VideoThumbnails.getThumbnailAsync(item.uri, {
        time: 1000,
      });

      setHighlightUploadStatus(`Uploading thumbnail ${i + 1}...`);

      const uploadedThumbnail = await uploadToR2(thumbnail.uri, 'photo');
      thumbnailUrl = uploadedThumbnail || undefined;

      currentStep++;
      setHighlightProgress(currentStep / totalSteps);

    } catch (thumbError) {
      console.warn('[Highlight thumbnail] failed:', thumbError);
    }
  }

  uploadedHighlightMedia.push({
    mediaUrl: uploadedUrl,
    mediaType: item.type,
    thumbnailUrl,
    imageUrl: item.type === 'image' ? uploadedUrl : undefined,
  });
}

    setHighlightUploadStatus('Posting highlight...');

    await createGroupSticky({
      groupId: group.id,
      title,
      body,
      authorNpub: npub ?? undefined,
      relayUrl: group.relayUrl,
      media: uploadedHighlightMedia,
    } as any);

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

  const handleRemoveMember = (member: BEGroupMember) => {
    if (!npub) return;
    Alert.alert(
      `Remove ${member.displayName || member.npub.slice(0, 12)}?`,
      'Their past posts will remain but they will no longer be able to view or post in this group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            if (!group) return;
            await removeMember(group.id, member.npub, npub);
            await load();
          }
        }
      ]
    );
  };

  const handlePromoteAdmin = (member: BEGroupMember) => {
    Alert.alert(
      `Make ${member.displayName || 'this member'} an admin?`,
      'They will be able to manage members and the invite code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make admin', onPress: async () => {
            if (!group) return;
            await updateMemberRole(group.id, member.npub, 'admin');
            await load();
          }
        }
      ]
    );
  };

  if (!group) return (
  <SafeAreaView style={s.safe}>
    <View style={s.loading}>
      <Text style={s.loadingText}>Loading…</Text>
    </View>
  </SafeAreaView>
);

const deepLink = `marksapp://join/${group.inviteCode}`;

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
          <Text style={s.headerTitle} numberOfLines={1}>{group.name}</Text>
          {group.season && <Text style={s.headerSub}>{group.season}</Text>}
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
                backgroundColor="#1a1a1a"
                color="#c9973a"
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
        {(['stickies', 'gallery', 'members'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tabBtn, tab === t && s.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'stickies'
  ? `Highlights (${stickies.length})`
  : t === 'gallery'
    ? `Gallery (${galleryItems.length})`
    : `Members (${members.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

    {/* Stickies tab */}
{tab === 'stickies' && (
  <ScrollView
    contentContainerStyle={s.timelineContainer}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c9973a" />}
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
                  placeholderTextColor="#444"
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
          style={[s.confirmBtn, highlightPosting && s.confirmBtnDisabled]}
          onPress={handleCreateSticky}
          disabled={highlightPosting}
        >
          {highlightPosting ? (
            <ActivityIndicator size="small" color="#111" />
          ) : (
            <Text style={s.confirmText}>Post highlight</Text>
          )}
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

{getStickyMediaItems(sticky).length > 0 && (
  <MediaCollage
    media={getStickyMediaItems(sticky)}
    onPressMedia={(index) => openViewerForSticky(sticky, index)}
  />
)}

<Text style={s.stickyMeta}>
  {formatStickyDate(sticky.createdAt)}
</Text>
        </View>
      ))
    )}
  </ScrollView>
)}

      {/* Gallery tab */}
      {tab === 'gallery' && (
  <FlatList
    data={galleryItems}
    keyExtractor={(item) => item.id}
    numColumns={3}
    contentContainerStyle={{ padding: 8 }}
    refreshControl={
      <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c9973a" />
    }
    renderItem={({ item }) => (
      <View style={{ flex: 1 / 3, padding: 4 }}>
        <TouchableOpacity onPress={() => openViewerForGalleryItem(item.mediaUrl)}>
    {item.mediaType === 'video' ? (
    <View
      style={{
        width: '100%',
        aspectRatio: 1,
        borderRadius: 8,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {item.thumbnailUrl ? (
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 8,
          }}
          resizeMode="cover"
        />
      ) : null}

      <View
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.25)',
        }}
      >
        <Text style={{ color: '#c9973a', fontSize: 28, fontWeight: '800' }}>▶</Text>
      </View>
    </View>
  ) : (
    <Image
      source={{ uri: item.mediaUrl }}
      style={{
        width: '100%',
        aspectRatio: 1,
        borderRadius: 8,
        backgroundColor: '#222',
      }}
    />
  )}
</TouchableOpacity>
      </View>
    )}
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

      {/* Members tab */}
      {tab === 'members' && (
        <FlatList
          data={members}
          keyExtractor={m => m.id}
          contentContainerStyle={s.membersList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c9973a" />}
          renderItem={({ item }) => (
            <View style={s.memberRow}>
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
                <Text style={s.memberName}>{item.displayName ?? `${item.npub.slice(0, 12)}…`}</Text>
                <View style={[
  s.roleBadge,
  item.role === 'owner' && s.roleBadgeOwner,
  item.role === 'admin' && s.roleBadgeAdmin,
]}>
  <Text style={[
    s.roleBadgeText,
    item.role === 'owner' && s.roleBadgeTextOwner,
    item.role === 'admin' && s.roleBadgeTextAdmin,
  ]}>
    {item.role === 'owner' ? '👑 Owner' : item.role === 'admin' ? '⭐ Admin' : 'Member'}
  </Text>
</View>
              </View>
              {isAdmin && item.npub !== npub && item.role !== 'owner' && (
                <TouchableOpacity
                  style={s.memberOptions}
                  onPress={() => Alert.alert(
                    item.displayName ?? 'Member',
                    'What would you like to do?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      item.role === 'member'
                        ? { text: 'Make admin', onPress: () => handlePromoteAdmin(item) }
                        : { text: 'Remove admin', onPress: () => updateMemberRole(group.id, item.npub, 'member').then(load) },
                      { text: 'Remove from group', style: 'destructive', onPress: () => handleRemoveMember(item) },
                    ]
                  )}
                >
                  <Text style={s.memberOptionsText}>⋯</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}

      {/* Admin actions bar */}
      {isAdmin && group.status === 'active' && (
        <View style={s.adminBar}>
          <TouchableOpacity style={s.adminBtn} onPress={handleArchive}>
  <Text style={s.adminBtnText} numberOfLines={1}>
    📦 Archive
  </Text>
</TouchableOpacity>
          {isMember && (
            <TouchableOpacity
              style={s.adminBtnGold}
              onPress={() => setShowStickyModal(true)}
            >
              <Text style={s.adminBtnGoldText}>+ Highlight</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Member post FAB */}
      {isMember && !isAdmin && group.status === 'active' && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => router.push({ pathname: '/group-thread', params: { id: group.id } } as any)}
          activeOpacity={0.85}
        >
          <Text style={s.fabIcon}>+</Text>
        </TouchableOpacity>
      )}

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
        placeholderTextColor="#444"
      />

            <Text style={s.inputLabel}>MESSAGE</Text>
      <TextInput
        style={[s.input, s.inputMulti]}
        value={stickyBody}
        onChangeText={setStickyBody}
        placeholder="Write the highlight..."
        placeholderTextColor="#444"
        multiline
        textAlignVertical="top"
      />

      <Text style={s.inputLabel}>MEDIA</Text>

      {selectedHighlightMediaList.length > 0 ? (
  <View>
    <MediaCollage
      media={selectedHighlightMediaList}
      onPressMedia={() => {}}
    />

    <TouchableOpacity
      style={s.highlightRemoveMediaBtn}
      onPress={() => {
        setSelectedHighlightMediaList([]);
        setSelectedHighlightMedia(null);
      }}
    >
      <Text style={s.highlightRemoveMediaText}>Remove all media</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[s.highlightAddMediaBtn, { marginTop: 10 }]}
      onPress={handlePickHighlightMedia}
      activeOpacity={0.85}
    >
      <Text style={s.highlightAddMediaText}>+ Add more media</Text>
    </TouchableOpacity>
  </View>
) : (
  <TouchableOpacity
    style={s.highlightAddMediaBtn}
    onPress={handlePickHighlightMedia}
    activeOpacity={0.85}
  >
    <Text style={s.highlightAddMediaText}>+ Add photo or video</Text>
    <Text style={s.highlightAddMediaHint}>Select up to 5 items</Text>
  </TouchableOpacity>
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
        backgroundColor: '#2a2a2a',
        borderRadius: 999,
        marginTop: 8,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.max(highlightProgress * 100, 5)}%`,
          height: '100%',
          backgroundColor: '#c9973a',
        }}
      />
    </View>

    <Text
      style={{
        color: '#555',
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
          style={s.cancelBtn}
          onPress={() => {
            setSelectedHighlightMedia(null);
            setShowStickyModal(false);
          }}
        >
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.confirmBtn} onPress={handleCreateSticky}>
          <Text style={s.confirmText}>Post highlight</Text>
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

function formatStickyDate(unix: number): string {
  const date = new Date(unix * 1000);
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#444', fontSize: 15 },

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
  borderColor: '#2a2a2a',
  backgroundColor: '#1a1a1a',
},
visibilityOptionActive: {
  borderColor: '#c9973a',
  backgroundColor: '#1e1600',
},
visibilityOptionDisabled: {
  opacity: 0.55,
},
visibilityIcon: {
  fontSize: 20,
},
visibilityTitle: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '700',
},
visibilityTitleDim: {
  color: '#aaa',
  fontSize: 14,
  fontWeight: '700',
},
visibilityHint: {
  color: '#555',
  fontSize: 11,
  marginTop: 2,
},
visibilityStatus: {
  color: '#c9973a',
  fontSize: 11,
  fontWeight: '800',
},
visibilitySoon: {
  color: '#555',
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
    borderBottomColor: '#242424',
    backgroundColor: '#111',
  },
  backBtn: { width: 58 },
  backText: { color: '#c9973a', fontSize: 14, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { color: '#f4f4f4', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerSub: { color: '#666', fontSize: 11, marginTop: 2, fontWeight: '600' },
  inviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#c9973a',
  },
  inviteBtnText: { color: '#111', fontWeight: '800', fontSize: 13 },
    stickyCard: {
    backgroundColor: '#181818',
    borderWidth: 0.5,
    borderColor: '#252525',
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
    color: '#f4f4f4',
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
    color: '#bdbdbd',
    fontSize: 14,
    lineHeight: 21,
  },
  stickyMeta: {
    color: '#555',
    fontSize: 11,
    marginTop: 12,
    fontWeight: '600',
  },

  groupRelayCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: '#252525',
    backgroundColor: '#181818',
    marginBottom: 16,
  },
  groupRelayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  groupRelayTitle: {
    color: '#f4f4f4',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  groupRelayHint: {
    color: '#666',
    fontSize: 12,
    lineHeight: 18,
  },
  groupRelayManage: {
    color: '#c9973a',
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
    color: '#555',
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  groupRelaySummaryValue: {
    color: '#c9973a',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 5,
  },
  groupRelayUrlText: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  groupRelayOption: {
    padding: 13,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#111',
    marginBottom: 9,
  },
  groupRelayOptionActive: {
    borderColor: '#c9973a66',
    backgroundColor: '#1e1600',
  },
  groupRelayOptionTitle: {
    color: '#f4f4f4',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  groupRelayOptionHint: {
    color: '#666',
    fontSize: 12,
    lineHeight: 17,
  },
  
  // Invite panel
  invitePanel: {
    backgroundColor: '#1a1a1a', borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a',
    padding: 16,
  },
  invitePanelTop: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  inviteCodeBlock: { flex: 1 },
  inviteCodeLabel: { fontSize: 10, color: '#555', fontWeight: '600', letterSpacing: 0.8, marginBottom: 6 },
  inviteCode: { fontSize: 32, fontWeight: '700', color: '#c9973a', letterSpacing: 6, marginBottom: 10 },
  inviteCodeActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  inviteCodeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#111' },
  inviteCodeBtnDanger: { borderColor: '#3a1a1a' },
  inviteCodeBtnText: { fontSize: 12, color: '#aaa', fontWeight: '500' },
  qrBlock: { padding: 8, backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a' },
  inviteMeta: { fontSize: 11, color: '#444', marginTop: 10, lineHeight: 16 },

    // Tabs
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e1e1e',
    backgroundColor: '#111',
    paddingHorizontal: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#c9973a',
  },
  tabText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  tabTextActive: {
    color: '#c9973a',
    fontWeight: '800',
  },

  // Timeline
  timelineContainer: { padding: 20, paddingBottom: 100 },
  archivedBanner: { backgroundColor: '#1a1a00', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 0.5, borderColor: '#3a3a00' },
  archivedBannerText: { color: '#888', fontSize: 13, textAlign: 'center' },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyText: { fontSize: 17, color: '#555', fontWeight: '500' },
  emptyHint: { fontSize: 13, color: '#333', marginTop: 6, textAlign: 'center' },

  // Members
  membersList: { padding: 20, paddingBottom: 100 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  memberAvatar: { width: 42, height: 42 },
  memberAvatarImg: { width: 42, height: 42, borderRadius: 21 },
  memberAvatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  memberAvatarLetter: { color: '#c9973a', fontWeight: '700', fontSize: 17 },
  memberBody: { flex: 1 },
  memberName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  memberRole: { color: '#555', fontSize: 11, marginTop: 2, textTransform: 'capitalize' },
  memberOptions: { padding: 8 },
  memberOptionsText: { fontSize: 20, color: '#444' },

  roleBadge: {
  alignSelf: 'flex-start',
  marginTop: 4,
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: '#1a1a1a',
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
},
roleBadgeOwner: {
  backgroundColor: '#1e1600',
  borderColor: '#c9973a',
},
roleBadgeAdmin: {
  backgroundColor: '#1a1a1a',
  borderColor: '#6b5cff',
},
roleBadgeText: {
  color: '#555',
  fontSize: 10,
  fontWeight: '700',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
},
roleBadgeTextOwner: {
  color: '#c9973a',
},
roleBadgeTextAdmin: {
  color: '#aaa',
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
    backgroundColor: '#111',
    borderTopWidth: 0.5,
    borderTopColor: '#222',
  },
  adminBtn: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminBtnText: {
  color: '#666',
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
    borderRadius: 999,
    backgroundColor: '#c9973a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminBtnGoldText: {
    color: '#111',
    fontWeight: '900',
    fontSize: 14,
  },
modalScrollContent: {
  flexGrow: 1,
  justifyContent: 'flex-end',
},
  modalOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.7)',
  justifyContent: 'flex-end',
},
modalCard: {
  backgroundColor: '#111',
  borderTopWidth: 0.5,
  borderTopColor: '#2a2a2a',
  padding: 20,
  borderTopLeftRadius: 18,
  borderTopRightRadius: 18,
},
modalTitle: {
  color: '#fff',
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
  color: '#444',
  fontWeight: '600',
  letterSpacing: 0.8,
  marginBottom: 6,
  marginTop: 10,
},
input: {
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
  borderRadius: 10,
  padding: 12,
  fontSize: 15,
  color: '#fff',
  backgroundColor: '#1a1a1a',
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
  borderColor: '#2a2a2a',
  alignItems: 'center',
},
cancelText: {
  color: '#555',
  fontSize: 14,
},
confirmBtn: {
  flex: 2,
  padding: 12,
  borderRadius: 10,
  backgroundColor: '#c9973a',
  alignItems: 'center',
},
confirmText: {
  color: '#111',
  fontWeight: '700',
  fontSize: 14,
},
  
highlightAddMediaBtn: {
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
  borderRadius: 12,
  padding: 14,
  backgroundColor: '#181818',
  alignItems: 'center',
},
highlightAddMediaText: {
  color: '#c9973a',
  fontSize: 14,
  fontWeight: '800',
},
highlightAddMediaHint: {
  color: '#555',
  fontSize: 11,
  marginTop: 4,
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
highlightRemoveMediaBtn: {
  padding: 11,
  alignItems: 'center',
  backgroundColor: '#111',
},
highlightRemoveMediaText: {
  color: '#c44',
  fontSize: 13,
  fontWeight: '800',
},  
// FAB
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#c9973a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
 
  fabIcon: { fontSize: 30, color: '#111', fontWeight: '300', lineHeight: 34 },
});