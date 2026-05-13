import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { nip19 } from 'nostr-tools';
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
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../src/constants/theme';
import { subscribeToDMEvents } from '../src/utils/dm-events';
import {
  getDMThreadById,
  getRecentMessagesForThread,
  markThreadRead,
  saveRemoteDMMessage,
  sendLocalDM,
  type DMMessage
} from '../src/utils/dm-storage';
import { fetchNostrDMs, fetchNostrProfile, sendNostrDM } from '../src/utils/nostr';
import { sendRemoteDMNotification } from '../src/utils/push-notifications';
import { useIdentity } from './_layout';

export default function DmThreadScreen() {
  const { theme, npub, profile } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);

  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string }>();

  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loadingInitialMessages, setLoadingInitialMessages] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasPubkey, setHasPubkey] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profilePicture, setProfilePicture] = useState<string | null>(null);

  const listRef = useRef<FlatList<DMMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  const leavingRef = useRef(false);
  const loadingMessagesRef = useRef(false);
  const pendingMessageReloadRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedProfilePubkeyRef = useRef<string | null>(null);
  const threadCatchUpInFlightRef = useRef(false);

  const threadId = useMemo(() => params.id || '', [params.id]);
  const title = useMemo(() => params.title || 'Conversation', [params.title]);

  const myDisplayName = useMemo(() => {
  return (
    profile?.display_name ||
    profile?.name ||
    (npub ? `${npub.slice(0, 12)}…` : 'You')
  );
}, [profile, npub]);

  const scrollToLatest = useCallback((animated = false) => {
    if (leavingRef.current) return;

    requestAnimationFrame(() => {
      if (leavingRef.current) return;
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, []);

  const hydrateThreadProfile = useCallback(async (
    participantPubkey: string,
    fallbackTitle: string
  ) => {
    if (hydratedProfilePubkeyRef.current === participantPubkey) return;

    hydratedProfilePubkeyRef.current = participantPubkey;

    try {
      const npub = nip19.npubEncode(participantPubkey);
      const profile = await fetchNostrProfile(npub);

      if (!profile || leavingRef.current) return;

      const displayName =
        profile.display_name ||
        profile.name ||
        fallbackTitle;

      setProfileName(displayName);
      setProfilePicture(profile.picture || null);
    } catch (error) {
      console.warn('[DM THREAD] profile fetch failed:', error);
    }
  }, []);

  const scheduleMarkThreadRead = useCallback(() => {
    if (!threadId || leavingRef.current) return;

    if (markReadTimerRef.current) {
      clearTimeout(markReadTimerRef.current);
    }

    markReadTimerRef.current = setTimeout(() => {
      markReadTimerRef.current = null;

      if (leavingRef.current) return;

      markThreadRead(threadId).catch(e => {
        console.warn('[DM THREAD] markThreadRead failed:', e);
      });
    }, 500);
  }, [threadId]);

  const loadLocalThread = useCallback(async () => {
    if (!threadId || leavingRef.current) return;

    if (loadingMessagesRef.current) {
      pendingMessageReloadRef.current = true;
      return;
    }

    loadingMessagesRef.current = true;
    setLoadingInitialMessages(true);

    try {
      const localMessages = await getRecentMessagesForThread(threadId, 30);        

      if (leavingRef.current) return;

      const newestFirstMessages = [...localMessages].sort(
        (a, b) => b.createdAt - a.createdAt
      );

      setMessages(newestFirstMessages);
      setLoadingInitialMessages(false);

      getDMThreadById(threadId)
        .then(thread => {
          if (leavingRef.current) return;

          setHasPubkey(!!thread?.participantPubkey);

          if (thread?.participantPubkey) {
            hydrateThreadProfile(thread.participantPubkey, thread.title);
          }

          scheduleMarkThreadRead();
        })
        .catch(error => {
          console.warn('[DM THREAD] failed to load thread metadata:', error);
        });
    } finally {
      loadingMessagesRef.current = false;

      if (!leavingRef.current) {
        setLoadingInitialMessages(false);
      }

      if (pendingMessageReloadRef.current && !leavingRef.current) {
        pendingMessageReloadRef.current = false;

        setTimeout(() => {
          loadLocalThread();
        }, 100);
      }
    }
  }, [threadId, scrollToLatest, hydrateThreadProfile, scheduleMarkThreadRead]);

  const catchUpThreadFromRelay = useCallback(async () => {
  if (!threadId || leavingRef.current) return;
  if (threadCatchUpInFlightRef.current) return;

  threadCatchUpInFlightRef.current = true;

  try {
    const thread = await getDMThreadById(threadId);

    if (!thread?.participantPubkey || leavingRef.current) return;

    const remoteMessages = await fetchNostrDMs({
      withPubkey: thread.participantPubkey,
      limit: 40,
    });

    if (leavingRef.current) return;

    for (const msg of remoteMessages) {
      await saveRemoteDMMessage({
        id: `nostr_${msg.id}`,
        threadId,
        text: msg.content,
        mine: msg.isMine,
        createdAt: msg.createdAt,
      });
    }

    if (leavingRef.current) return;

    const refreshed = await getRecentMessagesForThread(threadId, 30);
    const newestFirstMessages = [...refreshed].sort(
      (a, b) => b.createdAt - a.createdAt
    );

    setMessages(newestFirstMessages);
    scheduleMarkThreadRead();
  } catch (error) {
    console.warn('[DM THREAD] targeted relay catch-up failed:', error);
  } finally {
    threadCatchUpInFlightRef.current = false;
  }
}, [threadId, scheduleMarkThreadRead]);

useFocusEffect(
  useCallback(() => {
    leavingRef.current = false;
    loadLocalThread();

    const catchUpTimer = setTimeout(() => {
      catchUpThreadFromRelay();
    }, 350);

    return () => {
      leavingRef.current = true;
      clearTimeout(catchUpTimer);
    };
  }, [loadLocalThread, catchUpThreadFromRelay])
);

  useEffect(() => {
    if (!threadId) return;

    const unsubscribe = subscribeToDMEvents((changedThreadId) => {
      if (leavingRef.current) return;

      if (changedThreadId !== threadId && changedThreadId !== '__restore_done__') {
        return;
      }

      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }

      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;

        if (!leavingRef.current) {
          loadLocalThread();
        }
      }, 250);
    });

    return () => {
      leavingRef.current = true;

      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }

      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
      }

      unsubscribe();
    };
  }, [threadId, loadLocalThread]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !threadId || sending || leavingRef.current) return;

    setSending(true);
    setDraft('');
    setInputHeight(40);

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

          const next = [localMessage, ...prev].sort((a, b) => b.createdAt - a.createdAt);
          requestAnimationFrame(() => scrollToLatest(true));
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
    return;
  }

  if (!npub) {
    console.log('[DM] remote push skipped; missing sender npub');
    return;
  }

  let senderPubkey = '';

  try {
    const decoded = nip19.decode(npub);

    if (decoded.type === 'npub') {
      senderPubkey = decoded.data as string;
    }
  } catch (error) {
    console.warn('[DM] failed to decode sender npub for push:', error);
  }

  if (!senderPubkey) {
    console.log('[DM] remote push skipped; missing sender pubkey');
    return;
  }

if (!thread.participantPubkey) {
  console.log('[DM] remote push skipped; missing recipient pubkey');
  return;
}

const recipientNpub =
  thread.participantNpub ||
  nip19.npubEncode(thread.participantPubkey);

  sendRemoteDMNotification({
    recipientNpub,
    senderNpub: npub,
    senderPubkey,
    senderName: myDisplayName,
    body: text,
  }).catch(error => {
    console.warn('[DM] remote push failed:', error);
  });
});
      }
    } catch (err) {
      console.error('[DM] Send error:', err);
    } finally {
      if (!leavingRef.current) {
        setSending(false);

        requestAnimationFrame(() => {
          if (!leavingRef.current) {
            inputRef.current?.focus();
          }
        });
      }
    }
  };

  const handleBack = () => {
    leavingRef.current = true;

    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }

    if (markReadTimerRef.current) {
      clearTimeout(markReadTimerRef.current);
      markReadTimerRef.current = null;
    }

    Keyboard.dismiss();

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/messages' as any);
    }
  };

  const renderMessage = ({ item, index }: { item: DMMessage; index: number }) => {
    const olderMsg = index < messages.length - 1 ? messages[index + 1] : null;
    const showDateDivider = !olderMsg || !isSameDay(item.createdAt, olderMsg.createdAt);
    const senderName = item.mine ? 'You' : profileName || title || 'Member';
    const initials = getInitials(senderName);

    return (
      <View>
        {showDateDivider && (
          <View style={s.dateDivider}>
            <View style={s.dateDividerLine} />
            <Text style={s.dateDividerText}>{formatDividerDate(item.createdAt)}</Text>
            <View style={s.dateDividerLine} />
          </View>
        )}

        <View style={[s.messageRow, item.mine ? s.messageRowMine : s.messageRowOther]}>
          {!item.mine && (
            <View style={s.dmAvatar}>
              {profilePicture ? (
                <Image
                  source={{ uri: profilePicture }}
                  style={s.dmAvatarImage}
                  resizeMode="cover"
                />
              ) : (
                <Text style={s.dmAvatarText}>{initials}</Text>
              )}
            </View>
          )}

          <View style={[s.dmBubble, item.mine ? s.dmBubbleMine : s.dmBubbleOther]}>
            <Text style={s.dmMessageText}>{item.text}</Text>

            <Text style={s.dmTimeText}>
              {formatMessageTime(item.createdAt)}
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
              <Text style={s.headerTitle} numberOfLines={1}>
  {profileName || title}
</Text>
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
            inverted
            removeClippedSubviews
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={5}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              loadingInitialMessages ? (
                <View style={s.empty}>
                  <ActivityIndicator size="small" color={theme.gold} />
                </View>
              ) : (
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>✉️</Text>
                  <Text style={s.emptyText}>No messages yet</Text>
                  <Text style={s.emptyHint}>
                    {hasPubkey ? `Send ${title} a message below.` : 'Send the first message below.'}
                  </Text>
                </View>
              )
            }
            renderItem={renderMessage}
          />

          <View style={s.composer}>
            <TextInput
              ref={inputRef}
              style={[s.input, { height: Math.max(40, Math.min(120, inputHeight)) }]}
              placeholder={`Message ${profileName || title}…`}
              placeholderTextColor={theme.textMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              onFocus={() => {
                setTimeout(() => scrollToLatest(true), 200);
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

function getInitials(name?: string): string {
  const cleaned = name?.trim();

  if (!cleaned) return 'M';

  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase() || 'M';
}

function formatMessageTime(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
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

const createStyles = (theme: typeof Colors.dark) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  container: { flex: 1 },

  header: {
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: theme.gold, fontSize: 14, fontWeight: '600' },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginBottom: 4,
  },
  headerTitle: { color: theme.text, fontSize: 15, fontWeight: '700', maxWidth: 220 },
  headerSub: { color: theme.textMuted, fontSize: 10, marginTop: 2 },

  list: { padding: 16, paddingBottom: 8, flexGrow: 1 },

  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 16,
  },
  dateDividerLine: { flex: 1, height: 0.5, backgroundColor: theme.border },
  dateDividerText: { fontSize: 11, color: theme.textMuted, fontWeight: '500' },

  messageRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 2,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
    paddingLeft: 52,
  },
  messageRowOther: {
    justifyContent: 'flex-start',
    paddingRight: 44,
  },
  dmAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 8,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dmAvatarImage: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  dmAvatarText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  dmBubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dmBubbleMine: {
    backgroundColor: theme.raised,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 6,
  },
  dmBubbleOther: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 18,
  },
  dmMessageText: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  dmTimeText: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
    alignSelf: 'flex-end',
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 36, marginBottom: 14 },
  emptyText: { color: theme.text, fontSize: 16, fontWeight: '600', marginBottom: 6 },
  emptyHint: { color: theme.textMuted, fontSize: 13, textAlign: 'center' },

  composer: {
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: theme.bg,
  },
  input: {
    flex: 1,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 15,
    maxHeight: 120,
    lineHeight: 20,
  },
  sendBtn: {
  width: 42,
  height: 42,
  borderRadius: 21,
  backgroundColor: theme.gold,
  alignItems: 'center',
  justifyContent: 'center',
},
  sendBtnDim: { opacity: 0.35 },
  sendText: {
    fontSize: 20,
    color: theme.surface,
    fontWeight: '700',
    lineHeight: 22,
  },
});