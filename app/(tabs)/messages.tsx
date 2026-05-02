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
import { BEContact, getContacts } from '../../src/utils/contacts-storage';
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


type Sheet = 'none' | 'new';

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

export default function MessagesScreen() {
  const { themeMode } = useIdentity();
  const theme = themeMode === 'light' ? Colors.light : Colors.dark;
  const s = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  const [threads, setThreads] = useState<DMThread[]>([]);
  const [contacts, setContacts] = useState<BEContact[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [profilePictures, setProfilePictures] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<Sheet>('none');
  const [search, setSearch] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newNpub, setNewNpub] = useState('');
  const [creating, setCreating] = useState(false);

  const loadingThreadsRef = useRef(false);
  const loadingProfilesRef = useRef(false);
  const pendingThreadReloadRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    } finally {
      loadingProfilesRef.current = false;
    }
  }, []);

  const loadData = useCallback(async () => {
    if (loadingThreadsRef.current) {
      pendingThreadReloadRef.current = true;
      return;
    }

    loadingThreadsRef.current = true;

    try {
      const t = await getDMThreads();

      setThreads(t);

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

      if (pendingThreadReloadRef.current) {
        pendingThreadReloadRef.current = false;
        setTimeout(() => {
          loadData();
        }, 100);
      }
    }
  }, [hydrateProfiles]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

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

  const closeSheet = () => {
    setSheet('none');
    setNewTitle('');
    setNewNpub('');
    setCreating(false);
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

  const createConversation = async (contact?: BEContact) => {
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
        participantNpub = normalized.npub;
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

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.headerEyebrow}>PRIVATE</Text>
          <Text style={s.headerTitle}>Messages</Text>
        </View>

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
        data={filteredThreads}
        keyExtractor={item => item.id}
        renderItem={renderThread}
        contentContainerStyle={[
          s.list,
          filteredThreads.length === 0 && s.listEmpty,
        ]}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>✉️</Text>
            <Text style={s.emptyTitle}>
              {threads.length === 0 ? 'No messages yet' : 'No matches'}
            </Text>
            <Text style={s.emptyHint}>
              {threads.length === 0
                ? 'Start a private conversation with a saved contact or npub.'
                : 'Try searching by name, message, or npub.'}
            </Text>

            {threads.length === 0 && (
              <TouchableOpacity style={s.emptyBtn} onPress={() => setSheet('new')}>
                <Text style={s.emptyBtnText}>Start conversation</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <TouchableOpacity style={s.fab} onPress={() => setSheet('new')} activeOpacity={0.85}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      <Modal visible={sheet !== 'none'} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={closeSheet} />

          <View style={s.sheet}>
            <View style={s.sheetHandle} />

            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>New message</Text>
                <Text style={s.sheetHint}>Choose a bE Contact or enter a Nostr npub.</Text>
              </View>

              <TouchableOpacity onPress={closeSheet} style={s.closeBtn}>
                <Text style={s.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            {contacts.length > 0 && (
              <>
                <Text style={s.sectionLabel}>CONTACTS</Text>

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
              </>
            )}

            <Text style={s.sectionLabel}>MANUAL</Text>

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
              placeholder="npub1… or hex pubkey"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={s.inputHelp}>
              Leave npub blank for a local-only notes conversation.
            </Text>

            <View style={s.sheetActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={closeSheet}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  s.confirmBtn,
                  creating && s.confirmBtnDisabled,
                ]}
                onPress={() => createConversation()}
                disabled={creating}
              >
                <Text style={s.confirmText}>
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

const createStyles = (theme: typeof Colors.dark) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerEyebrow: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  headerTitle: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
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
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 6,
    height: 44,
    borderRadius: 14,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
  },
  searchIcon: {
    color: theme.textMuted,
    fontSize: 18,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
  },

  list: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 110,
  },
  listEmpty: {
    flexGrow: 1,
  },

  threadRow: {
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 18,
    marginBottom: 4,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUnread: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
   avatarText: {
    color: theme.gold,
    fontSize: 17,
    fontWeight: '900',
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  threadBody: {
    flex: 1,
    minWidth: 0,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.surface,
    paddingBottom: 12,
  },
  threadTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  threadTitle: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    marginRight: 8,
  },
  threadTitleUnread: {
    color: theme.text,
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
  },
  threadPreview: {
    flex: 1,
    color: theme.textSecondary,
    fontSize: 13,
    marginRight: 8,
  },
  threadPreviewUnread: {
    color: theme.textSecondary,
    fontWeight: '700',
  },
  threadMetaSecure: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
  },
  threadMetaLocal: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
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
    color: theme.surface,
    fontSize: 11,
    fontWeight: '900',
  },
  moreBtn: {
    width: 28,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  sheetHandle: {
    width: 38,
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
    gap: 12,
    marginBottom: 16,
  },
  sheetTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  sheetHint: {
    color: theme.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontWeight: '800',
  },

  sectionLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  contactStrip: {
    marginBottom: 18,
  },
  contactPill: {
    width: 76,
    marginRight: 12,
    alignItems: 'center',
  },
  contactAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginBottom: 7,
  },
  contactAvatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  contactAvatarText: {
    color: theme.gold,
    fontSize: 15,
    fontWeight: '900',
  },
  contactName: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: 72,
  },
  contactSecure: {
    color: theme.gold,
    fontSize: 10,
    marginTop: 3,
  },
  contactLocal: {
    color: theme.textMuted,
    fontSize: 10,
    marginTop: 3,
    fontWeight: '700',
  },

  input: {
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: theme.text,
    fontSize: 15,
    marginBottom: 9,
  },
  inputHelp: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 13,
    borderWidth: 0.5,
    borderColor: theme.border,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cancelText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontWeight: '800',
  },
  confirmBtn: {
    flex: 1.8,
    borderRadius: 13,
    backgroundColor: theme.gold,
    paddingVertical: 13,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmText: {
    color: theme.surface,
    fontSize: 14,
    fontWeight: '900',
  },
});