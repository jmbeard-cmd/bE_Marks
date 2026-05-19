import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { nip19 } from 'nostr-tools';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../src/constants/theme';
import { BEContact, getContacts, saveContact } from '../../src/utils/contacts-storage';
import { subscribeToDMEvents } from '../../src/utils/dm-events';
import {
  getCachedDMProfiles,
  saveCachedDMProfile,
} from '../../src/utils/dm-profile-cache';
import {
  createThread,
  deleteThread,
  getDMThreads,
  type DMThread,
} from '../../src/utils/dm-storage';
import { saveLocalGroupSystemMessage } from '../../src/utils/group-messages';
import {
  createGroup,
  isGroupAdmin,
  joinGroupByCode,
  publishGroupMetadataSnapshot,
  updateGroup,
  type BEGroup,
} from '../../src/utils/group-storage';
import {
  getCachedGroupsIndex,
  rebuildGroupsIndexForNpub,
  scheduleGroupsMembershipRefresh,
  subscribeToGroupsIndex,
} from '../../src/utils/groups-index';
import {
  getCachedDMThreadCards,
  saveCachedDMThreadCards,
} from '../../src/utils/dm-thread-list-cache';
import { DEFAULT_RELAY, fetchNostrProfile, npubToHex, publishGroupMessage } from '../../src/utils/nostr';
import { normalizeNostrIdentity } from '../../src/utils/nostr-identity';
import { syncLivingSpacesFromGroups } from '../../src/utils/living-spaces-storage';
import { notifyGroupEvent, registerGroupMemberForPush } from '../../src/utils/push-notifications';
import type { LivingSpace, LivingSpaceType } from '../../src/types/living-spaces';
import { useIdentity } from '../_layout';


type Sheet = 'none' | 'new' | 'new-group' | 'join-space' | 'edit-group';
type SpaceFilter = 'all' | 'unread' | 'dms' | 'groups';
type SpaceInboxItem =
  | { id: string; type: 'dm'; updatedAt: number; unread: number; thread: DMThread }
  | { id: string; type: 'group'; updatedAt: number; unread: number; group: BEGroup };
type SpaceTypeOption = {
  value: LivingSpaceType;
  label: string;
};

function formatThreadTime(unixSecs: number): string {
  const date = new Date(unixSecs * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]?.slice(0, 1).toUpperCase() || '?';
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
}

function getGroupInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'G';
  return clean.slice(0, 2).toUpperCase();
}

function getGroupAvatarText(group: BEGroup): string {
  const customIcon = group.icon?.trim();
  return customIcon || getGroupInitials(group.name);
}

type DiscoveryProfile = {
  input: string;
  npub: string;
  pubkey: string;
  displayName: string;
  picture?: string;
  nip05?: string;
};

type ConversationContact = {
  name: string;
  npub?: string;
  pubkeyHex?: string;
  nostrName?: string;
  nostrAvatar?: string;
};

const GROUP_TYPE_ICONS: Record<string, string> = {
  softball: '🥎',
  baseball: '⚾',
  basketball: '🏀',
  football: '🏈',
  soccer: '⚽',
  volleyball: '🏐',
  track: '🏃',
  class: '🏫',
  family: '👨‍👩‍👧‍👦',
  faculty: '🧑‍🏫',
  booster: '⭐',
  church: '⛪',
  youth: '🌱',
  parents: '👪',
  travel: '🚌',
  committee: '📋',
  neighborhood: '🏘️',
  friends: '🤝',
  volunteers: '🙌',
  music: '🎵',
  theater: '🎭',
  robotics: '🤖',
  default: '👥',
};

const GROUP_TYPE_OPTIONS = [
  'class',
  'family',
  'faculty',
  'booster',
  'church',
  'youth',
  'parents',
  'travel',
  'committee',
  'neighborhood',
  'friends',
  'volunteers',
  'basketball',
  'football',
  'baseball',
  'softball',
  'soccer',
  'volleyball',
  'track',
  'music',
  'theater',
  'robotics',
];

const SPACE_TYPE_OPTIONS: SpaceTypeOption[] = [
  { value: 'family', label: 'Family' },
  { value: 'classroom', label: 'Classroom' },
  { value: 'team', label: 'Team' },
  { value: 'club', label: 'Club' },
  { value: 'church', label: 'Church' },
  { value: 'organization', label: 'Organization' },
  { value: 'pto', label: 'PTO' },
  { value: 'booster', label: 'Booster' },
  { value: 'school', label: 'School' },
  { value: 'district', label: 'District' },
  { value: 'custom', label: 'Custom' },
];

const SPACE_TYPE_LABELS: Partial<Record<LivingSpaceType, string>> = {
  personal: 'Home',
  family: 'Family',
  school: 'School',
  classroom: 'Classroom',
  team: 'Team',
  club: 'Club',
  church: 'Church',
  organization: 'Organization',
  pto: 'PTO',
  booster: 'Booster',
  district: 'District',
  friends: 'Friends',
  group: 'Group',
  place: 'Place',
  book: 'Legacy',
  custom: 'Custom',
};

function normalizeGroupType(value?: string): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';
}

function getGroupTypeIcon(group: BEGroup): string | null {
  const directKey = normalizeGroupType(group.sport);

  if (directKey && GROUP_TYPE_ICONS[directKey]) {
    return GROUP_TYPE_ICONS[directKey];
  }

  return null;
}

function formatLivingSpaceType(space?: LivingSpace): string {
  if (!space) return 'Space';
  return SPACE_TYPE_LABELS[space.type] ?? 'Space';
}

function getSpaceTypeLabel(type: LivingSpaceType): string {
  return SPACE_TYPE_LABELS[type] ?? 'Space';
}

function formatRelayLabel(group: BEGroup): string {
  if (group.relayMode === 'custom') return 'private relay';
  if (group.relayMode === 'both') return 'bE + space relay';
  return 'bE relay';
}

async function resolveNip05Address(address: string): Promise<{ pubkey: string; npub: string; nip05: string }> {
  const cleaned = address.trim().toLowerCase();
  const parts = cleaned.split('@');

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Enter a valid NIP-05 address like name@example.com.');
  }

  const [name, domain] = parts;
  const response = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);

  if (!response.ok) {
    throw new Error('Could not find that NIP-05 address.');
  }

  const data = await response.json();
  const pubkey = data?.names?.[name];

  if (!pubkey || typeof pubkey !== 'string') {
    throw new Error('That NIP-05 address did not return a valid public key.');
  }

  return {
    pubkey,
    npub: nip19.npubEncode(pubkey),
    nip05: cleaned,
  };
}

async function resolveDiscoveryInput(input: string): Promise<DiscoveryProfile> {
  const cleaned = input.trim();

  if (!cleaned) {
    throw new Error('Enter an npub, hex pubkey, or NIP-05 address.');
  }

  let pubkey = '';
  let npub = '';
  let nip05: string | undefined;

  if (cleaned.includes('@') && !cleaned.startsWith('npub1')) {
    const resolved = await resolveNip05Address(cleaned);
    pubkey = resolved.pubkey;
    npub = resolved.npub;
    nip05 = resolved.nip05;
  } else {
    const normalized = normalizeNostrIdentity(cleaned);
    pubkey = normalized.pubkey;
    npub = normalized.npub || nip19.npubEncode(normalized.pubkey);
  }

  let displayName = nip05 || `${npub.slice(0, 12)}…`;
  let picture: string | undefined;

  try {
    const profile = await fetchNostrProfile(npub);

    if (profile) {
      displayName =
        profile.display_name ||
        profile.name ||
        displayName;

      picture = profile.picture;
    }
  } catch (error) {
    console.warn('[Messages] failed to fetch discovery profile:', error);
  }

  return {
    input: cleaned,
    npub,
    pubkey,
    displayName,
    picture,
    nip05,
  };
}

export default function MessagesScreen() {
  const { npub, nsec, profile, theme, themeMode } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  const [spaceFilter, setSpaceFilter] = useState<SpaceFilter>('all');
  const [threads, setThreads] = useState<DMThread[]>([]);
  const [groups, setGroups] = useState<BEGroup[]>([]);
  const [livingSpaces, setLivingSpaces] = useState<LivingSpace[]>([]);
  const [loadingInitialThreads, setLoadingInitialThreads] = useState(true);
  const [loadingInitialGroups, setLoadingInitialGroups] = useState(true);
  const [contacts, setContacts] = useState<BEContact[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [profilePictures, setProfilePictures] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<Sheet>('none');
  const [search, setSearch] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newNpub, setNewNpub] = useState('');
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupSeason, setGroupSeason] = useState('');
  const [groupSpaceType, setGroupSpaceType] = useState<LivingSpaceType>('custom');
  const [groupType, setGroupType] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupImageUri, setGroupImageUri] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');

  const [discoveryInput, setDiscoveryInput] = useState('');
  const [discoveryProfile, setDiscoveryProfile] = useState<DiscoveryProfile | null>(null);
  const [discoveryError, setDiscoveryError] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [savingDiscoveryContact, setSavingDiscoveryContact] = useState(false);

  const loadingThreadsRef = useRef(false);
  const loadingProfilesRef = useRef(false);
  const pendingThreadReloadRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const saveThreadCardSnapshot = useCallback(async (
    threadList: DMThread[],
    names: Record<string, string>,
    pictures: Record<string, string>
  ) => {
    const cards = threadList.map(thread => {
      const displayTitle =
        thread.participantPubkey && names[thread.participantPubkey]
          ? names[thread.participantPubkey]
          : thread.title;

      const profilePicture =
        thread.participantPubkey
          ? pictures[thread.participantPubkey]
          : undefined;

      return {
        id: thread.id,
        title: thread.title,
        displayTitle,
        participantPubkey: thread.participantPubkey,
        participantNpub: thread.participantNpub,
        profilePicture,
        updatedAt: thread.updatedAt,
        unread: thread.unread,
        lastMessage: thread.lastMessage || '',
      };
    });

    await saveCachedDMThreadCards(cards);
  }, []);

  const hydrateProfiles = useCallback(async (threadList: DMThread[]) => {
    if (loadingProfilesRef.current) return;

    loadingProfilesRef.current = true;

    try {
      const profileThreads = threadList.filter(thread => !!thread.participantPubkey);

      if (profileThreads.length === 0) {
        setProfileNames({});
        setProfilePictures({});
        return;
      }

      const nextNames: Record<string, string> = {};
      const nextPictures: Record<string, string> = {};

      for (const thread of profileThreads) {
        if (!thread.participantPubkey) continue;

        try {
          const npub = nip19.npubEncode(thread.participantPubkey);
          const profile = await fetchNostrProfile(npub);

          if (!profile) continue;

          const displayName =
            profile.display_name ||
            profile.name ||
            thread.title;

          nextNames[thread.participantPubkey] = displayName;

          if (profile.picture) {
            nextPictures[thread.participantPubkey] = profile.picture;
          }

          await saveCachedDMProfile({
            pubkey: thread.participantPubkey,
            displayName,
            picture: profile.picture,
          });
        } catch (error) {
          console.warn('[Messages] failed to hydrate DM profile:', error);
        }

        await new Promise(resolve => setTimeout(resolve, 0));
      }

      setProfileNames(prev => ({
        ...prev,
        ...nextNames,
      }));

      setProfilePictures(prev => ({
        ...prev,
        ...nextPictures,
      }));

      await saveThreadCardSnapshot(
        threadList,
        nextNames,
        nextPictures
      );
    } finally {
      loadingProfilesRef.current = false;
    }
  }, [saveThreadCardSnapshot]);

  const loadData = useCallback(async () => {
    if (loadingThreadsRef.current) {
      pendingThreadReloadRef.current = true;
      return;
    }

    loadingThreadsRef.current = true;

    try {
      const cachedCards = await getCachedDMThreadCards();

      if (cachedCards.length > 0) {
        const cachedNames: Record<string, string> = {};
        const cachedPictures: Record<string, string> = {};

        const cachedThreads = cachedCards.map(card => {
          if (card.participantPubkey) {
            cachedNames[card.participantPubkey] = card.displayTitle;

            if (card.profilePicture) {
              cachedPictures[card.participantPubkey] = card.profilePicture;
            }
          }

          return {
            id: card.id,
            title: card.title,
            participantPubkey: card.participantPubkey,
            participantNpub: card.participantNpub,
            updatedAt: card.updatedAt,
            unread: card.unread,
            lastMessage: card.lastMessage,
          } as DMThread;
        });

        setProfileNames(prev => ({
          ...prev,
          ...cachedNames,
        }));

        setProfilePictures(prev => ({
          ...prev,
          ...cachedPictures,
        }));

        setThreads(cachedThreads);
        setLoadingInitialThreads(false);
      }

      const t = await getDMThreads();

      setThreads(t);
      setLoadingInitialThreads(false);

      const pubkeys = t
        .map(thread => thread.participantPubkey)
        .filter((pubkey): pubkey is string => !!pubkey);

      if (pubkeys.length > 0) {
        getCachedDMProfiles(pubkeys)
          .then(cachedProfiles => {
            const cachedNames: Record<string, string> = {};
            const cachedPictures: Record<string, string> = {};

            Object.values(cachedProfiles).forEach(profile => {
              cachedNames[profile.pubkey] = profile.displayName;

              if (profile.picture) {
                cachedPictures[profile.pubkey] = profile.picture;
              }
            });

            if (Object.keys(cachedNames).length > 0) {
              setProfileNames(prev => ({
                ...prev,
                ...cachedNames,
              }));
            }

            if (Object.keys(cachedPictures).length > 0) {
              setProfilePictures(prev => ({
                ...prev,
                ...cachedPictures,
              }));
            }

            saveThreadCardSnapshot(t, cachedNames, cachedPictures);
          })
          .catch(error => {
            console.warn('[Messages] failed to load cached DM profiles:', error);
          });
      }

      getContacts()
        .then(setContacts)
        .catch(error => {
          console.warn('[Messages] failed to load contacts:', error);
        });

      if (profileHydrationTimerRef.current) {
        clearTimeout(profileHydrationTimerRef.current);
      }

      profileHydrationTimerRef.current = setTimeout(() => {
        profileHydrationTimerRef.current = null;
        hydrateProfiles(t);
      }, 300);
    } finally {
      loadingThreadsRef.current = false;
      setLoadingInitialThreads(false);

      if (pendingThreadReloadRef.current) {
        pendingThreadReloadRef.current = false;
        setTimeout(() => {
          loadData();
        }, 100);
      }
    }
  }, [hydrateProfiles, saveThreadCardSnapshot]);

  const loadGroups = useCallback(async () => {
    setLoadingInitialGroups(true);

    try {
      const cached = await getCachedGroupsIndex();

      if (cached.updatedAt > 0) {
        setGroups(cached.activeGroups);
        setLoadingInitialGroups(false);
      }

      syncLivingSpacesFromGroups()
        .then(setLivingSpaces)
        .catch(error => {
          console.warn('[Spaces] failed to sync Living Spaces from cached groups:', error);
        });

      if (!npub) {
        setGroups([]);
        return;
      }

      const rebuilt = await rebuildGroupsIndexForNpub(npub);
      setGroups(rebuilt.activeGroups);
      setLivingSpaces(await syncLivingSpacesFromGroups());
    } catch (error) {
      console.warn('[Spaces] failed to load groups:', error);
    } finally {
      setLoadingInitialGroups(false);
    }
  }, [npub]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      loadGroups();

      if (npub) {
        scheduleGroupsMembershipRefresh(npub);
      }
    }, [loadData, loadGroups, npub])
  );

  useEffect(() => {
    const unsubscribe = subscribeToGroupsIndex(snapshot => {
      setGroups(snapshot.activeGroups);
      setLoadingInitialGroups(false);
      syncLivingSpacesFromGroups()
        .then(setLivingSpaces)
        .catch(error => {
          console.warn('[Spaces] failed to sync Living Spaces after group index update:', error);
        });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToDMEvents(() => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }

      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        loadData();
      }, 250);
    });

    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }

      if (profileHydrationTimerRef.current) {
        clearTimeout(profileHydrationTimerRef.current);
        profileHydrationTimerRef.current = null;
      }

      unsubscribe();
    };
  }, [loadData]);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;

    return threads.filter(thread => {
      const title = thread.title.toLowerCase();
      const preview = (thread.lastMessage || '').toLowerCase();
      const npub = (thread.participantNpub || '').toLowerCase();

      return title.includes(q) || preview.includes(q) || npub.includes(q);
    });
  }, [threads, search]);

  const inboxItems = useMemo<SpaceInboxItem[]>(() => {
    const q = search.trim().toLowerCase();
    const dmItems: SpaceInboxItem[] = filteredThreads.map(thread => ({
      id: `dm_${thread.id}`,
      type: 'dm',
      updatedAt: thread.updatedAt,
      unread: thread.unread,
      thread,
    }));

    const groupItems: SpaceInboxItem[] = groups
      .filter(group => {
        if (!q) return true;

        const title = group.name.toLowerCase();
        const preview = (group.lastPostPreview || '').toLowerCase();
        const season = (group.season || '').toLowerCase();

        return title.includes(q) || preview.includes(q) || season.includes(q);
      })
      .map(group => ({
        id: `group_${group.id}`,
        type: 'group',
        updatedAt: group.lastPostAt ?? group.updatedAt,
        unread: 0,
        group,
      }));

    const combined =
      spaceFilter === 'dms'
        ? dmItems
        : spaceFilter === 'groups'
          ? groupItems
          : spaceFilter === 'unread'
            ? [...dmItems, ...groupItems].filter(item => item.unread > 0)
            : [...dmItems, ...groupItems];

    return combined.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [filteredThreads, groups, search, spaceFilter]);

  const livingSpaceByGroupId = useMemo(() => {
    const map = new Map<string, LivingSpace>();

    livingSpaces.forEach(space => {
      if (space.source === 'group' && space.sourceId) {
        map.set(space.sourceId, space);
      }
    });

    return map;
  }, [livingSpaces]);

  const unreadSpaceCount = threads.filter(thread => thread.unread > 0).length;
  const loadingInitialSpaces = loadingInitialThreads || loadingInitialGroups;
  const headerLogo =
    themeMode === 'light'
      ? require('../../assets/images/bE_logo_dark.png')
      : require('../../assets/images/bE_logo_light.png');
  const myDisplayName =
    profile?.display_name ||
    profile?.name ||
    (npub ? `${npub.slice(0, 12)}…` : 'Member');

  const discoveryAlreadyContact = useMemo(() => {
    if (!discoveryProfile) return false;

    return contacts.some(contact =>
      contact.npub === discoveryProfile.npub ||
      contact.pubkeyHex === discoveryProfile.pubkey
    );
  }, [contacts, discoveryProfile]);

  const closeSheet = () => {
    setSheet('none');
    setNewTitle('');
    setNewNpub('');
    setGroupName('');
    setGroupSeason('');
    setGroupSpaceType('custom');
    setGroupType('');
    setGroupDescription('');
    setGroupImageUri(null);
    setEditingGroupId(null);
    setJoinCode('');
    setCreating(false);

    setDiscoveryInput('');
    setDiscoveryProfile(null);
    setDiscoveryError('');
    setDiscovering(false);
    setSavingDiscoveryContact(false);
  };

  const getThreadDisplayTitle = useCallback((thread: DMThread): string => {
    if (thread.participantPubkey && profileNames[thread.participantPubkey]) {
      return profileNames[thread.participantPubkey];
    }

    return thread.title;
  }, [profileNames]);

  const openThread = (thread: DMThread) => {
    router.push({
      pathname: '/dm-thread',
      params: {
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      },
    } as any);
  };

  const openGroup = (group: BEGroup) => {
    router.push({ pathname: '/group-detail', params: { id: group.id } } as any);
  };

  const openEditGroup = async (group: BEGroup) => {
    const canEdit = !!npub && (
      group.ownerNpub === npub ||
      await isGroupAdmin(group.id, npub)
    );

    if (!canEdit) {
      Alert.alert('Admin only', 'Only a Space owner or admin can edit Space identity and type.');
      return;
    }

    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupSeason(group.season ?? '');
    setGroupSpaceType(group.spaceType ?? 'custom');
    setGroupType(group.sport ?? '');
    setGroupDescription(group.description ?? '');
    setGroupImageUri(group.coverImage ?? null);
    setSheet('edit-group');
  };

  const handleDeleteThread = (thread: DMThread) => {
    Alert.alert(
      'Delete conversation?',
      `Delete "${thread.title}" from this device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteThread(thread.id);
            await loadData();
          },
        },
      ]
    );
  };

  const createConversation = async (contact?: ConversationContact) => {
    if (creating) return;

    setCreating(true);

    try {
      const title = contact
        ? contact.nostrName || contact.name
        : newTitle.trim() || 'New Conversation';

      const npubInput = contact ? contact.npub ?? '' : newNpub.trim();

      let participantPubkey: string | undefined;
      let participantNpub: string | undefined;

      if (npubInput) {
        const normalized = normalizeNostrIdentity(npubInput);
        participantPubkey = normalized.pubkey;
        participantNpub = normalized.npub || nip19.npubEncode(normalized.pubkey);
      }

      const thread = await createThread({
        title,
        participantPubkey,
        participantNpub,
      });

      closeSheet();
      await loadData();
      openThread(thread);
    } catch (error: any) {
      Alert.alert(
        'Invalid Nostr address',
        error?.message || 'Please enter a valid npub or hex pubkey.'
      );
    }

    setCreating(false);
  };

  const pickGroupImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo access to choose a Space image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setGroupImageUri(result.assets[0].uri);
    }
  };

  const createGroupSpace = async () => {
    if (creating) return;

    const cleanName = groupName.trim();

    if (!cleanName) {
      Alert.alert('Space name required', 'Add a name for this Space.');
      return;
    }

    if (!npub) {
      Alert.alert('Not signed in', 'Sign in before creating a Space.');
      return;
    }

    setCreating(true);

    try {
      const pubkeyHex = npubToHex(npub);
      const group = await createGroup({
        name: cleanName,
        description: groupDescription.trim() || undefined,
        season: groupSeason.trim() || undefined,
        spaceType: groupSpaceType,
        spaceLabel: getSpaceTypeLabel(groupSpaceType),
        isSpace: true,
        sport: groupType || undefined,
        coverImage: groupImageUri || undefined,
        relayUrl: DEFAULT_RELAY,
        ownerNpub: npub,
        ownerPubkeyHex: pubkeyHex,
        ownerDisplayName: myDisplayName,
        ownerAvatarUrl: profile?.picture,
        nsec: nsec ?? undefined,
      });

      registerGroupMemberForPush({
        groupId: group.id,
        groupName: group.name,
        relayUrl: group.relayUrl,
        memberNpub: npub,
        role: 'owner',
        status: 'active',
        displayName: myDisplayName,
      }).catch(error => {
        console.warn('[Spaces] push member registration failed after Space create:', error);
      });

      closeSheet();
      await loadGroups();
      setLivingSpaces(await syncLivingSpacesFromGroups());
      setSpaceFilter('groups');
      openGroup(group);
    } catch (error: any) {
      Alert.alert('Could not create Space', error?.message || 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const saveGroupSpaceEdits = async () => {
    if (creating || !editingGroupId) return;

    const cleanName = groupName.trim();

    if (!cleanName) {
      Alert.alert('Space name required', 'Add a name for this Space.');
      return;
    }

    setCreating(true);

    try {
      const editingGroup = groups.find(group => group.id === editingGroupId);
      const canEdit = !!npub && (
        editingGroup?.ownerNpub === npub ||
        await isGroupAdmin(editingGroupId, npub)
      );

      if (!canEdit) {
        Alert.alert('Admin only', 'Only a Space owner or admin can save these changes.');
        return;
      }

      await updateGroup(editingGroupId, {
        name: cleanName,
        description: groupDescription.trim() || undefined,
        season: groupSeason.trim() || undefined,
        spaceType: groupSpaceType,
        spaceLabel: getSpaceTypeLabel(groupSpaceType),
        isSpace: true,
        sport: groupType || undefined,
        coverImage: groupImageUri || undefined,
      });

      if (nsec) {
        const publishResult = await publishGroupMetadataSnapshot(editingGroupId, nsec);
        if (!publishResult.success) {
          console.warn('[Spaces] failed to publish Space metadata update:', publishResult.error);
        }
      }

      closeSheet();
      await loadGroups();
      setLivingSpaces(await syncLivingSpacesFromGroups());
    } catch (error: any) {
      Alert.alert('Could not update Space', error?.message || 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const joinGroupSpace = async () => {
    if (creating) return;

    const code = joinCode.trim().toUpperCase();

    if (code.length < 6) {
      Alert.alert('Invalid code', 'Enter the 6-character invite code.');
      return;
    }

    if (!npub) {
      Alert.alert('Not signed in', 'Sign in before joining a Space.');
      return;
    }

    setCreating(true);

    try {
      const pubkeyHex = npubToHex(npub);
      const result = await joinGroupByCode({
        code,
        npub,
        pubkeyHex,
        relayUrl: DEFAULT_RELAY,
        nsec: nsec ?? undefined,
        displayName: myDisplayName,
        avatarUrl: profile?.picture,
      });

      if (!result.success || !result.group) {
        Alert.alert('Could not join', result.error ?? 'Invalid invite code.');
        return;
      }

      registerGroupMemberForPush({
        groupId: result.group.id,
        groupName: result.group.name,
        relayUrl: result.group.relayUrl,
        memberNpub: npub,
        role: 'member',
        status: 'active',
        displayName: myDisplayName,
      }).catch(error => {
        console.warn('[Spaces] push member registration failed after join:', error);
      });

      notifyGroupEvent({
        groupId: result.group.id,
        groupName: result.group.name,
        relayUrl: result.group.relayUrl,
        actorNpub: npub,
        actorName: myDisplayName,
        eventType: 'member_joined',
        memberNpub: npub,
        memberName: myDisplayName,
        routeTarget: 'group-detail',
        groupTab: 'members',
      }).catch(error => {
        console.warn('[Spaces] remote join notification failed:', error);
      });

      await saveLocalGroupSystemMessage({
        groupId: result.group.id,
        text: `${myDisplayName} joined the space`,
        systemType: 'join',
        actorNpub: npub,
        actorName: myDisplayName,
      });

      if (nsec) {
        publishGroupMessage({
          groupId: result.group.id,
          clientMessageId: `system_join_${result.group.id}_${npub}_${Date.now()}`,
          text: `${myDisplayName} joined the space`,
          kind: 'system',
          systemType: 'join',
          senderNpub: npub,
          senderName: myDisplayName,
          nsec,
          relayUrl: result.group.relayUrl,
        }).then(result => {
          if (!result.success) {
            console.warn('[Spaces] publish join system message failed:', result.error);
          }
        }).catch(error => {
          console.warn('[Spaces] publish join system message error:', error);
        });
      }

      closeSheet();
      await loadGroups();
      setLivingSpaces(await syncLivingSpacesFromGroups());
      setSpaceFilter('groups');
      openGroup(result.group);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not join that Space.');
    } finally {
      setCreating(false);
    }
  };

  const handleDiscoverPerson = async () => {
    if (discovering) return;

    setDiscovering(true);
    setDiscoveryError('');
    setDiscoveryProfile(null);

    try {
      const profile = await resolveDiscoveryInput(discoveryInput);
      setDiscoveryProfile(profile);
      setNewTitle(profile.displayName);
      setNewNpub(profile.npub);
    } catch (error: any) {
      setDiscoveryError(error?.message || 'Could not find that person.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleSaveDiscoveryContact = async () => {
    if (!discoveryProfile || savingDiscoveryContact) return;

    setSavingDiscoveryContact(true);

    try {
      const contactName = discoveryProfile.displayName || discoveryProfile.nip05 || 'Nostr Contact';

      await saveContact({
        name: contactName,
        npub: discoveryProfile.npub,
        pubkeyHex: discoveryProfile.pubkey,
        nostrName: discoveryProfile.displayName,
        nostrAvatar: discoveryProfile.picture,
      });

      const nextContacts = await getContacts();
      setContacts(nextContacts);

      Alert.alert('Contact saved', `${contactName} was added to your bE Contacts.`);
    } catch (error: any) {
      Alert.alert(
        'Could not save contact',
        error?.message || 'Please try again.'
      );
    } finally {
      setSavingDiscoveryContact(false);
    }
  };

  const handleStartDiscoveryMessage = async () => {
    if (!discoveryProfile) return;

    await createConversation({
      name: discoveryProfile.displayName,
      npub: discoveryProfile.npub,
      pubkeyHex: discoveryProfile.pubkey,
      nostrName: discoveryProfile.displayName,
      nostrAvatar: discoveryProfile.picture,
    });
  };

  const handleCopyDiscoveryNpub = async () => {
    if (!discoveryProfile) return;

    await Clipboard.setStringAsync(discoveryProfile.npub);
    Alert.alert('Copied', 'npub copied to clipboard.');
  };

  const renderThread = ({ item }: { item: DMThread }) => {
    const encrypted = !!item.participantPubkey;
    const hasUnread = item.unread > 0;
    const displayTitle = getThreadDisplayTitle(item);

    const profilePicture =
      item.participantPubkey
        ? profilePictures[item.participantPubkey]
        : undefined;

    return (
      <TouchableOpacity
        style={s.threadRow}
        activeOpacity={0.82}
        onPress={() => openThread(item)}
        onLongPress={() => handleDeleteThread(item)}
      >
        <View style={[s.avatar, hasUnread && s.avatarUnread]}>
          {profilePicture ? (
            <Image source={{ uri: profilePicture }} style={s.avatarImage} />
          ) : (
            <Text style={s.avatarText}>{getInitials(displayTitle)}</Text>
          )}
        </View>

        <View style={s.threadBody}>
          <View style={s.threadTop}>
            <Text style={[s.threadTitle, hasUnread && s.threadTitleUnread]} numberOfLines={1}>
              {displayTitle}
            </Text>

            <Text style={s.threadTime}>{formatThreadTime(item.updatedAt)}</Text>
          </View>

          <View style={s.threadBottom}>
            <Text style={[s.threadPreview, hasUnread && s.threadPreviewUnread]} numberOfLines={1}>
              {item.lastMessage || (encrypted ? 'Encrypted conversation' : 'Local conversation')}
            </Text>

            {hasUnread && (
              <View style={s.unreadBadge}>
                <Text style={s.unreadText}>{item.unread}</Text>
              </View>
            )}
          </View>

          <Text style={encrypted ? s.threadMetaSecure : s.threadMetaLocal} numberOfLines={1}>
            {encrypted ? '🔒 Nostr encrypted' : 'Local only — add npub to sync'}
          </Text>
        </View>

        <TouchableOpacity
          style={s.moreBtn}
          onPress={() => handleDeleteThread(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.moreText}>⋯</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderSpaceItem = ({ item }: { item: SpaceInboxItem }) => {
    if (item.type === 'group') {
      const group = item.group;
      const livingSpace = livingSpaceByGroupId.get(group.id);
      const groupTypeIcon = getGroupTypeIcon(group);
      const preview =
        group.lastPostPreview ||
        `${group.memberCount ?? 0} member${(group.memberCount ?? 0) !== 1 ? 's' : ''}`;

      return (
        <TouchableOpacity
          style={s.threadRow}
          activeOpacity={0.82}
          onPress={() => openGroup(group)}
          onLongPress={() => { void openEditGroup(group); }}
        >
          <View style={s.avatar}>
            {group.coverImage ? (
              <Image source={{ uri: group.coverImage }} style={s.avatarImage} />
            ) : (
              <Text style={s.avatarText}>{getGroupAvatarText(group)}</Text>
            )}
          </View>

          <View style={s.threadBody}>
            <View style={s.threadTop}>
              <Text style={s.threadTitle} numberOfLines={1}>
                {group.name}
              </Text>

              <Text style={s.threadTime}>{formatThreadTime(item.updatedAt)}</Text>
            </View>

            <Text style={s.threadPreview} numberOfLines={1}>
              {preview}
            </Text>

            <View style={s.threadMetaRow}>
              {groupTypeIcon ? (
                <View style={s.spaceCategoryBadge}>
                  <Text style={s.spaceCategoryBadgeText}>{groupTypeIcon}</Text>
                </View>
              ) : null}

              <Text style={s.threadMetaSecure} numberOfLines={1}>
                {formatLivingSpaceType(livingSpace)} space - {formatRelayLabel(group)}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={s.moreBtn}
            onPress={() => { void openEditGroup(group); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.moreText}>⋯</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      );
    }

    return renderThread({ item: item.thread });
  };

  const handleCompose = () => {
    setSheet(spaceFilter === 'groups' ? 'new-group' : 'new');
  };

  const submitSheet = () => {
    if (sheet === 'edit-group') {
      saveGroupSpaceEdits();
      return;
    }

    if (sheet === 'new-group') {
      createGroupSpace();
      return;
    }

    if (sheet === 'join-space') {
      joinGroupSpace();
      return;
    }

    createConversation();
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View style={s.headerBrand}>
          <Image source={headerLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Spaces</Text>
        </View>

      </View>

      <View style={s.filterPills}>
        {([
          ['unread', 'Unread', unreadSpaceCount],
          ['dms', 'DMs', threads.length],
          ['groups', 'Groups', groups.length],
        ] as const).map(([value, label, count]) => {
          const active = spaceFilter === value;

          return (
            <TouchableOpacity
              key={value}
              style={[s.filterPill, active && s.filterPillActive]}
              onPress={() => setSpaceFilter(active ? 'all' : value)}
              activeOpacity={0.85}
            >
              <Text style={[s.filterPillText, active && s.filterPillTextActive]}>
                {label}
              </Text>

              {count > 0 && (
                <View style={[s.filterCount, active && s.filterCountActive]}>
                  <Text style={[s.filterCountText, active && s.filterCountTextActive]}>
                    {count > 99 ? '99+' : count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.searchWrap}>
        <Text style={s.searchIcon}>⌕</Text>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations"
          placeholderTextColor={theme.textMuted}
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={inboxItems}
        keyExtractor={item => item.id}
        renderItem={renderSpaceItem}
        contentContainerStyle={[
          s.list,
          inboxItems.length === 0 && s.listEmpty,
        ]}
        ListEmptyComponent={
          loadingInitialSpaces ? (
            <View style={s.empty}>
              <Text style={s.emptyHint}>Loading messages…</Text>
            </View>
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>✉️</Text>
              <Text style={s.emptyTitle}>
                  {search.trim()
                    ? 'No matches'
                    : spaceFilter === 'all'
                      ? 'No spaces yet'
                      : spaceFilter === 'unread'
                    ? 'No unread spaces'
                    : spaceFilter === 'groups'
                      ? 'No groups yet'
                      : 'No messages yet'}
              </Text>
              <Text style={s.emptyHint}>
                  {search.trim()
                    ? 'Try searching by name, message, Space, or npub.'
                    : spaceFilter === 'all'
                      ? 'DMs and Spaces will appear together here as conversations start.'
                    : spaceFilter === 'groups'
                    ? 'Create or join a Space for teams, schools, churches, or family.'
                    : spaceFilter === 'unread'
                      ? 'New DMs and Space activity will appear here when something needs attention.'
                      : 'Start a private conversation with a saved contact or npub.'}
              </Text>

              {spaceFilter === 'dms' && !search.trim() && (
                <TouchableOpacity style={s.emptyBtn} onPress={handleCompose}>
                  <Text style={s.emptyBtnText}>Start conversation</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
      />

      <TouchableOpacity style={s.fab} onPress={handleCompose} activeOpacity={0.85}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <Modal visible={sheet !== 'none'} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={closeSheet} />

          <View style={s.sheet}>
            <View style={s.sheetHandle} />

            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>
                  {sheet === 'edit-group'
                    ? 'Edit Space'
                    : sheet === 'new-group'
                      ? 'New Space'
                      : sheet === 'join-space'
                        ? 'Join Space'
                        : 'New message'}
                </Text>
                <Text style={s.sheetHint}>
                  {sheet === 'edit-group'
                    ? 'Update this Space identity, image, and category badge.'
                    : sheet === 'new-group'
                      ? 'Create a Space with its own identity, image, and relay route.'
                      : sheet === 'join-space'
                        ? 'Enter a Space invite code from your family, school, church, or team.'
                        : 'Find someone by npub or NIP-05, then start a private DM.'}
                </Text>
              </View>

              <TouchableOpacity onPress={closeSheet} style={s.closeBtn}>
                <Text style={s.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={s.sheetScroll}
              contentContainerStyle={s.sheetScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {sheet === 'new-group' || sheet === 'edit-group' ? (
                <View style={s.primaryPanel}>
                  {sheet === 'new-group' && (
                    <TouchableOpacity
                      style={s.joinSpaceShortcut}
                      onPress={() => setSheet('join-space')}
                      activeOpacity={0.85}
                    >
                      <Text style={s.joinSpaceShortcutTitle}>Have an invite code?</Text>
                      <Text style={s.joinSpaceShortcutText}>Join an existing Space</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={s.groupImagePicker} onPress={pickGroupImage} activeOpacity={0.85}>
                    {groupImageUri ? (
                      <Image source={{ uri: groupImageUri }} style={s.groupImagePreview} />
                    ) : (
                      <View style={s.groupImageFallback}>
                        <Text style={s.groupImageInitials}>
                          {groupName.trim() ? getGroupInitials(groupName) : 'SP'}
                        </Text>
                      </View>
                    )}

                    <View style={s.groupImageCopy}>
                      <Text style={s.primaryTitle}>Space image</Text>
                      <Text style={s.primaryHint}>Choose the photo or logo that represents this Space.</Text>
                    </View>
                  </TouchableOpacity>

                  <TextInput
                    style={s.input}
                    value={groupName}
                    onChangeText={setGroupName}
                    placeholder="Space name"
                    placeholderTextColor={theme.textMuted}
                  />

                  <TextInput
                    style={s.input}
                    value={groupSeason}
                    onChangeText={setGroupSeason}
                    placeholder="Season or year, optional"
                    placeholderTextColor={theme.textMuted}
                  />

                  <TextInput
                    style={[s.input, s.multilineInput]}
                    value={groupDescription}
                    onChangeText={setGroupDescription}
                    placeholder="Description, optional"
                    placeholderTextColor={theme.textMuted}
                    multiline
                  />

                  <Text style={s.inputHelp}>Space type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.groupTypeStrip}>
                    {SPACE_TYPE_OPTIONS.map(option => {
                      const active = groupSpaceType === option.value;

                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[s.groupTypePill, active && s.groupTypePillActive]}
                          onPress={() => setGroupSpaceType(option.value)}
                          activeOpacity={0.84}
                        >
                          <Text style={[s.groupTypePillText, active && s.groupTypePillTextActive]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={s.inputHelp}>
                    Space type controls how this Space can organize Marks, Mantles, River views, and Legacy later.
                  </Text>

                  <Text style={s.inputHelp}>Category badge</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.groupTypeStrip}>
                    <TouchableOpacity
                      style={[s.groupTypePill, !groupType && s.groupTypePillActive]}
                      onPress={() => setGroupType('')}
                      activeOpacity={0.84}
                    >
                      <Text style={[s.groupTypePillText, !groupType && s.groupTypePillTextActive]}>
                        No badge
                      </Text>
                    </TouchableOpacity>

                    {GROUP_TYPE_OPTIONS.map(type => {
                      const active = groupType === type;

                      return (
                        <TouchableOpacity
                          key={type}
                          style={[s.groupTypePill, active && s.groupTypePillActive]}
                          onPress={() => setGroupType(active ? '' : type)}
                          activeOpacity={0.84}
                        >
                          <Text style={s.groupTypePillIcon}>{GROUP_TYPE_ICONS[type]}</Text>
                          <Text style={[s.groupTypePillText, active && s.groupTypePillTextActive]}>
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={s.inputHelp}>
                    Category icons show as a small badge on Space cards. The Space image stays as the main card icon.
                  </Text>
                </View>
              ) : sheet === 'join-space' ? (
                <View style={s.primaryPanel}>
                  <View style={s.primaryPanelHeader}>
                    <View>
                      <Text style={s.primaryTitle}>Invite code</Text>
                      <Text style={s.primaryHint}>Ask a Space admin for the 6-character code.</Text>
                    </View>

                    <Text style={s.primaryBadge}>Space</Text>
                  </View>

                  <TextInput
                    style={[s.input, s.joinCodeInput]}
                    value={joinCode}
                    onChangeText={text => setJoinCode(text.toUpperCase())}
                    placeholder="ABC123"
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                  />

                  <Text style={s.inputHelp}>
                    Spaces can represent teams, schools, churches, family groups, trips, and other trusted communities.
                  </Text>

                  <TouchableOpacity
                    style={s.discoverySecondaryBtn}
                    onPress={() => setSheet('new-group')}
                    activeOpacity={0.85}
                  >
                    <Text style={s.discoverySecondaryText}>Create a new Space instead</Text>
                  </TouchableOpacity>
                </View>
              ) : (
              <>
              <View style={s.primaryPanel}>
                <View style={s.primaryPanelHeader}>
                  <View>
                    <Text style={s.primaryTitle}>Find People</Text>
                    <Text style={s.primaryHint}>Paste an npub or enter a NIP-05 address.</Text>
                  </View>

                  <Text style={s.primaryBadge}>Nostr</Text>
                </View>

                <View style={s.discoveryBox}>
                  <TextInput
                    style={s.discoveryInput}
                    value={discoveryInput}
                    onChangeText={text => {
                      setDiscoveryInput(text);
                      setDiscoveryError('');
                      setDiscoveryProfile(null);
                    }}
                    placeholder="npub1… or name@example.com"
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <TouchableOpacity
                    style={[
                      s.discoveryLookupBtn,
                      discovering && s.discoveryLookupBtnDisabled,
                    ]}
                    onPress={handleDiscoverPerson}
                    disabled={discovering}
                  >
                    <Text style={s.discoveryLookupText}>
                      {discovering ? 'Finding…' : 'Find'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {!!discoveryError && (
                  <Text style={s.discoveryError}>{discoveryError}</Text>
                )}

                {discoveryProfile && (
                  <View style={s.discoveryResult}>
                    <View style={s.discoveryResultTop}>
                      {discoveryProfile.picture ? (
                        <Image source={{ uri: discoveryProfile.picture }} style={s.discoveryAvatar} />
                      ) : (
                        <View style={s.discoveryAvatarFallback}>
                          <Text style={s.discoveryAvatarText}>
                            {getInitials(discoveryProfile.displayName)}
                          </Text>
                        </View>
                      )}

                      <View style={s.discoveryBody}>
                        <Text style={s.discoveryName} numberOfLines={1}>
                          {discoveryProfile.displayName}
                        </Text>

                        {!!discoveryProfile.nip05 && (
                          <Text style={s.discoveryNip05} numberOfLines={1}>
                            {discoveryProfile.nip05}
                          </Text>
                        )}

                        <Text style={s.discoveryNpub} numberOfLines={1}>
                          {discoveryProfile.npub}
                        </Text>
                      </View>
                    </View>

                    <View style={s.discoveryActions}>
                      <TouchableOpacity
                        style={[
                          s.discoverySecondaryBtn,
                          discoveryAlreadyContact && s.discoveryDisabledBtn,
                        ]}
                        onPress={handleSaveDiscoveryContact}
                        disabled={discoveryAlreadyContact || savingDiscoveryContact}
                      >
                        <Text style={s.discoverySecondaryText}>
                          {discoveryAlreadyContact
                            ? 'Saved'
                            : savingDiscoveryContact
                              ? 'Saving…'
                              : 'Add Contact'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={s.discoverySecondaryBtn}
                        onPress={handleCopyDiscoveryNpub}
                      >
                        <Text style={s.discoverySecondaryText}>Copy npub</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={s.discoveryPrimaryBtn}
                        onPress={handleStartDiscoveryMessage}
                        disabled={creating}
                      >
                        <Text style={s.discoveryPrimaryText}>
                          {creating ? 'Starting…' : 'Message'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {contacts.length > 0 && (
                <View style={s.secondarySection}>
                  <View style={s.sectionHeaderRow}>
                    <Text style={s.sectionLabel}>BΕ CONTACTS</Text>
                    <Text style={s.sectionCount}>{contacts.length}</Text>
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.contactStrip}>
                    {contacts.map(contact => (
                      <TouchableOpacity
                        key={contact.id}
                        style={s.contactPill}
                        onPress={() => createConversation(contact)}
                        activeOpacity={0.82}
                      >
                        {contact.nostrAvatar ? (
                          <Image source={{ uri: contact.nostrAvatar }} style={s.contactAvatar} />
                        ) : (
                          <View style={s.contactAvatarFallback}>
                            <Text style={s.contactAvatarText}>
                              {getInitials(contact.nostrName || contact.name)}
                            </Text>
                          </View>
                        )}

                        <Text style={s.contactName} numberOfLines={1}>
                          {contact.nostrName || contact.name}
                        </Text>

                        <Text style={contact.npub ? s.contactSecure : s.contactLocal}>
                          {contact.npub ? '🔒' : 'Local'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={s.manualPanel}>
                <Text style={s.manualTitle}>Local-only conversation</Text>
                <Text style={s.manualHint}>
                  Use this for private notes or a conversation placeholder that does not sync until an npub is added.
                </Text>

                <TextInput
                  style={s.input}
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Conversation name"
                  placeholderTextColor={theme.textMuted}
                />

                <TextInput
                  style={s.input}
                  value={newNpub}
                  onChangeText={setNewNpub}
                  placeholder="Optional npub1… or hex pubkey"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={s.inputHelp}>
                  Leave the npub blank to keep this conversation local-only on this device.
                </Text>
              </View>
              </>
              )}
            </ScrollView>

            <View style={s.sheetActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={closeSheet}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  s.confirmBtn,
                  creating && s.confirmBtnDisabled,
                ]}
                onPress={submitSheet}
                disabled={creating}
              >
                <Text style={s.confirmText}>
                  {creating
                    ? 'Saving...'
                    : sheet === 'edit-group'
                      ? 'Save changes'
                      : sheet === 'new-group'
                        ? 'Create Space'
                        : sheet === 'join-space'
                          ? 'Join Space'
                        : 'Start'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: typeof Colors.dark) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  header: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerLogo: {
    width: 34,
    height: 34,
  },
  headerTitle: {
    color: theme.text,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  filterPills: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 0,
  },
  filterPill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  filterPillActive: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  filterPillText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '900',
  },
  filterPillTextActive: {
    color: theme.bg,
  },
  filterCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    backgroundColor: theme.gold,
  },
  filterCountActive: {
    backgroundColor: theme.bg,
  },
  filterCountText: {
    color: theme.bg,
    fontSize: 10,
    fontWeight: '900',
  },
  filterCountTextActive: {
    color: theme.gold,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: {
    color: theme.surface,
    fontSize: 24,
    fontWeight: '700',
    marginTop: -2,
  },

  searchWrap: {
    marginHorizontal: 18,
    marginTop: 10,
    marginBottom: 6,
    height: 38,
    borderRadius: 13,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
  },
  searchIcon: {
    color: theme.textMuted,
    fontSize: 16,
    marginRight: 7,
  },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
  },

  list: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 110,
  },
  listEmpty: {
    flexGrow: 1,
  },

  threadRow: {
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 16,
    marginBottom: 7,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarUnread: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  avatarText: {
    color: theme.gold,
    fontSize: 14,
    fontWeight: '900',
  },
  avatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  threadBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 1,
  },
  threadTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  threadTitle: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
    marginRight: 8,
  },
  threadTitleUnread: {
    color: theme.text,
    fontWeight: '900',
  },
  threadTime: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  threadBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 18,
  },
  threadPreview: {
    flex: 1,
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 8,
  },
  threadPreviewUnread: {
    color: theme.text,
    fontWeight: '800',
  },
  threadMetaSecure: {
    alignSelf: 'flex-start',
    color: theme.gold,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.raised,
  },
  threadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  spaceCategoryBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.gold + '55',
  },
  spaceCategoryBadgeText: {
    fontSize: 11,
  },
  threadMetaLocal: {
    alignSelf: 'flex-start',
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.raised,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: theme.bg,
    fontSize: 11,
    fontWeight: '900',
  },
  moreBtn: {
    width: 28,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    color: theme.textMuted,
    fontSize: 22,
    fontWeight: '900',
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
  },
  emptyIcon: {
    fontSize: 38,
    marginBottom: 14,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyHint: {
    color: theme.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyBtn: {
    backgroundColor: theme.gold,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  emptyBtnText: {
    color: theme.surface,
    fontSize: 14,
    fontWeight: '900',
  },

  fab: {
    position: 'absolute',
    right: 22,
    bottom: 26,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    color: theme.surface,
    fontSize: 26,
    fontWeight: '800',
    marginTop: -2,
  },

  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(17, 24, 28, 0.28)'
      : 'rgba(0,0,0,0.58)',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: theme.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 18,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 18,
  },
  sheetTitle: {
    color: theme.text,
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  sheetHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    maxWidth: 260,
    fontWeight: '600',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: theme.textMuted,
    fontSize: 15,
    fontWeight: '900',
  },

  sheetScroll: {
    maxHeight: 560,
  },
  sheetScrollContent: {
    paddingBottom: 14,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  sectionCount: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
  },
  secondarySection: {
    marginTop: 2,
    marginBottom: 16,
  },
  contactStrip: {
    marginBottom: 0,
  },
  contactPill: {
    width: 88,
    minHeight: 112,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  contactAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginBottom: 8,
  },
  contactAvatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  contactAvatarText: {
    color: theme.gold,
    fontSize: 15,
    fontWeight: '900',
  },
  contactName: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    maxWidth: 76,
  },
  contactSecure: {
    color: theme.gold,
    fontSize: 10,
    marginTop: 5,
    fontWeight: '900',
  },
  contactLocal: {
    color: theme.textMuted,
    fontSize: 10,
    marginTop: 5,
    fontWeight: '800',
  },

  input: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  multilineInput: {
    minHeight: 82,
    textAlignVertical: 'top',
  },
  joinCodeInput: {
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900',
  },
  inputHelp: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 2,
    fontWeight: '600',
  },

  primaryPanel: {
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 22,
    padding: 14,
    marginBottom: 16,
  },
  primaryPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  primaryTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  primaryHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 3,
  },
  primaryBadge: {
    color: theme.bg,
    backgroundColor: theme.gold,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
  },
  joinSpaceShortcut: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  joinSpaceShortcutTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '900',
  },
  joinSpaceShortcutText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  groupImagePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  groupImagePreview: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: theme.surface,
  },
  groupImageFallback: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  groupImageInitials: {
    color: theme.gold,
    fontSize: 18,
    fontWeight: '900',
  },
  groupImageCopy: {
    flex: 1,
    minWidth: 0,
  },
  groupTypeStrip: {
    marginTop: 8,
    marginBottom: 10,
  },
  groupTypePill: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  groupTypePillActive: {
    borderColor: theme.gold,
    backgroundColor: theme.gold,
  },
  groupTypePillIcon: {
    fontSize: 15,
  },
  groupTypePillText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '800',
  },
  groupTypePillTextActive: {
    color: theme.bg,
  },
  manualPanel: {
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 20,
    padding: 14,
    marginBottom: 4,
  },
  manualTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  manualHint: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    marginBottom: 12,
  },

  discoveryBox: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  discoveryInput: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  discoveryLookupBtn: {
    minWidth: 78,
    borderRadius: 16,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  discoveryLookupBtnDisabled: {
    opacity: 0.6,
  },
  discoveryLookupText: {
    color: theme.bg,
    fontSize: 13,
    fontWeight: '900',
  },
  discoveryError: {
    color: theme.gold,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 10,
  },
  discoveryResult: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 20,
    padding: 12,
    marginTop: 4,
  },
  discoveryResultTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  discoveryAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  discoveryAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoveryAvatarText: {
    color: theme.gold,
    fontSize: 15,
    fontWeight: '900',
  },
  discoveryBody: {
    flex: 1,
    minWidth: 0,
  },
  discoveryName: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 3,
  },
  discoveryNip05: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  discoveryNpub: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  discoveryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  discoverySecondaryBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 19,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  discoveryDisabledBtn: {
    opacity: 0.55,
  },
  discoverySecondaryText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '900',
  },
  discoveryPrimaryBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 19,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  discoveryPrimaryText: {
    color: theme.bg,
    fontSize: 11,
    fontWeight: '900',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  confirmBtn: {
    flex: 1.8,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmText: {
    color: theme.bg,
    fontSize: 14,
    fontWeight: '900',
  },
});
