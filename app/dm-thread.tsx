import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  formatDMTime,
  getDMThreadById,
  getMessagesForThread,
  markThreadRead,
  sendLocalDM,
  type DMMessage,
} from '../src/utils/dm-storage';
import { sendNostrDM } from '../src/utils/nostr';

export default function DmThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string }>();

  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [hasPubkey, setHasPubkey] = useState(false);

  const listRef = useRef<FlatList<DMMessage>>(null);
  const leavingRef = useRef(false);

  const threadId = useMemo(() => params.id || '', [params.id]);
  const title = useMemo(() => params.title || 'Conversation', [params.title]);

  const scrollToBottom = useCallback((animated = false) => {
    if (leavingRef.current) return;

    requestAnimationFrame(() => {
      if (leavingRef.current) return;
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const loadLocalThread = useCallback(async () => {
    if (!threadId || leavingRef.current) return;

    const [localMessages, thread] = await Promise.all([
      getMessagesForThread(threadId),
      getDMThreadById(threadId),
    ]);

    if (leavingRef.current) return;

    setMessages(localMessages);
    setHasPubkey(!!thread?.participantPubkey);

    requestAnimationFrame(() => scrollToBottom(false));

    markThreadRead(threadId).catch(e => {
      console.warn('[DM THREAD] markThreadRead failed:', e);
    });
  }, [threadId, scrollToBottom]);

  useFocusEffect(
    useCallback(() => {
      leavingRef.current = false;
      loadLocalThread();

      return () => {
        leavingRef.current = true;
      };
    }, [loadLocalThread])
  );

  useEffect(() => {
  if (!threadId) return;

  const interval = setInterval(() => {
    if (!leavingRef.current) {
      loadLocalThread();
    }
  }, 1000);

  return () => clearInterval(interval);
}, [threadId, loadLocalThread]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !threadId || sending || leavingRef.current) return;

    setSending(true);
    setDraft('');
    setInputHeight(40);
    Keyboard.dismiss();

    try {
      const localMessage = await sendLocalDM({
        threadId,
        text,
        mine: true,
      });

      if (!leavingRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m.id === localMessage.id);
          if (exists) return prev;

          const next = [...prev, localMessage].sort((a, b) => a.createdAt - b.createdAt);
          requestAnimationFrame(() => scrollToBottom(true));
          return next;
        });
      }

      const thread = await getDMThreadById(threadId);

      if (thread?.participantPubkey) {
  console.log('[DM THREAD SEND] threadId:', threadId);
  console.log('[DM THREAD SEND] title:', thread.title);
  console.log('[DM THREAD SEND] participantPubkey:', thread.participantPubkey);
  console.log('[DM THREAD SEND] participantNpub:', thread.participantNpub);

  sendNostrDM({
    toPubkey: thread.participantPubkey,
    content: text,
  }).then(result => {
          if (!result.success) {
            console.warn('[DM] Nostr send failed:', result.error);
          }
        });
      }
    } catch (err) {
      console.error('[DM] Send error:', err);
    } finally {
      if (!leavingRef.current) {
        setSending(false);
      }
    }
  };

  const handleBack = () => {
    leavingRef.current = true;
    Keyboard.dismiss();

    requestAnimationFrame(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/messages' as any);
      }
    });
  };

  const renderMessage = ({ item, index }: { item: DMMessage; index: number }) => {
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showDateDivider = !prevMsg || !isSameDay(item.createdAt, prevMsg.createdAt);

    return (
      <View>
        {showDateDivider && (
          <View style={s.dateDivider}>
            <View style={s.dateDividerLine} />
            <Text style={s.dateDividerText}>{formatDividerDate(item.createdAt)}</Text>
            <View style={s.dateDividerLine} />
          </View>
        )}

        <View style={[s.row, item.mine ? s.rowMine : s.rowOther]}>
          <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleOther]}>
            <Text style={[s.messageText, item.mine ? s.messageTextMine : s.messageTextOther]}>
              {item.text}
            </Text>

            <Text style={[s.time, item.mine ? s.timeMine : s.timeOther]}>
              {formatDMTime(item.createdAt)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={s.container}>
          <View style={s.header}>
            <TouchableOpacity
              onPress={handleBack}
              style={s.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={s.backText}>← Back</Text>
            </TouchableOpacity>

            <View style={s.headerCenter}>
              <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
              {hasPubkey && <Text style={s.headerSub}>🔒 End-to-end encrypted</Text>}
            </View>

            <View style={{ width: 60 }} />
          </View>

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            contentContainerStyle={s.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            removeClippedSubviews
            initialNumToRender={18}
            maxToRenderPerBatch={18}
            windowSize={7}
            onContentSizeChange={() => scrollToBottom(false)}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyIcon}>✉️</Text>
                <Text style={s.emptyText}>No messages yet</Text>
                <Text style={s.emptyHint}>
                  {hasPubkey ? `Send ${title} a message below.` : 'Send the first message below.'}
                </Text>
              </View>
            }
            renderItem={renderMessage}
          />

          <View style={s.composer}>
            <TextInput
              style={[s.input, { height: Math.max(40, Math.min(120, inputHeight)) }]}
              placeholder={`Message ${title}…`}
              placeholderTextColor="#444"
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              onFocus={() => {
                setTimeout(() => scrollToBottom(true), 200);
              }}
              onContentSizeChange={e => {
                setInputHeight(e.nativeEvent.contentSize.height);
              }}
            />

            <TouchableOpacity
              style={[s.sendBtn, (!draft.trim() || sending) && s.sendBtnDim]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#111" />
              ) : (
                <Text style={s.sendText}>↑</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);

  return (
    da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
  );
}

function formatDividerDate(unixSecs: number): string {
  const date = new Date(unixSecs * 1000);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1 },

  header: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#c9973a', fontSize: 14, fontWeight: '600' },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700', maxWidth: 220 },
  headerSub: { color: '#555', fontSize: 10, marginTop: 2 },

  list: { padding: 16, paddingBottom: 8, flexGrow: 1 },

  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 16,
  },
  dateDividerLine: { flex: 1, height: 0.5, backgroundColor: '#222' },
  dateDividerText: { fontSize: 11, color: '#444', fontWeight: '500' },

  row: {
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },

  bubble: {
    maxWidth: '75%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: {
    backgroundColor: '#c9973a',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#1f1f1f',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    borderBottomLeftRadius: 4,
  },
  messageText: { fontSize: 15, lineHeight: 21 },
  messageTextMine: { color: '#111' },
  messageTextOther: { color: '#eee' },
  time: { fontSize: 10, marginTop: 5 },
  timeMine: { color: 'rgba(0,0,0,0.4)', textAlign: 'right' },
  timeOther: { color: '#555' },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 36, marginBottom: 14 },
  emptyText: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 6 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center' },

  composer: {
    borderTopWidth: 0.5,
    borderTopColor: '#222',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: '#000',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    maxHeight: 120,
    lineHeight: 20,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#c9973a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDim: { opacity: 0.4 },
  sendText: {
    fontSize: 20,
    color: '#111',
    fontWeight: '700',
    lineHeight: 22,
  },
});