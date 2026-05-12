import * as Clipboard from 'expo-clipboard';
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
import {
  getCachedDMThreadCards,
  saveCachedDMThreadCards,
} from '../../src/utils/dm-thread-list-cache';
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
  const { theme } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  const [threads, setThreads] = useState<DMThread[]>([]);
  const [loadingInitialThreads, setLoadingInitialThreads] = useState(true);
  const [contacts, setContacts] = useState<BEContact[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [profilePictures, setProfilePictures] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<Sheet>('none');
  const [search, setSearch] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newNpub, setNewNpub] = useState('');
  const [creating, setCreating] = useState(false);

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
          loadingInitialThreads ? (
            <View style={s.empty}>
              <Text style={s.emptyHint}>Loading messages…</Text>
            </View>
          ) : (
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
          )
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
                <Text style={s.sheetHint}>Find someone by npub or NIP-05, then start a private DM.</Text>
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 20,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  avatar: {
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
  avatarUnread: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  avatarText: {
    color: theme.gold,
    fontSize: 16,
    fontWeight: '900',
  },
  avatarImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  threadBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2,
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
    fontWeight: '800',
    marginRight: 8,
  },
  threadTitleUnread: {
    color: theme.text,
    fontWeight: '900',
  },
  threadTime: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  threadBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 21,
  },
  threadPreview: {
    flex: 1,
    color: theme.textMuted,
    fontSize: 13,
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
    fontSize: 10,
    fontWeight: '800',
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.raised,
  },
  threadMetaLocal: {
    alignSelf: 'flex-start',
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
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