import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { nip19 } from 'nostr-tools';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StartDMModal, {
  type DMDiscoveryPerson,
} from '../../components/dm/StartDMModal';
import { Colors } from '../../src/constants/theme';
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
import { fetchNostrProfile } from '../../src/utils/nostr';
import { normalizeNostrIdentity } from '../../src/utils/nostr-identity';
import { useIdentity } from '../_layout';

type Theme = typeof Colors.dark;

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
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export default function DMsScreen() {
  const { theme, npub } = useIdentity();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  const [threads, setThreads] = useState<DMThread[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [profilePictures, setProfilePictures] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [composerVisible, setComposerVisible] = useState(false);
  const [startingPersonId, setStartingPersonId] = useState<string | null>(null);

  const hydrateProfiles = useCallback(async (threadList: DMThread[]) => {
    const pubkeys = Array.from(
      new Set(
        threadList
          .map(thread => thread.participantPubkey)
          .filter((pubkey): pubkey is string => !!pubkey)
      )
    );

    if (pubkeys.length === 0) return;

    try {
      const cachedProfiles = await getCachedDMProfiles(pubkeys);
      const cachedList = Object.values(cachedProfiles) as Array<{
        pubkey: string;
        displayName: string;
        picture?: string;
      }>;

      const cachedNames: Record<string, string> = {};
      const cachedPictures: Record<string, string> = {};

      cachedList.forEach(profile => {
        cachedNames[profile.pubkey] = profile.displayName;

        if (profile.picture) {
          cachedPictures[profile.pubkey] = profile.picture;
        }
      });

      if (Object.keys(cachedNames).length > 0) {
        setProfileNames(prev => ({ ...prev, ...cachedNames }));
      }

      if (Object.keys(cachedPictures).length > 0) {
        setProfilePictures(prev => ({ ...prev, ...cachedPictures }));
      }
    } catch (error) {
      console.warn('[DM Inbox] failed to load cached profiles:', error);
    }

    for (const pubkey of pubkeys) {
      try {
        const npub = nip19.npubEncode(pubkey);
        const profile = await fetchNostrProfile(npub);

        if (!profile) continue;

        const thread = threadList.find(item => item.participantPubkey === pubkey);
        const displayName =
          profile.display_name ||
          profile.name ||
          thread?.title ||
          npub.slice(0, 14);

        setProfileNames(prev => ({
          ...prev,
          [pubkey]: displayName,
        }));

        if (profile.picture) {
          setProfilePictures(prev => ({
            ...prev,
            [pubkey]: profile.picture || '',
          }));
        }

        await saveCachedDMProfile({
          pubkey,
          displayName,
          picture: profile.picture,
        });
      } catch (error) {
        console.warn('[DM Inbox] failed to hydrate profile:', error);
      }
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const nextThreads = await getDMThreads();
      setThreads(nextThreads);
      hydrateProfiles(nextThreads);
    } catch (error) {
      console.warn('[DM Inbox] failed to load threads:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateProfiles]);

  useFocusEffect(
    useCallback(() => {
      loadThreads();
    }, [loadThreads])
  );

  useEffect(() => {
    const unsubscribe = subscribeToDMEvents(() => {
      loadThreads();
    });

    return unsubscribe;
  }, [loadThreads]);

  const getThreadDisplayTitle = useCallback((thread: DMThread): string => {
    if (thread.participantPubkey && profileNames[thread.participantPubkey]) {
      return profileNames[thread.participantPubkey];
    }

    return thread.title || 'DM';
  }, [profileNames]);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return threads;

    return threads.filter(thread => {
      const displayTitle = getThreadDisplayTitle(thread).toLowerCase();
      const savedTitle = thread.title.toLowerCase();
      const preview = (thread.lastMessage || '').toLowerCase();
      const npub = (thread.participantNpub || '').toLowerCase();

      return (
        displayTitle.includes(q) ||
        savedTitle.includes(q) ||
        preview.includes(q) ||
        npub.includes(q)
      );
    });
  }, [getThreadDisplayTitle, search, threads]);

  const unreadCount = useMemo(
    () => threads.reduce((total, thread) => total + Math.max(0, thread.unread || 0), 0),
    [threads]
  );

  const openThread = useCallback((thread: DMThread) => {
    router.push({
      pathname: '/dm-thread',
      params: {
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      },
    } as any);
  }, [getThreadDisplayTitle, router]);

  const closeComposer = useCallback(() => {
    setComposerVisible(false);
    setStartingPersonId(null);
  }, []);

  const handleStartDMFromPerson = useCallback(async (person: DMDiscoveryPerson) => {
    if (startingPersonId) return;

    setStartingPersonId(person.id);

    try {
      let participantPubkey = person.pubkeyHex?.trim().toLowerCase();
      let participantNpub = person.npub?.trim();

      if (!participantPubkey && participantNpub) {
        const normalized = normalizeNostrIdentity(participantNpub);
        participantPubkey = normalized.pubkey;
        participantNpub = normalized.npub || nip19.npubEncode(normalized.pubkey);
      }

      if (!participantPubkey) {
        Alert.alert(
          'Cannot start DM',
          'This person does not have a DM identity available yet.'
        );
        return;
      }

      if (!participantNpub) {
        participantNpub = nip19.npubEncode(participantPubkey);
      }

      let currentPubkey = '';

      if (npub) {
        try {
          const decoded = nip19.decode(npub);

          if (decoded.type === 'npub' && typeof decoded.data === 'string') {
            currentPubkey = decoded.data.toLowerCase();
          }
        } catch {}
      }

      const selectedIsCurrentUser =
        (!!npub && participantNpub.toLowerCase() === npub.toLowerCase()) ||
        (!!currentPubkey && participantPubkey.toLowerCase() === currentPubkey);

      if (selectedIsCurrentUser) {
        Alert.alert('That is you', 'Choose another person to start a DM.');
        return;
      }

      const existingThread = threads.find(thread => {
        const samePubkey =
          !!thread.participantPubkey &&
          thread.participantPubkey.toLowerCase() === participantPubkey;

        const sameNpub =
          !!thread.participantNpub &&
          !!participantNpub &&
          thread.participantNpub.toLowerCase() === participantNpub.toLowerCase();

        return samePubkey || sameNpub;
      });

      if (existingThread) {
        closeComposer();
        openThread(existingThread);
        return;
      }

      const thread = await createThread({
        title: person.displayName,
        participantPubkey,
        participantNpub,
      });

      closeComposer();
      await loadThreads();
      openThread(thread);
    } catch (error) {
      Alert.alert(
        'Unable to start DM',
        error instanceof Error
          ? error.message
          : 'Could not start a DM with this person.'
      );
    } finally {
      setStartingPersonId(null);
    }
  }, [
    closeComposer,
    loadThreads,
    openThread,
    startingPersonId,
    threads,
  ]);

  const handleDeleteThread = useCallback((thread: DMThread) => {
    const title = getThreadDisplayTitle(thread);

    Alert.alert(
      'Delete DM?',
      `Delete "${title}" from this device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteThread(thread.id);
            await loadThreads();
          },
        },
      ]
    );
  }, [getThreadDisplayTitle, loadThreads]);

  const renderThread = useCallback(({ item }: { item: DMThread }) => {
    const title = getThreadDisplayTitle(item);
    const encrypted = !!item.participantPubkey;
    const hasUnread = item.unread > 0;
    const profilePicture =
      item.participantPubkey ? profilePictures[item.participantPubkey] : undefined;

    return (
      <TouchableOpacity
        style={[styles.threadRow, hasUnread && styles.threadRowUnread]}
        activeOpacity={0.88}
        onPress={() => openThread(item)}
        onLongPress={() => handleDeleteThread(item)}
      >
        <View pointerEvents="none" style={styles.threadCardWash} />
        <View pointerEvents="none" style={styles.threadCardGlow} />

        <View style={[styles.avatar, hasUnread && styles.avatarUnread]}>
          {profilePicture ? (
            <Image source={{ uri: profilePicture }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{getInitials(title)}</Text>
          )}
        </View>

        <View style={styles.threadBody}>
          <View style={styles.threadTop}>
            <Text style={[styles.threadTitle, hasUnread && styles.threadTitleUnread]} numberOfLines={1}>
              {title}
            </Text>
          </View>

          <Text style={[styles.threadPreview, hasUnread && styles.threadPreviewUnread]} numberOfLines={1}>
            {item.lastMessage || (encrypted ? 'Encrypted DM' : 'Local DM')}
          </Text>

          <View style={styles.threadMetaRow}>
            <Text style={encrypted ? styles.threadMetaSecure : styles.threadMetaLocal} numberOfLines={1}>
              {encrypted ? 'Nostr encrypted' : 'Local only'}
            </Text>

            <Text style={styles.threadTimeChip} numberOfLines={1}>
              {formatThreadTime(item.updatedAt)}
            </Text>

            {hasUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {item.unread > 99 ? '99+' : item.unread}
                </Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.moreButton}
          onPress={() => handleDeleteThread(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.78}
        >
          <Text style={styles.moreText}>⋯</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [
    getThreadDisplayTitle,
    handleDeleteThread,
    openThread,
    profilePictures,
    styles,
  ]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadThreads();
  }, [loadThreads]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>bE Marks</Text>
          <Text style={styles.title}>DMs</Text>
          <Text style={styles.subtitle}>
            {unreadCount > 0
              ? `${unreadCount} unread private message${unreadCount === 1 ? '' : 's'}`
              : 'Private DMs'}
          </Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search DMs"
          placeholderTextColor={theme.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={theme.gold}
        />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.gold} />
          <Text style={styles.loadingText}>Loading DMs…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredThreads}
          keyExtractor={item => item.id}
          renderItem={renderThread}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.gold}
              colors={[theme.gold]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>✉️</Text>
              <Text style={styles.emptyTitle}>
                {search.trim() ? 'No matching DMs' : 'No DMs yet'}
              </Text>
              <Text style={styles.emptyText}>
                {search.trim()
                  ? 'Try a different name or message preview.'
                  : 'Start a private conversation with a contact, Space member, QR card, or discoverable relay profile.'}
              </Text>

              {!search.trim() && (
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => setComposerVisible(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.emptyButtonText}>Start DM</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

            <TouchableOpacity
        style={styles.fab}
        onPress={() => setComposerVisible(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Start new DM"
      >
        <Ionicons name="add" size={34} color={theme.gold} />
      </TouchableOpacity>

      <StartDMModal
        visible={composerVisible}
        theme={theme}
        currentNpub={npub}
        busyPersonId={startingPersonId}
        onClose={closeComposer}
        onSelectPerson={handleStartDMFromPerson}
      />
    </SafeAreaView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    kicker: {
      color: theme.gold,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    title: {
      color: theme.text,
      fontSize: 34,
      fontWeight: '900',
      letterSpacing: -0.7,
    },
    subtitle: {
      color: theme.textMuted,
      fontSize: 13,
      marginTop: 4,
      fontWeight: '600',
    },
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 92,
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor:
        theme.bg === '#0D0F0E'
          ? 'rgba(18,20,19,0.88)'
          : theme.surface + 'EE',
      borderWidth: 0.75,
      borderColor: theme.gold + '66',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 5,
      zIndex: 20,
    },
    searchWrap: {
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    searchInput: {
      minHeight: 46,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      color: theme.text,
      paddingHorizontal: 16,
      fontSize: 15,
      fontWeight: '600',
    },
    loadingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingBottom: 100,
    },
    loadingText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    list: {
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 122,
      flexGrow: 1,
    },
    threadRow: {
      minHeight: 94,
      borderRadius: 22,
      borderWidth: 0.7,
      borderColor: theme.border,
      backgroundColor: theme.raised,
      paddingLeft: 14,
      paddingRight: 54,
      paddingVertical: 12,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      position: 'relative',
      overflow: 'hidden',
      shadowColor: theme.gold,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.14,
      shadowRadius: 14,
      elevation: 5,
    },
    threadRowUnread: {
      borderColor: theme.gold,
    },
    threadCardWash: {
      position: 'absolute',
      top: -38,
      right: -44,
      width: 148,
      height: 148,
      borderRadius: 74,
      opacity: 0.13,
      backgroundColor: theme.gold,
    },
    threadCardGlow: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 42,
      opacity: 0.38,
      backgroundColor: theme.surface,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 0.8,
      borderColor: `${theme.gold}35`,
      overflow: 'hidden',
      zIndex: 1,
    },
    avatarUnread: {
      borderColor: theme.gold,
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      color: theme.gold,
      fontSize: 20,
      fontWeight: '900',
    },
    threadBody: {
      flex: 1,
      minWidth: 0,
      zIndex: 1,
    },
    threadTop: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    threadTitle: {
      flex: 1,
      minWidth: 0,
      color: theme.text,
      fontSize: 17,
      fontWeight: '900',
      letterSpacing: -0.2,
    },
    threadTitleUnread: {
      color: theme.text,
    },
    threadPreview: {
      color: theme.textMuted,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '800',
      marginBottom: 10,
    },
    threadPreviewUnread: {
      color: theme.text,
    },
    threadMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'nowrap',
      gap: 6,
    },
    threadMetaSecure: {
      maxWidth: 116,
      borderRadius: 999,
      borderWidth: 0.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      color: theme.gold,
      paddingHorizontal: 9,
      paddingVertical: 5,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
    },
    threadMetaLocal: {
      maxWidth: 116,
      borderRadius: 999,
      borderWidth: 0.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      color: theme.textMuted,
      paddingHorizontal: 9,
      paddingVertical: 5,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
    },
    threadTimeChip: {
      maxWidth: 72,
      borderRadius: 999,
      borderWidth: 0.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      color: theme.textMuted,
      paddingHorizontal: 8,
      paddingVertical: 5,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
    },
    unreadBadge: {
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.gold,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 7,
    },
    unreadBadgeText: {
      color: theme.bg,
      fontSize: 10,
      fontWeight: '900',
    },
    moreButton: {
      position: 'absolute',
      top: 14,
      right: 14,
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 0.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 4,
    },
    moreText: {
      color: theme.gold,
      fontSize: 20,
      fontWeight: '900',
      marginTop: -4,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingBottom: 110,
    },
    emptyIcon: {
      fontSize: 34,
      marginBottom: 12,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 20,
      fontWeight: '900',
      marginBottom: 8,
      textAlign: 'center',
    },
    emptyText: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      fontWeight: '600',
    },
    emptyButton: {
      marginTop: 18,
      paddingHorizontal: 18,
      minHeight: 42,
      borderRadius: 21,
      backgroundColor: theme.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyButtonText: {
      color: '#171411',
      fontSize: 14,
      fontWeight: '900',
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.42)',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 28,
    },
    sheetHandle: {
      width: 42,
      height: 5,
      borderRadius: 3,
      alignSelf: 'center',
      backgroundColor: theme.border,
      marginBottom: 18,
    },
    sheetTitle: {
      color: theme.text,
      fontSize: 24,
      fontWeight: '900',
      marginBottom: 6,
    },
    sheetHint: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
      marginBottom: 18,
    },
    inputLabel: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 8,
      marginTop: 10,
    },
    input: {
      minHeight: 48,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.bg,
      color: theme.text,
      paddingHorizontal: 14,
      fontSize: 15,
      fontWeight: '600',
    },
    sheetActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 20,
    },
    cancelButton: {
      flex: 1,
      minHeight: 46,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButtonText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '900',
    },
    createButton: {
      flex: 1,
      minHeight: 46,
      borderRadius: 23,
      backgroundColor: theme.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createButtonDisabled: {
      opacity: 0.55,
    },
    createButtonText: {
      color: '#171411',
      fontSize: 14,
      fontWeight: '900',
    },
  });
}


