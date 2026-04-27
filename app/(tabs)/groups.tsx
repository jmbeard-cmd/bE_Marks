import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
import {
  createGroup,
  getActiveGroups,
  getArchivedGroups,
  joinGroupByCode,
  type BEGroup
} from '../../src/utils/group-storage';
import { DEFAULT_RELAY, npubToHex } from '../../src/utils/nostr';
import { useIdentity } from '../_layout';

const SPORT_ICONS: Record<string, string> = {
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
  swimming: '🏊',
  cheer: '📣',
  band: '🎵',
  choir: '🎶',
  theater: '🎭',
  nhs: '🎓',
  class: '📚',
  booster: '⭐',
  faculty: '👩‍🏫',
  default: '👥',
};

function getGroupIcon(group: BEGroup): string {
  if (group.sport) {
    const key = group.sport.toLowerCase().replace(/\s/g, '');
    return SPORT_ICONS[key] ?? SPORT_ICONS.default;
  }
  return SPORT_ICONS.default;
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
  const { npub, nsec } = useIdentity();

  const [activeGroups, setActiveGroups] = useState<BEGroup[]>([]);
  const [archivedGroups, setArchivedGroups] = useState<BEGroup[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [sheet, setSheet] = useState<Sheet>('none');

  // Create form
  const [cgName, setCgName] = useState('');
  const [cgSeason, setCgSeason] = useState('');
  const [cgSport, setCgSport] = useState('');
  const [cgDescription, setCgDescription] = useState('');
  const [cgSchool, setCgSchool] = useState('');
  const [creating, setCreating] = useState(false);

  // Join form
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

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
    const [active, archived] = await Promise.all([
      getActiveGroups(),
      getArchivedGroups(),
    ]);
    setActiveGroups(active);
    setArchivedGroups(archived);
  }, []);

  useFocusEffect(useCallback(() => { loadGroups(); }, [loadGroups]));

  const closeSheet = () => {
    setSheet('none');
    setCgName(''); setCgSeason(''); setCgSport('');
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
        schoolId: cgSchool.trim() || undefined,
        relayUrl: DEFAULT_RELAY,
        ownerNpub: npub,
        ownerPubkeyHex: pubkeyHex,
        nsec: nsec ?? undefined,
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

  function getRelayLabel(group: BEGroup): { text: string; type: 'default' | 'custom' | 'both' } {
  const mode = group.relayMode ?? 'default';

  if (mode === 'custom') return { text: 'Private Relay', type: 'custom' };
  if (mode === 'both') return { text: 'bE + Private', type: 'both' };
  return { text: 'bE Relay', type: 'default' };
}
  
  const renderGroup = ({ item }: { item: BEGroup }) => (
    <TouchableOpacity
      style={[s.card, item.status === 'archived' && s.cardArchived]}
      activeOpacity={0.85}
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
          <Text style={s.cardTime}>{formatGroupTime(item.lastPostAt)}</Text>
        </View>
                <View style={s.cardMid}>
  {item.season && <Text style={s.seasonBadge}>{item.season}</Text>}

  <Text style={s.memberBadge}>
    {item.memberCount ?? 0} member{(item.memberCount ?? 0) !== 1 ? 's' : ''}
  </Text>

  {/* 🔥 Relay badge */}
  {(() => {
    const relay = getRelayLabel(item);
    return (
      <Text
        style={[
          s.relayBadge,
          relay.type === 'custom' && s.relayBadgeCustom,
          relay.type === 'both' && s.relayBadgeBoth,
        ]}
      >
        {relay.text}
      </Text>
    );
  })()}

  {item.status === 'archived' && <Text style={s.archivedBadge}>Archived</Text>}
</View>
        <Text style={s.cardPreview} numberOfLines={1}>
          {item.lastPostPreview || `${item.memberCount} member${item.memberCount !== 1 ? 's' : ''}`}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const SPORTS = ['softball', 'baseball', 'basketball', 'football', 'volleyball',
    'track', 'soccer', 'wrestling', 'golf', 'tennis', 'cheer', 'band', 'choir',
    'theater', 'nhs', 'class', 'booster', 'faculty'];

  return (
    <SafeAreaView style={s.safe}>
      <BEHeader title="Groups" />

      <FlatList
        data={activeGroups}
        keyExtractor={g => g.id}
        contentContainerStyle={[s.list, activeGroups.length === 0 && s.listEmpty]}
        ListEmptyComponent={
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
                    placeholderTextColor="#444"
                    value={cgName}
                    onChangeText={setCgName}
                    autoFocus
                  />

                  <Text style={s.inputLabel}>SEASON (OPTIONAL)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. 2025-2026"
                    placeholderTextColor="#444"
                    value={cgSeason}
                    onChangeText={setCgSeason}
                  />

                  <Text style={s.inputLabel}>TYPE (OPTIONAL)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sportPills}>
                    {SPORTS.map(sport => (
                      <TouchableOpacity
                        key={sport}
                        style={[s.sportPill, cgSport === sport && s.sportPillActive]}
                        onPress={() => setCgSport(cgSport === sport ? '' : sport)}
                      >
                        <Text style={[s.sportPillText, cgSport === sport && s.sportPillTextActive]}>
                          {SPORT_ICONS[sport] ?? '👥'} {sport.charAt(0).toUpperCase() + sport.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={s.inputLabel}>SCHOOL / ORG (OPTIONAL)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Washington, Rush Springs…"
                    placeholderTextColor="#444"
                    value={cgSchool}
                    onChangeText={setCgSchool}
                  />

                  <Text style={s.inputLabel}>DESCRIPTION (OPTIONAL)</Text>
                  <TextInput
                    style={[s.input, s.inputMulti]}
                    placeholder="What is this group for?"
                    placeholderTextColor="#444"
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
                  placeholderTextColor="#444"
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  list: { padding: 20, paddingBottom: 100 },
  listEmpty: { flexGrow: 1 },

  // Empty state
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: { backgroundColor: '#c9973a', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginBottom: 12, width: '100%', alignItems: 'center' },
  emptyBtnText: { color: '#111', fontWeight: '700', fontSize: 14 },
  emptyBtnOutline: { borderWidth: 0.5, borderColor: '#c9973a', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, width: '100%', alignItems: 'center' },
  emptyBtnOutlineText: { color: '#c9973a', fontWeight: '600', fontSize: 14 },

  // Group card
  card: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#222',
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  cardArchived: { opacity: 0.6 },
  groupIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#2a1e00', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#c9973a33',
  },
  groupIconArchived: { backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' },
  groupIconText: { fontSize: 22 },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  groupName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  groupNameArchived: { color: '#555' },
  cardTime: { color: '#444', fontSize: 11 },
  cardMid: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  seasonBadge: { fontSize: 10, color: '#c9973a', backgroundColor: '#1e1600', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, borderWidth: 0.5, borderColor: '#3a2800' },
    memberBadge: { fontSize: 10, color: '#aaa', backgroundColor: '#111', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a' },
  archivedBadge: { fontSize: 10, color: '#444', backgroundColor: '#1a1a1a', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a' },

relayBadge: {
  fontSize: 10,
  color: '#aaa',
  backgroundColor: '#111',
  paddingHorizontal: 7,
  paddingVertical: 2,
  borderRadius: 10,
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
},

relayBadgeCustom: {
  color: '#6b5cff',
  borderColor: '#6b5cff33',
  backgroundColor: '#151433',
},

relayBadgeBoth: {
  color: '#c9973a',
  borderColor: '#c9973a55',
  backgroundColor: '#1e1600',
},
  cardPreview: { color: '#555', fontSize: 13 },

  // Archived section
  archivedSection: { marginTop: 8 },
  archivedToggle: { paddingVertical: 12, paddingHorizontal: 4 },
  archivedToggleText: { color: '#444', fontSize: 13, fontWeight: '500' },

  // FABs
  fabRow: { position: 'absolute', bottom: 24, right: 24, flexDirection: 'row', gap: 12, alignItems: 'center' },
  fabSecondary: {
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28,
    borderWidth: 1.5, borderColor: '#c9973a', backgroundColor: '#111',
  },
  fabSecondaryText: { color: '#c9973a', fontWeight: '700', fontSize: 14 },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#c9973a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabIcon: { fontSize: 30, color: '#111', fontWeight: '300', lineHeight: 34 },

  // Sheet
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a1a', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40, maxHeight: '90%',
  },
  sheetHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 6 },
  sheetHint: { fontSize: 13, color: '#555', lineHeight: 18, marginBottom: 20 },
  sportPills: { marginBottom: 6 },
  sportPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#111', marginRight: 8 },
  sportPillActive: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  sportPillText: { fontSize: 12, color: '#666' },
  sportPillTextActive: { color: '#111', fontWeight: '600' },
  inputLabel: { fontSize: 11, color: '#555', fontWeight: '600', letterSpacing: 0.8, marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: '#111', borderWidth: 0.5, borderColor: '#2a2a2a',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    color: '#fff', fontSize: 15, marginBottom: 4,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top', lineHeight: 22 },
  codeInput: { textAlign: 'center', fontSize: 28, fontWeight: '700', letterSpacing: 8 },
  inputMeta: { fontSize: 11, color: '#444', marginTop: 8, marginBottom: 4, lineHeight: 17 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  cancelText: { color: '#555', fontSize: 14, fontWeight: '500' },
  confirmBtn: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#c9973a', alignItems: 'center' },
  confirmBtnDim: { opacity: 0.5 },
  confirmText: { color: '#111', fontWeight: '700', fontSize: 14 },
});