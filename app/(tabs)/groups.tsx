import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BEHeader from '../../components/BEHeader';
import { Colors } from '../../src/constants/theme';
import { saveLocalGroupSystemMessage } from '../../src/utils/group-messages';
import {
  createGroup,
  getActiveGroups,
  getArchivedGroups,
  joinGroupByCode,
  type BEGroup
} from '../../src/utils/group-storage';
import {
  DEFAULT_RELAY,
  npubToHex,
  publishGroupMessage,
} from '../../src/utils/nostr';
import {
  registerGroupMemberForPush,
  sendRemoteGroupNotification,
} from '../../src/utils/push-notifications';
import { useIdentity } from '../_layout';

const GROUP_TYPE_ICONS: Record<string, string> = {
  softball: '🥎',
  baseball: '⚾',
  basketball: '🏀',
  football: '🏈',
  volleyball: '🏐',
  track: '🏃',
  crosscountry: '🏃',
  soccer: '⚽',
  wrestling: '🤼',
golf: '⛳',
tennis: '🎾',
swimming: '🏊',
cheer: '📣',
  band: '🎵',
  choir: '🎶',
  theater: '🎭',
  nhs: '🎓',
  class: '📚',
  booster: '⭐',
faculty: '🧑‍🏫',
staff: '🧑‍🏫',
teacher: '🧑‍🏫',
teachers: '🧑‍🏫',
default: '👥',
};

function normalizeGroupType(value?: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getGroupIcon(group: BEGroup): string {
  const customIcon = group.icon?.trim();

  if (customIcon) {
    return customIcon;
  }

  const directKey = normalizeGroupType(group.sport);

  if (directKey && GROUP_TYPE_ICONS[directKey]) {
    return GROUP_TYPE_ICONS[directKey];
  }

  const searchText = normalizeGroupType(`${group.name} ${group.description ?? ''}`);

  if (searchText.includes('faculty') || searchText.includes('teacher') || searchText.includes('staff')) {
    return GROUP_TYPE_ICONS.faculty;
  }

  if (searchText.includes('class')) {
    return GROUP_TYPE_ICONS.class;
  }

  if (searchText.includes('booster')) {
    return GROUP_TYPE_ICONS.booster;
  }

  return GROUP_TYPE_ICONS.default;
}

function formatGroupTime(unixSecs?: number): string {
  if (!unixSecs) return '';
  const date = new Date(unixSecs * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type Sheet = 'none' | 'create' | 'join';

export default function GroupsScreen() {
  const router = useRouter();
  const { npub, nsec, profile, themeMode } = useIdentity();

  const theme = themeMode === 'light' ? Colors.light : Colors.dark;
  const s = useMemo(() => createStyles(theme), [theme]);

  const [activeGroups, setActiveGroups] = useState<BEGroup[]>([]);
  const [archivedGroups, setArchivedGroups] = useState<BEGroup[]>([]);
  const [loadingInitialGroups, setLoadingInitialGroups] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [sheet, setSheet] = useState<Sheet>('none');

  // Create form
  const [cgName, setCgName] = useState('');
  const [cgSeason, setCgSeason] = useState('');
  const [cgSport, setCgSport] = useState('');
  const [cgIcon, setCgIcon] = useState('');
  const [cgDescription, setCgDescription] = useState('');
  const [cgSchool, setCgSchool] = useState('');
  const [creating, setCreating] = useState(false);

  // Join form
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const myDisplayName = useMemo(() => {
  return (
    profile?.display_name ||
    profile?.name ||
    (npub ? `${npub.slice(0, 12)}…` : 'You')
  );
}, [profile, npub]);

  // Swipe to close
  const sheetY = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderMove: (_, g) => { if (g.dy > 0) sheetY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(sheetY, { toValue: 600, duration: 200, useNativeDriver: true })
            .start(() => { sheetY.setValue(0); closeSheet(); });
        } else {
          Animated.spring(sheetY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const loadGroups = useCallback(async () => {
    try {
      const [active, archived] = await Promise.all([
        getActiveGroups(),
        getArchivedGroups(),
      ]);

      setActiveGroups(active);
      setArchivedGroups(archived);
    } catch (error) {
      console.warn('[Groups] failed to load groups:', error);
    } finally {
      setLoadingInitialGroups(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadGroups(); }, [loadGroups]));

  const closeSheet = () => {
    setSheet('none');
    setCgName(''); setCgSeason(''); setCgSport(''); setCgIcon('');
    setCgDescription(''); setCgSchool('');
    setJoinCode('');
  };

  const handleCreate = async () => {
    if (!cgName.trim()) { Alert.alert('Name required', 'Give your group a name.'); return; }
    if (!npub) { Alert.alert('Not signed in', 'Sign in to create a group.'); return; }
    setCreating(true);
    try {
      const pubkeyHex = npubToHex(npub);
      const group = await createGroup({
        name: cgName.trim(),
        description: cgDescription.trim() || undefined,
        season: cgSeason.trim() || undefined,
        sport: cgSport.trim() || undefined,
        icon: cgIcon.trim() || undefined,
        schoolId: cgSchool.trim() || undefined,
        relayUrl: DEFAULT_RELAY,
        ownerNpub: npub,
        ownerPubkeyHex: pubkeyHex,
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
  console.warn('[Groups] push member registration failed after create:', error);
});
      closeSheet();
      await loadGroups();
      router.push({ pathname: '/group-thread', params: { id: group.id } } as any);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not create group.');
    }
    setCreating(false);
  };

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 6) { Alert.alert('Invalid code', 'Enter the 6-character invite code.'); return; }
    if (!npub) { Alert.alert('Not signed in', 'Sign in to join a group.'); return; }
    setJoining(true);
    try {
      const pubkeyHex = npubToHex(npub);
      const result = await joinGroupByCode({
        code,
        npub,
        pubkeyHex,
        relayUrl: DEFAULT_RELAY,
        nsec: nsec ?? undefined,
      });
if (result.success && result.group) {
  registerGroupMemberForPush({
    groupId: result.group.id,
    groupName: result.group.name,
    relayUrl: result.group.relayUrl,
    memberNpub: npub,
    role: 'member',
    status: 'active',
    displayName: myDisplayName,
  }).catch(error => {
    console.warn('[Groups] push member registration failed after join:', error);
  });

  sendRemoteGroupNotification({
    groupId: result.group.id,
    groupName: result.group.name,
    relayUrl: result.group.relayUrl,
    senderNpub: npub,
    senderName: myDisplayName,
    body: 'joined the group',
  }).catch(error => {
    console.warn('[Groups] remote join notification failed:', error);
  });
  await saveLocalGroupSystemMessage({
  groupId: result.group.id,
  text: `${myDisplayName} joined the group`,
  systemType: 'join',
  actorNpub: npub,
  actorName: myDisplayName,
});

if (nsec) {
  publishGroupMessage({
    groupId: result.group.id,
    clientMessageId: `system_join_${result.group.id}_${npub}_${Date.now()}`,
    text: `${myDisplayName} joined the group`,
    kind: 'system',
    systemType: 'join',
    senderNpub: npub,
    senderName: myDisplayName,
    nsec,
    relayUrl: result.group.relayUrl,
  }).then(result => {
    if (!result.success) {
      console.warn('[Groups] publish join system message failed:', result.error);
    }
  }).catch(error => {
    console.warn('[Groups] publish join system message error:', error);
  });
}

  closeSheet();
  await loadGroups();
  router.push({ pathname: '/group-thread', params: { id: result.group.id } } as any);
} else {
  Alert.alert('Could not join', result.error ?? 'Invalid invite code.');
}
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not join group.');
    }
    setJoining(false);
  };

  function getRelayLabel(group: BEGroup): {
  text: string;
  icon: string;
  type: 'default' | 'custom' | 'both';
} {
  const mode = group.relayMode ?? 'default';

  if (mode === 'custom') return { text: 'Private', icon: '◆', type: 'custom' };
  if (mode === 'both') return { text: 'Both', icon: '↔', type: 'both' };
  return { text: 'bE', icon: '●', type: 'default' };
}
  
    const renderGroup = ({ item }: { item: BEGroup }) => {
    const relay = getRelayLabel(item);
    const preview =
      item.lastPostPreview ||
      `${item.memberCount ?? 0} member${(item.memberCount ?? 0) !== 1 ? 's' : ''}`;

    return (
      <TouchableOpacity
        style={[s.card, item.status === 'archived' && s.cardArchived]}
        activeOpacity={0.88}
        onPress={() => router.push({ pathname: '/group-thread', params: { id: item.id } } as any)}
      >
        <View style={[s.groupIcon, item.status === 'archived' && s.groupIconArchived]}>
          <Text style={s.groupIconText}>{getGroupIcon(item)}</Text>
        </View>

        <View style={s.cardBody}>
          <View style={s.cardTop}>
            <Text style={[s.groupName, item.status === 'archived' && s.groupNameArchived]} numberOfLines={1}>
              {item.name}
            </Text>
            {!!item.lastPostAt && <Text style={s.cardTime}>{formatGroupTime(item.lastPostAt)}</Text>}
          </View>

          <Text style={s.cardPreview} numberOfLines={1}>
            {preview}
          </Text>

          <View style={s.cardMetaRow}>
            {item.season && <Text style={s.seasonBadge}>{item.season}</Text>}

            <Text style={s.memberBadge}>
              {item.memberCount ?? 0} member{(item.memberCount ?? 0) !== 1 ? 's' : ''}
            </Text>

            <View
              style={[
                s.relayBadge,
                relay.type === 'custom' && s.relayBadgeCustom,
                relay.type === 'both' && s.relayBadgeBoth,
              ]}
            >
              <Text style={s.relayBadgeIcon}>{relay.icon}</Text>
              <Text style={s.relayBadgeText}>{relay.text}</Text>
            </View>

            {item.status === 'archived' && <Text style={s.archivedBadge}>Archived</Text>}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const GROUP_TYPES = [
    'softball',
    'baseball',
    'basketball',
    'football',
    'volleyball',
    'track',
    'soccer',
    'wrestling',
    'golf',
    'tennis',
    'cheer',
    'band',
    'choir',
    'theater',
    'nhs',
    'class',
    'booster',
    'faculty',
  ];

  const QUICK_ICONS = ['👥', '🧑‍🏫', '🏫', '📚', '⭐', '🏀', '🏈', '⚾', '🥎', '⚽', '🏐', '🎵', '🎭', '🤖', '✝️'];

  return (
    <SafeAreaView style={s.safe}>
      <BEHeader title="Groups" />

      <FlatList
        data={activeGroups}
        keyExtractor={g => g.id}
        contentContainerStyle={[
          s.list,
          (loadingInitialGroups || activeGroups.length === 0) && s.listEmpty,
        ]}
        ListEmptyComponent={
          loadingInitialGroups ? (
            <View style={s.empty}>
              <Text style={s.emptyHint}>Loading groups…</Text>
            </View>
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>👥</Text>
              <Text style={s.emptyTitle}>No groups yet</Text>
              <Text style={s.emptyHint}>
                Create a group for your team, class, or organization — or join one with an invite code.
              </Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => setSheet('create')}>
                <Text style={s.emptyBtnText}>Create a group</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.emptyBtnOutline} onPress={() => setSheet('join')}>
                <Text style={s.emptyBtnOutlineText}>Join with a code</Text>
              </TouchableOpacity>
            </View>
          )
        }
        ListFooterComponent={
          archivedGroups.length > 0 ? (
            <View style={s.archivedSection}>
              <TouchableOpacity
                style={s.archivedToggle}
                onPress={() => setShowArchived(v => !v)}
              >
                <Text style={s.archivedToggleText}>
                  {showArchived ? '▾' : '▸'} Past seasons ({archivedGroups.length})
                </Text>
              </TouchableOpacity>
              {showArchived && archivedGroups.map(g => (
                <View key={g.id}>{renderGroup({ item: g })}</View>
              ))}
            </View>
          ) : null
        }
        renderItem={renderGroup}
      />

      {/* FAB row — Create and Join */}
      <View style={s.fabRow}>
        <TouchableOpacity style={s.fabSecondary} onPress={() => setSheet('join')} activeOpacity={0.85}>
          <Text style={s.fabSecondaryText}>Join</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.fab} onPress={() => setSheet('create')} activeOpacity={0.85}>
          <Text style={s.fabIcon}>+</Text>
        </TouchableOpacity>
      </View>

      {/* ── Sheets ── */}
      <Modal visible={sheet !== 'none'} transparent animationType="slide" onRequestClose={closeSheet}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.overlay}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />

            {/* ── Create Group ── */}
            {sheet === 'create' && (
              <Animated.View style={[s.sheet, { transform: [{ translateY: sheetY }] }]}>
                <View style={s.sheetHandle} {...pan.panHandlers} />
                <Text style={s.sheetTitle}>Create Group</Text>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={s.inputLabel}>GROUP NAME *</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Varsity Softball, NHS, Boys Track…"
                    placeholderTextColor={theme.textMuted}
                    value={cgName}
                    onChangeText={setCgName}
                    autoFocus
                  />

                  <Text style={s.inputLabel}>SEASON (OPTIONAL)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. 2025-2026"
                    placeholderTextColor={theme.textMuted}
                    value={cgSeason}
                    onChangeText={setCgSeason}
                  />

                  <Text style={s.inputLabel}>ICON (OPTIONAL)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Type or paste an emoji, e.g. 🧑‍🏫"
                    placeholderTextColor={theme.textMuted}
                    value={cgIcon}
                    onChangeText={setCgIcon}
                    maxLength={4}
                  />

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sportPills}>
                    {QUICK_ICONS.map(icon => (
                      <TouchableOpacity
                        key={icon}
                        style={[s.iconPill, cgIcon === icon && s.sportPillActive]}
                        onPress={() => setCgIcon(cgIcon === icon ? '' : icon)}
                      >
                        <Text style={[s.iconPillText, cgIcon === icon && s.sportPillTextActive]}>
                          {icon}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={s.inputLabel}>TYPE (OPTIONAL)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sportPills}>
                    {GROUP_TYPES.map(sport => (
                      <TouchableOpacity
                        key={sport}
                        style={[s.sportPill, cgSport === sport && s.sportPillActive]}
                        onPress={() => setCgSport(cgSport === sport ? '' : sport)}
                      >
                        <Text style={[s.sportPillText, cgSport === sport && s.sportPillTextActive]}>
                          {GROUP_TYPE_ICONS[sport] ?? GROUP_TYPE_ICONS.default} {sport.charAt(0).toUpperCase() + sport.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={s.inputLabel}>SCHOOL / ORG (OPTIONAL)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Washington, Rush Springs…"
                    placeholderTextColor={theme.textMuted}
                    value={cgSchool}
                    onChangeText={setCgSchool}
                  />

                  <Text style={s.inputLabel}>DESCRIPTION (OPTIONAL)</Text>
                  <TextInput
                    style={[s.input, s.inputMulti]}
                    placeholder="What is this group for?"
                    placeholderTextColor={theme.textMuted}
                    value={cgDescription}
                    onChangeText={setCgDescription}
                    multiline
                    textAlignVertical="top"
                  />

                  <Text style={s.inputMeta}>
                    An invite code and QR code will be generated automatically. Share it with your group members.
                  </Text>

                  <View style={s.sheetActions}>
                    <TouchableOpacity style={s.cancelBtn} onPress={closeSheet}>
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.confirmBtn, !cgName.trim() && s.confirmBtnDim]}
                      onPress={handleCreate}
                      disabled={creating || !cgName.trim()}
                    >
                      <Text style={s.confirmText}>{creating ? 'Creating…' : 'Create group'}</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </Animated.View>
            )}

            {/* ── Join Group ── */}
            {sheet === 'join' && (
              <Animated.View style={[s.sheet, { transform: [{ translateY: sheetY }] }]}>
                <View style={s.sheetHandle} {...pan.panHandlers} />
                <Text style={s.sheetTitle}>Join a Group</Text>
                <Text style={s.sheetHint}>Enter the 6-character invite code from your coach or group admin.</Text>

                <Text style={s.inputLabel}>INVITE CODE</Text>
                <TextInput
                  style={[s.input, s.codeInput]}
                  placeholder="XXXXXX"
                  placeholderTextColor={theme.textMuted}
                  value={joinCode}
                  onChangeText={t => setJoinCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  autoFocus
                />

                <View style={s.sheetActions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={closeSheet}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.confirmBtn, joinCode.length < 6 && s.confirmBtnDim]}
                    onPress={handleJoin}
                    disabled={joining || joinCode.length < 6}
                  >
                    <Text style={s.confirmText}>{joining ? 'Joining…' : 'Join group'}</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: typeof Colors.dark) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  list: { padding: 20, paddingBottom: 100 },
  listEmpty: { flexGrow: 1 },

  // Empty state
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 16 },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyHint: { color: theme.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: { backgroundColor: theme.gold, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginBottom: 12, width: '100%', alignItems: 'center' },
  emptyBtnText: { color: theme.surface, fontWeight: '700', fontSize: 14 },
  emptyBtnOutline: { borderWidth: 0.5, borderColor: theme.gold, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, width: '100%', alignItems: 'center' },
  emptyBtnOutlineText: { color: theme.gold, fontWeight: '600', fontSize: 14 },

    // Group card
  card: {
    flexDirection: 'row',
    gap: 13,
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 15,
    marginBottom: 12,
  },
  cardArchived: {
    opacity: 0.58,
  },
  groupIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.raised,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.gold + '33',
  },
  groupIconArchived: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  groupIconText: {
    fontSize: 22,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  groupName: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    letterSpacing: -0.2,
  },
  groupNameArchived: {
    color: theme.textMuted,
  },
  cardTime: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  cardPreview: {
    color: theme.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 9,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  seasonBadge: {
    fontSize: 10,
    color: theme.gold,
    backgroundColor: theme.raised,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.gold + '55',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  memberBadge: {
    fontSize: 10,
    color: theme.textSecondary,
    backgroundColor: theme.bg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    fontWeight: '600',
  },
  archivedBadge: {
    fontSize: 10,
    color: theme.textMuted,
    backgroundColor: theme.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    fontWeight: '600',
  },
    relayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  relayBadgeIcon: {
    fontSize: 8,
    color: theme.textMuted,
  },
  relayBadgeText: {
    fontSize: 10,
    color: theme.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.25,
  },
  relayBadgeCustom: {
    borderColor: theme.gold + '55',
    backgroundColor: theme.raised,
  },
  relayBadgeBoth: {
    borderColor: theme.gold + '55',
    backgroundColor: theme.raised,
  },

  // Archived section
  archivedSection: { marginTop: 8 },
  archivedToggle: { paddingVertical: 12, paddingHorizontal: 4 },
  archivedToggleText: { color: theme.textMuted, fontSize: 13, fontWeight: '500' },

  // FABs
  fabRow: { position: 'absolute', bottom: 24, right: 24, flexDirection: 'row', gap: 12, alignItems: 'center' },
  fabSecondary: {
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28,
    borderWidth: 1.5, borderColor: theme.gold, backgroundColor: theme.bg,
  },
  fabSecondaryText: { color: theme.gold, fontWeight: '700', fontSize: 14 },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.gold,
    
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#c9973a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabIcon: { fontSize: 30, color: theme.surface, fontWeight: '300', lineHeight: 34 },

  // Sheet
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40, maxHeight: '90%',
  },
  sheetHandle: { width: 36, height: 4, backgroundColor: theme.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: theme.text, marginBottom: 6 },
  sheetHint: { fontSize: 13, color: theme.textMuted, lineHeight: 18, marginBottom: 20 },
  sportPills: { marginBottom: 6 },
  sportPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    marginRight: 8,
  },
  sportPillActive: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
    iconPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPillText: {
    fontSize: 20,
    color: theme.text,
  },
  sportPillText: {
    fontSize: 12,
    color: theme.text,
  },
  sportPillTextActive: {
    color: theme.bg,
    fontWeight: '600',
  },
  inputLabel: { fontSize: 11, color: theme.textMuted, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: theme.text,
    fontSize: 15,
    marginBottom: 4,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top', lineHeight: 22 },
  codeInput: { textAlign: 'center', fontSize: 28, fontWeight: '700', letterSpacing: 8 },
inputMeta: {
  fontSize: 11,
  color: theme.textMuted,
  marginTop: 8,
  marginBottom: 4,
  lineHeight: 17,
},
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
  },
  cancelText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBtn: {
    flex: 2,
    padding: 14,
    borderRadius: 12,
    backgroundColor: theme.gold,
    alignItems: 'center',
  },
  confirmBtnDim: { opacity: 0.5 },
  confirmText: {
    color: theme.bg,
    fontWeight: '700',
    fontSize: 14,
  },
});