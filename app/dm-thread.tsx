import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
  saveRemoteDMMessage,
  sendLocalDM,
  type DMMessage,
} from '../src/utils/dm-storage';
import {
  fetchNostrDMs,
  fetchNostrProfile,
  sendNostrDM,
  subscribeToNostrDMs,
  type NostrProfile,
} from '../src/utils/nostr';

export default function DmThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string }>();

  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [hasPubkey, setHasPubkey] = useState(false);
  const [contactProfile, setContactProfile] = useState<NostrProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const listRef = useRef<FlatList>(null);

  const threadId = useMemo(() => params.id || '', [params.id]);
  const title = useMemo(() => params.title || 'Conversation', [params.title]);

  const scrollToBottom = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const loadContactProfile = useCallback(async () => {
    setContactProfile(null);
    setProfileLoading(false);

    if (!threadId) return;

    const thread = await getDMThreadById(threadId);

    if (!thread?.participantNpub) {
      setContactProfile(null);
      return;
    }

    setProfileLoading(true);

    try {
      const profile = await fetchNostrProfile(thread.participantNpub);
      const stillCurrentThread = await getDMThreadById(threadId);

      if (stillCurrentThread?.participantNpub === thread.participantNpub) {
        setContactProfile(profile);
      }
    } catch {
      setContactProfile(null);
    }

    setProfileLoading(false);
  }, [threadId]);

  const loadMessages = useCallback(async () => {
    if (!threadId) return;

    const localMessages = await getMessagesForThread(threadId);
    setMessages(localMessages);
    setTimeout(() => scrollToBottom(false), 50);

    const thread = await getDMThreadById(threadId);
    setHasPubkey(!!thread?.participantPubkey);

    await markThreadRead(threadId);

    if (!thread?.participantPubkey) return;

    fetchNostrDMs({ withPubkey: thread.participantPubkey })
      .then(async remoteMessages => {
        for (const msg of remoteMessages) {
          await saveRemoteDMMessage({
            id: `nostr_${msg.id}`,
            threadId,
            text: msg.content,
            mine: msg.isMine,
            createdAt: msg.createdAt,
          });
        }

        const merged = await getMessagesForThread(threadId);
        setMessages(merged);
        setTimeout(() => scrollToBottom(false), 50);
      })
      .catch(e => {
        console.warn('[DM] Remote fetch error:', e);
      });
  }, [threadId, scrollToBottom]);

  useFocusEffect(
    useCallback(() => {
      setMessages([]);
      setContactProfile(null);
      setHasPubkey(false);

      loadMessages();
      loadContactProfile();
    }, [loadMessages, loadContactProfile])
  );

  useEffect(() => {
    if (!threadId) return;

    let unsubscribe: (() => void) | undefined;

    async function startLiveDMs() {
      const thread = await getDMThreadById(threadId);
      if (!thread?.participantPubkey) return;

      unsubscribe = await subscribeToNostrDMs({
        withPubkey: thread.participantPubkey,
        onMessage: msg => {
          console.log('[DM THREAD] live message received:', msg);
console.log('[DM THREAD] current threadId:', threadId);
          const converted: DMMessage = {
            id: `nostr_${msg.id}`,
            threadId,
            text: msg.content,
            mine: msg.isMine,
            createdAt: msg.createdAt,
          };

          saveRemoteDMMessage(converted).then(async () => {
            console.log('[DM THREAD] saved remote message:', converted);
            const next = await getMessagesForThread(threadId);
            setMessages(next);
            setTimeout(() => scrollToBottom(true), 50);
          });
        },
      });
    }

    startLiveDMs();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [threadId, scrollToBottom]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !threadId || sending) return;

    setSending(true);
    setDraft('');
    Keyboard.dismiss();

    try {
      const localMessage = await sendLocalDM({
        threadId,
        text,
        mine: true,
      });

      setMessages(prev => {
        const exists = prev.some(m => m.id === localMessage.id);
        if (exists) return prev;

        const next = [...prev, localMessage].sort((a, b) => a.createdAt - b.createdAt);
        setTimeout(() => scrollToBottom(true), 50);
        return next;
      });

      const thread = await getDMThreadById(threadId);

      if (thread?.participantPubkey) {
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
    }

    setSending(false);
  };

  const handleBack = () => {
  router.replace('/(tabs)/messages' as any);
};

  const displayName = contactProfile?.display_name || contactProfile?.name || title;
  const avatarLetter = displayName[0]?.toUpperCase() || '?';

  const renderMessage = ({ item, index }: { item: DMMessage; index: number }) => {
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showDateDivider = !prevMsg || !isSameDay(item.createdAt, prevMsg.createdAt);

    return (
      <>
        {showDateDivider && (
          <View style={s.dateDivider}>
            <View style={s.dateDividerLine} />
            <Text style={s.dateDividerText}>{formatDividerDate(item.createdAt)}</Text>
            <View style={s.dateDividerLine} />
          </View>
        )}

        <View style={[s.row, item.mine ? s.rowMine : s.rowOther]}>
          {!item.mine && (
            <View style={s.msgAvatar}>
              {contactProfile?.picture ? (
                <Image source={{ uri: contactProfile.picture }} style={s.msgAvatarImg} />
              ) : (
                <View style={s.msgAvatarFallback}>
                  <Text style={s.msgAvatarLetter}>{avatarLetter}</Text>
                </View>
              )}
            </View>
          )}

          <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleOther]}>
            <Text style={[s.messageText, item.mine ? s.messageTextMine : s.messageTextOther]}>
              {item.text}
            </Text>

            <Text style={[s.time, item.mine ? s.timeMine : s.timeOther]}>
              {formatDMTime(item.createdAt)}
            </Text>
          </View>
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 64}
      >
        <View style={s.container}>
          <View style={s.header}>
            <TouchableOpacity
              onPress={handleBack}
              style={s.backBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.backText}>← Back</Text>
            </TouchableOpacity>

            <View style={s.headerCenter}>
              <View style={s.headerAvatar}>
                {contactProfile?.picture ? (
                  <Image source={{ uri: contactProfile.picture }} style={s.headerAvatarImg} />
                ) : (
                  <View style={s.headerAvatarFallback}>
                    {profileLoading ? (
                      <ActivityIndicator size="small" color="#c9973a" />
                    ) : (
                      <Text style={s.headerAvatarLetter}>{avatarLetter}</Text>
                    )}
                  </View>
                )}
              </View>

              <View>
                <Text style={s.headerTitle} numberOfLines={1}>{displayName}</Text>
                {hasPubkey && (
                  <Text style={s.headerSub}>🔒 End-to-end encrypted</Text>
                )}
              </View>
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
            onContentSizeChange={() => scrollToBottom(false)}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyIcon}>✉️</Text>
                <Text style={s.emptyText}>No messages yet</Text>
                <Text style={s.emptyHint}>
                  {hasPubkey
                    ? `Send ${displayName} a message below.`
                    : 'Send the first message below.'}
                </Text>
                {!hasPubkey && (
                  <Text style={s.emptyLocalNote}>
                    No Nostr address — messages are stored locally only.
                  </Text>
                )}
              </View>
            }
            renderItem={renderMessage}
          />

          <View style={s.composer}>
            <TextInput
              style={s.input}
              placeholder={`Message ${displayName}…`}
              placeholderTextColor="#444"
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={2000}
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

  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

function formatDividerDate(unixSecs: number): string {
  const date = new Date(unixSecs * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isToday) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  headerAvatar: { width: 36, height: 36 },
  headerAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  headerAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarLetter: { color: '#c9973a', fontWeight: '700', fontSize: 15 },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700', maxWidth: 160 },
  headerSub: { color: '#555', fontSize: 10, marginTop: 1 },

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
    gap: 8,
  },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },

  msgAvatar: { width: 28, height: 28, marginBottom: 2 },
  msgAvatarImg: { width: 28, height: 28, borderRadius: 14 },
  msgAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgAvatarLetter: { color: '#c9973a', fontWeight: '700', fontSize: 11 },

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
  emptyLocalNote: {
    color: '#3a3a3a',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 17,
  },

  composer: {
    borderTopWidth: 0.5,
    borderTopColor: '#222',
    padding: 12,
    paddingBottom: Platform.OS === 'android' ? 16 : 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
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