import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AudioRecorder from '../../components/AudioRecorder';
import BEHeader from '../../components/BEHeader';
import type {
  LivingMarkCaptureSource,
  LivingMarkPerson,
  LivingMarkPlace,
  LivingSpace,
  MarkPrivacy,
} from '../../src/types/living-spaces';
import { getContacts } from '../../src/utils/contacts-storage';
import {
  formatEventDate,
  formatEventTime,
  getCalendarEventsForGroup,
  type GroupCalendarEvent,
} from '../../src/utils/group-calendar';
import { getVisibleGroupsForNpub } from '../../src/utils/group-storage';
import {
  isLivingPersonSelected,
  mergeLivingPersonCandidates,
  resolvePeopleSelection,
  toggleLivingPersonSelection,
  type LivingPersonCandidate,
} from '../../src/utils/living-people';
import {
  extractLivingCaptureFromExif,
  SYSTEM_LIVING_SPACE_IDS,
} from '../../src/utils/living-space-routing';
import {
  ensureDefaultLivingSpaces,
  persistLivingMarkCapture,
} from '../../src/utils/living-spaces-storage';
import { compressMediaForUpload } from '../../src/utils/media-compression';
import { publishFamilyMilestone, signAndPublish } from '../../src/utils/nostr';
import { notifyMarkEvent } from '../../src/utils/push-notifications';
import { uploadMilestoneMedia } from '../../src/utils/r2';
import { getFamilyMembers, saveMilestone } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

const PRESET_TAGS = ['Family', 'Faith', 'Career', 'School', 'Travel', 'Health', 'Achievement', 'Personal'];
const LIFE_STAGE_OPTIONS = ['Childhood', 'Elementary', 'Middle School', 'High School', 'College', 'Season', 'Trip'];

type DraftMedia = {
  id: string;
  uri: string;
  type: 'image' | 'video';
  thumbnailUri?: string;
  place?: LivingMarkPlace;
  occurredAt?: number;
  captureSource: Extract<LivingMarkCaptureSource, 'camera' | 'library'>;
};

function getCaptureMetadataForDraft(media: DraftMedia[], audioUri?: string): {
  place?: LivingMarkPlace;
  occurredAt?: number;
  captureSource?: LivingMarkCaptureSource;
} {
  const mediaWithPlace = media.find(item => item.place);
  const mediaWithDate = media.find(item => item.occurredAt);
  const firstMedia = media[0];

  if (firstMedia) {
    return {
      place: mediaWithPlace?.place,
      occurredAt: mediaWithDate?.occurredAt,
      captureSource: firstMedia.captureSource,
    };
  }

  if (audioUri) {
    return {
      captureSource: 'voice',
    };
  }

  return {
    captureSource: 'manual',
  };
}

function getRouteParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function LogScreen() {
  const { nsec, npub, family, relays, profile, theme } = useIdentity();
  const router = useRouter();
  const params = useLocalSearchParams<{
    selectedSpaceId?: string;
    returnToGroupId?: string;
    returnToGroupTab?: string;
  }>();

  const routeSelectedSpaceId = getRouteParam(params.selectedSpaceId);
  const returnToGroupId = getRouteParam(params.returnToGroupId);
  const routeReturnToGroupTab = getRouteParam(params.returnToGroupTab);

  const returnToGroupTab =
    routeReturnToGroupTab === 'overview' ||
    routeReturnToGroupTab === 'chat' ||
    routeReturnToGroupTab === 'stickies' ||
    routeReturnToGroupTab === 'mantle' ||
    routeReturnToGroupTab === 'calendar' ||
    routeReturnToGroupTab === 'gallery' ||
    routeReturnToGroupTab === 'members' ||
    routeReturnToGroupTab === 'legacy' ||
    routeReturnToGroupTab === 'book'
      ? routeReturnToGroupTab
      : 'overview';

  const routePreselectAppliedRef = useRef(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [media, setMedia] = useState<DraftMedia[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [publishToNostr, setPublishToNostr] = useState(true);
  const [audioUri, setAudioUri] = useState<string | undefined>();
  const [livingSpaces, setLivingSpaces] = useState<LivingSpace[]>([]);
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(() => new Set());
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [peopleInput, setPeopleInput] = useState('');
  const [personCandidates, setPersonCandidates] = useState<LivingPersonCandidate[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<LivingMarkPerson[]>([]);
  const [lifeStage, setLifeStage] = useState('');
  const [eventInput, setEventInput] = useState('');
  const [calendarEvents, setCalendarEvents] = useState<GroupCalendarEvent[]>([]);
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);
  const [loadingCalendarEvents, setLoadingCalendarEvents] = useState(false);
  const [savedToBook, setSavedToBook] = useState(false);

  const myDisplayName =
  profile?.display_name ||
  profile?.name ||
  (npub ? `${npub.slice(0, 12)}…` : 'Someone');

  useEffect(() => {
    let cancelled = false;

    async function loadLivingSpaces() {
      try {
        const [groupSnapshot, contacts, familyMembers] = await Promise.all([
          npub
            ? getVisibleGroupsForNpub(npub)
            : Promise.resolve({ activeGroups: [], archivedGroups: [] }),
          getContacts(),
          family ? getFamilyMembers(family.id) : Promise.resolve([]),
        ]);

        const groups = groupSnapshot.activeGroups;

        const spaces = await ensureDefaultLivingSpaces({
          family: family
            ? {
                id: family.id,
                name: family.name,
                relayUrl: family.relayUrl,
                relayMode: family.relayMode,
              }
            : null,
          groups: groups.map(group => ({
            id: group.id,
            name: group.name,
            description: group.description,
            sport: group.sport,
            icon: group.icon,
            coverImage: group.coverImage,
            schoolId: group.schoolId,
            relayUrl: group.relayUrl,
            relayMode: group.relayMode,
            createdAt: group.createdAt,
            updatedAt: group.updatedAt,
          })),
        });

        if (!cancelled) {
          setLivingSpaces(spaces);
          setVisibleGroupIds(new Set(groups.map(group => group.id)));
          setPersonCandidates(
            mergeLivingPersonCandidates([
              {
                npub,
                displayName: myDisplayName,
                avatarUrl: (profile as any)?.picture || (profile as any)?.avatarUrl,
                source: 'current-user',
              },
              ...familyMembers.map(member => ({
                npub: member.npub,
                displayName: member.displayName,
                source: 'family-member' as const,
              })),
              ...contacts.map(contact => ({
                npub: contact.npub,
                displayName: contact.nostrName || contact.name,
                avatarUrl: contact.nostrAvatar,
                source: 'contact' as const,
              })),
            ])
          );
        }
      } catch (error) {
        console.warn('[Living Spaces] failed to load placement chips:', error);
      }
    }

    loadLivingSpaces();

    return () => {
      cancelled = true;
    };
  }, [family, myDisplayName, npub, profile]);

  const selectedSpace = selectedSpaceId
    ? livingSpaces.find(space => space.id === selectedSpaceId)
    : null;

      useEffect(() => {
    if (routePreselectAppliedRef.current) return;
    if (!routeSelectedSpaceId || livingSpaces.length === 0) return;

    const routeSpaceExists = livingSpaces.some(space => space.id === routeSelectedSpaceId);

    if (!routeSpaceExists) return;

    routePreselectAppliedRef.current = true;
    setSelectedSpaceId(routeSelectedSpaceId);
  }, [livingSpaces, routeSelectedSpaceId]);

  const selectedIsFamilySpace =
    selectedSpace?.id === SYSTEM_LIVING_SPACE_IDS.family ||
    selectedSpace?.type === 'family';

  const selectedGroupSpaceId =
    selectedSpace?.source === 'group' ? selectedSpace.id : null;

  const selectedGroupId =
    selectedSpace?.source === 'group'
      ? selectedSpace.sourceId ?? selectedSpace.id.replace(/^group:/, '')
      : null;

  const returnGroupId = returnToGroupId?.trim() || undefined;

  const navigateAfterLog = useCallback(() => {
    if (returnGroupId) {
      router.replace({
        pathname: '/group-detail',
        params: {
          id: returnGroupId,
          tab: returnToGroupTab,
        },
      } as any);
      return;
    }

    router.replace('/(tabs)/timeline' as any);
  }, [returnGroupId, returnToGroupTab, router]);

  useEffect(() => {
    if (!returnGroupId) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      navigateAfterLog();
      return true;
    });

    return () => subscription.remove();
  }, [navigateAfterLog, returnGroupId]);

  useEffect(() => {
    let cancelled = false;

    async function loadCalendarEventsForSelectedSpace() {
      if (!selectedGroupId) {
        setCalendarEvents([]);
        setSelectedCalendarEventId(null);
        return;
      }

      setLoadingCalendarEvents(true);

      try {
        const loaded = await getCalendarEventsForGroup(selectedGroupId);

        if (!cancelled) {
          setCalendarEvents(loaded.slice(0, 12));
        }
      } catch (error) {
        console.warn('[Log Calendar Events] failed to load:', error);

        if (!cancelled) {
          setCalendarEvents([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingCalendarEvents(false);
        }
      }
    }

    loadCalendarEventsForSelectedSpace();

    return () => {
      cancelled = true;
    };
  }, [selectedGroupId]);

const placementChipSpaces = livingSpaces
  .filter(space => !space.archivedAt)
  .filter(space => {
    if (space.id === SYSTEM_LIVING_SPACE_IDS.profile) return true;
    if (space.id === SYSTEM_LIVING_SPACE_IDS.family && !!family) return true;

    if (space.source !== 'group') return false;

    const groupId = space.sourceId ?? space.id.replace(/^group:/, '');
    return visibleGroupIds.has(groupId);
  });

  const pickPhoto = async () => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow photo access in settings.');
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.9,
    allowsMultipleSelection: true,
    selectionLimit: 10,
    exif: true,
  });

  if (!result.canceled) {
    const newMedia = await Promise.all(
  result.assets.map(async a => {
    const type = (a.type === 'video' ? 'video' : 'image') as 'image' | 'video';
    let thumbnailUri: string | undefined;

    if (type === 'video') {
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(a.uri, {
          time: 1000,
        });
        thumbnailUri = thumb.uri;
      } catch (error) {
        console.warn('[Log Video Preview Thumbnail] Failed:', error);
      }
    }

    const capture = extractLivingCaptureFromExif(a.exif);

    return {
      id: `media_${Date.now()}_${Math.random()}`,
      uri: a.uri,
      type,
      thumbnailUri,
      place: capture.place,
      occurredAt: capture.occurredAt,
      captureSource: 'library' as const,
    };
  })
);

setMedia(prev => [...prev, ...newMedia]);
  }
};

  const takePhoto = async () => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();

  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow camera access in settings.');
    return;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    videoMaxDuration: 60,
    quality: 0.85,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    allowsEditing: false,
    exif: true,
  });

  if (!result.canceled) {
    const asset = result.assets[0];

    const type = (asset.type === 'video' ? 'video' : 'image') as 'image' | 'video';
let thumbnailUri: string | undefined;

if (type === 'video') {
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, {
      time: 1000,
    });
    thumbnailUri = thumb.uri;
  } catch (error) {
    console.warn('[Camera Video Preview Thumbnail] Failed:', error);
  }
}

const capture = extractLivingCaptureFromExif(asset.exif);

const mediaItem: DraftMedia = {
  id: `media_${Date.now()}_${Math.random()}`,
  uri: asset.uri,
  type,
  thumbnailUri,
  place: capture.place,
  occurredAt: capture.occurredAt,
  captureSource: 'camera',
};

setMedia(prev => [...prev, mediaItem]);
  }
};

const recordVideo = async () => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();

  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow camera access in settings.');
    return;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    videoMaxDuration: 60,
    quality: 0.85,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    allowsEditing: false,
    exif: true,
  });

  if (!result.canceled) {
    const asset = result.assets[0];

    let thumbnailUri: string | undefined;

try {
  const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, {
    time: 1000,
  });
  thumbnailUri = thumb.uri;
} catch (error) {
  console.warn('[Record Video Preview Thumbnail] Failed:', error);
}

const capture = extractLivingCaptureFromExif(asset.exif);

const mediaItem: DraftMedia = {
  id: `media_${Date.now()}_${Math.random()}`,
  uri: asset.uri,
  type: 'video' as const,
  thumbnailUri,
  place: capture.place,
  occurredAt: capture.occurredAt,
  captureSource: 'camera',
};

setMedia(prev => [...prev, mediaItem]);
  }
};

const toggleCalendarEvent = (event: GroupCalendarEvent) => {
  const active = selectedCalendarEventId === event.id;

  if (active) {
    setSelectedCalendarEventId(null);
    setEventInput('');
    return;
  }

  setSelectedCalendarEventId(event.id);
  setEventInput(event.title);
};

const addTag = (t: string) => {
    const clean = t.trim();
    if (!clean || tags.includes(clean)) return;
    setTags(prev => [...prev, clean]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));

  const handleSave = async () => {
    if (!title.trim() && !note.trim() && media.length === 0 && !audioUri) {
  Alert.alert('Nothing to save', 'Add a title, note, photo, video, or voice note first.');
  return;
}

if (selectedGroupId && !visibleGroupIds.has(selectedGroupId)) {
  Alert.alert(
    'Space unavailable',
    'You no longer have access to that Space. This Mark was not saved there.'
  );
  setSelectedSpaceId(null);
  return;
}

    setSaving(true);
setProgress(0);
setSaveStatus('Preparing your Mark...');
try {
      const fullNote = title.trim() ? `${title.trim()}\n\n${note.trim()}` : note.trim();

      // ── Step 1: Upload media FIRST so the URL is ready for the Nostr event ──
      setSaveStatus('Uploading media...');
      let completed = 0;
const total = media.length || 1;

const uploadedMedia: {
  id: string;
  uri: string;
  type: 'image' | 'video';
  source: 'r2' | 'local';
  thumbnailUri?: string;
}[] = [];

for (let i = 0; i < media.length; i++) {
  const m = media[i];

  setSaveStatus(
    m.type === 'video'
      ? `Compressing video ${i + 1} of ${media.length}...`
      : `Optimizing photo ${i + 1} of ${media.length}...`
  );

  const compressed = await compressMediaForUpload({
    uri: m.uri,
    type: m.type,
    onStatus: setSaveStatus,
    onProgress: compressionProgress => {
      const baseProgress = Math.floor((i / total) * 40);
      const itemProgress = Math.floor(compressionProgress * (40 / total));
      setProgress(Math.min(40, baseProgress + itemProgress));
    },
  });

  const uploadUri = compressed.uri;

  let thumbnailUri: string | undefined;

  if (m.type === 'video') {
    try {
      setSaveStatus(`Creating video thumbnail ${i + 1} of ${media.length}...`);

      const thumb = await VideoThumbnails.getThumbnailAsync(uploadUri, {
        time: 1000,
      });

      setSaveStatus(`Uploading video thumbnail ${i + 1} of ${media.length}...`);

      const thumbUpload = await uploadMilestoneMedia({
        photoUri: thumb.uri,
      });

      thumbnailUri = thumbUpload.photoUri || thumb.uri;
    } catch (error) {
      console.warn('[Mark Video Thumbnail] Failed:', error);
    }
  }

  setSaveStatus(
    m.type === 'video'
      ? `Uploading compressed video ${i + 1} of ${media.length}...`
      : `Uploading optimized photo ${i + 1} of ${media.length}...`
  );

  const result = await uploadMilestoneMedia({
    photoUri: m.type === 'image' ? uploadUri : undefined,
    videoUri: m.type === 'video' ? uploadUri : undefined,
  });

  const uploadedUri =
    m.type === 'image'
      ? result.photoUri || m.uri
      : result.videoUri || m.uri;

  completed++;
  setProgress(Math.floor((completed / total) * 60));

  uploadedMedia.push({
    id: m.id,
    uri: uploadedUri,
    type: m.type,
    source: uploadedUri.startsWith('http') ? 'r2' as const : 'local' as const,
    thumbnailUri,
  });
}

const uploadedPhoto = uploadedMedia.find(m => m.type === 'image')?.uri;
const uploadedVideo = uploadedMedia.find(m => m.type === 'video')?.uri;

let uploadedAudio = audioUri;

if (audioUri) {
  setSaveStatus('Uploading voice note...');

  const audioUpload = await uploadMilestoneMedia({
    audioUri,
  });

  uploadedAudio = audioUpload.audioUri || audioUri;

  if (audioUpload.uploadErrors.includes('audio')) {
    console.warn('[Mark Audio Upload] Failed; saved local audio only');
  }
}

      // Warn user immediately if any media failed — don't silently drop it
      

      // ── Step 2: Publish to Nostr relay with all media URLs ──
      let nostrEventId: string | undefined;
      let published = false;

      setSaveStatus('Publishing to relay...');
      setProgress(70);
      if (publishToNostr && nsec) {
        const result = await signAndPublish({
          note: fullNote,
          tags,
          imageUrl: uploadedPhoto,
          videoUrl: uploadedVideo,
          audioUrl: uploadedAudio,
        }, nsec);
        if (result.success) {
          nostrEventId = result.eventId;
          published = true;
        } else {
          Alert.alert('Relay warning', `Saved locally. Relay: ${result.error}`);
        }
      }

      // ── Step 4: Save to local storage ──
      setSaveStatus('Saving Mark...');
      setProgress(85);

      const shouldSaveAsFamilyMark = !!family && selectedIsFamilySpace;

      const savedMilestone = await saveMilestone({
        note: fullNote,
        tags,
        photoUri: uploadedPhoto,
        media: uploadedMedia,
        audioUri: uploadedAudio,
        videoUri: uploadedVideo,
        nostrEventId,
        publishedToRelay: published,
        familyId: shouldSaveAsFamilyMark ? family.id : undefined,
        authorNpub: npub ?? undefined,
        authorName: myDisplayName,
      });

      setSaveStatus('Placing Mark...');
      setProgress(90);

      const captureMetadata = getCaptureMetadataForDraft(media, audioUri);
      const privacyHint: MarkPrivacy | undefined =
        shouldSaveAsFamilyMark
          ? 'family'
          : selectedGroupSpaceId
            ? 'space'
            : publishToNostr && published
              ? 'public'
              : undefined;

      const resolvedPeople = resolvePeopleSelection({
        selectedPeople,
        manualInput: peopleInput,
      });

      await persistLivingMarkCapture({
        milestone: savedMilestone,
        spaces: livingSpaces,
        selectedSpaceId,
        currentNpub: npub,
        peopleIds: resolvedPeople.peopleIds,
        people: resolvedPeople.people,
        lifeStage: lifeStage || undefined,
        eventId: selectedCalendarEventId || eventInput.trim() || undefined,
        savedToBook,
        captureSource: captureMetadata.captureSource,
        place: captureMetadata.place,
        occurredAt: captureMetadata.occurredAt,
        capturedAt: captureMetadata.occurredAt ?? savedMilestone.createdAt,
        privacy: privacyHint,
      });

      // ── Step 5: Finish placement and publish to family relay only when Family Space is selected ──
      setSaveStatus(shouldSaveAsFamilyMark ? 'Sharing with Family Space...' : 'Finishing Mark...');
      setProgress(95);

      if (shouldSaveAsFamilyMark && family && nsec && npub) {
        publishFamilyMilestone(
          {
            id: savedMilestone.id,
            note: fullNote,
            tags,
            photoUri: uploadedPhoto,
            videoUri: uploadedVideo,
            audioUri: uploadedAudio,
            media: uploadedMedia,
            createdAt: savedMilestone.createdAt,
            familyId: family.id,
            authorNpub: npub,
            authorName: myDisplayName,
          },
          nsec,
          relays
        ).then(result => {
          if (!result.success) console.warn('[Family Sync] Failed to publish:', result.error);
          else console.log('[Family Sync] Published:', result.eventId);
        });

        getFamilyMembers(family.id)
          .then(familyMembers => {
            const recipientNpubs = familyMembers
              .map(member => member.npub)
              .filter(memberNpub => memberNpub !== npub);

            return notifyMarkEvent({
              recipientNpubs,
              authorNpub: npub,
              authorName: myDisplayName,
              markId: savedMilestone.id,
              title: title.trim() || undefined,
              preview: note.trim() || fullNote,
              eventId: nostrEventId,
              familyId: family.id,
            });
          })
          .catch(error => {
            console.warn('[Mark Notification] failed:', error);
          });
      }

      // ── Reset form ──
      setTitle('');
      setNote('');
      setTags([]);
      setMedia([]);
      setAudioUri(undefined);
      setTagInput('');
      setSelectedSpaceId(null);
      setShowContext(false);
      setPeopleInput('');
      setSelectedPeople([]);
      setLifeStage('');
      setEventInput('');
      setSelectedCalendarEventId(null);
      setSavedToBook(false);

      setProgress(100);

      Alert.alert(
        '✓ Saved',
        published ? 'Published to your relay.' : 'Saved locally.',
        [
          {
            text: 'OK',
            onPress: navigateAfterLog,
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
setSaveStatus('');
setProgress(0);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
        <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        <BEHeader title="Log" />

        {/* Photo */}
        {/* Photos */}
<View style={s.field}>
  <Text style={[s.label, { color: theme.textMuted }]}>PHOTOS</Text>

  {media.length > 0 ? (
    <ScrollView horizontal style={s.photoPreviewRow}>
      {media.map(item => (
        <View key={item.id} style={s.multiPhotoWrap}>
          <Image
  source={{ uri: item.type === 'video' ? item.thumbnailUri || item.uri : item.uri }}
  style={s.multiPhoto}
  resizeMode="cover"
/>

{item.type === 'video' && (
  <View style={s.videoBadge}>
    <Text style={s.videoBadgeText}>▶</Text>
  </View>
)}

          <TouchableOpacity
            style={s.removePhotoBtn}
            onPress={() => setMedia(prev => prev.filter(m => m.id !== item.id))}
          >
            <Text style={s.removePhotoText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  ) : null}

  <View style={s.photoRow}>
  <TouchableOpacity style={[s.photoBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={takePhoto}>
    <Text style={s.photoBtnIcon}>📷</Text>
    <Text style={[s.photoBtnText, { color: theme.textSecondary }]}>Take Photo</Text>
  </TouchableOpacity>

  <TouchableOpacity style={[s.photoBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={recordVideo}>
    <Text style={s.photoBtnIcon}>🎥</Text>
    <Text style={[s.photoBtnText, { color: theme.textSecondary }]}>Record Video</Text>
  </TouchableOpacity>

  <TouchableOpacity style={[s.photoBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={pickPhoto}>
    <Text style={s.photoBtnIcon}>🖼️</Text>
    <Text style={[s.photoBtnText, { color: theme.textSecondary }]}>Library</Text>
  </TouchableOpacity>
</View>
</View>

        {/* Title */}
        <View style={s.field}>
          <Text style={[s.label, { color: theme.textMuted }]}>TITLE</Text>
          <TextInput
  style={[s.titleInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
            placeholder="Name this Mark..."
            placeholderTextColor={theme.textMuted}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />
        </View>

        {/* Note */}
        <View style={s.field}>
          <Text style={[s.label, { color: theme.textMuted }]}>NOTE</Text>
          <TextInput
  style={[s.textarea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
            placeholder="What happened? How did it feel?"
            placeholderTextColor={theme.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Voice note */}
        <View style={s.field}>
          <Text style={[s.label, { color: theme.textMuted }]}>VOICE NOTE</Text>
          <AudioRecorder
            onRecordingComplete={(uri) => setAudioUri(uri || undefined)}
            existingUri={audioUri}
          />
        </View>

        {/* Tags */}
        <View style={s.field}>
          <Text style={[s.label, { color: theme.textMuted }]}>TAGS</Text>
          <View style={s.presets}>
            {PRESET_TAGS.map(t => (
              <TouchableOpacity
                key={t}
                style={[
  s.presetChip,
  { backgroundColor: theme.surface, borderColor: theme.border },
  tags.includes(t) && { backgroundColor: theme.gold, borderColor: theme.gold },
]}
                onPress={() => tags.includes(t) ? removeTag(t) : addTag(t)}
              >
                <Text style={[
  s.presetText,
  { color: theme.textSecondary },
  tags.includes(t) && { color: theme.bg, fontWeight: '600' }
]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom tag input with visible + button */}
          <View style={s.tagInputRow}>
            <TextInput
  style={[s.tagInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              placeholder="Custom tag..."
              placeholderTextColor={theme.textMuted}
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={() => addTag(tagInput)}
              returnKeyType="done"
              autoCapitalize="words"
            />
<TouchableOpacity
  style={[
    s.tagAddBtn,
    { backgroundColor: theme.gold },
    !tagInput.trim() && s.tagAddBtnDim,
  ]}
              onPress={() => addTag(tagInput)}
              disabled={!tagInput.trim()}
            >
            <Text style={[s.tagAddBtnText, { color: theme.bg }]}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {tags.length > 0 && (
            <View style={s.selectedTags}>
              {tags.map(t => (
                <TouchableOpacity key={t} style={[s.tagChip, { backgroundColor: theme.surface, borderColor: theme.gold }]} onPress={() => removeTag(t)}>
                  <Text style={[s.tagChipText, { color: theme.gold }]}>{t} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {placementChipSpaces.length > 0 && (
          <View style={s.field}>
            <Text style={[s.label, { color: theme.textMuted }]}>PLACE IN</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.placeChipRow}>
              <TouchableOpacity
                style={[
                  s.placeChip,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  !selectedSpaceId && { backgroundColor: theme.gold, borderColor: theme.gold },
                ]}
                onPress={() => setSelectedSpaceId(null)}
              >
                <Text
                  style={[
                    s.placeChipText,
                    { color: theme.textSecondary },
                    !selectedSpaceId && { color: theme.bg, fontWeight: '700' },
                  ]}
                >
                  Auto
                </Text>
              </TouchableOpacity>

              {placementChipSpaces.map(space => {
                const active = selectedSpaceId === space.id;

                return (
                  <TouchableOpacity
                    key={space.id}
                    style={[
                      s.placeChip,
                      { backgroundColor: theme.surface, borderColor: theme.border },
                      active && { backgroundColor: theme.gold, borderColor: theme.gold },
                    ]}
                    onPress={() => setSelectedSpaceId(active ? null : space.id)}
                  >
                    <Text
                      style={[
                        s.placeChipText,
                        { color: theme.textSecondary },
                        active && { color: theme.bg, fontWeight: '700' },
                      ]}
                      numberOfLines={1}
                    >
                      {space.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={[s.placeHint, { color: theme.textMuted }]}>
              Optional. Auto can suggest placement from tags, family, and media details.
            </Text>
          </View>
        )}

        <View style={s.field}>
          <TouchableOpacity
            style={[s.contextToggle, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => setShowContext(value => !value)}
            activeOpacity={0.82}
          >
            <View style={s.contextTitleWrap}>
              <Text style={[s.contextTitle, { color: theme.text }]}>Context</Text>
              <Text style={[s.contextHint, { color: theme.textMuted }]}>
                Add what you know now. bE can calmly ask for missing details later.
              </Text>
            </View>
            <Text style={[s.contextToggleText, { color: theme.gold }]}>
              {showContext ? 'Hide' : 'Add'}
            </Text>
          </TouchableOpacity>

          {showContext && (
            <View style={[s.contextPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[s.contextMiniHint, { color: theme.textMuted }]}>People</Text>

              {personCandidates.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.contextChipRow}>
                  {personCandidates.slice(0, 14).map(person => {
                    const active = isLivingPersonSelected(selectedPeople, person);

                    return (
                      <TouchableOpacity
                        key={person.id}
                        style={[
                          s.personChip,
                          { backgroundColor: theme.raised, borderColor: theme.border },
                          active && { backgroundColor: theme.gold, borderColor: theme.gold },
                        ]}
                        onPress={() => setSelectedPeople(prev => toggleLivingPersonSelection(prev, person))}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            s.personChipAvatar,
                            { color: active ? theme.bg : theme.gold, borderColor: active ? theme.bg : theme.border },
                          ]}
                        >
                          {person.displayName.slice(0, 1).toUpperCase()}
                        </Text>
                        <Text
                          style={[
                            s.contextChipText,
                            { color: theme.textSecondary },
                            active && { color: theme.bg, fontWeight: '700' },
                          ]}
                          numberOfLines={1}
                        >
                          {person.displayName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <TextInput
                style={[s.contextInput, { color: theme.text, backgroundColor: theme.raised, borderColor: theme.border }]}
                placeholder="Add another person, name, or npub"
                placeholderTextColor={theme.textMuted}
                value={peopleInput}
                onChangeText={setPeopleInput}
                returnKeyType="done"
              />

              <Text style={[s.contextMiniHint, { color: theme.textMuted }]}>Calendar event</Text>

              {selectedGroupSpaceId ? (
                <>
                  {loadingCalendarEvents ? (
                    <View style={s.calendarEventLoadingRow}>
                      <ActivityIndicator size="small" color={theme.gold} />
                      <Text style={[s.calendarEventLoadingText, { color: theme.textMuted }]}>
                        Loading calendar events…
                      </Text>
                    </View>
                  ) : calendarEvents.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={s.contextChipRow}
                    >
                      {calendarEvents.map(event => {
                        const active = selectedCalendarEventId === event.id;

                        return (
                          <TouchableOpacity
                            key={event.id}
                            style={[
                              s.calendarEventChip,
                              { backgroundColor: theme.raised, borderColor: theme.border },
                              active && { backgroundColor: theme.gold, borderColor: theme.gold },
                            ]}
                            onPress={() => toggleCalendarEvent(event)}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                s.calendarEventChipTitle,
                                { color: theme.textSecondary },
                                active && { color: theme.bg, fontWeight: '800' },
                              ]}
                              numberOfLines={1}
                            >
                              {event.title}
                            </Text>
                            <Text
                              style={[
                                s.calendarEventChipMeta,
                                { color: theme.textMuted },
                                active && { color: theme.bg },
                              ]}
                              numberOfLines={1}
                            >
                              {formatEventDate(event)} • {formatEventTime(event)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <Text style={[s.calendarEventEmptyText, { color: theme.textMuted }]}>
                      No calendar events found for this Space yet.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={[s.calendarEventEmptyText, { color: theme.textMuted }]}>
                  Pick a group Space above to attach this Mark to a calendar event.
                </Text>
              )}

              <TextInput
                style={[s.contextInput, { color: theme.text, backgroundColor: theme.raised, borderColor: theme.border }]}
                placeholder="Or type event name, season, trip, or ceremony"
                placeholderTextColor={theme.textMuted}
                value={eventInput}
                onChangeText={text => {
                  setEventInput(text);
                  setSelectedCalendarEventId(null);
                }}
                returnKeyType="done"
              />

              <Text style={[s.contextMiniHint, { color: theme.textMuted }]}>Life stage</Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.contextChipRow}>
                {LIFE_STAGE_OPTIONS.map(option => {
                  const active = lifeStage === option;

                  return (
                    <TouchableOpacity
                      key={option}
                      style={[
                        s.contextChip,
                        { backgroundColor: theme.raised, borderColor: theme.border },
                        active && { backgroundColor: theme.gold, borderColor: theme.gold },
                      ]}
                      onPress={() => setLifeStage(active ? '' : option)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          s.contextChipText,
                          { color: theme.textSecondary },
                          active && { color: theme.bg, fontWeight: '700' },
                        ]}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                style={[
                  s.contextChip,
                  { alignSelf: 'flex-start', backgroundColor: theme.raised, borderColor: theme.border },
                  savedToBook && { backgroundColor: theme.gold, borderColor: theme.gold },
                ]}
                onPress={() => setSavedToBook(value => !value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    s.contextChipText,
                    { color: theme.textSecondary },
                    savedToBook && { color: theme.bg, fontWeight: '700' },
                  ]}
                >
                  Save toward Living Book
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Relay toggle */}
        <View style={[s.relayRow, { borderColor: theme.border }]}>
          <View>
            <Text style={[s.relayLabel, { color: theme.text }]}>Publish to relay</Text>
            <Text style={[s.relayHint, { color: theme.textMuted }]}>relay.beginningend.com</Text>
          </View>
          <TouchableOpacity
          style={[
  s.toggle,
  { backgroundColor: theme.raised },
  publishToNostr && { backgroundColor: theme.gold },
]}
            onPress={() => setPublishToNostr(v => !v)}
          >
            <View style={[s.toggleThumb, publishToNostr && s.toggleThumbOn]} />
          </TouchableOpacity>
        </View>

        {selectedIsFamilySpace && family && (
          <View style={[s.relayRow, { borderColor: theme.border }]}>
            <View>
              <Text style={[s.relayLabel, { color: theme.text }]}>Family Space selected</Text>
              <Text style={[s.relayHint, { color: theme.textMuted }]}>
                This Mark will be placed in {family.name}.
              </Text>
            </View>

            <Text style={[s.relayHint, { color: theme.gold, fontWeight: '800' }]}>
              Family
            </Text>
          </View>
        )}

        {/* Save */}
<TouchableOpacity
  style={[
    s.saveBtn,
    { backgroundColor: theme.gold },
    saving && s.saveBtnSaving,
  ]}
  onPress={handleSave}
  disabled={saving}
>
          {saving ? (
            <View style={s.savingRow}>
              <ActivityIndicator color="#111" />
              <Text style={[s.saveBtnText, { color: theme.bg }]}>{saveStatus || 'Saving...'}</Text>
            </View>
          ) : (
            <Text style={[s.saveBtnText, { color: theme.bg }]}>Save Mark</Text>
          )}
        </TouchableOpacity>

      </ScrollView>

      {saving && (
        <View style={s.savingOverlay}>
          <View style={[s.savingCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ActivityIndicator color={theme.gold} />
<Text style={[s.savingTitle, { color: theme.text }]}>
  {saveStatus || 'Saving Mark...'}
</Text>

<View style={[s.progressWrap, { backgroundColor: theme.raised }]}>
  <View style={[s.progressBar, { width: `${progress}%`, backgroundColor: theme.gold }]} />
</View>

            <Text style={[s.progressText, { color: theme.textMuted }]}>
              {progress}%
           </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  container: { padding: 20, paddingBottom: 48 },
  photoRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  photoBtn: { flex: 1, height: 90, borderRadius: 10, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoBtnIcon: { fontSize: 24 },
  photoBtnText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  photoPreview: { marginBottom: 22, borderRadius: 10, overflow: 'hidden', borderWidth: 0.5, borderColor: '#2a2a2a' },
  photo: { width: '100%', height: 220 },
  photoActions: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingVertical: 10, backgroundColor: '#1a1a1a' },
  photoActionBtn: { padding: 4 },
  photoActionText: { fontSize: 13, color: '#888' },
  field: { marginBottom: 22 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, marginBottom: 8 },
  titleInput: { borderWidth: 0.5, borderRadius: 8, padding: 12, fontSize: 16, fontWeight: '500' },
  textarea: { borderWidth: 0.5, borderRadius: 8, padding: 12, fontSize: 15, minHeight: 100, lineHeight: 22 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  presetChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5 },
  presetChipActive: {},
  presetText: { fontSize: 13, color: '#666' },
  presetTextActive: { color: '#111', fontWeight: '600' },

  photoPreviewRow: {
  marginBottom: 22,
},
multiPhotoWrap: {
  marginRight: 10,
  position: 'relative',
},
multiPhoto: {
  width: 140,
  height: 140,
  borderRadius: 10,
  backgroundColor: '#000',
},
removePhotoBtn: {
  position: 'absolute',
  top: 6,
  right: 6,
  backgroundColor: 'rgba(0,0,0,0.7)',
  width: 26,
  height: 26,
  borderRadius: 13,
  alignItems: 'center',
  justifyContent: 'center',
},
removePhotoText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '700',
},
progressWrap: {
  height: 6,
  backgroundColor: '#222',
  borderRadius: 4,
  overflow: 'hidden',
  marginBottom: 10,
},
progressBar: {
  height: '100%',
},
savingOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.65)',
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 28,
},
savingCard: {
  width: '100%',
  borderRadius: 18,
  backgroundColor: '#1a1a1a',
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
  padding: 20,
  alignItems: 'center',
},
savingTitle: {
  color: '#fff',
  fontSize: 15,
  fontWeight: '700',
  marginTop: 12,
  marginBottom: 14,
},
progressText: {
  color: '#888',
  fontSize: 12,
  fontWeight: '600',
},
videoBadge: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.25)',
  borderRadius: 10,
},
videoBadgeText: {
  color: '#fff',
  fontSize: 28,
  fontWeight: '800',
},
  // Custom tag row
  tagInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  tagInput: { flex: 1, borderWidth: 0.5, borderRadius: 8, padding: 10, fontSize: 14 },
  tagAddBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  tagAddBtnDim: { opacity: 0.35 },
  tagAddBtnText: { fontSize: 13, fontWeight: '700' },
  selectedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 0.5 },
  tagChipText: { fontSize: 12 },
  placeChipRow: { gap: 8, paddingRight: 20 },
  placeChip: { minHeight: 34, maxWidth: 160, paddingHorizontal: 13, borderRadius: 18, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center' },
  placeChipText: { fontSize: 12, fontWeight: '600' },
  placeHint: { fontSize: 11, lineHeight: 16, marginTop: 8 },
  contextToggle: { borderWidth: 0.5, borderRadius: 10, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  contextTitleWrap: { flex: 1, minWidth: 0 },
  contextTitle: { fontSize: 14, fontWeight: '800' },
  contextHint: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  contextToggleText: { fontSize: 12, fontWeight: '900' },
  contextPanel: { borderWidth: 0.5, borderRadius: 10, marginTop: 10, padding: 12, gap: 10 },
  contextInput: { borderWidth: 0.5, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10, fontSize: 13 },
  contextMiniHint: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  contextChipRow: { gap: 8, paddingRight: 20 },
  contextChip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center' },
  contextChipText: { fontSize: 12, fontWeight: '700' },
  personChip: { minHeight: 34, maxWidth: 180, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 17, borderWidth: 0.5, flexDirection: 'row', alignItems: 'center', gap: 7 },
  personChipAvatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 0.5, textAlign: 'center', lineHeight: 19, fontSize: 10, fontWeight: '900', overflow: 'hidden' },
    calendarEventLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  calendarEventLoadingText: { fontSize: 12, fontWeight: '600' },
  calendarEventEmptyText: { fontSize: 12, lineHeight: 17 },
  calendarEventChip: { width: 210, minHeight: 54, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderWidth: 0.5, justifyContent: 'center' },
  calendarEventChipTitle: { fontSize: 12, fontWeight: '800', marginBottom: 3 },
  calendarEventChipMeta: { fontSize: 10, fontWeight: '700' },
  relayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, paddingVertical: 12, borderTopWidth: 0.5, borderBottomWidth: 0.5 },
  relayLabel: { fontSize: 14, fontWeight: '500' },
  relayHint: { fontSize: 11, marginTop: 2 },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: '#2a2a2a', justifyContent: 'center', padding: 2 },
  toggleOn: {},
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  saveBtn: { borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
saveBtnSaving: { opacity: 0.85 },
savingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveBtnText: { color: '#111', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
