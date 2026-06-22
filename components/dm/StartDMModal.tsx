import { Ionicons } from '@expo/vector-icons';
import { nip19 } from 'nostr-tools';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions, 
    View,
} from 'react-native';
import { Colors } from '../../src/constants/theme';
import { getContacts } from '../../src/utils/contacts-storage';
import { getDMThreads } from '../../src/utils/dm-storage';
import {
    getGroupMembers,
    getGroups,
} from '../../src/utils/group-storage';

type Theme = typeof Colors.dark;

export type DMDiscoverySource =
  | 'contact'
  | 'space'
  | 'recent'
  | 'relay'
  | 'private-relay'
  | 'qr';

export type DMDiscoveryPerson = {
  id: string;
  source: DMDiscoverySource;
  displayName: string;
  npub?: string;
  pubkeyHex?: string;
  avatarUrl?: string;
  subtitle?: string;
  relayUrl?: string;
};

type StartDMModalProps = {
  visible: boolean;
  theme: Theme;
  currentNpub?: string | null;
  busyPersonId?: string | null;
  onClose: () => void;
  onSelectPerson: (person: DMDiscoveryPerson) => void;
};

const SOURCE_PRIORITY: Record<DMDiscoverySource, number> = {
  contact: 0,
  space: 1,
  recent: 2,
  relay: 3,
  'private-relay': 4,
  qr: 5,
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function getSourceLabel(source: DMDiscoverySource): string {
  if (source === 'contact') return 'Contact';
  if (source === 'space') return 'Space';
  if (source === 'recent') return 'Recent';
  if (source === 'relay') return 'bE Relay';
  if (source === 'private-relay') return 'Private Relay';
  return 'QR';
}

function getPersonKey(person: DMDiscoveryPerson): string {
  const pubkey = person.pubkeyHex?.trim().toLowerCase();
  if (pubkey) return `pubkey:${pubkey}`;

  const npub = person.npub?.trim().toLowerCase();
  if (npub) return `npub:${npub}`;

  return `${person.source}:${person.id}`;
}

function normalizeIdentityValue(value?: string | null): string {
  return value?.trim().toLowerCase() || '';
}

function getCurrentIdentityKeys(currentNpub?: string | null): {
  currentNpub: string;
  currentPubkeyHex: string;
} {
  const normalizedNpub = normalizeIdentityValue(currentNpub);

  if (!normalizedNpub) {
    return {
      currentNpub: '',
      currentPubkeyHex: '',
    };
  }

  try {
    const decoded = nip19.decode(normalizedNpub);

    if (decoded.type === 'npub' && typeof decoded.data === 'string') {
      return {
        currentNpub: normalizedNpub,
        currentPubkeyHex: decoded.data.toLowerCase(),
      };
    }
  } catch {}

  return {
    currentNpub: normalizedNpub,
    currentPubkeyHex: '',
  };
}

function isCurrentUserDiscoveryPerson(
  person: DMDiscoveryPerson,
  currentKeys: {
    currentNpub: string;
    currentPubkeyHex: string;
  }
): boolean {
  const personNpub = normalizeIdentityValue(person.npub);
  const personPubkeyHex = normalizeIdentityValue(person.pubkeyHex);

  return (
    (!!currentKeys.currentNpub && personNpub === currentKeys.currentNpub) ||
    (!!currentKeys.currentPubkeyHex && personPubkeyHex === currentKeys.currentPubkeyHex)
  );
}

function mergePeople(people: DMDiscoveryPerson[]): DMDiscoveryPerson[] {
  const byKey = new Map<string, DMDiscoveryPerson>();

  for (const person of people) {
    const key = getPersonKey(person);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, person);
      continue;
    }

    const existingPriority = SOURCE_PRIORITY[existing.source];
    const nextPriority = SOURCE_PRIORITY[person.source];

    if (nextPriority < existingPriority) {
      byKey.set(key, {
        ...person,
        avatarUrl: person.avatarUrl || existing.avatarUrl,
        subtitle: person.subtitle || existing.subtitle,
      });
    } else if (!existing.avatarUrl && person.avatarUrl) {
      byKey.set(key, {
        ...existing,
        avatarUrl: person.avatarUrl,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const sourceDiff = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];

    if (sourceDiff !== 0) return sourceDiff;

    return a.displayName.localeCompare(b.displayName);
  });
}

export default function StartDMModal({
  visible,
  theme,
  currentNpub,
  busyPersonId,
  onClose,
  onSelectPerson,
}: StartDMModalProps) {
  const s = useMemo(() => createStyles(theme), [theme]);
  const { height: windowHeight } = useWindowDimensions();
  const currentIdentityKeys = useMemo(
    () => getCurrentIdentityKeys(currentNpub),
    [currentNpub]
  );
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<DMDiscoveryPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  const keyboardOpen = keyboardInset > 0;
  const queryActive = query.trim().length > 0;

  const sheetTopGap = keyboardOpen ? 18 : 78;
  const sheetBottomGap = keyboardOpen ? keyboardInset + 10 : 0;
  const fullPickerHeight = Math.max(
    420,
    windowHeight - sheetTopGap - sheetBottomGap
  );

  const loadDiscoveryPeople = useCallback(async () => {
    setLoading(true);

    try {
      const [contacts, groups, recentThreads] = await Promise.all([
        getContacts(),
        getGroups(),
        getDMThreads(),
      ]);

      const nextPeople: DMDiscoveryPerson[] = [];

      contacts.forEach(contact => {
        if (!contact.npub && !contact.pubkeyHex) return;

        const person: DMDiscoveryPerson = {
          id: `contact_${contact.id}`,
          source: 'contact',
          displayName: contact.nostrName || contact.name,
          npub: contact.npub,
          pubkeyHex: contact.pubkeyHex,
          avatarUrl: contact.nostrAvatar,
          subtitle: 'Saved bE Contact',
        };

        if (isCurrentUserDiscoveryPerson(person, currentIdentityKeys)) return;

        nextPeople.push(person);
      });

      const activeGroups = groups.filter(group => group.status === 'active');

      const groupMemberSets = await Promise.all(
        activeGroups.map(async group => ({
          group,
          members: await getGroupMembers(group.id),
        }))
      );

      groupMemberSets.forEach(({ group, members }) => {
        members.forEach(member => {
          const memberNpub = member.npub?.trim();

          if (!memberNpub) return;

          const person: DMDiscoveryPerson = {
            id: `space_${group.id}_${member.id}`,
            source: 'space',
            displayName:
              member.displayName?.trim() ||
              `${memberNpub.slice(0, 12)}…`,
            npub: memberNpub,
            pubkeyHex: member.pubkeyHex,
            avatarUrl: member.avatarUrl,
            subtitle: `Member of ${group.name}`,
            relayUrl: group.relayUrl,
          };

          if (isCurrentUserDiscoveryPerson(person, currentIdentityKeys)) return;

          nextPeople.push(person);
        });
      });

      recentThreads.forEach(thread => {
        if (!thread.participantPubkey && !thread.participantNpub) return;

        const person: DMDiscoveryPerson = {
          id: `recent_${thread.id}`,
          source: 'recent',
          displayName: thread.title || 'Recent DM',
          npub: thread.participantNpub,
          pubkeyHex: thread.participantPubkey,
          subtitle: 'Recent DM',
        };

        if (isCurrentUserDiscoveryPerson(person, currentIdentityKeys)) return;

        nextPeople.push(person);
      });

      setPeople(mergePeople(nextPeople));
    } catch (error) {
      console.warn('[Start DM] failed to load discovery people:', error);
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [currentIdentityKeys]);

  useEffect(() => {
    if (!visible) return;

    setQuery('');
    loadDiscoveryPeople();
  }, [loadDiscoveryPeople, visible]);

    useEffect(() => {
    if (!visible) {
      setKeyboardInset(0);
      return;
    }

    const showSub = Keyboard.addListener('keyboardDidShow', event => {
      setKeyboardInset(event.endCoordinates?.height ?? 0);
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardInset(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const filteredPeople = useMemo(() => {
    const clean = query.trim().toLowerCase();

    if (!clean) return people;

    return people.filter(person => {
      const haystack = [
        person.displayName,
        person.subtitle,
        getSourceLabel(person.source),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(clean);
    });
  }, [people, query]);

  const showRelayDiscoveryNotice = useCallback(() => {
    Alert.alert(
      'Relay discovery next',
      'People discoverable on bE Relay will appear here after the relay people index is wired.'
    );
  }, []);

  const showQRNotice = useCallback(() => {
    Alert.alert(
      'QR contact cards next',
      'QR scanning will let someone share their bE contact card without typing keys.'
    );
  }, []);

  const renderPerson = ({ item }: { item: DMDiscoveryPerson }) => {
    const busy = busyPersonId === item.id;
    const sourceLabel = getSourceLabel(item.source);

    return (
      <TouchableOpacity
        style={s.personRow}
        onPress={() => onSelectPerson(item)}
        disabled={!!busyPersonId}
        activeOpacity={0.84}
      >
        <View style={s.avatar}>
          {item.avatarUrl ? (
            <Image source={{ uri: item.avatarUrl }} style={s.avatarImage} />
          ) : (
            <Text style={s.avatarText}>{getInitials(item.displayName)}</Text>
          )}
        </View>

        <View style={s.personBody}>
          <Text style={s.personName} numberOfLines={1}>
            {item.displayName}
          </Text>

          <Text style={s.personSubtitle} numberOfLines={1}>
            {item.subtitle || sourceLabel}
          </Text>

          <View style={s.personMetaRow}>
            <Text style={s.sourceChip}>{sourceLabel}</Text>
            {!!item.pubkeyHex && <Text style={s.secureChip}>DM ready</Text>}
          </View>
        </View>

        {busy ? (
          <ActivityIndicator size="small" color={theme.gold} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.modalOverlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />

        <KeyboardAvoidingView
          style={s.keyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <View
            style={[
              s.sheet,
              {
                height: fullPickerHeight,
                maxHeight: fullPickerHeight,
                marginTop: sheetTopGap,
                marginBottom: sheetBottomGap,
              },
            ]}
          >
          <View style={s.sheetHandle} />

          <View style={s.headerRow}>
            <View style={s.headerTextBlock}>
              <Text style={s.sheetTitle}>Start DM</Text>
              <Text style={s.sheetHint}>
                Find a contact, Space member, or discoverable relay profile.
              </Text>
            </View>

            <TouchableOpacity
              style={s.closeButton}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={22} color={theme.gold} />
            </TouchableOpacity>
          </View>

          <View style={s.searchWrap}>
            <Ionicons name="search" size={18} color={theme.textMuted} />
            <TextInput
              style={s.searchInput}
              placeholder="Search people"
              placeholderTextColor={theme.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={theme.gold}
            />
          </View>

          {!keyboardOpen && !queryActive && (
            <View style={s.discoveryActions}>
              <TouchableOpacity
                style={s.discoveryCard}
                onPress={showRelayDiscoveryNotice}
                activeOpacity={0.84}
              >
                <View style={s.discoveryIcon}>
                  <Ionicons name="radio-outline" size={20} color={theme.gold} />
                </View>
                <View style={s.discoveryTextBlock}>
                  <Text style={s.discoveryTitle}>People on bE Relay</Text>
                  <Text style={s.discoveryHint}>Discoverable relay profiles</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.discoveryCard}
                onPress={showQRNotice}
                activeOpacity={0.84}
              >
                <View style={s.discoveryIcon}>
                  <Ionicons name="qr-code-outline" size={20} color={theme.gold} />
                </View>
                <View style={s.discoveryTextBlock}>
                  <Text style={s.discoveryTitle}>Scan QR</Text>
                  <Text style={s.discoveryHint}>No key typing</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={theme.gold} />
              <Text style={s.loadingText}>Finding people…</Text>
            </View>
          ) : (
            <FlatList
              data={filteredPeople}
              keyExtractor={item => item.id}
              renderItem={renderPerson}
              style={s.peopleList}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                s.listContent,
                keyboardOpen && s.listContentKeyboard,
              ]}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>
                    {query.trim() ? 'No matching people' : 'No people found yet'}
                  </Text>
                  <Text style={s.emptyText}>
                    {query.trim()
                      ? 'Try another name or look in your Spaces.'
                      : 'Add contacts, join Spaces, or use QR/relay discovery next.'}
                  </Text>
                </View>
              }
            />
          )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.42)',
    },
        backdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    keyboardAvoider: {
      flex: 1,
      width: '100%',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 22,
    },
    sheetHandle: {
      width: 42,
      height: 5,
      borderRadius: 3,
      alignSelf: 'center',
      backgroundColor: theme.border,
      marginBottom: 16,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 14,
    },
    headerTextBlock: {
      flex: 1,
      minWidth: 0,
    },
    sheetTitle: {
      color: theme.text,
      fontSize: 26,
      fontWeight: '900',
      marginBottom: 5,
    },
    sheetHint: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    closeButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.raised,
      borderWidth: 0.5,
      borderColor: theme.border,
    },
    searchWrap: {
      minHeight: 46,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.bg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
      paddingVertical: 10,
    },
    discoveryActions: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 14,
    },
    discoveryCard: {
      flex: 1,
      minHeight: 68,
      borderRadius: 18,
      borderWidth: 0.7,
      borderColor: theme.border,
      backgroundColor: theme.raised,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    discoveryIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 0.5,
      borderColor: theme.border,
    },
    discoveryTextBlock: {
      flex: 1,
      minWidth: 0,
    },
    discoveryTitle: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '900',
    },
    discoveryHint: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
      marginTop: 2,
    },
    loadingWrap: {
      minHeight: 220,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    loadingText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    peopleList: {
      flex: 1,
      minHeight: 0,
    },
    listContent: {
      paddingBottom: 8,
    },
    listContentKeyboard: {
      paddingBottom: 24,
    },
    personRow: {
      minHeight: 78,
      borderRadius: 18,
      borderWidth: 0.7,
      borderColor: theme.border,
      backgroundColor: theme.bg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.raised,
      borderWidth: 0.7,
      borderColor: `${theme.gold}45`,
      overflow: 'hidden',
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      color: theme.gold,
      fontSize: 17,
      fontWeight: '900',
    },
    personBody: {
      flex: 1,
      minWidth: 0,
    },
    personName: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '900',
      marginBottom: 3,
    },
    personSubtitle: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 7,
    },
    personMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sourceChip: {
      color: theme.gold,
      backgroundColor: theme.raised,
      borderWidth: 0.5,
      borderColor: theme.border,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
    },
    secureChip: {
      color: theme.textMuted,
      backgroundColor: theme.raised,
      borderWidth: 0.5,
      borderColor: theme.border,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
    },
    empty: {
      minHeight: 190,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '900',
      marginBottom: 8,
      textAlign: 'center',
    },
    emptyText: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '700',
      textAlign: 'center',
    },
  });
}