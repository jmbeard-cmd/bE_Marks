import { useAudioPlayer } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageViewerModal, { ViewerImage } from '../components/ImageViewerModal';
import type {
  LivingMarkPermissions,
  LivingMarkPerson,
  LivingMarkView,
  LivingSpace,
} from '../src/types/living-spaces';
import { setAppActivity } from '../src/utils/app-activity';
import { getContacts } from '../src/utils/contacts-storage';
import {
  formatEventDate,
  formatEventTime,
  getCalendarEventsForGroup,
  getSpaceEventTypeLabel,
  type GroupCalendarEvent,
} from '../src/utils/group-calendar';
import { getGroupMembers, isGroupAdmin } from '../src/utils/group-storage';
import {
  getPersonDisplayName,
  isLivingPersonSelected,
  livingPeopleToInput,
  mergeLivingPersonCandidates,
  normalizeLivingPeople,
  resolvePeopleSelection,
  toggleLivingPersonSelection,
  type LivingPersonCandidate,
} from '../src/utils/living-people';
import { SYSTEM_LIVING_SPACE_IDS } from '../src/utils/living-space-routing';
import {
  getLivingMarkViewForMilestone,
  getLivingSpaces,
  updateLivingMarkContext,
} from '../src/utils/living-spaces-storage';
import {
  fetchNostrProfile,
  type NostrProfile,
} from '../src/utils/nostr';
import {
  formatDate,
  getFamilyMembers,
  getMilestones,
  updateMilestone,
  type Milestone,
} from '../src/utils/storage';
import { useIdentity } from './_layout';

const { width } = Dimensions.get('window');
const LIFT_UP_TAG = 'Lift Up';

function getRouteLabel(kind: string): string {
  if (kind === 'local') return 'Local';
  if (kind === 'family-relay') return 'Family Space sync';
  if (kind === 'space-relay') return 'Space relay';
  if (kind === 'public-relay') return 'Public relay';
  return kind;
}

function getCalendarEventMarkLabel(event: GroupCalendarEvent): string {
  const title = event.title.trim();
  const eventTypeLabel = getSpaceEventTypeLabel(event.spaceEventType);
  const opponent = event.opponent?.trim();

  const detailParts = [
    opponent
      ? `${eventTypeLabel} vs ${opponent}`
      : event.spaceEventType && event.spaceEventType !== 'event'
        ? eventTypeLabel
        : '',
    `${formatEventDate(event)} • ${formatEventTime(event)}`,
  ].filter(Boolean);

  return [title, ...detailParts].join(' • ');
}

// Photo with loading state and broken-URI fallback
function MilestonePhoto({ uri }: { uri: string }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  if (error) {
    return (
      <View style={s.photoFallback}>
        <Text style={s.photoFallbackIcon}>🖼️</Text>
        <Text style={s.photoFallbackText}>Image unavailable</Text>
      </View>
    );
  }
  return (
    <View style={s.photoContainer}>
      <Image
        source={{ uri }}
        style={s.photo}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
      />
      {loading && (
        <View style={s.photoLoadingOverlay}>
          <ActivityIndicator size="small" color="#c9973a" />
        </View>
      )}
    </View>
  );
}

export default function MilestoneDetail() {
  const { id, returnToGroupId, returnToGroupTab } = useLocalSearchParams<{
    id: string;
    returnToGroupId?: string;
    returnToGroupTab?: string;
  }>();
  const router = useRouter();
  const { npub, family, profile, theme } = useIdentity();
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [isAddingReflection, setIsAddingReflection] = useState(false);
  const [reflectionText, setReflectionText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [detailMediaIndex, setDetailMediaIndex] = useState(0);
  const [reflectionProfiles, setReflectionProfiles] = useState<Record<string, NostrProfile>>({});
  const [livingView, setLivingView] = useState<LivingMarkView | null>(null);
  const [livingSpaces, setLivingSpaces] = useState<LivingSpace[]>([]);
  const [isEditingContext, setIsEditingContext] = useState(false);
  const [savingContext, setSavingContext] = useState(false);
  const [contextPeopleInput, setContextPeopleInput] = useState('');
  const [contextPersonCandidates, setContextPersonCandidates] = useState<LivingPersonCandidate[]>([]);
  const [selectedContextPeople, setSelectedContextPeople] = useState<LivingMarkPerson[]>([]);
  const [contextLifeStage, setContextLifeStage] = useState('');
  const [contextEventInput, setContextEventInput] = useState('');
  const [contextCalendarEvents, setContextCalendarEvents] = useState<GroupCalendarEvent[]>([]);
  const [contextSelectedCalendarEventId, setContextSelectedCalendarEventId] = useState<string | null>(null);
  const [loadingContextCalendarEvents, setLoadingContextCalendarEvents] = useState(false);
  const [showContextCalendarPicker, setShowContextCalendarPicker] = useState(false);
  const [contextPlaceInput, setContextPlaceInput] = useState('');
  const [contextSpaceId, setContextSpaceId] = useState<string | null>(null);
  const [contextInitialSpaceId, setContextInitialSpaceId] = useState<string | null>(null);
  const [contextSavedToBook, setContextSavedToBook] = useState(false);
  const [canManageMarkPermissions, setCanManageMarkPermissions] = useState(false);
  const [isEditingPermissions, setIsEditingPermissions] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState<LivingMarkPermissions>({});

  const audioPlayer = useAudioPlayer(
    milestone?.audioUri ? { uri: milestone.audioUri } : null
  );
  const videoViewRef = useRef<VideoView>(null);
  const videoPlayer = useVideoPlayer(
    milestone?.videoUri ? { uri: milestone.videoUri } : null,
    player => { player.loop = false; }
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (returnToGroupId) {
      router.replace({
        pathname: '/group-detail',
        params: { id: returnToGroupId, tab: returnToGroupTab || 'stickies' },
      } as any);
      return;
    }

    router.replace('/(tabs)/messages' as any);
  };

  useEffect(() => {
    let cancelled = false;

    async function loadMilestone() {
      if (!id) return;

      const all = await getMilestones();
      const found = all.find(m => m.id === id);

      if (cancelled) return;

      if (found) {
        setMilestone(found);
      }
    }

    loadMilestone();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function loadLivingContext() {
      if (!milestone) {
        setLivingView(null);
        return;
      }

      try {
        const spaces = await getLivingSpaces();
        const view = await getLivingMarkViewForMilestone({
          milestone,
          spaces,
          currentNpub: npub,
        });

        if (!cancelled) {
          setLivingSpaces(spaces);
          setLivingView(view);
        }
      } catch (error) {
        console.warn('[Mark Detail] failed to load Living Spaces context:', error);
      }
    }

    loadLivingContext();

    return () => {
      cancelled = true;
    };
  }, [milestone, npub]);

  useEffect(() => {
    let cancelled = false;

    async function loadPersonCandidates() {
      const groupSpaceIds =
        livingView?.spaces
          .filter(space => space.source === 'group' && space.sourceId)
          .map(space => space.sourceId as string) ?? [];

      const [contacts, familyMembers, groupMemberGroups] = await Promise.all([
        getContacts(),
        family ? getFamilyMembers(family.id) : Promise.resolve([]),
        Promise.all(groupSpaceIds.map(groupId => getGroupMembers(groupId))),
      ]);

      if (cancelled) return;

      const groupMembers = groupMemberGroups.flat();
      const myDisplayName =
        profile?.display_name ||
        profile?.name ||
        (npub ? `${npub.slice(0, 12)}...` : 'You');

      const familyPersonSeeds: {
        npub?: string;
        displayName?: string;
        avatarUrl?: string;
        source: 'family-member';
      }[] = familyMembers.map(member => ({
        npub: member.npub,
        displayName: member.displayName,
        avatarUrl: undefined,
        source: 'family-member',
      }));

      const contactPersonSeeds: {
        npub?: string;
        displayName?: string;
        avatarUrl?: string;
        source: 'contact';
      }[] = contacts.map(contact => ({
        npub: contact.npub,
        displayName: contact.nostrName || contact.name,
        avatarUrl: contact.nostrAvatar,
        source: 'contact',
      }));

      const knownPersonByNpub = new Map(
        [...familyPersonSeeds, ...contactPersonSeeds]
          .filter(person => person.npub)
          .map(person => [person.npub as string, person])
      );

      setContextPersonCandidates(
        mergeLivingPersonCandidates([
          {
            npub,
            displayName: myDisplayName,
            avatarUrl: (profile as any)?.picture || (profile as any)?.avatarUrl,
            source: 'current-user',
          },
          ...groupMembers
            .filter(member => member.npub !== npub)
            .map(member => {
              const knownPerson = knownPersonByNpub.get(member.npub);

              return {
                npub: member.npub,
                displayName:
                  member.displayName?.trim() ||
                  knownPerson?.displayName?.trim() ||
                  (member.npub ? `${member.npub.slice(0, 12)}...` : 'Space member'),
                avatarUrl: member.avatarUrl || knownPerson?.avatarUrl,
                source: 'space-member' as const,
              };
            }),
          ...familyPersonSeeds,
          ...contactPersonSeeds,
        ])
      );
    }

    loadPersonCandidates().catch(error => {
      console.warn('[Mark Detail] failed to load people candidates:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [family, livingView?.placement.updatedAt, livingView?.spaces, npub, profile]);

  useEffect(() => {
    let cancelled = false;

    async function resolvePermissionAccess() {
      if (!milestone) {
        setCanManageMarkPermissions(false);
        return;
      }

      if (!milestone.authorNpub || milestone.authorNpub === npub) {
        setCanManageMarkPermissions(true);
        return;
      }

      if (!npub) {
        setCanManageMarkPermissions(false);
        return;
      }

      const groupSpaceIds =
        livingView?.spaces
          .filter(space => space.source === 'group' && space.sourceId)
          .map(space => space.sourceId as string) ?? [];

      for (const groupId of groupSpaceIds) {
        if (await isGroupAdmin(groupId, npub)) {
          if (!cancelled) setCanManageMarkPermissions(true);
          return;
        }
      }

      if (!cancelled) setCanManageMarkPermissions(false);
    }

    resolvePermissionAccess().catch(error => {
      console.warn('[Mark Detail] failed to resolve permission access:', error);
      if (!cancelled) setCanManageMarkPermissions(false);
    });

    return () => {
      cancelled = true;
    };
  }, [milestone, npub, livingView?.spaces]);

    useEffect(() => {
    let cancelled = false;

    async function loadContextCalendarEvents() {
      const selectedGroupId = contextSpaceId?.startsWith('group:')
        ? contextSpaceId.replace(/^group:/, '')
        : null;

      if (!selectedGroupId) {
        setContextCalendarEvents([]);
        setContextSelectedCalendarEventId(null);
        setShowContextCalendarPicker(false);
        return;
      }

      setLoadingContextCalendarEvents(true);

      try {
        const loadedEvents = await getCalendarEventsForGroup(selectedGroupId);

        if (!cancelled) {
          setContextCalendarEvents(loadedEvents.slice(0, 12));
        }
      } catch (error) {
        console.warn('[Mark Detail Calendar Events] failed to load:', error);

        if (!cancelled) {
          setContextCalendarEvents([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingContextCalendarEvents(false);
        }
      }
    }

    loadContextCalendarEvents();

    return () => {
      cancelled = true;
    };
  }, [contextSpaceId]);
  
  useEffect(() => {
  if (!milestone?.reflections?.length) return;

  const authors = Array.from(
    new Set(
      milestone.reflections
        .map(r => r.authorNpub)
        .filter(Boolean)
    )
  ) as string[];

  authors.forEach(async authorNpub => {
    if (reflectionProfiles[authorNpub]) return;

    const profile = await fetchNostrProfile(authorNpub);

    if (profile) {
      setReflectionProfiles(prev => ({
        ...prev,
        [authorNpub]: profile,
      }));
    }
  });
}, [milestone?.reflections]);

  useEffect(() => {
    if (!audioPlayer) return;
    const sub = audioPlayer.addListener('playbackStatusUpdate', (status: any) => {
      if (status.didJustFinish) setIsAudioPlaying(false);
    });
    return () => sub.remove();
  }, [audioPlayer]);

  const playAudio = () => { if (!audioPlayer) return; audioPlayer.play(); setIsAudioPlaying(true); };
  const stopAudio = () => { if (!audioPlayer) return; audioPlayer.pause(); setIsAudioPlaying(false); };

  const startEditing = () => {
    if (!milestone) return;
    if (milestone.authorNpub && milestone.authorNpub !== npub) return;

    const currentTags = milestone.tags ?? [];

    setEditTitle('');
    setEditNote(milestone.note ?? '');
    setEditTags(currentTags);
    setEditTagInput(currentTags.map(tag => `#${tag.replace(/^#/, '')}`).join(' '));
    setIsEditingContext(false);
    setIsEditingPermissions(false);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!milestone) return;

    const parsedTags = Array.from(
      new Set(
        editTagInput
          .split(/[\s,]+/)
          .map(tag => tag.trim().replace(/^#/, ''))
          .filter(Boolean)
      )
    );

    const newNote = editNote.trim();

    await updateMilestone(milestone.id, { note: newNote, tags: parsedTags });
    setMilestone(prev => prev ? { ...prev, note: newNote, tags: parsedTags } : prev);
    setEditTags(parsedTags);
    setIsEditing(false);
  };

  const startContextEditing = () => {
    if (!milestone || !livingView) return;
    if (milestone.authorNpub && milestone.authorNpub !== npub) return;

    const primarySpaceId = livingView.placement.primarySpaceId ?? livingView.placement.spaceIds[0] ?? null;

    const existingPeople = livingView.metadata.people.filter(person => person.role !== 'author');
    setSelectedContextPeople(existingPeople);
    setContextPeopleInput(
      existingPeople.length > 0 ? '' : livingPeopleToInput([], livingView.metadata.peopleIds ?? [])
    );
    setContextLifeStage(livingView.metadata.lifeStage ?? '');
    setContextEventInput(livingView.metadata.eventTitle || livingView.metadata.eventId || '');
    setContextSelectedCalendarEventId(livingView.metadata.eventId ?? null);
    setShowContextCalendarPicker(false);
    setContextPlaceInput(livingView.metadata.place?.name ?? '');
    setContextSpaceId(primarySpaceId);
    setContextInitialSpaceId(primarySpaceId);
    setContextSavedToBook(
      livingView.metadata.savedToBook ||
        livingView.placement.spaceIds.includes(SYSTEM_LIVING_SPACE_IDS.livingBook)
    );
    setIsEditingPermissions(false);
    setIsEditingContext(true);
  };

  const cancelContextEditing = () => {
    setIsEditingContext(false);
    setContextPeopleInput('');
    setSelectedContextPeople([]);
    setContextLifeStage('');
    setContextEventInput('');
    setContextSelectedCalendarEventId(null);
    setShowContextCalendarPicker(false);
    setContextPlaceInput('');
    setContextSpaceId(null);
    setContextInitialSpaceId(null);
    setContextSavedToBook(false);
  };

  const saveContextEditing = async () => {
    if (!milestone || !livingView || savingContext) return;

    setSavingContext(true);

    try {
      const resolvedPeople = resolvePeopleSelection({
        selectedPeople: selectedContextPeople,
        manualInput: contextPeopleInput,
      });

      const selectedContextCalendarEvent = contextSelectedCalendarEventId
        ? contextCalendarEvents.find(event => event.id === contextSelectedCalendarEventId)
        : null;

      const eventText = contextEventInput.trim();
      const eventIdForMark = contextSelectedCalendarEventId || eventText || undefined;
      const eventTitleForMark = contextSelectedCalendarEventId
        ? selectedContextCalendarEvent
          ? getCalendarEventMarkLabel(selectedContextCalendarEvent)
          : eventText || undefined
        : eventText || undefined;

      const updatedView = await updateLivingMarkContext({
        milestone,
        currentNpub: npub,
        peopleIds: resolvedPeople.peopleIds,
        people: resolvedPeople.people,
        lifeStage: contextLifeStage,
        eventId: eventIdForMark,
        eventTitle: eventTitleForMark,
        placeName: contextPlaceInput,
        selectedSpaceId: contextSpaceId,
        spaceChanged: contextSpaceId !== contextInitialSpaceId,
        savedToBook: contextSavedToBook,
      });

      setLivingView(updatedView);
      setLivingSpaces(await getLivingSpaces());
      cancelContextEditing();
    } catch (error: any) {
      Alert.alert('Context not saved', error?.message ?? 'Unable to save Mark context.');
    } finally {
      setSavingContext(false);
    }
  };

  const startPermissionEditing = () => {
    if (!livingView || !canManageMarkPermissions) return;

    setPermissionDraft(livingView.metadata.markPermissions ?? {});
    setIsEditingContext(false);
    setIsEditingPermissions(true);
  };

  const cancelPermissionEditing = () => {
    setIsEditingPermissions(false);
    setPermissionDraft({});
  };

  const setPermissionValue = (key: keyof LivingMarkPermissions, value: boolean) => {
    setPermissionDraft(prev => {
      const next: LivingMarkPermissions = {
        ...prev,
        [key]: value,
      };

      if (key === 'restricted' && value) {
        next.highlightApproved = false;
        next.bookApproved = false;
      }

      if ((key === 'highlightApproved' || key === 'bookApproved') && value) {
        next.restricted = false;
      }

      return next;
    });
  };

  const savePermissionEditing = async () => {
    if (!milestone || !livingView || !canManageMarkPermissions || savingPermissions) return;

    setSavingPermissions(true);

    try {
      const updatedView = await updateLivingMarkContext({
        milestone,
        currentNpub: npub,
        markPermissions: permissionDraft,
      });

      setLivingView(updatedView);
      cancelPermissionEditing();
    } catch (error: any) {
      Alert.alert('Permissions not saved', error?.message ?? 'Unable to save Mark permissions.');
    } finally {
      setSavingPermissions(false);
    }
  };
const getReflectionAuthorLabel = (authorNpub?: string) => {
  if (!authorNpub) return 'Family member';

  const profile = reflectionProfiles[authorNpub];
  const name = profile?.display_name || profile?.name;

  if (name) return name;

  return `${authorNpub.slice(0, 10)}…`;
};

  const saveReflection = async () => {
  if (!milestone || !reflectionText.trim()) return;

  const reflection = {
    text: reflectionText.trim(),
    createdAt: Math.floor(Date.now() / 1000),
    authorNpub: npub ?? undefined,
  };

  const updatedReflections = [...(milestone.reflections ?? []), reflection];

  const updatedMilestone = {
    ...milestone,
    reflections: updatedReflections,
  };

  await updateMilestone(milestone.id, { reflections: updatedReflections });

  setMilestone(updatedMilestone);
  setReflectionText('');
  setIsAddingReflection(false);
};

  const deleteReflection = async (index: number) => {
    if (!milestone) return;
    Alert.alert('Delete reflection', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const updated = (milestone.reflections ?? []).filter((_, i) => i !== index);
          await updateMilestone(milestone.id, { reflections: updated });
          setMilestone(prev => prev ? { ...prev, reflections: updated } : prev);
        }
      }
    ]);
  };

  if (!milestone) return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.gold} />
      </View>
    </SafeAreaView>
  );

const hasTitle = milestone.note?.includes('\n\n');
const title = hasTitle ? milestone.note.split('\n\n')[0] : null;
const body = hasTitle ? milestone.note.split('\n\n').slice(1).join('\n\n') : milestone.note;

const isLiftUpMark = milestone.tags?.some(
  tag => tag.toLowerCase() === LIFT_UP_TAG.toLowerCase()
) ?? false;

const contextPeopleEditLabel = isLiftUpMark
  ? 'Who is this Mark lifting up?'
  : 'People';

const contextPeopleEditHint = isLiftUpMark
  ? 'Tag the person this Mark is about. Notifications can be handled separately later.'
  : 'Tag people connected to this Mark.';

const contextPeopleEditPlaceholder = isLiftUpMark
  ? 'Type @ to tag the person being lifted up'
  : 'Type @ to tag someone in this Mark';

const isOwner = !milestone.authorNpub || milestone.authorNpub === npub;

const authorLabel =
  milestone.authorName?.trim() ||
  (milestone.authorNpub && milestone.authorNpub === npub
    ? 'You'
    : milestone.authorNpub
      ? `${milestone.authorNpub.slice(0, 10)}…`
      : null);

const openMediaViewer = (uri: string) => {
  setAppActivity('media-viewer', true);
  setSelectedImage(uri);
};

  const viewerImages: ViewerImage[] =
  milestone.media && milestone.media.length > 0
    ? milestone.media.map(item => ({
        id: item.id,
        uri: item.uri,
        type: item.type,
        thumbnailUrl: item.thumbnailUri,
      }))
    : milestone.photoUri
      ? [{ id: 'legacy-photo', uri: milestone.photoUri, type: 'image' }]
      : [];

  const contextSpaceOptions = livingSpaces
    .filter(space => !space.archivedAt)
    .filter(space =>
      space.id === SYSTEM_LIVING_SPACE_IDS.profile ||
      (space.id === SYSTEM_LIVING_SPACE_IDS.family && !!family) ||
      space.source === 'group'
    )
    .slice(0, 12);
  const selectedContextSpace =
    contextSpaceId && !contextSpaceOptions.some(space => space.id === contextSpaceId)
      ? livingSpaces.find(space => space.id === contextSpaceId)
      : null;
  const editableContextSpaces = selectedContextSpace
    ? [selectedContextSpace, ...contextSpaceOptions]
    : contextSpaceOptions;
  const contextSpaceNames =
    livingView?.spaces
      .filter(space =>
        space.id !== SYSTEM_LIVING_SPACE_IDS.livingBook &&
        space.id !== SYSTEM_LIVING_SPACE_IDS.places
      )
      .map(space => space.name) ?? [];
  const placeLabel =
    livingView?.metadata.place?.name ||
    (livingView?.metadata.place?.latitude !== undefined && livingView?.metadata.place?.longitude !== undefined
      ? `${livingView.metadata.place.latitude.toFixed(3)}, ${livingView.metadata.place.longitude.toFixed(3)}`
      : undefined);
  const eventTitleLabel =
    livingView?.metadata.eventTitle ||
    (livingView?.metadata.eventId && !livingView.metadata.eventId.startsWith('cal_')
      ? livingView.metadata.eventId
      : undefined);
  const eventSourceSpaceLabel = livingView?.metadata.eventSpaceName;
  const eventContextLabel = eventTitleLabel
    ? [
        eventTitleLabel,
        eventSourceSpaceLabel ? `from ${eventSourceSpaceLabel}` : undefined,
      ].filter(Boolean).join(' · ')
    : undefined;
  const routeLabels = Array.from(
    new Set((livingView?.metadata.relayTargets ?? []).map(target => getRouteLabel(target.kind)))
  );
  const contextPeople =
    livingView?.metadata.people.filter(person => person.role !== 'author') ?? [];
  const contextPeopleForDisplay =
    contextPeople.length > 0
      ? contextPeople
      : normalizeLivingPeople({ peopleIds: livingView?.metadata.peopleIds ?? [] }).people;
  const contextPeopleLabel =
    contextPeopleForDisplay.length > 0
      ? contextPeopleForDisplay.map(person => getPersonDisplayName(person)).join(', ')
      : livingPeopleToInput([], livingView?.metadata.peopleIds ?? []);
  const contextChips = [
    ...(contextSpaceNames.length
      ? [{ label: 'Space', value: contextSpaceNames.join(', ') }]
      : []),
    ...(eventContextLabel
      ? [{ label: 'Event', value: eventContextLabel }]
      : []),
    ...(placeLabel ? [{ label: 'Place', value: placeLabel }] : []),
    ...(livingView?.metadata.savedToBook || livingView?.placement.spaceIds.includes(SYSTEM_LIVING_SPACE_IDS.livingBook)
      ? [{ label: 'Legacy', value: 'Saved' }]
      : []),
    ...(livingView?.metadata.privacy
      ? [{ label: 'Privacy', value: livingView.metadata.privacy }]
      : []),
    ...(routeLabels.length
      ? [{ label: 'Route', value: routeLabels.join(' + ') }]
      : []),
  ];
  const markPermissions = livingView?.metadata.markPermissions ?? {};
  const permissionChips = [
    ...(markPermissions.guardianConsentNeeded
      ? [{ label: 'Consent', value: 'Guardian consent needed', tone: 'danger' as const }]
      : []),
    ...(markPermissions.guardianConsentSatisfied && !markPermissions.guardianConsentNeeded
      ? [{ label: 'Consent', value: 'Guardian consent on file', tone: 'gold' as const }]
      : []),
    ...(markPermissions.restricted
      ? [{ label: 'Restricted', value: 'Do not feature, print, or promote', tone: 'danger' as const }]
      : []),
    ...(markPermissions.bookApproved && !markPermissions.restricted
      ? [{ label: 'Legacy', value: 'Approved for Legacy', tone: 'gold' as const }]
      : []),
  ];
  const permissionOptions: {
    key: keyof LivingMarkPermissions;
    label: string;
    detail: string;
  }[] = [
    {
      key: 'bookApproved',
      label: 'Approve for Legacy',
      detail: 'Can be included in future Legacy drafts.',
    },
    {
      key: 'restricted',
      label: 'Restricted',
      detail: 'Do not use for Legacy, recaps, or public views.',
    },
  ];

  const contextMentionMatch = contextPeopleInput.match(/@([^\s,]*)$/);
  const contextMentionSearch = contextMentionMatch?.[1]?.trim().toLowerCase() ?? '';
  const contextMentionActive = contextPeopleInput.includes('@') && contextMentionMatch !== null;

  const contextMentionSuggestions = contextMentionActive
    ? contextPersonCandidates
        .filter(person => !isLivingPersonSelected(selectedContextPeople, person))
        .filter(person => {
          if (contextMentionSearch.length === 0) return person.source === 'space-member';

          const displayName = person.displayName.toLowerCase();
          const npubValue = person.npub?.toLowerCase() ?? '';

          return (
            displayName.startsWith(contextMentionSearch) ||
            displayName.includes(contextMentionSearch) ||
            npubValue.includes(contextMentionSearch)
          );
        })
        .slice(0, 6)
    : [];

  const selectContextMentionCandidate = (person: LivingPersonCandidate) => {
    setSelectedContextPeople(prev =>
      isLivingPersonSelected(prev, person)
        ? prev
        : toggleLivingPersonSelection(prev, person)
    );

    setContextPeopleInput(current => current.replace(/@([^\s,]*)$/, '').trim());
  };

  const getContextPersonSourceLabel = (person: LivingPersonCandidate): string => {
    if (person.source === 'space-member') return 'Space member';
    if (person.source === 'family-member') return 'Family';
    if (person.source === 'current-user') return 'You';
    return 'Contact';
  };

  const toggleContextCalendarEvent = (event: GroupCalendarEvent) => {
    const active = contextSelectedCalendarEventId === event.id;

    if (active) {
      setContextSelectedCalendarEventId(null);
      setContextEventInput('');
      return;
    }

    setContextSelectedCalendarEventId(event.id);
    setContextEventInput(getCalendarEventMarkLabel(event));
  };

  return (
    <SafeAreaView style={s.safe}>

      {/* Header */}
      <View style={[s.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={s.backBtn}
        >
          <Text style={[s.backText, { color: theme.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerMeta}>
          <Text style={[s.headerDate, { color: theme.textMuted }]}>
            {formatDate(milestone.createdAt)}
          </Text>

          {authorLabel && (
            <Text style={[s.headerAuthor, { color: theme.textMuted }]} numberOfLines={1}>
              By {authorLabel}
            </Text>
          )}
        </View>
        {!isEditing && isOwner && (
  <TouchableOpacity onPress={startEditing} style={s.editBtn}>
    <Text style={[s.editBtnText, { color: theme.gold }]}>Edit</Text>
  </TouchableOpacity>
)}
        {isEditing && (
          <TouchableOpacity onPress={() => setIsEditing(false)} style={s.editBtn}>
            <Text style={[s.editBtnText, { color: theme.textMuted }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

            <KeyboardAvoidingView
        style={s.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={s.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

        {/* Media */}
{viewerImages.length > 0 ? (
  <View style={s.heroCarousel}>
    <FlatList
      data={viewerImages}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item, index) => `${item.id || item.uri}_${index}`}
      getItemLayout={(_, index) => ({
        length: width,
        offset: width * index,
        index,
      })}
      onMomentumScrollEnd={(event) => {
        const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
        setDetailMediaIndex(nextIndex);
      }}
      renderItem={({ item, index }) => {
        const previewUri =
          item.type === 'video'
            ? item.thumbnailUrl || item.uri
            : item.thumbnailUrl || item.uri;

        return (
          <TouchableOpacity
            activeOpacity={0.92}
            style={s.heroSlide}
            onPress={() => openMediaViewer(item.uri)}
          >
            <Image
              source={{ uri: previewUri }}
              style={s.heroImage}
              resizeMode="cover"
            />

            {item.type === 'video' && (
              <View style={s.heroVideoBadge}>
                <Text style={s.heroVideoBadgeText}>▶</Text>
              </View>
            )}

            {viewerImages.length > 1 && (
              <View style={s.heroCounter}>
                <Text style={s.heroCounterText}>
                  {index + 1} / {viewerImages.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      }}
    />

    {viewerImages.length > 1 && (
      <View style={s.heroDots}>
        {viewerImages.map((item, index) => (
          <View
            key={`${item.id || item.uri}_dot_${index}`}
            style={[
              s.heroDot,
              index === detailMediaIndex && [
                s.heroDotActive,
                { backgroundColor: theme.gold },
              ],
            ]}
          />
        ))}
      </View>
    )}
  </View>
) : null}

        <View style={s.content}>

          {/* ── Edit mode ── */}
          {isEditing ? (
            <View style={s.editBlock}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>MARK</Text>
              <TextInput
                style={[s.editInput, s.editTextarea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                value={editNote}
                onChangeText={setEditNote}
                placeholder="What do you want to remember?"
                placeholderTextColor={theme.textMuted}
                multiline
                textAlignVertical="top"
              />

              <Text style={[s.sectionLabel, { marginTop: 16, color: theme.textMuted }]}>TAGS</Text>
              <TextInput
                style={[s.editInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                value={editTagInput}
                onChangeText={setEditTagInput}
                placeholder="#family #game #memory"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />

              <View style={s.editActions}>
                <TouchableOpacity style={[s.cancelEditBtn, { borderColor: theme.border }]} onPress={() => setIsEditing(false)}>
                  <Text style={[s.cancelEditText, { color: theme.textMuted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveEditBtn, { backgroundColor: theme.gold }]} onPress={saveEdit}>
                  <Text style={[s.saveEditText, { color: theme.bg }]}>Save changes</Text>
                </TouchableOpacity>
              </View>
            </View>

          ) : (
            /* ── View mode ── */
            <>
              {title && <Text style={[s.title, { color: theme.text }]}>{title}</Text>}
              {body ? (
                <View style={s.section}>
                  <Text style={[s.sectionLabel, { color: theme.textMuted }]}>NOTE</Text>
                  <Text style={[s.note, { color: theme.textSecondary }]}>{body}</Text>
                </View>
              ) : null}
            </>
          )}

          {/* Audio */}
          {milestone.audioUri && (
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>VOICE NOTE</Text>
              <TouchableOpacity style={[s.mediaBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={isAudioPlaying ? stopAudio : playAudio}>
                <Text style={[s.mediaBtnIcon, { color: theme.gold }]}>{isAudioPlaying ? '⏹' : '▶'}</Text>
<Text style={[s.mediaBtnText, { color: theme.gold }]}>{isAudioPlaying ? 'Stop playback' : 'Play voice note'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Video */}
          {milestone.videoUri && !(milestone.media ?? []).some(item => item.type === 'video') && (
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>VIDEO CLIP</Text>
              <View style={[s.videoContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <VideoView
                  ref={videoViewRef}
                  player={videoPlayer}
                  style={s.video}
                  contentFit="contain"
                  nativeControls={false}
                />
                <TouchableOpacity
                  style={s.videoOverlay}
                  onPress={() => {
                    if (isVideoPlaying) {
                      videoPlayer.pause();
                      setIsVideoPlaying(false);
                    } else {
                      videoPlayer.play();
                      setIsVideoPlaying(true);
                      videoViewRef.current?.enterFullscreen();
                    }
                  }}
                >
                  {!isVideoPlaying && (
                    <View style={s.playCircle}>
                      <Text style={s.playCircleIcon}>▶</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Tags */}
          {milestone.tags.length > 0 && !isEditing && (
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>TAGS</Text>
              <View style={s.tags}>
                {milestone.tags.map(t => (
                  <Text key={t} style={[s.tag, { color: theme.gold, backgroundColor: theme.surface, borderColor: theme.border }]}>{t}</Text>
                ))}
              </View>
            </View>
          )}

          {!isEditing && (
            <View style={s.section}>
              <View style={s.contextHeader}>
                <Text style={[s.sectionLabel, { color: theme.textMuted }]}>MARK CONTEXT</Text>
                {isOwner && livingView && !isEditingContext && (
                  <TouchableOpacity onPress={startContextEditing}>
                    <Text style={[s.addReflectionBtn, { color: theme.gold }]}>Edit Context</Text>
                  </TouchableOpacity>
                )}
              </View>

              {!isEditingContext ? (
                <>
                  {contextPeopleForDisplay.length > 0 && (
                    <View style={s.contextPeopleSelectedRow}>
                      {contextPeopleForDisplay.map(person => (
                        <View
                          key={person.id || person.npub || person.displayName || 'person'}
                          style={[s.contextPersonChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                        >
                          <Text style={[s.contextPersonAvatar, { color: theme.gold, borderColor: theme.border }]}>
                            {getPersonDisplayName(person).slice(0, 1).toUpperCase()}
                          </Text>
                          <Text style={[s.contextPersonChipText, { color: theme.text }]} numberOfLines={1}>
                            {getPersonDisplayName(person)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {contextChips.length > 0 ? (
                    <View style={[s.contextChips, contextPeopleForDisplay.length > 0 && { marginTop: 8 }]}>
                      {contextChips.map(chip => (
                        <View
                          key={`${chip.label}_${chip.value}`}
                          style={[s.contextChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                        >
                          <Text style={[s.contextChipLabel, { color: theme.textMuted }]}>{chip.label}</Text>
                          <Text style={[s.contextChipValue, { color: theme.text }]}>{chip.value}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    !contextPeopleLabel && (
                      <Text style={[s.reflectionEmpty, { color: theme.textSecondary }]}>
                        Context will appear here as this Mark is placed into your Living Spaces.
                      </Text>
                    )
                  )}

                  {livingView?.placement.confidence === 'suggested' && (
                    <Text style={[s.contextHint, { color: theme.textMuted }]}>
                      Suggested from tags, family, and media details. Edit to lock the Space.
                    </Text>
                  )}
                </>
              ) : (
                <View style={s.contextEditor}>
                  <Text style={[s.contextSubLabel, { color: theme.textMuted }]}>
                    {contextPeopleEditLabel}
                  </Text>
                  <Text style={[s.contextPeopleHelp, { color: theme.textMuted }]}>
                    {contextPeopleEditHint}
                  </Text>

                  {selectedContextPeople.length > 0 && (
                    <View style={s.contextPeopleSelectedRow}>
                      {selectedContextPeople.map(person => {
                        const personKey = person.id || person.npub || person.displayName || 'person';

                        return (
                          <TouchableOpacity
                            key={personKey}
                            style={[s.contextPersonChip, { backgroundColor: theme.gold, borderColor: theme.gold }]}
                            onPress={() =>
                              setSelectedContextPeople(prev =>
                                prev.filter(item => (item.id || item.npub || item.displayName) !== personKey)
                              )
                            }
                            activeOpacity={0.82}
                          >
                            <Text style={[s.contextPersonAvatar, { color: theme.bg, borderColor: theme.bg }]}>
                              {getPersonDisplayName(person).slice(0, 1).toUpperCase()}
                            </Text>
                            <Text style={[s.contextPersonChipText, { color: theme.bg }]} numberOfLines={1}>
                              {getPersonDisplayName(person)} x
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  {contextPersonCandidates.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.contextChipScroll}>
                      {contextPersonCandidates.slice(0, 16).map(person => {
                        const active = isLivingPersonSelected(selectedContextPeople, person);

                        return (
                          <TouchableOpacity
                            key={person.id}
                            style={[
                              s.contextPersonChip,
                              { backgroundColor: theme.surface, borderColor: theme.border },
                              active && { backgroundColor: theme.gold, borderColor: theme.gold },
                            ]}
                            onPress={() => setSelectedContextPeople(prev => toggleLivingPersonSelection(prev, person))}
                            activeOpacity={0.82}
                          >
                            <Text
                              style={[
                                s.contextPersonAvatar,
                                { color: active ? theme.bg : theme.gold, borderColor: active ? theme.bg : theme.border },
                              ]}
                            >
                              {person.displayName.slice(0, 1).toUpperCase()}
                            </Text>
                            <Text
                              style={[
                                s.contextPersonChipText,
                                { color: theme.textSecondary },
                                active && { color: theme.bg },
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
                    style={[s.editInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                    value={contextPeopleInput}
                    onChangeText={setContextPeopleInput}
                    placeholder={contextPeopleEditPlaceholder}
                    placeholderTextColor={theme.textMuted}
                    returnKeyType="next"
                  />

                  {contextMentionSuggestions.length > 0 && (
                    <View style={[s.mentionPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                      {contextMentionSuggestions.map(person => (
                        <TouchableOpacity
                          key={person.id}
                          style={[s.mentionRow, { borderBottomColor: theme.border }]}
                          onPress={() => selectContextMentionCandidate(person)}
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
                              {getContextPersonSourceLabel(person)}
                            </Text>
                          </View>

                          <Text style={[s.mentionAction, { color: theme.gold }]}>Add</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text style={[s.contextSubLabel, { color: theme.textMuted }]}>Space</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.contextChipScroll}>
                    {editableContextSpaces.map(space => {
                      const active = contextSpaceId === space.id;

                      return (
                        <TouchableOpacity
                          key={space.id}
                          style={[
                            s.contextSelectChip,
                            { backgroundColor: theme.surface, borderColor: theme.border },
                            active && { backgroundColor: theme.gold, borderColor: theme.gold },
                          ]}
                          onPress={() => setContextSpaceId(space.id)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              s.contextSelectChipText,
                              { color: theme.textSecondary },
                              active && { color: theme.bg, fontWeight: '800' },
                            ]}
                            numberOfLines={1}
                          >
                            {space.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={[s.contextSubLabel, { color: theme.textMuted }]}>Calendar event</Text>

                  <TouchableOpacity
                    style={[
                      s.contextSelectChip,
                      {
                        alignSelf: 'flex-start',
                        maxWidth: '100%',
                        backgroundColor: theme.surface,
                        borderColor: contextEventInput ? theme.gold : theme.border,
                      },
                    ]}
                    onPress={() => setShowContextCalendarPicker(value => !value)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        s.contextSelectChipText,
                        { color: contextEventInput ? theme.gold : theme.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {contextEventInput || 'Select saved event'}
                    </Text>
                  </TouchableOpacity>

                  {showContextCalendarPicker && (
                    <View style={[s.mentionPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                      {contextSpaceId?.startsWith('group:') ? (
                        loadingContextCalendarEvents ? (
                          <View style={{ padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <ActivityIndicator size="small" color={theme.gold} />
                            <Text style={[s.contextPeopleHelp, { color: theme.textMuted, marginTop: 0 }]}>
                              Loading events...
                            </Text>
                          </View>
                        ) : contextCalendarEvents.length > 0 ? (
                          contextCalendarEvents.map(event => {
                            const active = contextSelectedCalendarEventId === event.id;

                            return (
                              <TouchableOpacity
                                key={event.id}
                                style={[
                                  s.mentionRow,
                                  { borderBottomColor: theme.border },
                                  active && { backgroundColor: theme.gold + '1F' },
                                ]}
                                onPress={() => toggleContextCalendarEvent(event)}
                                activeOpacity={0.82}
                              >
                                <View style={s.mentionTextWrap}>
                                  <Text
                                    style={[s.mentionName, { color: active ? theme.gold : theme.text }]}
                                    numberOfLines={1}
                                  >
                                    {getCalendarEventMarkLabel(event)}
                                  </Text>
                                  <Text style={[s.mentionMeta, { color: theme.textMuted }]} numberOfLines={1}>
                                    {formatEventDate(event)} • {formatEventTime(event)}
                                  </Text>
                                </View>

                                <Text style={[s.mentionAction, { color: active ? theme.gold : theme.textMuted }]}>
                                  {active ? 'Selected' : 'Add'}
                                </Text>
                              </TouchableOpacity>
                            );
                          })
                        ) : (
                          <Text style={[s.contextPeopleHelp, { color: theme.textMuted, padding: 12, marginTop: 0 }]}>
                            No events found for this Space yet.
                          </Text>
                        )
                      ) : (
                        <Text style={[s.contextPeopleHelp, { color: theme.textMuted, padding: 12, marginTop: 0 }]}>
                          Calendar events are available for group Spaces.
                        </Text>
                      )}

                      <TextInput
                        style={[
                          s.editInput,
                          {
                            margin: 10,
                            color: theme.text,
                            backgroundColor: theme.raised,
                            borderColor: theme.border,
                          },
                        ]}
                        value={contextEventInput}
                        onChangeText={text => {
                          setContextEventInput(text);
                          setContextSelectedCalendarEventId(null);
                        }}
                        placeholder="Or type event name..."
                        placeholderTextColor={theme.textMuted}
                        returnKeyType="next"
                      />
                    </View>
                  )}

                  <TextInput
                    style={[s.editInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
                    value={contextPlaceInput}
                    onChangeText={setContextPlaceInput}
                    placeholder="Place name"
                    placeholderTextColor={theme.textMuted}
                    returnKeyType="done"
                  />

                  <TouchableOpacity
                    style={[
                      s.contextSelectChip,
                      { alignSelf: 'flex-start', backgroundColor: theme.surface, borderColor: theme.border },
                      contextSavedToBook && { backgroundColor: theme.gold, borderColor: theme.gold },
                    ]}
                    onPress={() => setContextSavedToBook(value => !value)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        s.contextSelectChipText,
                        { color: theme.textSecondary },
                        contextSavedToBook && { color: theme.bg, fontWeight: '800' },
                      ]}
                    >
                      Save toward Legacy
                    </Text>
                  </TouchableOpacity>

                  <View style={s.editActions}>
                    <TouchableOpacity
                      style={[s.cancelEditBtn, { borderColor: theme.border }]}
                      onPress={cancelContextEditing}
                      disabled={savingContext}
                    >
                      <Text style={[s.cancelEditText, { color: theme.textMuted }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.saveEditBtn, { backgroundColor: theme.gold }, savingContext && s.savingContextBtn]}
                      onPress={saveContextEditing}
                      disabled={savingContext}
                    >
                      <Text style={[s.saveEditText, { color: theme.bg }]}>
                        {savingContext ? 'Saving...' : 'Save context'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {!isEditing && livingView && (
            <View style={s.section}>
              <View style={s.contextHeader}>
                <Text style={[s.sectionLabel, { color: theme.textMuted }]}>MARK PERMISSIONS</Text>
                {canManageMarkPermissions && !isEditingPermissions && (
                  <TouchableOpacity onPress={startPermissionEditing}>
                    <Text style={[s.addReflectionBtn, { color: theme.gold }]}>Edit Permissions</Text>
                  </TouchableOpacity>
                )}
              </View>

              {!isEditingPermissions ? (
                <>
                  {permissionChips.length > 0 ? (
                    <View style={s.contextChips}>
                      {permissionChips.map(chip => (
                        <View
                          key={`${chip.label}_${chip.value}`}
                          style={[
                            s.contextChip,
                            {
                              backgroundColor: chip.tone === 'danger' ? theme.danger : theme.surface,
                              borderColor: chip.tone === 'danger' ? theme.danger : theme.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              s.contextChipLabel,
                              { color: chip.tone === 'danger' ? theme.bg : theme.textMuted },
                            ]}
                          >
                            {chip.label}
                          </Text>
                          <Text
                            style={[
                              s.contextChipValue,
                              { color: chip.tone === 'danger' ? theme.bg : theme.text },
                            ]}
                          >
                            {chip.value}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[s.reflectionEmpty, { color: theme.textSecondary }]}>
                      No special approvals set. This Mark follows its current Space privacy.
                    </Text>
                  )}
                  <Text style={[s.contextHint, { color: theme.textMuted }]}>
                    Legacy approval prepares future album drafts. Restricted overrides Legacy use.
                  </Text>
                </>
              ) : (
                <View style={s.contextEditor}>
                  {permissionOptions.map(option => {
                    const active = permissionDraft[option.key] === true;
                    const disabled =
                      permissionDraft.restricted === true &&
                      (option.key === 'highlightApproved' || option.key === 'bookApproved');

                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          s.permissionOption,
                          { backgroundColor: theme.surface, borderColor: theme.border },
                          active && { backgroundColor: option.key === 'restricted' ? theme.danger : theme.gold, borderColor: option.key === 'restricted' ? theme.danger : theme.gold },
                          disabled && s.permissionOptionDisabled,
                        ]}
                        onPress={() => !disabled && setPermissionValue(option.key, !active)}
                        activeOpacity={0.82}
                        disabled={disabled}
                      >
                        <View style={s.permissionOptionText}>
                          <Text
                            style={[
                              s.permissionOptionLabel,
                              { color: active ? theme.bg : theme.text },
                            ]}
                          >
                            {option.label}
                          </Text>
                          <Text
                            style={[
                              s.permissionOptionDetail,
                              { color: active ? theme.bg : theme.textSecondary },
                            ]}
                          >
                            {option.detail}
                          </Text>
                        </View>
                        <Text style={[s.permissionCheck, { color: active ? theme.bg : theme.textMuted }]}>
                          {active ? 'On' : 'Off'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <View style={s.editActions}>
                    <TouchableOpacity
                      style={[s.cancelEditBtn, { borderColor: theme.border }]}
                      onPress={cancelPermissionEditing}
                      disabled={savingPermissions}
                    >
                      <Text style={[s.cancelEditText, { color: theme.textMuted }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.saveEditBtn, { backgroundColor: theme.gold }, savingPermissions && s.savingContextBtn]}
                      onPress={savePermissionEditing}
                      disabled={savingPermissions}
                    >
                      <Text style={[s.saveEditText, { color: theme.bg }]}>
                        {savingPermissions ? 'Saving...' : 'Save permissions'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Reflections */}
          <View style={s.section}>
            <View style={s.reflectionHeader}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>REFLECTIONS</Text>
              {!isAddingReflection && (
                <TouchableOpacity onPress={() => setIsAddingReflection(true)}>
                  <Text style={[s.addReflectionBtn, { color: theme.gold }]}>+ Add</Text>
                </TouchableOpacity>
              )}
            </View>

            {(milestone.reflections ?? []).length === 0 && !isAddingReflection && (
              <Text style={[s.reflectionEmpty, { color: theme.textSecondary }]}>
                No reflections yet. Come back later and add one.
              </Text>
            )}

            {(milestone.reflections ?? []).map((r, i) => {
  const profile = r.authorNpub ? reflectionProfiles[r.authorNpub] : null;
  const authorName = getReflectionAuthorLabel(r.authorNpub);

  return (
    <View key={i} style={[s.reflectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={s.reflectionAuthorRow}>
        {profile?.picture ? (
          <Image source={{ uri: profile.picture }} style={s.reflectionAuthorAvatar} />
        ) : (
          <View style={[s.reflectionAuthorFallback, { backgroundColor: theme.raised }]}>
            <Text style={[s.reflectionAuthorLetter, { color: theme.gold }]}>
              {authorName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={[s.reflectionAuthorName, { color: theme.text }]}>{authorName}</Text>
          <Text style={[s.reflectionDate, { color: theme.textMuted }]}>{formatDate(r.createdAt)}</Text>
        </View>
      </View>

      <Text style={[s.reflectionText, { color: theme.textSecondary }]}>{r.text}</Text>

      <TouchableOpacity onPress={() => deleteReflection(i)} style={s.reflectionDelete}>
        <Text style={[s.reflectionDeleteText, { color: theme.textMuted }]}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
})}

            {isAddingReflection && (
              <View style={s.reflectionInputBlock}>
                <TextInput
  style={[s.editInput, s.editTextarea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
  value={reflectionText}
  onChangeText={setReflectionText}
  placeholder="Looking back, what do you notice? How have you grown?"
  placeholderTextColor={theme.textMuted}
  multiline
  textAlignVertical="top"
  autoFocus
/>
                <View style={s.editActions}>
<TouchableOpacity
  style={[s.cancelEditBtn, { borderColor: theme.border }]}
  onPress={() => { setIsAddingReflection(false); setReflectionText(''); }}
>
  <Text style={[s.cancelEditText, { color: theme.textMuted }]}>Cancel</Text>
</TouchableOpacity>
                  <TouchableOpacity style={[s.saveEditBtn, { backgroundColor: theme.gold }]} onPress={saveReflection}>
                    <Text style={[s.saveEditText, { color: theme.bg }]}>Save reflection</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Relay status */}
          <View style={[s.section, s.relaySection, { borderTopColor: theme.border }]}>
            <Text style={[s.relayStatus, { color: theme.textMuted }]}>
              {milestone.publishedToRelay
                ? `↑ Published to relay · ${milestone.nostrEventId?.slice(0, 12)}…`
                : '· Saved locally only'}
            </Text>
          </View>

        </View>
              </ScrollView>
      </KeyboardAvoidingView>

      <ImageViewerModal
  images={viewerImages}
  selectedUri={selectedImage}
  onClose={() => {
    setAppActivity('media-viewer', false);
    setSelectedImage(null);
  }}
/>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e',
  },
  backBtn: { padding: 4, minWidth: 60 },
  backText: { fontSize: 15, color: '#c9973a', fontWeight: '500' },
  headerDate: { fontSize: 12, color: '#444' },
    headerMeta: {
    flex: 1,
    alignItems: 'center',
  },
  headerAuthor: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  editBtn: { padding: 4, minWidth: 60, alignItems: 'flex-end' },
  editBtnText: { fontSize: 15, color: '#c9973a', fontWeight: '500' },

    keyboardAvoid: { flex: 1 },
  container: { paddingBottom: 140 },
  content: { padding: 20 },

  // Photo
  photoContainer: { width: '100%' },
  photo: { width: '100%', height: width * 0.75 },
  photoLoadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  photoFallback: { width: '100%', height: 80, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  photoFallbackIcon: { fontSize: 16 },
  photoFallbackText: { fontSize: 12, color: '#444' },

  title: { fontSize: 26, fontWeight: '700', color: '#fff', letterSpacing: -0.5, marginBottom: 20, lineHeight: 32 },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 },
  note: { fontSize: 16, color: '#aaa', lineHeight: 27 },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag: {
  fontSize: 11,
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 20,
  borderWidth: 0.5,
  lineHeight: 15,
},

  // Audio / media buttons
  mediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 0.5 },
  mediaBtnIcon: { fontSize: 18, color: '#c9973a' },
  mediaBtnText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },

  // Video
  videoContainer: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', borderWidth: 0.5 },
  video: { width: '100%', height: '100%' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(201,151,58,0.9)', alignItems: 'center', justifyContent: 'center' },
  playCircleIcon: { fontSize: 22, color: '#111', marginLeft: 4 },

  // Relay
  relaySection: { borderTopWidth: 0.5, paddingTop: 16 },
  relayStatus: { fontSize: 12, color: '#333' },

  // Edit
  editBlock: { marginBottom: 24 },
  editInput: { borderWidth: 0.5, borderRadius: 10, padding: 12, fontSize: 15 },
  editTextarea: { minHeight: 120, lineHeight: 22, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelEditBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 0.5, alignItems: 'center' },
  cancelEditText: { fontSize: 14, color: '#555' },
  saveEditBtn: { flex: 2, padding: 13, borderRadius: 10, alignItems: 'center' },
  saveEditText: { fontSize: 14, fontWeight: '700' },

  // Tag editing
  tagInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  tagAddBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  tagAddBtnDim: { opacity: 0.35 },
  tagAddBtnText: { fontSize: 13, fontWeight: '700' },
  presetTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  presetTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  presetTagActive: {},
  presetTagText: { fontSize: 12, color: '#666' },
  presetTagTextActive: { color: '#111', fontWeight: '600' },
  selectedTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  selectedTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 0.5 },
  selectedTagText: { fontSize: 12 },

  // Living context
  contextHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  contextChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contextChip: { maxWidth: '100%', borderRadius: 12, borderWidth: 0.5, paddingHorizontal: 10, paddingVertical: 8 },
  contextChipLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  contextChipValue: { fontSize: 12, fontWeight: '700' },
  contextHint: { fontSize: 11, lineHeight: 16, marginTop: 10 },
  contextEditor: { gap: 10 },
  contextSubLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2 },
  contextPeopleHelp: { fontSize: 11, lineHeight: 16, marginTop: -5 },
  contextChipScroll: { gap: 8, paddingRight: 20 },
  contextSelectChip: { minHeight: 34, maxWidth: 170, paddingHorizontal: 12, borderRadius: 17, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center' },
  contextSelectChipText: { fontSize: 12, fontWeight: '700' },
  contextPeopleSelectedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contextPersonChip: { minHeight: 34, maxWidth: 190, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 17, borderWidth: 0.5, flexDirection: 'row', alignItems: 'center', gap: 7 },
  contextPersonAvatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 0.5, textAlign: 'center', lineHeight: 19, fontSize: 10, fontWeight: '900', overflow: 'hidden' },
  contextPersonChipText: { maxWidth: 138, fontSize: 12, fontWeight: '800' },
  mentionPanel: { borderWidth: 0.5, borderRadius: 12, overflow: 'hidden' },
  mentionRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 0.5 },
  mentionAvatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 0.5, textAlign: 'center', lineHeight: 25, fontSize: 11, fontWeight: '900', overflow: 'hidden' },
  mentionTextWrap: { flex: 1, minWidth: 0 },
  mentionName: { fontSize: 13, fontWeight: '800' },
  mentionMeta: { fontSize: 10, marginTop: 2, fontWeight: '600' },
  mentionAction: { fontSize: 11, fontWeight: '900' },
  permissionOption: { minHeight: 58, borderRadius: 14, borderWidth: 0.5, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  permissionOptionDisabled: { opacity: 0.48 },
  permissionOptionText: { flex: 1, gap: 3 },
  permissionOptionLabel: { fontSize: 13, fontWeight: '900' },
  permissionOptionDetail: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  permissionCheck: { minWidth: 28, textAlign: 'right', fontSize: 12, fontWeight: '900' },
  savingContextBtn: { opacity: 0.55 },

  // Reflections
  reflectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  addReflectionBtn: { fontSize: 13, fontWeight: '600' },
  reflectionEmpty: { fontSize: 14, fontStyle: 'italic', lineHeight: 22 },
  reflectionAuthorRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  marginBottom: 8,
},
reflectionAuthorAvatar: {
  width: 34,
  height: 34,
  borderRadius: 17,
},
reflectionAuthorFallback: {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: 'center',
  justifyContent: 'center',
},
reflectionAuthorLetter: {
  fontSize: 13,
  fontWeight: '700',
},
reflectionAuthorName: {
  color: '#eee',
  fontSize: 13,
  fontWeight: '700',
},
  reflectionCard: { borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 0.5 },
  reflectionDate: { fontSize: 10, color: '#555', marginBottom: 8, fontWeight: '600', letterSpacing: 0.6 },
  reflectionText: { fontSize: 15, color: '#aaa', lineHeight: 24 },
  reflectionDelete: { marginTop: 12, alignSelf: 'flex-end' },
  reflectionDeleteText: { fontSize: 12, color: '#2a2a2a' },
  reflectionInputBlock: { marginTop: 4 },

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

  imageModalOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.95)',
  alignItems: 'center',
  justifyContent: 'center',
},
imageModalClose: {
  position: 'absolute',
  top: 50,
  right: 24,
  zIndex: 10,
  width: 42,
  height: 42,
  borderRadius: 21,
  backgroundColor: '#1a1a1a',
  alignItems: 'center',
  justifyContent: 'center',
},
imageModalCloseText: {
  color: '#fff',
  fontSize: 22,
  fontWeight: '700',
},
fullscreenImage: {
  width: '100%',
  height: '100%',
},
heroCarousel: {
  width: '100%',
  backgroundColor: '#000',
  marginBottom: 16,
},
heroSlide: {
  width,
  height: width * 0.82,
  backgroundColor: '#000',
  position: 'relative',
},
heroImage: {
  width: '100%',
  height: '100%',
  backgroundColor: '#000',
},
heroCounter: {
  position: 'absolute',
  top: 14,
  right: 14,
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: 'rgba(0,0,0,0.68)',
},
heroCounterText: {
  color: '#fff',
  fontSize: 12,
  fontWeight: '800',
},
heroDots: {
  position: 'absolute',
  bottom: 12,
  left: 0,
  right: 0,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
},
heroDot: {
  width: 6,
  height: 6,
  borderRadius: 3,
  backgroundColor: 'rgba(255,255,255,0.35)',
},
heroDotActive: {
  width: 7,
  height: 7,
  borderRadius: 3.5,
},
heroVideoBadge: {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.18)',
},
heroVideoBadgeText: {
  color: '#fff',
  fontSize: 42,
  fontWeight: '900',
  textShadowColor: 'rgba(0,0,0,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
},
});
