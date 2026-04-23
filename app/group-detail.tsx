import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    FlatList,
    Image,
    RefreshControl,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    archiveGroup,
    getGroupById,
    getGroupMembers,
    isGroupAdmin,
    isGroupMember,
    regenerateInviteCode,
    removeMember,
    updateMemberRole,
    type BEGroup,
    type BEGroupMember,
} from '../src/utils/group-storage';
import { useIdentity } from './_layout';

type Tab = 'timeline' | 'gallery' | 'members';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { npub } = useIdentity();

  const [group, setGroup] = useState<BEGroup | null>(null);
  const [members, setMembers] = useState<BEGroupMember[]>([]);
  const [tab, setTab] = useState<Tab>('timeline');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [g, m] = await Promise.all([
      getGroupById(id),
      getGroupMembers(id),
    ]);
    setGroup(g);
    setMembers(m);
    if (npub && g) {
      const [admin, member] = await Promise.all([
        isGroupAdmin(id, npub),
        isGroupMember(id, npub),
      ]);
      setIsAdmin(admin);
      setIsMember(member);
    }
  }, [id, npub]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleShareInvite = async () => {
    if (!group) return;
    const deepLink = `marksapp://join/${group.inviteCode}`;
    try {
      await Share.share({
        message: `Join "${group.name}" on bE Marks!\n\nInvite code: ${group.inviteCode}\n\nOr tap: ${deepLink}`,
        title: `Join ${group.name}`,
      });
    } catch {}
  };

  const handleCopyCode = async () => {
    if (!group) return;
    await Clipboard.setStringAsync(group.inviteCode);
    Alert.alert('Copied', 'Invite code copied to clipboard.');
  };

  const handleRegenerateCode = () => {
    Alert.alert(
      'Regenerate invite code?',
      'The old code will stop working immediately. Share the new code with your group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate', onPress: async () => {
            if (!group) return;
            const newCode = await regenerateInviteCode(group.id);
            await load();
            Alert.alert('New code ready', `Your new invite code is: ${newCode}`);
          }
        }
      ]
    );
  };

  const handleArchive = () => {
    Alert.alert(
      'Archive this group?',
      'Members can still view past posts but no new posts will be allowed. You can start a new season anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive', style: 'destructive', onPress: async () => {
            if (!group) return;
            await archiveGroup(group.id);
            await load();
          }
        }
      ]
    );
  };

  const handleRemoveMember = (member: BEGroupMember) => {
    if (!npub) return;
    Alert.alert(
      `Remove ${member.displayName || member.npub.slice(0, 12)}?`,
      'Their past posts will remain but they will no longer be able to view or post in this group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            if (!group) return;
            await removeMember(group.id, member.npub, npub);
            await load();
          }
        }
      ]
    );
  };

  const handlePromoteAdmin = (member: BEGroupMember) => {
    Alert.alert(
      `Make ${member.displayName || 'this member'} an admin?`,
      'They will be able to manage members and the invite code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make admin', onPress: async () => {
            if (!group) return;
            await updateMemberRole(group.id, member.npub, 'admin');
            await load();
          }
        }
      ]
    );
  };

  if (!group) return (
    <SafeAreaView style={s.safe}>
      <View style={s.loading}>
        <Text style={s.loadingText}>Loading…</Text>
      </View>
    </SafeAreaView>
  );

  const deepLink = `marksapp://join/${group.inviteCode}`;

  return (
    <SafeAreaView style={s.safe}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/groups' as any);
          }}
          style={s.backBtn}
        >
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{group.name}</Text>
          {group.season && <Text style={s.headerSub}>{group.season}</Text>}
        </View>
        {isAdmin && (
          <TouchableOpacity style={s.inviteBtn} onPress={() => setShowInvite(v => !v)}>
            <Text style={s.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        )}
        {!isAdmin && <View style={{ width: 50 }} />}
      </View>

      {/* Invite panel — slides in when admin taps Invite */}
      {showInvite && isAdmin && (
        <View style={s.invitePanel}>
          <View style={s.invitePanelTop}>
            <View style={s.inviteCodeBlock}>
              <Text style={s.inviteCodeLabel}>INVITE CODE</Text>
              <Text style={s.inviteCode}>{group.inviteCode}</Text>
              <View style={s.inviteCodeActions}>
                <TouchableOpacity style={s.inviteCodeBtn} onPress={handleCopyCode}>
                  <Text style={s.inviteCodeBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.inviteCodeBtn} onPress={handleShareInvite}>
                  <Text style={s.inviteCodeBtnText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.inviteCodeBtn, s.inviteCodeBtnDanger]} onPress={handleRegenerateCode}>
                  <Text style={[s.inviteCodeBtnText, { color: '#c00' }]}>Regenerate</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={s.qrBlock}>
              <QRCode
                value={deepLink}
                size={100}
                backgroundColor="#1a1a1a"
                color="#c9973a"
              />
            </View>
          </View>
          <Text style={s.inviteMeta}>
            Members scan the QR or enter the code in Groups → Join. Regenerate if it gets shared with the wrong people.
          </Text>
        </View>
      )}

      {/* Tab bar */}
      <View style={s.tabRow}>
        {(['timeline', 'gallery', 'members'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tabBtn, tab === t && s.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'timeline' ? 'Posts' : t === 'gallery' ? 'Gallery' : `Members (${members.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Timeline tab */}
      {tab === 'timeline' && (
        <ScrollView
          contentContainerStyle={s.timelineContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c9973a" />}
        >
          {group.status === 'archived' && (
            <View style={s.archivedBanner}>
              <Text style={s.archivedBannerText}>
                📦 This group is archived. No new posts can be added.
              </Text>
            </View>
          )}
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📸</Text>
            <Text style={s.emptyText}>No posts yet</Text>
            <Text style={s.emptyHint}>
              {group.status === 'active'
                ? 'Be the first to post something to this group.'
                : 'This archived group has no posts.'}
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Gallery tab */}
      {tab === 'gallery' && (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🖼️</Text>
          <Text style={s.emptyText}>No photos yet</Text>
          <Text style={s.emptyHint}>Photos posted to this group will appear here.</Text>
        </View>
      )}

      {/* Members tab */}
      {tab === 'members' && (
        <FlatList
          data={members}
          keyExtractor={m => m.id}
          contentContainerStyle={s.membersList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c9973a" />}
          renderItem={({ item }) => (
            <View style={s.memberRow}>
              <View style={s.memberAvatar}>
                {item.avatarUrl ? (
                  <Image source={{ uri: item.avatarUrl }} style={s.memberAvatarImg} />
                ) : (
                  <View style={s.memberAvatarFallback}>
                    <Text style={s.memberAvatarLetter}>
                      {(item.displayName ?? item.npub)[0].toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <View style={s.memberBody}>
                <Text style={s.memberName}>{item.displayName ?? `${item.npub.slice(0, 12)}…`}</Text>
                <Text style={s.memberRole}>{item.role}</Text>
              </View>
              {isAdmin && item.npub !== npub && item.role !== 'owner' && (
                <TouchableOpacity
                  style={s.memberOptions}
                  onPress={() => Alert.alert(
                    item.displayName ?? 'Member',
                    'What would you like to do?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      item.role === 'member'
                        ? { text: 'Make admin', onPress: () => handlePromoteAdmin(item) }
                        : { text: 'Remove admin', onPress: () => updateMemberRole(group.id, item.npub, 'member').then(load) },
                      { text: 'Remove from group', style: 'destructive', onPress: () => handleRemoveMember(item) },
                    ]
                  )}
                >
                  <Text style={s.memberOptionsText}>⋯</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}

      {/* Admin actions bar */}
      {isAdmin && group.status === 'active' && (
        <View style={s.adminBar}>
          <TouchableOpacity style={s.adminBtn} onPress={handleArchive}>
            <Text style={s.adminBtnText}>📦 Archive season</Text>
          </TouchableOpacity>
          {isMember && (
            <TouchableOpacity
              style={s.adminBtnGold}
              onPress={() => router.push({ pathname: '/(tabs)/log' } as any)}
            >
              <Text style={s.adminBtnGoldText}>+ Post to group</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Member post FAB */}
      {isMember && !isAdmin && group.status === 'active' && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => router.push({ pathname: '/(tabs)/log' } as any)}
          activeOpacity={0.85}
        >
          <Text style={s.fabIcon}>+</Text>
        </TouchableOpacity>
      )}

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#444', fontSize: 15 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#222',
  },
  backBtn: { width: 50 },
  backText: { color: '#c9973a', fontSize: 14, fontWeight: '600' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub: { color: '#555', fontSize: 11, marginTop: 1 },
  inviteBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#c9973a' },
  inviteBtnText: { color: '#111', fontWeight: '700', fontSize: 13 },

  // Invite panel
  invitePanel: {
    backgroundColor: '#1a1a1a', borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a',
    padding: 16,
  },
  invitePanelTop: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  inviteCodeBlock: { flex: 1 },
  inviteCodeLabel: { fontSize: 10, color: '#555', fontWeight: '600', letterSpacing: 0.8, marginBottom: 6 },
  inviteCode: { fontSize: 32, fontWeight: '700', color: '#c9973a', letterSpacing: 6, marginBottom: 10 },
  inviteCodeActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  inviteCodeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#111' },
  inviteCodeBtnDanger: { borderColor: '#3a1a1a' },
  inviteCodeBtnText: { fontSize: 12, color: '#aaa', fontWeight: '500' },
  qrBlock: { padding: 8, backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a' },
  inviteMeta: { fontSize: 11, color: '#444', marginTop: 10, lineHeight: 16 },

  // Tabs
  tabRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#c9973a' },
  tabText: { fontSize: 12, color: '#444', fontWeight: '500' },
  tabTextActive: { color: '#c9973a', fontWeight: '700' },

  // Timeline
  timelineContainer: { padding: 20, paddingBottom: 100 },
  archivedBanner: { backgroundColor: '#1a1a00', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 0.5, borderColor: '#3a3a00' },
  archivedBannerText: { color: '#888', fontSize: 13, textAlign: 'center' },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyText: { fontSize: 17, color: '#555', fontWeight: '500' },
  emptyHint: { fontSize: 13, color: '#333', marginTop: 6, textAlign: 'center' },

  // Members
  membersList: { padding: 20, paddingBottom: 100 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  memberAvatar: { width: 42, height: 42 },
  memberAvatarImg: { width: 42, height: 42, borderRadius: 21 },
  memberAvatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  memberAvatarLetter: { color: '#c9973a', fontWeight: '700', fontSize: 17 },
  memberBody: { flex: 1 },
  memberName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  memberRole: { color: '#555', fontSize: 11, marginTop: 2, textTransform: 'capitalize' },
  memberOptions: { padding: 8 },
  memberOptionsText: { fontSize: 20, color: '#444' },

  // Admin bar
  adminBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10, padding: 16,
    backgroundColor: '#111', borderTopWidth: 0.5, borderTopColor: '#222',
  },
  adminBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  adminBtnText: { color: '#555', fontSize: 13, fontWeight: '500' },
  adminBtnGold: { flex: 2, padding: 12, borderRadius: 10, backgroundColor: '#c9973a', alignItems: 'center' },
  adminBtnGoldText: { color: '#111', fontWeight: '700', fontSize: 13 },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#c9973a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabIcon: { fontSize: 30, color: '#111', fontWeight: '300', lineHeight: 34 },
});