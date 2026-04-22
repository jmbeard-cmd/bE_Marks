import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BEHeader from '../../components/BEHeader';
import { createThread, getDMThreads, type DMThread } from '../../src/utils/dm-storage';
import { normalizeNostrIdentity } from '../../src/utils/nostr-identity';

function formatThreadTime(unixSecs: number): string {
  const date = new Date(unixSecs * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MessagesScreen() {
  const router = useRouter();
  const [threads, setThreads] = useState<DMThread[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newNostrInput, setNewNostrInput] = useState('');
  const [creating, setCreating] = useState(false);

  const loadThreads = useCallback(async () => {
    const data = await getDMThreads();
    setThreads(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadThreads();
    }, [loadThreads])
  );

  const handleNewThread = async () => {
    setCreating(true);
    try {
      const title = newTitle.trim() || 'New Conversation';
      let participantPubkey: string | undefined;
      let participantNpub: string | undefined;

      if (newNostrInput.trim()) {
        const normalized = normalizeNostrIdentity(newNostrInput);
        participantPubkey = normalized.pubkey;
        participantNpub = normalized.npub;
      }

      const thread = await createThread({ title, participantPubkey, participantNpub });
      setNewTitle('');
      setNewNostrInput('');
      setShowNewModal(false);
      await loadThreads();
      router.push({
        pathname: '/(tabs)/dm-thread',
        params: { id: thread.id, title: thread.title },
      } as any);
    } catch (error: any) {
      Alert.alert('Invalid Nostr identity', error?.message || 'Please enter a valid npub or hex pubkey.');
    }
    setCreating(false);
  };

  const closeModal = () => {
    setNewTitle('');
    setNewNostrInput('');
    setShowNewModal(false);
  };

  const totalUnread = threads.reduce((sum, t) => sum + (t.unread || 0), 0);

  return (
    <SafeAreaView style={s.safe}>
      <BEHeader title="Messages" />

      <FlatList
        data={threads}
        keyExtractor={item => item.id}
        contentContainerStyle={[s.list, threads.length === 0 && s.listEmpty]}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>✉️</Text>
            <Text style={s.emptyTitle}>No messages yet</Text>
            <Text style={s.emptyHint}>Start a private conversation with a family member or trusted contact.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowNewModal(true)}>
              <Text style={s.emptyBtnText}>Start a conversation</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.card}
            activeOpacity={0.85}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/dm-thread',
                params: { id: item.id, title: item.title },
              } as any)
            }
          >
            <View style={[s.avatar, item.unread > 0 && s.avatarUnread]}>
              <Text style={s.avatarText}>{(item.title[0] || 'C').toUpperCase()}</Text>
            </View>
            <View style={s.cardBody}>
              <View style={s.cardTop}>
                <Text style={[s.title, item.unread > 0 && s.titleUnread]}>{item.title}</Text>
                <Text style={s.time}>{formatThreadTime(item.updatedAt)}</Text>
              </View>
              <View style={s.cardBottom}>
                <Text style={[s.preview, item.unread > 0 && s.previewUnread]} numberOfLines={1}>
                  {item.lastMessage || 'No messages yet'}
                </Text>
                {item.unread > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{item.unread}</Text></View>
                )}
              </View>
              {item.participantNpub && (
                <Text style={s.npubHint} numberOfLines={1}>
                  {item.participantNpub.slice(0, 16)}…
                </Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      />

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setShowNewModal(true)} activeOpacity={0.85}>
        <Text style={s.fabIcon}>✏️</Text>
      </TouchableOpacity>

      {/* New conversation modal */}
      <Modal visible={showNewModal} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={s.modalOverlay}>
              <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeModal} />
              <View style={s.modalSheet}>
                <View style={s.modalHandle} />
                <Text style={s.modalTitle}>New Conversation</Text>
                <Text style={s.modalHint}>Private messages are encrypted end-to-end via Nostr NIP-04.</Text>

                <Text style={s.inputLabel}>CONVERSATION NAME</Text>
                <TextInput
                  style={s.input}
                  placeholder="e.g. Mom, Dad, Legacy Crew…"
                  placeholderTextColor="#444"
                  value={newTitle}
                  onChangeText={setNewTitle}
                  returnKeyType="next"
                  autoFocus
                />

                <Text style={s.inputLabel}>NOSTR ADDRESS (OPTIONAL)</Text>
                <TextInput
                  style={s.input}
                  placeholder="npub1… or hex pubkey"
                  placeholderTextColor="#444"
                  value={newNostrInput}
                  onChangeText={setNewNostrInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleNewThread}
                />
                <Text style={s.inputMeta}>
                  Leave blank to use as a local notes thread.
                </Text>

                <View style={s.modalActions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={closeModal}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.createBtn, (!newTitle.trim() && !newNostrInput.trim()) && s.createBtnDim]}
                    onPress={handleNewThread}
                    disabled={creating}
                  >
                    <Text style={s.createText}>{creating ? 'Starting…' : 'Start conversation'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  list: { padding: 20, paddingBottom: 100 },
  listEmpty: { flexGrow: 1 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: { backgroundColor: '#c9973a', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#111', fontWeight: '700', fontSize: 14 },

  card: {
    flexDirection: 'row', gap: 12,
    backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#222',
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  avatarUnread: { backgroundColor: '#2a1e00', borderWidth: 1.5, borderColor: '#c9973a' },
  avatarText: { color: '#c9973a', fontWeight: '700', fontSize: 19 },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' },
  title: { color: '#aaa', fontSize: 15, fontWeight: '500', flex: 1, marginRight: 8 },
  titleUnread: { color: '#fff', fontWeight: '700' },
  time: { color: '#555', fontSize: 11 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  preview: { color: '#555', fontSize: 13, flex: 1, marginRight: 10 },
  previewUnread: { color: '#888' },
  npubHint: { fontSize: 10, color: '#333', marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#111', fontWeight: '700', fontSize: 11 },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#c9973a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabIcon: { fontSize: 22 },

  // Modal / sheet
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#1a1a1a', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 6 },
  modalHint: { fontSize: 13, color: '#555', lineHeight: 18, marginBottom: 24 },
  inputLabel: { fontSize: 11, color: '#555', fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 },
  input: {
    backgroundColor: '#111', borderWidth: 0.5, borderColor: '#2a2a2a',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    color: '#fff', fontSize: 15, marginBottom: 6,
  },
  inputMeta: { fontSize: 11, color: '#444', marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  cancelText: { color: '#555', fontSize: 14, fontWeight: '500' },
  createBtn: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#c9973a', alignItems: 'center' },
  createBtnDim: { opacity: 0.6 },
  createText: { color: '#111', fontWeight: '700', fontSize: 14 },
});