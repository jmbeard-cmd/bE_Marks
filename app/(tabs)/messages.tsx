import { useFocusEffect, useRouter } from 'expo-router';
import { nip19 } from 'nostr-tools';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const { theme } = useIdentity();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  const [threads, setThreads] = useState<DMThread[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [profilePictures, setProfilePictures] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [composerVisible, setComposerVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newNpub, setNewNpub] = useState('');
  const [creating, setCreating] = useState(false);

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
    setNewTitle('');
    setNewNpub('');
    setCreating(false);
  }, []);

  const handleCreateThread = useCallback(async () => {
    if (creating) return;

    const titleInput = newTitle.trim();
    const npubInput = newNpub.trim();

    if (!titleInput && !npubInput) {
      Alert.alert('DM info needed', 'Enter a name, npub, or hex pubkey to start a DM.');
      return;
    }

    setCreating(true);

    try {
      let participantPubkey: string | undefined;
      let participantNpub: string | undefined;
      let title = titleInput || 'New DM';

      if (npubInput) {
        const normalized = normalizeNostrIdentity(npubInput);
        participantPubkey = normalized.pubkey;
        participantNpub = normalized.npub || nip19.npubEncode(normalized.pubkey);

        if (!titleInput) {
          title = `${participantNpub.slice(0, 14)}…`;
        }
      }

      const thread = await createThread({
        title,
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
          : 'Please enter a valid npub or hex pubkey.'
      );
      setCreating(false);
    }
  }, [closeComposer, creating, loadThreads, newNpub, newTitle, openThread]);

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
        activeOpacity={0.84}
        onPress={() => openThread(item)}
        onLongPress={() => handleDeleteThread(item)}
      >
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

            <Text style={styles.threadTime}>{formatThreadTime(item.updatedAt)}</Text>
          </View>

          <View style={styles.threadBottom}>
            <Text style={[styles.threadPreview, hasUnread && styles.threadPreviewUnread]} numberOfLines={1}>
              {item.lastMessage || (encrypted ? 'Encrypted DM' : 'Local DM')}
            </Text>

            {hasUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {item.unread > 99 ? '99+' : item.unread}
                </Text>
              </View>
            )}
          </View>

          <Text style={encrypted ? styles.threadMetaSecure : styles.threadMetaLocal} numberOfLines={1}>
            {encrypted ? '🔒 Nostr encrypted' : 'Local only — add npub to sync'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.moreButton}
          onPress={() => handleDeleteThread(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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

        <TouchableOpacity
          style={styles.newButton}
          onPress={() => setComposerVisible(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.newButtonText}>＋</Text>
        </TouchableOpacity>
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
                  ? 'Try a different name, npub, or message preview.'
                  : 'Start a private conversation with a saved contact, npub, or hex pubkey.'}
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

      <Modal
        visible={composerVisible}
        transparent
        animationType="slide"
        onRequestClose={closeComposer}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeComposer} />

          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetTitle}>New DM</Text>
            <Text style={styles.sheetHint}>
              Add an npub or hex pubkey to make this a synced encrypted Nostr DM.
            </Text>

            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="DM name"
              placeholderTextColor={theme.textMuted}
              value={newTitle}
              onChangeText={setNewTitle}
              selectionColor={theme.gold}
            />

            <Text style={styles.inputLabel}>npub or hex pubkey</Text>
            <TextInput
              style={styles.input}
              placeholder="npub1… or hex pubkey"
              placeholderTextColor={theme.textMuted}
              value={newNpub}
              onChangeText={setNewNpub}
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={theme.gold}
            />

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={closeComposer}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.createButton, creating && styles.createButtonDisabled]}
                onPress={handleCreateThread}
                disabled={creating}
                activeOpacity={0.85}
              >
                <Text style={styles.createButtonText}>
                  {creating ? 'Starting…' : 'Start'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    newButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: theme.gold,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 7,
    },
    newButtonText: {
      color: '#171411',
      fontSize: 28,
      fontWeight: '800',
      marginTop: -2,
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
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      marginBottom: 10,
    },
    threadRowUnread: {
      borderColor: theme.gold,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.bg,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    avatarUnread: {
      borderColor: theme.gold,
    },
    avatarImage: {
      width: 50,
      height: 50,
      borderRadius: 25,
    },
    avatarText: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '900',
    },
    threadBody: {
      flex: 1,
      minWidth: 0,
    },
    threadTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    threadTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
    },
    threadTitleUnread: {
      fontWeight: '900',
    },
    threadTime: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    threadBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    threadPreview: {
      flex: 1,
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    threadPreviewUnread: {
      color: theme.text,
      fontWeight: '800',
    },
    unreadBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: theme.gold,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    unreadBadgeText: {
      color: '#171411',
      fontSize: 11,
      fontWeight: '900',
    },
    threadMetaSecure: {
      color: theme.gold,
      fontSize: 11,
      fontWeight: '800',
      marginTop: 5,
    },
    threadMetaLocal: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
      marginTop: 5,
    },
    moreButton: {
      width: 28,
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moreText: {
      color: theme.textMuted,
      fontSize: 24,
      fontWeight: '800',
      marginTop: -6,
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


