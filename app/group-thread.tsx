import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
    getMessagesForGroup,
    saveRemoteGroupMessage,
    sendLocalGroupMessage,
    type GroupMessage,
} from '../src/utils/group-messages';
import { getGroupById } from '../src/utils/group-storage';
import {
    fetchGroupMessages,
    publishGroupMessage,
    subscribeToGroupMessages,
} from '../src/utils/nostr';
import { uploadToR2 } from '../src/utils/r2';
import { useIdentity } from './_layout';

export default function GroupThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { npub, nsec, profile } = useIdentity();

  const groupId = useMemo(() => params.id || '', [params.id]);

  const [groupName, setGroupName] = useState('Group');
  const [relayUrl, setRelayUrl] = useState('wss://relay.beginningend.com');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const listRef = useRef<FlatList>(null);

  const myDisplayName =
    profile?.display_name ||
    profile?.name ||
    (npub ? `${npub.slice(0, 12)}…` : 'You');

  const scrollToBottom = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;

    const group = await getGroupById(groupId);
    if (group) {
      setGroupName(group.name);
      setRelayUrl(group.relayUrl);
    }
  }, [groupId]);

  const loadMessages = useCallback(async () => {
    if (!groupId) return;

    try {
      const remoteMessages = await fetchGroupMessages(groupId, relayUrl);

      for (const msg of remoteMessages) {
        const mine = !!npub && msg.senderNpub === npub;

        await saveRemoteGroupMessage({
          id: `nostr_group_${msg.id}`,
          groupId,
          text: msg.text,
          imageUrl: msg.imageUrl,
          mine,
          senderNpub: msg.senderNpub,
          senderName: msg.senderName,
          createdAt: msg.createdAt,
        });
      }
    } catch (e) {
      console.warn('[Groups] Remote fetch error:', e);
    }

    const allMessages = await getMessagesForGroup(groupId);
    setMessages(allMessages);
    setTimeout(() => scrollToBottom(false), 100);
  }, [groupId, relayUrl, npub, scrollToBottom]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!groupId || !relayUrl) return;

    let unsubscribe: (() => void) | undefined;

    async function startLiveGroupMessages() {
      unsubscribe = await subscribeToGroupMessages({
        groupId,
        relayUrl,
        onMessage: async (msg) => {
          const mine = !!npub && msg.senderNpub === npub;

          await saveRemoteGroupMessage({
            id: `nostr_group_${msg.id}`,
            groupId,
            text: msg.text,
            imageUrl: msg.imageUrl,
            mine,
            senderNpub: msg.senderNpub,
            senderName: msg.senderName,
            createdAt: msg.createdAt,
          });

          const next = await getMessagesForGroup(groupId);
          setMessages(next);
          setTimeout(() => scrollToBottom(true), 50);
        },
      });
    }

    startLiveGroupMessages();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [groupId, relayUrl, npub, scrollToBottom]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !groupId || sending) return;

    setSending(true);
    setDraft('');
    Keyboard.dismiss();

    try {
      await sendLocalGroupMessage({
        groupId,
        text,
        mine: true,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
      });

      if (nsec) {
        const result = await publishGroupMessage({
          groupId,
          text,
          senderNpub: npub ?? undefined,
          senderName: myDisplayName,
          nsec,
          relayUrl,
        });

        if (!result.success) {
          console.warn('[Groups] publishGroupMessage failed:', result.error);
        }
      }

      await loadMessages();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not send message.');
    }

    setSending(false);
  };

  const handlePickImage = async () => {
    if (!groupId || uploadingImage) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to send images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    setUploadingImage(true);

    try {
      const uploadedUrl = await uploadToR2(result.assets[0].uri, 'photo');

      if (!uploadedUrl) {
        Alert.alert('Upload failed', 'Could not upload image.');
        setUploadingImage(false);
        return;
      }

      await sendLocalGroupMessage({
        groupId,
        imageUrl: uploadedUrl,
        mine: true,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
      });

      if (nsec) {
        const result = await publishGroupMessage({
          groupId,
          imageUrl: uploadedUrl,
          senderNpub: npub ?? undefined,
          senderName: myDisplayName,
          nsec,
          relayUrl,
        });

        if (!result.success) {
          console.warn('[Groups] publishGroupMessage image failed:', result.error);
        }
      }

      await loadMessages();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not send image.');
    }

    setUploadingImage(false);
  };

  const handleBack = () => {
    router.navigate('/(tabs)/groups' as any);
  };

  const handleOpenInfo = () => {
    router.push({ pathname: '/group-detail', params: { id: groupId } } as any);
  };

  const renderMessage = ({ item, index }: { item: GroupMessage; index: number }) => {
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showName = !item.mine && (!prevMsg || prevMsg.senderName !== item.senderName);

    return (
      <View style={[s.row, item.mine ? s.rowMine : s.rowOther]}>
        <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleOther]}>
          {!item.mine && showName && (
            <Text style={s.senderName}>
              {item.senderName || 'Member'}
            </Text>
          )}

          {!!item.text && (
            <Text style={[s.messageText, item.mine ? s.messageTextMine : s.messageTextOther]}>
              {item.text}
            </Text>
          )}

          {!!item.imageUrl && (
            <Image source={{ uri: item.imageUrl }} style={s.messageImage} resizeMode="cover" />
          )}

          <Text style={[s.time, item.mine ? s.timeMine : s.timeOther]}>
            {formatMessageTime(item.createdAt)}
          </Text>
        </View>
      </View>
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
              <Text style={s.headerTitle} numberOfLines={1}>
                {groupName}
              </Text>
              <Text style={s.headerSub}>Group chat</Text>
            </View>

            <TouchableOpacity
              onPress={handleOpenInfo}
              style={s.infoBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.infoText}>Info</Text>
            </TouchableOpacity>
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
                <Text style={s.emptyIcon}>👥</Text>
                <Text style={s.emptyText}>No messages yet</Text>
                <Text style={s.emptyHint}>
                  Send the first message to this group below.
                </Text>
              </View>
            }
            renderItem={renderMessage}
          />

          <View style={s.composer}>
            <TouchableOpacity
              style={[s.attachBtn, uploadingImage && s.attachBtnDim]}
              onPress={handlePickImage}
              disabled={uploadingImage}
            >
              {uploadingImage ? (
                <ActivityIndicator size="small" color="#c9973a" />
              ) : (
                <Text style={s.attachText}>＋</Text>
              )}
            </TouchableOpacity>

            <TextInput
              style={s.input}
              placeholder={`Message ${groupName}…`}
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

function formatMessageTime(unix: number): string {
  const date = new Date(unix * 1000);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700', maxWidth: 180 },
  headerSub: { color: '#555', fontSize: 10, marginTop: 1 },
  infoBtn: { minWidth: 60, alignItems: 'flex-end' },
  infoText: { color: '#c9973a', fontSize: 14, fontWeight: '600' },

  list: { padding: 16, paddingBottom: 8, flexGrow: 1 },

  row: { marginBottom: 8, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },

  bubble: {
    maxWidth: '78%',
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

  senderName: {
    color: '#c9973a',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },

  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextMine: { color: '#111' },
  messageTextOther: { color: '#eee' },

  messageImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginTop: 4,
  },

  time: {
    fontSize: 10,
    marginTop: 6,
  },
  timeMine: { color: 'rgba(0,0,0,0.45)', textAlign: 'right' },
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
    padding: 12,
    paddingBottom: Platform.OS === 'android' ? 16 : 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },
  attachBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtnDim: { opacity: 0.5 },
  attachText: {
    fontSize: 24,
    color: '#c9973a',
    lineHeight: 26,
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