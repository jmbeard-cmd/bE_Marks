import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import {
    formatDMTime,
    getDMThreadById,
    getMessagesForThread,
    markThreadRead,
    sendLocalDM,
    type DMMessage,
} from '../../src/utils/dm-storage';
import { fetchNostrDMs, sendNostrDM, subscribeToNostrDMs } from '../../src/utils/nostr';

export default function DmThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string }>();

  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<DMMessage[]>([]);

  const threadId = useMemo(() => params.id || '', [params.id]);
  const title = useMemo(() => params.title || 'Conversation', [params.title]);

  const loadMessages = useCallback(async () => {
  if (!threadId) return;

  console.log('live DM effect started for threadId:', threadId);

  const localMessages = await getMessagesForThread(threadId);
  const thread = await getDMThreadById(threadId);

  let merged: DMMessage[] = [...localMessages];

  if (thread?.participantPubkey) {
    const remoteMessages = await fetchNostrDMs({
      withPubkey: thread.participantPubkey,
    });

    const convertedRemote: DMMessage[] = remoteMessages.map((msg) => ({
      id: `nostr_${msg.id}`,
      threadId,
      text: msg.content,
      mine: msg.isMine,
      createdAt: msg.createdAt,
    }));

    const byId = new Map<string, DMMessage>();

    for (const msg of [...localMessages, ...convertedRemote]) {
      byId.set(msg.id, msg);
    }

    merged = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  setMessages(merged);
  await markThreadRead(threadId);
}, [threadId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
    }, [loadMessages])
  );

  useEffect(() => {
  if (!threadId) return;

  let unsubscribe: (() => void) | undefined;

  async function startLiveDMs() {
    const thread = await getDMThreadById(threadId);
    console.log('thread from storage:', thread);
    if (!thread?.participantPubkey) return;

    unsubscribe = await subscribeToNostrDMs({
      withPubkey: thread.participantPubkey,
      onMessage: (msg) => {
        console.log('live DM received in UI:', msg);
        setMessages((prev) => {
          const converted: DMMessage = {
            id: `nostr_${msg.id}`,
            threadId,
            text: msg.content,
            mine: msg.isMine,
            createdAt: msg.createdAt,
          };

          const exists = prev.some((m) => m.id === converted.id);
          if (exists) return prev;

          return [...prev, converted].sort((a, b) => a.createdAt - b.createdAt);
        });
      },
    });
  }

  startLiveDMs();

  return () => {
    if (unsubscribe) unsubscribe();
  };
}, [threadId]);

  const handleSend = async () => {
  const text = draft.trim();
  if (!text || !threadId) return;

  try {
    // 1. Save locally first (instant UI)
    await sendLocalDM({
      threadId,
      text,
      mine: true,
    });

    setDraft('');
    await loadMessages();

    // 2. Load thread to get pubkey
    const thread = await getDMThreadById(threadId);

    if (!thread?.participantPubkey) {
      console.log('No participant pubkey — skipping Nostr DM');
      return;
    }

    // 3. Send to Nostr
    const result = await sendNostrDM({
      toPubkey: thread.participantPubkey,
      content: text,
    });

    if (!result.success) {
      console.log('Nostr DM failed:', result.error);
    } else {
      console.log('Nostr DM sent:', result.eventIds);
    }

  } catch (err) {
    console.error('Send error:', err);
  }
};

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={s.container}>
            {/* Header */}
            <View style={s.header}>
              <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
                <Text style={s.backText}>Back</Text>
              </TouchableOpacity>

              <Text style={s.headerTitle} numberOfLines={1}>
                {title}
              </Text>

              <View style={{ width: 44 }} />
            </View>

            {/* Messages */}
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={s.list}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyText}>No messages yet</Text>
                  <Text style={s.emptyHint}>Send the first one below.</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[s.row, item.mine ? s.rowMine : s.rowOther]}>
                  <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleOther]}>
                    <Text
                      style={[
                        s.messageText,
                        item.mine ? s.messageTextMine : s.messageTextOther,
                      ]}
                    >
                      {item.text}
                    </Text>
                    <Text style={[s.time, item.mine ? s.timeMine : s.timeOther]}>
                      {formatDMTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
              )}
            />

            {/* Composer */}
            <View style={s.composer}>
              <TextInput
                style={s.input}
                placeholder="Write a message..."
                placeholderTextColor="#555"
                value={draft}
                onChangeText={setDraft}
                multiline
              />

              <TouchableOpacity style={s.sendBtn} onPress={handleSend}>
                <Text style={s.sendText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },

  container: { flex: 1 },

  header: {
    height: 56,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },

  backBtn: { paddingVertical: 8, paddingRight: 8, width: 44 },
  backText: { color: '#c9973a', fontSize: 14, fontWeight: '600' },

  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },

  list: {
    padding: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },

  row: {
    marginBottom: 12,
    flexDirection: 'row',
  },

  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },

  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  bubbleMine: { backgroundColor: '#c9973a' },
  bubbleOther: {
    backgroundColor: '#1f1f1f',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
  },

  messageText: { fontSize: 14, lineHeight: 20 },
  messageTextMine: { color: '#111' },
  messageTextOther: { color: '#eee' },

  time: { fontSize: 10, marginTop: 6 },
  timeMine: { color: '#3f2d00' },
  timeOther: { color: '#666' },

  composer: {
    borderTopWidth: 0.5,
    borderTopColor: '#222',
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },

  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#fff',
    maxHeight: 120,
  },

  sendBtn: {
    backgroundColor: '#c9973a',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },

  sendText: { color: '#111', fontWeight: '700' },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },

  emptyText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  emptyHint: {
    color: '#555',
    fontSize: 13,
    marginTop: 6,
  },
});