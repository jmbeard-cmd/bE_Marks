import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    Alert,
    FlatList,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import BEHeader from '../../components/BEHeader';
import { createThread, getDMThreads, type DMThread } from '../../src/utils/dm-storage';
import { normalizeNostrIdentity } from '../../src/utils/nostr-identity';

export default function MessagesScreen() {
  const router = useRouter();
  const [threads, setThreads] = useState<DMThread[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newNostrInput, setNewNostrInput] = useState('');

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
  try {
    const title = newTitle.trim() || 'New Conversation';

    let participantPubkey: string | undefined;
    let participantNpub: string | undefined;

    if (newNostrInput.trim()) {
      const normalized = normalizeNostrIdentity(newNostrInput);

      participantPubkey = normalized.pubkey;
      participantNpub = normalized.npub;
    }

    const thread = await createThread({
      title,
      participantPubkey,
      participantNpub,
    });

    setNewTitle('');
    setNewNostrInput('');

    await loadThreads();

    router.push({
      pathname: '/(tabs)/dm-thread',
      params: { id: thread.id, title: thread.title },
    } as any);
  } catch (error: any) {
    Alert.alert(
      'Invalid Nostr identity',
      error?.message || 'Please enter a valid npub or hex pubkey.'
    );
  }
};

  return (
    <SafeAreaView style={s.safe}>
      <BEHeader title="Messages" />

      <FlatList
        data={threads}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View style={s.topRow}>
  <Text style={s.helper}>Private messages for family and trusted contacts</Text>

  <TextInput
    style={s.input}
    placeholder="Conversation title"
    placeholderTextColor="#555"
    value={newTitle}
    onChangeText={setNewTitle}
  />

  <TextInput
    style={s.input}
    placeholder="Enter npub or hex pubkey"
    placeholderTextColor="#555"
    value={newNostrInput}
    onChangeText={setNewNostrInput}
    autoCapitalize="none"
    autoCorrect={false}
  />

  <TouchableOpacity style={s.newBtn} onPress={handleNewThread}>
    <Text style={s.newBtnText}>New</Text>
  </TouchableOpacity>
</View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>✉️</Text>
            <Text style={s.emptyTitle}>No messages yet</Text>
            <Text style={s.emptyHint}>Start a conversation to build out your DM space.</Text>
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
            <View style={s.avatar}>
              <Text style={s.avatarText}>{item.title[0] || 'C'}</Text>
            </View>

            <View style={s.cardBody}>
              <View style={s.cardTop}>
                <Text style={s.title}>{item.title}</Text>
                <Text style={s.time}>
                  {new Date(item.updatedAt * 1000).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              </View>

              <View style={s.cardBottom}>
                <Text style={s.subtitle} numberOfLines={1}>
                  {item.lastMessage || 'No messages yet'}
                </Text>

                {item.unread > 0 && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{item.unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  list: { padding: 20, paddingBottom: 40, flexGrow: 1 },
  topRow: { marginBottom: 18 },
  input: {
  backgroundColor: '#1a1a1a',
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: '#fff',
  marginBottom: 10,
},
  helper: { color: '#555', fontSize: 13, marginBottom: 12 },
  newBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#c9973a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  newBtnText: { color: '#111', fontWeight: '700', fontSize: 13 },
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: '#222',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#c9973a', fontWeight: '700', fontSize: 18 },
  cardBody: { flex: 1 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 15, fontWeight: '600' },
  time: { color: '#555', fontSize: 11 },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subtitle: { color: '#777', fontSize: 13, flex: 1, marginRight: 10 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#c9973a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#111', fontWeight: '700', fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 34, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 17, fontWeight: '600', marginBottom: 6 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center' },
});