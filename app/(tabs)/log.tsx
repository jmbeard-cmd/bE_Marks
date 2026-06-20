import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  DeviceEventEmitter,
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
  formatCompactCalendarEventMarkLabel,
  formatEventDate,
  formatEventTime,
  getCalendarEventsForGroup,
  type GroupCalendarEvent,
} from '../../src/utils/group-calendar';
import {
  getGroupMembers,
  getVisibleGroupsForNpub,
} from '../../src/utils/group-storage';
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
import {
  publishGroupMark,
  signAndPublish,
} from '../../src/utils/nostr';
import { uploadMilestoneMedia } from '../../src/utils/r2';
import {
  getAccountSafetySettings,
  getFamilyMembers,
  saveMilestone,
  updateMilestone,
  type AccountSafetySettings,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

const LIFT_UP_TAG = 'Lift Up';
const PRESET_TAGS = ['Family', 'Faith', 'Career', 'School', 'Travel', 'Health', 'Achievement', 'Personal'];

type MarkMode = 'memory' | 'lift-up';
type PublishLane = 'personal' | 'space' | 'both';

type DraftMedia = {
  id: string;
  uri: string;
  type: 'image' | 'video';
  thumbnailUri?: string;
  place?: LivingMarkPlace;
  occurredAt?: number;
  captureSource: Extract<LivingMarkCaptureSource, 'camera' | 'library'>;
};

type ComposerCalendarEventOption = {
  key: string;
  event: GroupCalendarEvent;
  groupId: string;
  spaceId: string;
  spaceName: string;
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

function normalizeComposerRelayUrl(value?: string | null): string | null {
  const trimmed = value?.trim();

  if (!trimmed) return null;
  if (!trimmed.startsWith('wss://') && !trimmed.startsWith('ws://')) return null;

  return trimmed.replace(/\/$/, '');
}

function getComposerSpaceRelayUrls(
  primaryRelayUrl?: string | null,
  backupRelayUrls: string[] = []
): string[] {
  return Array.from(
    new Set(
      [primaryRelayUrl, ...backupRelayUrls]
        .map(relayUrl => normalizeComposerRelayUrl(relayUrl))
        .filter((relayUrl): relayUrl is string => !!relayUrl)
    )
  );
}

export default function LogScreen() {
  const { nsec, npub, family, relays, profile, theme } = useIdentity();
  const router = useRouter();
  const params = useLocalSearchParams<{
    selectedSpaceId?: string;
    returnToGroupId?: string;
    returnToGroupTab?: string;
    calendarEventId?: string;
    calendarEventTitle?: string;
    savedToBook?: string;
  }>();

  const routeSelectedSpaceId = getRouteParam(params.selectedSpaceId);
  const returnToGroupId = getRouteParam(params.returnToGroupId);
  const routeReturnToGroupTab = getRouteParam(params.returnToGroupTab);
  const routeCalendarEventId = getRouteParam(params.calendarEventId);
  const routeCalendarEventTitle = getRouteParam(params.calendarEventTitle);
  const routeSavedToBook = getRouteParam(params.savedToBook);

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
  const routeCalendarEventAppliedRef = useRef(false);
  const publicPublishWarningShownRef = useRef(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [markMode, setMarkMode] = useState<MarkMode>('memory');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [media, setMedia] = useState<DraftMedia[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [publishToNostr, setPublishToNostr] = useState(false);
  const [audioUri, setAudioUri] = useState<string | undefined>();
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [livingSpaces, setLivingSpaces] = useState<LivingSpace[]>([]);
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<string>>(() => new Set());
  const [groupRelayUrlsById, setGroupRelayUrlsById] = useState<Record<string, string[]>>({});
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [peopleInput, setPeopleInput] = useState('');
  const [personCandidates, setPersonCandidates] = useState<LivingPersonCandidate[]>([]);
  const [groupPersonCandidates, setGroupPersonCandidates] = useState<LivingPersonCandidate[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<LivingMarkPerson[]>([]);
  const [lifeStage, setLifeStage] = useState('');
  const [eventInput, setEventInput] = useState('');
  const [calendarEventOptions, setCalendarEventOptions] = useState<ComposerCalendarEventOption[]>([]);
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);
  const [loadingCalendarEvents, setLoadingCalendarEvents] = useState(false);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [savedToBook, setSavedToBook] = useState(false);
  const [accountSafety, setAccountSafety] = useState<AccountSafetySettings | null>(null);

  const myDisplayName =
  profile?.display_name ||
  profile?.name ||
  (npub ? `${npub.slice(0, 12)}â€¦` : 'Someone');

  const isLiftUpMark = markMode === 'lift-up';

  const titlePlaceholder = isLiftUpMark
    ? 'Who are you lifting up?'
    : 'Give this Mark a title';

  const notePlaceholder = isLiftUpMark
    ? 'What did they do that should be remembered?'
    : 'Tell the story behind this Mark...';

      useEffect(() => {
    DeviceEventEmitter.emit('be:floatingDock:setHidden', true);

    return () => {
      DeviceEventEmitter.emit('be:floatingDock:setHidden', false);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    getAccountSafetySettings()
      .then(settings => {
        if (mounted) {
          setAccountSafety(settings);
        }
      })
      .catch(error => {
        console.warn('[Account Safety] failed to load in Mark composer:', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

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
          const relayUrlsByGroupId = groups.reduce<Record<string, string[]>>((acc, group) => {
            acc[group.id] = getComposerSpaceRelayUrls(
              group.relayUrl,
              group.backupRelayUrls ?? []
            );

            return acc;
          }, {});

          setLivingSpaces(spaces);
          setVisibleGroupIds(new Set(groups.map(group => group.id)));
          setGroupRelayUrlsById(relayUrlsByGroupId);
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

  useEffect(() => {
    if (routeCalendarEventAppliedRef.current) return;
    if (routeSavedToBook === '1' || routeSavedToBook === 'true') {
      setSavedToBook(true);
    }
  }, [routeSavedToBook]);

  const selectedGroupSpaceId =
    selectedSpace?.source === 'group' ? selectedSpace.id : null;

  const selectedGroupId =
    selectedSpace?.source === 'group'
      ? selectedSpace.sourceId ?? selectedSpace.id.replace(/^group:/, '')
      : null;

  const selectedGroupRelayUrls =
    selectedGroupId
      ? groupRelayUrlsById[selectedGroupId] ?? getComposerSpaceRelayUrls(selectedSpace?.relayUrl)
      : [];

  const selectedGroupRelayUrl = selectedGroupRelayUrls[0];

  const contextPeopleLabel = isLiftUpMark
    ? 'Who are you lifting up?'
    : 'People';

  const contextPeopleHint = isLiftUpMark
    ? 'Tag the person this Mark is about. Notifications can be handled separately later.'
    : selectedGroupSpaceId
      ? 'Tag Space members or add names connected to this Mark.'
      : 'Add people connected to this Mark.';

  const contextPeoplePlaceholder = isLiftUpMark
    ? selectedGroupSpaceId
      ? 'Type @ to tag the person being lifted up'
      : 'Add the person this Mark is about'
    : selectedGroupSpaceId
      ? 'Type @ to tag someone in this Space'
      : 'Add another person, name, or npub';

  useEffect(() => {
    let cancelled = false;

    async function loadGroupPeople() {
      if (!selectedGroupId) {
        setGroupPersonCandidates([]);
        return;
      }

      try {
        const members = await getGroupMembers(selectedGroupId);

        if (cancelled) return;

        const seenMemberNpubs = new Set<string>();

        setGroupPersonCandidates(
          members
            .filter(member => {
              const memberNpub = member.npub?.trim();
              if (!memberNpub) return false;
              if (npub && memberNpub.toLowerCase() === npub.toLowerCase()) return false;

              const key = memberNpub.toLowerCase();
              if (seenMemberNpubs.has(key)) return false;

              seenMemberNpubs.add(key);
              return true;
            })
            .map(member => {
              const knownPerson = personCandidates.find(person => person.npub === member.npub);
              const displayName =
                member.displayName?.trim() ||
                knownPerson?.displayName?.trim() ||
                (member.npub ? `${member.npub.slice(0, 12)}â€¦` : 'Group member');

              return {
                id: member.npub.toLowerCase(),
                npub: member.npub,
                displayName,
                avatarUrl: member.avatarUrl || knownPerson?.avatarUrl,
                source: 'space-member' as const,
              };
            })
        );
      } catch (error) {
        console.warn('[Log People] failed to load group members:', error);

        if (!cancelled) {
          setGroupPersonCandidates([]);
        }
      }
    }

    loadGroupPeople();

    return () => {
      cancelled = true;
    };
  }, [npub, personCandidates, selectedGroupId]);

  const displayedPersonCandidates = mergeLivingPersonCandidates([
    ...personCandidates,
    ...groupPersonCandidates,
  ]);

  const peopleChipCandidates =
    selectedGroupSpaceId && groupPersonCandidates.length > 0
      ? groupPersonCandidates
      : displayedPersonCandidates;

  const mentionCandidatePool =
    selectedGroupSpaceId && groupPersonCandidates.length > 0
      ? groupPersonCandidates
      : displayedPersonCandidates;

  const mentionMatch = peopleInput.match(/@([^\s,]*)$/);
  const mentionSearch = mentionMatch?.[1]?.trim().toLowerCase() ?? '';
  const mentionActive = peopleInput.includes('@') && mentionMatch !== null;

  const mentionSuggestions = mentionActive
    ? mentionCandidatePool
        .filter(person => !isLivingPersonSelected(selectedPeople, person))
        .filter(person => {
          if (mentionSearch.length === 0) return person.source === 'space-member';

          const displayName = person.displayName.toLowerCase();
          const npubValue = person.npub?.toLowerCase() ?? '';

          return (
            displayName.startsWith(mentionSearch) ||
            displayName.includes(mentionSearch) ||
            npubValue.includes(mentionSearch)
          );
        })
        .slice(0, 6)
    : [];

  const selectMentionCandidate = (person: LivingPersonCandidate) => {
    setSelectedPeople(prev =>
      isLivingPersonSelected(prev, person)
        ? prev
        : toggleLivingPersonSelection(prev, person)
    );

    setPeopleInput(current => current.replace(/@([^\s,]*)$/, '').trim());
  };

  const selectedIsSharedSpace = !!selectedGroupSpaceId;
  const publicPostingLockedForChildGroup =
    accountSafety?.childUnder13 === true && !!selectedGroupSpaceId;

  const publishLane: PublishLane = selectedGroupSpaceId
    ? publishToNostr && !publicPostingLockedForChildGroup
      ? 'both'
      : 'space'
    : 'personal';

  const publicPublishLabel = publicPostingLockedForChildGroup
    ? 'Space-safe Mark'
    : selectedIsSharedSpace
      ? 'Also publish beyond this Space'
      : 'Make your Mark public';

  const publicPublishHint = publicPostingLockedForChildGroup
    ? 'This Mark will save inside the Space. Public posting is turned off for child accounts.'
    : selectedGroupSpaceId
      ? 'This Mark saves to the Space by default. Turn this on only if it should also be posted publicly.'
      : 'Optional. Turn this on only when you want this Mark posted publicly.';

  const primarySaveLabel = selectedGroupSpaceId
    ? 'Save to Space'
    : 'Save Mark';

  useEffect(() => {
    if (selectedIsSharedSpace || publicPostingLockedForChildGroup) {
      setPublishToNostr(false);
      publicPublishWarningShownRef.current = false;
    }
  }, [publicPostingLockedForChildGroup, selectedIsSharedSpace, selectedSpaceId]);

  const handleLiftUpAction = () => {
    if (markMode === 'lift-up') {
      setMarkMode('memory');
      return;
    }

    setMarkMode('lift-up');
    setShowContext(true);
  };

  const handleCalendarAction = () => {
    setShowCalendarPicker(value => !value);
    setShowContext(false);
  };
  
  const handlePublicPublishToggle = () => {
    if (publicPostingLockedForChildGroup) {
      Alert.alert(
        'Space-safe posting',
        'Public posting is turned off for child accounts inside group Spaces. This Mark will still sync with Space members.'
      );
      setPublishToNostr(false);
      return;
    }

    if (publishToNostr) {
      setPublishToNostr(false);
      return;
    }

    if (!publicPublishWarningShownRef.current) {
      Alert.alert(
        'Make this Mark public?',
        selectedIsSharedSpace
          ? 'This Mark will also be visible outside this Space to anyone who can read your public relay. Space members will still receive it through the Space relay even if this stays off.'
          : 'This Mark will be visible to anyone who can read your public relay.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Make public',
            onPress: () => {
              publicPublishWarningShownRef.current = true;
              setPublishToNostr(true);
            },
          },
        ]
      );
      return;
    }

    setPublishToNostr(true);
  };

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

    router.replace('/(tabs)/groups' as any);
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

    async function loadCalendarEventOptions() {
      const eligibleSpaces = livingSpaces
        .filter(space => !space.archivedAt)
        .filter(space => space.source === 'group')
        .filter(space => {
          const groupId = space.sourceId ?? space.id.replace(/^group:/, '');

          if (selectedGroupId) {
            return groupId === selectedGroupId;
          }

          return visibleGroupIds.has(groupId);
        });

      if (eligibleSpaces.length === 0) {
        setCalendarEventOptions([]);
        setSelectedCalendarEventId(null);
        return;
      }

      setLoadingCalendarEvents(true);

      try {
        const loadedOptions = await Promise.all(
          eligibleSpaces.map(async space => {
            const groupId = space.sourceId ?? space.id.replace(/^group:/, '');
            const events = await getCalendarEventsForGroup(groupId);

            return events.slice(0, 12).map(event => ({
              key: `${groupId}:${event.id}`,
              event,
              groupId,
              spaceId: space.id,
              spaceName: space.name,
            }));
          })
        );

        const flattenedOptions = loadedOptions
          .flat()
          .sort((a, b) => String(a.event.startDate).localeCompare(String(b.event.startDate)))
          .slice(0, 20);

        if (!cancelled) {
          setCalendarEventOptions(flattenedOptions);

          if (routeCalendarEventId && !routeCalendarEventAppliedRef.current) {
            const routeOption = flattenedOptions.find(option => option.event.id === routeCalendarEventId);

            if (routeOption || routeCalendarEventTitle) {
              routeCalendarEventAppliedRef.current = true;
              setSelectedCalendarEventId(routeCalendarEventId);
              setEventInput(routeOption?.event.title ?? routeCalendarEventTitle ?? '');
            }
          }
        }
      } catch (error) {
        console.warn('[Log Calendar Events] failed to load:', error);

        if (!cancelled) {
          setCalendarEventOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingCalendarEvents(false);
        }
      }
    }

    loadCalendarEventOptions();

    return () => {
      cancelled = true;
    };
  }, [livingSpaces, routeCalendarEventId, routeCalendarEventTitle, selectedGroupId, visibleGroupIds]);

const placementChipSpaces = livingSpaces
  .filter(space => !space.archivedAt)
  .filter(space => {
    if (space.id === SYSTEM_LIVING_SPACE_IDS.profile) return false;
    if (space.id === SYSTEM_LIVING_SPACE_IDS.family) return false;

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

const toggleCalendarEvent = (option: ComposerCalendarEventOption) => {
  const active = selectedCalendarEventId === option.event.id;

  if (active) {
    setSelectedCalendarEventId(null);
    setEventInput('');
    return;
  }

  setSelectedCalendarEventId(option.event.id);
  setEventInput(option.event.title);
};

const extractHashTags = (value: string): string[] => {
  return Array.from(
    new Set(
      value
        .split(/\s+/)
        .map(item => item.trim())
        .filter(item => item.startsWith('#') && item.length > 1)
        .map(item => item.replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter(Boolean)
    )
  );
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

if (selectedGroupSpaceId && selectedGroupRelayUrls.length === 0) {
  Alert.alert(
    'Space relay missing',
    'This Space does not have a valid relay configured. This Mark was not saved or published because bE Marks will not fall back to your personal relays for Space posts.'
  );
  return;
}

    setSaving(true);
setProgress(0);
setSaveStatus('Preparing your Mark...');
try {
      const fullNote = title.trim() ? `${title.trim()}\n\n${note.trim()}` : note.trim();

      // â”€â”€ Step 1: Upload media FIRST so the URL is ready for the Nostr event â”€â”€
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

      // Warn user immediately if any media failed â€” don't silently drop it

      const hashTags = extractHashTags(tagInput);

      const finalTags = isLiftUpMark
        ? Array.from(new Set([...tags, ...hashTags, LIFT_UP_TAG]))
        : Array.from(new Set([...tags, ...hashTags]));
      
      // â”€â”€ Step 2: Optionally publish to public/profile relay â”€â”€
      let nostrEventId: string | undefined;
      let published = false;

      const shouldPublishToPersonalRelays =
        publishToNostr &&
        !publicPostingLockedForChildGroup &&
        (publishLane === 'personal' || publishLane === 'both');

      setProgress(70);
      if (shouldPublishToPersonalRelays && nsec) {
        setSaveStatus(selectedIsSharedSpace ? 'Publishing beyond this Space...' : 'Publishing publicly...');

        const result = await signAndPublish({
          note: fullNote,
          tags: finalTags,
          imageUrl: uploadedPhoto,
          videoUrl: uploadedVideo,
          audioUrl: uploadedAudio,
        }, nsec, relays);

        if (result.success) {
          nostrEventId = result.eventId;
          published = true;
        } else {
          Alert.alert('Public relay warning', `Saved locally. Public relay: ${result.error}`);
        }
      } else {
        setSaveStatus(selectedIsSharedSpace ? 'Keeping this inside the Space...' : 'Saving privately...');
      }

      // â”€â”€ Step 4: Save to local storage â”€â”€
      setSaveStatus('Saving Mark...');
      setProgress(85);

      const savedMilestone = await saveMilestone({
        title: title.trim() || undefined,
        note: fullNote,
        tags: finalTags,
        photoUri: uploadedPhoto,
        media: uploadedMedia,
        audioUri: uploadedAudio,
        videoUri: uploadedVideo,
        nostrEventId,
        publishedToRelay: published,
        authorNpub: npub ?? undefined,
        authorName: myDisplayName,
      });

      setSaveStatus('Placing Mark...');
      setProgress(90);

      const captureMetadata = getCaptureMetadataForDraft(media, audioUri);
      const privacyHint: MarkPrivacy | undefined =
        selectedGroupSpaceId
          ? 'space'
          : publishToNostr && published
            ? 'public'
            : undefined;

      const resolvedPeople = resolvePeopleSelection({
        selectedPeople,
        manualInput: peopleInput,
      });
      const selectedCalendarEventOption = selectedCalendarEventId
        ? calendarEventOptions.find(option => option.event.id === selectedCalendarEventId)
        : null;
      const eventText = eventInput.trim();
      const eventIdForMark = selectedCalendarEventId || eventText || undefined;
      const eventTitleForMark = selectedCalendarEventId
        ? selectedCalendarEventOption
          ? formatCompactCalendarEventMarkLabel(selectedCalendarEventOption.event)
          : eventText || undefined
        : eventText || undefined;
      const eventSpaceIdForMark = selectedCalendarEventOption?.spaceId;
      const eventGroupIdForMark = selectedCalendarEventOption?.groupId;
      const eventSpaceNameForMark = selectedCalendarEventOption?.spaceName;

      const livingMarkCapture = await persistLivingMarkCapture({
        milestone: savedMilestone,
        spaces: livingSpaces,
        selectedSpaceId,
        currentNpub: npub,
        peopleIds: resolvedPeople.peopleIds,
        people: resolvedPeople.people,
        lifeStage: lifeStage || undefined,
        eventId: eventIdForMark,
        eventTitle: eventTitleForMark,
        eventSpaceId: eventSpaceIdForMark,
        eventGroupId: eventGroupIdForMark,
        eventSpaceName: eventSpaceNameForMark,
        savedToBook,
        captureSource: captureMetadata.captureSource,
        place: captureMetadata.place,
        occurredAt: captureMetadata.occurredAt,
        capturedAt: captureMetadata.occurredAt ?? savedMilestone.createdAt,
        privacy: privacyHint,
      });

      // â”€â”€ Step 5: Publish Space relay snapshot when selected â”€â”€
      const shouldPublishGroupSpaceMark =
        (publishLane === 'space' || publishLane === 'both') &&
        !!selectedGroupId &&
        !!selectedGroupSpaceId &&
        !!nsec &&
        selectedGroupRelayUrls.length > 0 &&
        visibleGroupIds.has(selectedGroupId);

      setSaveStatus(
        shouldPublishGroupSpaceMark
          ? 'Sharing with Space...'
          : 'Finishing Mark...'
      );
      setProgress(95);

      let groupSpacePublished = false;

      if (shouldPublishGroupSpaceMark && selectedGroupId && nsec && selectedGroupRelayUrl) {
        const groupMarkResult = await publishGroupMark({
          groupId: selectedGroupId,
          milestone: savedMilestone,
          metadata: livingMarkCapture.metadata,
          placement: livingMarkCapture.placement,
          nsec,
          relayUrl: selectedGroupRelayUrl,
          relayUrls: selectedGroupRelayUrls,
        });

        if (!groupMarkResult.success) {
          console.warn('[Space Marks] publish from Log failed:', groupMarkResult.error);
        } else {
          groupSpacePublished = true;

          await updateMilestone(savedMilestone.id, {
            spaceRelayEventId: groupMarkResult.eventId,
            spaceRelayPublishedAt: Math.floor(Date.now() / 1000),
            spaceRelayGroupIds: [selectedGroupId],
          });
        }
      }

      // â”€â”€ Reset form â”€â”€
      setTitle('');
      setNote('');
      setMarkMode('memory');
      setTags([]);
      setMedia([]);
      setAudioUri(undefined);
      setShowVoiceRecorder(false);
      setTagInput('');
      setSelectedSpaceId(null);
      setShowContext(false);
      setPeopleInput('');
      setSelectedPeople([]);
      setLifeStage('');
      setEventInput('');
      setSelectedCalendarEventId(null);
      setSavedToBook(false);
      setPublishToNostr(false);
      publicPublishWarningShownRef.current = false;

      setProgress(100);

      const savedMessage = selectedGroupSpaceId
        ? groupSpacePublished
          ? published
            ? 'Saved to Space and also published publicly.'
            : 'Saved to Space.'
          : 'Saved locally. Space sync did not finish.'
        : published
          ? 'Published publicly.'
          : 'Saved privately.';

      Alert.alert(
        'âœ“ Saved',
        savedMessage,
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
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
        <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        <BEHeader title="Mark" />

        {/* Composer */}
        <View
          style={[
            s.composerField,
            s.posterComposerCard,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[s.posterComposerEyebrow, { color: theme.textMuted }]}>
            Title
          </Text>

          <TextInput
            style={[
              s.posterTitleInput,
              {
                color: theme.text,
                borderBottomColor: theme.border,
              },
            ]}
            placeholder={titlePlaceholder}
            placeholderTextColor={theme.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            returnKeyType="next"
          />

          <Text style={[s.posterTitleHint, { color: theme.textMuted }]}>
            Optional headline for the card.
          </Text>

          <Text style={[s.posterComposerEyebrow, { color: theme.textMuted }]}>
            Story
          </Text>

          <TextInput
            style={[
              s.markComposerInput,
              {
                color: theme.text,
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
            placeholder={notePlaceholder}
            placeholderTextColor={theme.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </View>

                {/* Hashtags */}
        <View style={s.field}>
          <TextInput
            style={[
              s.hashTagInput,
              {
                color: theme.text,
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
            placeholder="#tags"
            placeholderTextColor={theme.textMuted}
            value={tagInput}
            onChangeText={setTagInput}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Media */}
        <View style={s.field}>

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
                      <Text style={s.videoBadgeText}>â–¶</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={s.removePhotoBtn}
                    onPress={() => setMedia(prev => prev.filter(m => m.id !== item.id))}
                  >
                    <Text style={s.removePhotoText}>âœ•</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <View style={s.mediaRail}>
            <TouchableOpacity
              style={[s.mediaRailBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={pickPhoto}
              activeOpacity={0.82}
            >
              <Ionicons name="images-outline" size={22} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.mediaRailBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={takePhoto}
              activeOpacity={0.82}
            >
              <Ionicons name="camera-outline" size={22} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.mediaRailBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={recordVideo}
              activeOpacity={0.82}
            >
              <Ionicons name="videocam-outline" size={22} color={theme.textSecondary} />
            </TouchableOpacity>

                      <TouchableOpacity
              style={[
                s.mediaRailBtn,
                { backgroundColor: theme.surface, borderColor: theme.border },
                !!selectedCalendarEventId && { borderColor: theme.gold, backgroundColor: theme.gold + '1F' },
              ]}
              onPress={handleCalendarAction}
              activeOpacity={0.82}
            >
              <Ionicons
                name={selectedCalendarEventId ? 'calendar' : 'calendar-outline'}
                size={22}
                color={selectedCalendarEventId ? theme.gold : theme.textSecondary}
              />
            </TouchableOpacity>  

            <TouchableOpacity
              style={[
                s.mediaRailBtn,
                { backgroundColor: theme.surface, borderColor: theme.border },
                showVoiceRecorder && { borderColor: theme.gold, backgroundColor: theme.gold + '1F' },
              ]}
              onPress={() => setShowVoiceRecorder(value => !value)}
              activeOpacity={0.82}
            >
              <Ionicons
                name="mic-outline"
                size={22}
                color={showVoiceRecorder ? theme.gold : theme.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.mediaRailBtn,
                { backgroundColor: theme.surface, borderColor: theme.border },
                isLiftUpMark && { borderColor: theme.gold, backgroundColor: theme.gold + '1F' },
              ]}
              onPress={handleLiftUpAction}
              activeOpacity={0.82}
            >
              <Ionicons
                name="arrow-up-circle-outline"
                size={23}
                color={isLiftUpMark ? theme.gold : theme.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.mediaRailBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => setShowContext(value => !value)}
              activeOpacity={0.82}
            >
              <Ionicons name="ellipsis-horizontal-circle-outline" size={23} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {showCalendarPicker && (
            <View style={[s.calendarPickerPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={s.calendarPickerHeader}>
                <Text style={[s.calendarPickerTitle, { color: theme.text }]}>
                  Calendar event
                </Text>

                <TouchableOpacity
                  onPress={() => setShowCalendarPicker(false)}
                  activeOpacity={0.82}
                >
                  <Ionicons name="close" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              {loadingCalendarEvents ? (
                <View style={s.calendarEventLoadingRow}>
                  <ActivityIndicator size="small" color={theme.gold} />
                  <Text style={[s.calendarEventLoadingText, { color: theme.textMuted }]}>
                    Loading eventsâ€¦
                  </Text>
                </View>
              ) : calendarEventOptions.length > 0 ? (
                <ScrollView
                  style={s.calendarPickerList}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {calendarEventOptions.map(option => {
                    const active = selectedCalendarEventId === option.event.id;

                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          s.calendarPickerEventRow,
                          { borderColor: theme.border, backgroundColor: theme.raised },
                          active && { borderColor: theme.gold, backgroundColor: theme.gold + '1F' },
                        ]}
                        onPress={() => toggleCalendarEvent(option)}
                        activeOpacity={0.82}
                      >
                        <View style={s.calendarPickerEventText}>
                          <Text
                            style={[
                              s.calendarPickerEventTitle,
                              { color: active ? theme.gold : theme.text },
                            ]}
                            numberOfLines={1}
                          >
                            {option.event.title}
                          </Text>

                          <Text style={[s.calendarPickerEventMeta, { color: theme.textMuted }]} numberOfLines={1}>
                            {selectedGroupSpaceId ? '' : `${option.spaceName} â€¢ `}
                            {formatEventDate(option.event)} â€¢ {formatEventTime(option.event)}
                          </Text>
                        </View>

                        {active && (
                          <Ionicons name="checkmark-circle" size={20} color={theme.gold} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={[s.calendarEventEmptyText, { color: theme.textMuted }]}>
                  {selectedGroupSpaceId
                    ? 'No events found for this Space yet.'
                    : 'No upcoming Space events found yet.'}
                </Text>
              )}

              <TextInput
                style={[
                  s.calendarPickerInput,
                  { color: theme.text, backgroundColor: theme.raised, borderColor: theme.border },
                ]}
                placeholder="Or type event name..."
                placeholderTextColor={theme.textMuted}
                value={eventInput}
                onChangeText={text => {
                  setEventInput(text);
                  setSelectedCalendarEventId(null);
                }}
                returnKeyType="done"
              />
            </View>
          )}
        </View>

        {showVoiceRecorder && (
          <View style={s.field}>
            <AudioRecorder
              onRecordingComplete={(uri) => setAudioUri(uri || undefined)}
              existingUri={audioUri}
            />
          </View>
        )}

        {showContext && (
          <View style={s.field}>
            <View style={[s.contextPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[s.contextMiniHint, { color: theme.textMuted }]}>
                {contextPeopleLabel}
              </Text>
              <Text style={[s.contextPeopleHelp, { color: theme.textMuted }]}>
                {contextPeopleHint}
              </Text>

              {peopleChipCandidates.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.contextChipRow}>
                  {peopleChipCandidates.slice(0, 14).map(person => {
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
                placeholder={contextPeoplePlaceholder}
                placeholderTextColor={theme.textMuted}
                value={peopleInput}
                onChangeText={setPeopleInput}
                returnKeyType="done"
              />

              {mentionSuggestions.length > 0 && (
                <View style={[s.mentionPanel, { backgroundColor: theme.raised, borderColor: theme.border }]}>
                  {mentionSuggestions.map(person => (
                    <TouchableOpacity
                      key={person.id}
                      style={[s.mentionRow, { borderBottomColor: theme.border }]}
                      onPress={() => selectMentionCandidate(person)}
                      activeOpacity={0.82}
                    >
                      <Text style={[s.mentionAvatar, { color: theme.gold, borderColor: theme.border }]}>
                        {person.displayName.slice(0, 1).toUpperCase()}
                      </Text>

                      <View style={s.mentionTextWrap}>
                        <Text style={[s.mentionName, { color: theme.text }]} numberOfLines={1}>
                          {person.displayName}
                        </Text>
                        <Text style={[s.mentionMeta, { color: theme.textMuted }]} numberOfLines={1}>
                          {person.source === 'space-member'
                            ? 'Space member'
                            : person.source === 'family-member'
                              ? 'Family'
                              : person.source === 'current-user'
                                ? 'You'
                                : 'Contact'}
                        </Text>
                      </View>

                      <Text style={[s.mentionAction, { color: theme.gold }]}>Add</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

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
          </View>
        )}

        {/* Public visibility / safety control */}
        <View style={[s.relayRow, { borderColor: theme.border }]}>
          <View style={{ flex: 1, paddingRight: 14 }}>
            <Text style={[s.relayLabel, { color: theme.text }]}>{publicPublishLabel}</Text>
            <Text style={[s.relayHint, { color: theme.textMuted }]}>{publicPublishHint}</Text>
          </View>

          {publicPostingLockedForChildGroup ? (
            <Text style={[s.relayHint, { color: theme.gold, fontWeight: '800' }]}>
              Protected
            </Text>
          ) : (
            <TouchableOpacity
            style={[
  s.toggle,
  { backgroundColor: theme.raised },
  publishToNostr && { backgroundColor: theme.gold },
]}
              onPress={handlePublicPublishToggle}
            >
              <View style={[s.toggleThumb, publishToNostr && s.toggleThumbOn]} />
            </TouchableOpacity>
          )}
        </View>

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
            <Text style={[s.saveBtnText, { color: theme.bg }]}>{primarySaveLabel}</Text>
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
  photoRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  mediaRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  mediaRailBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtnIcon: { fontSize: 23 },
  photoBtnText: { fontSize: 13, fontWeight: '900', textAlign: 'center' },
  photoPreview: { marginBottom: 22, borderRadius: 10, overflow: 'hidden', borderWidth: 0.5, borderColor: '#2a2a2a' },
  photo: { width: '100%', height: 220 },
  photoActions: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingVertical: 10, backgroundColor: '#1a1a1a' },
  photoActionBtn: { padding: 4 },
  photoActionText: { fontSize: 13, color: '#888' },
  field: { marginBottom: 22 },
  composerField: { marginBottom: 14 },
  posterComposerCard: {
    borderWidth: 0.5,
    borderRadius: 22,
    padding: 14,
  },
  posterComposerEyebrow: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  posterTitleInput: {
    borderBottomWidth: 0.5,
    paddingHorizontal: 0,
    paddingBottom: 10,
    marginBottom: 7,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
  },
  posterTitleHint: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginBottom: 16,
  },
  markComposerInput: {
    borderWidth: 0.5,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 17,
    minHeight: 150,
    lineHeight: 24,
    fontWeight: '500',
  },
  markTypeRow: { flexDirection: 'row', gap: 10 },
  markTypeChip: { flex: 1, minHeight: 64, borderRadius: 14, borderWidth: 0.5, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  markTypeTitle: { fontSize: 14, fontWeight: '900', marginBottom: 3 },
  markTypeHint: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
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
  hashTagInput: {
    borderWidth: 0.5,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '700',
  },
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
  contextPeopleHelp: { fontSize: 11, lineHeight: 16, marginTop: -5 },
  mentionPanel: { borderWidth: 0.5, borderRadius: 12, overflow: 'hidden' },
  mentionRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 0.5 },
  mentionAvatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 0.5, textAlign: 'center', lineHeight: 25, fontSize: 11, fontWeight: '900', overflow: 'hidden' },
  mentionTextWrap: { flex: 1, minWidth: 0 },
  mentionName: { fontSize: 13, fontWeight: '800' },
  mentionMeta: { fontSize: 10, marginTop: 2, fontWeight: '600' },
  mentionAction: { fontSize: 11, fontWeight: '900' },
  contextMiniHint: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  contextChipRow: { gap: 8, paddingRight: 20 },
  contextChip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center' },
  contextChipText: { fontSize: 12, fontWeight: '700' },
  personChip: { minHeight: 34, maxWidth: 180, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 17, borderWidth: 0.5, flexDirection: 'row', alignItems: 'center', gap: 7 },
  personChipAvatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 0.5, textAlign: 'center', lineHeight: 19, fontSize: 10, fontWeight: '900', overflow: 'hidden' },
   calendarPickerPanel: {
    borderWidth: 0.5,
    borderRadius: 18,
    padding: 12,
    marginTop: 2,
    gap: 10,
  },
  calendarPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendarPickerTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  calendarPickerList: {
    maxHeight: 220,
  },
  calendarPickerEventRow: {
    minHeight: 58,
    borderWidth: 0.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  calendarPickerEventText: {
    flex: 1,
    minWidth: 0,
  },
  calendarPickerEventTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  calendarPickerEventMeta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  calendarPickerInput: {
    borderWidth: 0.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: '700',
  },
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







