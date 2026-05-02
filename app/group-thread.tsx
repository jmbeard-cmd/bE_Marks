import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageViewerModal, { ViewerImage } from '../components/ImageViewerModal';
import MessageBubble from '../components/MessageBubble';
import { Colors } from '../src/constants/theme';
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
type PendingUploadMessage = {
  id: string;
  groupId: string;
  text?: string;
  mediaType: 'image' | 'video';
  mine: true;
  senderName?: string;
  createdAt: number;
  pending: true;
  pendingLabel: string;
};

export default function GroupThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
    const { npub, nsec, profile, themeMode } = useIdentity();
  const theme = Colors[themeMode];
  const s = useMemo(() => createStyles(theme), [theme]);

  const groupId = useMemo(() => params.id || '', [params.id]);

  const [groupName, setGroupName] = useState('Group');
  const [relayUrl, setRelayUrl] = useState('wss://relay.beginningend.com');
  const [draft, setDraft] = useState('');
    const [inputHeight, setInputHeight] = useState(40);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
const [sending, setSending] = useState(false);
const [uploadingImage, setUploadingImage] = useState(false);
const [uploadStatus, setUploadStatus] = useState<string | null>(null);
const [pendingUploads, setPendingUploads] = useState<PendingUploadMessage[]>([]);
const [selectedMediaUri, setSelectedMediaUri] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const myDisplayName =
    profile?.display_name ||
    profile?.name ||
    (npub ? `${npub.slice(0, 12)}…` : 'You');

    const viewerMedia: ViewerImage[] = messages
  .filter(message => !!(message.mediaUrl || message.imageUrl))
  .map(message => {
    const item: ViewerImage = {
      id: message.id,
      uri: message.mediaUrl || message.imageUrl!,
      type: message.mediaType || (message.imageUrl ? 'image' : 'image'),
      thumbnailUrl: message.thumbnailUrl,
    };

    return item;
  });

    const visibleMessages = useMemo(
    () => [...messages, ...pendingUploads].sort((a, b) => a.createdAt - b.createdAt),
    [messages, pendingUploads]
  );

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
  mediaUrl: msg.mediaUrl || msg.imageUrl,
  mediaType: msg.mediaType || (msg.imageUrl ? 'image' : undefined),
  thumbnailUrl: msg.thumbnailUrl,
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
  mediaUrl: msg.mediaUrl || msg.imageUrl,
  mediaType: msg.mediaType || (msg.imageUrl ? 'image' : undefined),
  thumbnailUrl: msg.thumbnailUrl,
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
    setInputHeight(40);

    try {
      setUploadStatus('Posting...');
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
      setUploadStatus(null);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not send message.');
    }

    setSending(false);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

    const handlePickMedia = async () => {
    if (!groupId || uploadingImage) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow media access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

        setUploadingImage(true);
    setUploadStatus('Preparing media...');

    const pendingId = `pending_upload_${Date.now()}`;
    const pendingMediaType = result.assets[0].type === 'video' ? 'video' : 'image';

    setPendingUploads(prev => [
      ...prev,
      {
        id: pendingId,
        groupId,
        mediaType: pendingMediaType,
        mine: true,
        senderName: myDisplayName,
        createdAt: Math.floor(Date.now() / 1000),
        pending: true,
        pendingLabel: pendingMediaType === 'video'
          ? 'Uploading video…'
          : 'Uploading photo…',
      },
    ]);

    setTimeout(() => scrollToBottom(true), 50);

    try {
      const asset = result.assets[0];
      const mediaType = asset.type === 'video' ? 'video' : 'image';
      const uploadUri = asset.uri;

      setUploadStatus('Uploading...');

      const uploadedUrl = await uploadToR2(
        uploadUri,
        mediaType === 'video' ? 'video' : 'photo'
      );

      if (!uploadedUrl) {
        Alert.alert('Upload failed', 'Could not upload media.');
        setUploadStatus(null);
        setUploadingImage(false);
        return;
      }

      let thumbnailUrl: string | undefined;

      if (mediaType === 'video') {
        try {
          setUploadStatus('Creating thumbnail...');

          const thumbnail = await VideoThumbnails.getThumbnailAsync(uploadUri, {
            time: 1000,
          });

          setUploadStatus('Uploading thumbnail...');

          const uploadedThumbnail = await uploadToR2(thumbnail.uri, 'photo');
          thumbnailUrl = uploadedThumbnail || undefined;
        } catch (thumbError) {
          console.warn('[Groups] thumbnail failed:', thumbError);
        }
      }

      setUploadStatus('Posting...');

      await sendLocalGroupMessage({
        groupId,
        mediaUrl: uploadedUrl,
        mediaType,
        thumbnailUrl,
        imageUrl: mediaType === 'image' ? uploadedUrl : undefined,
        mine: true,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
      });

      if (nsec) {
        await publishGroupMessage({
          groupId,
          mediaUrl: uploadedUrl,
          mediaType,
          thumbnailUrl,
          imageUrl: mediaType === 'image' ? uploadedUrl : undefined,
          senderNpub: npub ?? undefined,
          senderName: myDisplayName,
          nsec,
          relayUrl,
        });
      }

            setPendingUploads(prev => prev.filter(item => item.id !== pendingId));
      await loadMessages();
      setUploadStatus(null);
    } catch (e: any) {
            setPendingUploads(prev => prev.filter(item => item.id !== pendingId));
      Alert.alert('Error', e?.message || 'Failed to send media.');
      setUploadStatus(null);
    }

    setUploadingImage(false);
  };

const handleTakePhoto = async () => {
  if (!groupId || uploadingImage) return;

  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (permission.status !== 'granted') {
    Alert.alert('Permission needed', 'Allow camera access.');
    return;
  }

  setUploadingImage(true);
  setUploadStatus('Opening camera...');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    setUploadStatus(null);
    setUploadingImage(false);
    return;
  }

  try {
    setUploadStatus('Uploading...');

    const uploadedUrl = await uploadToR2(result.assets[0].uri, 'photo');

    if (!uploadedUrl) {
      Alert.alert('Upload failed', 'Could not upload photo.');
      setUploadStatus(null);
      setUploadingImage(false);
      return;
    }

    setUploadStatus('Posting...');

    await sendLocalGroupMessage({
      groupId,
      mediaUrl: uploadedUrl,
      mediaType: 'image',
      imageUrl: uploadedUrl,
      mine: true,
      senderNpub: npub ?? undefined,
      senderName: myDisplayName,
    });

    if (nsec) {
      await publishGroupMessage({
        groupId,
        mediaUrl: uploadedUrl,
        mediaType: 'image',
        imageUrl: uploadedUrl,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
        nsec,
        relayUrl,
      });
    }

    await loadMessages();
    setUploadStatus(null);
  } catch (e: any) {
    Alert.alert('Error', e?.message || 'Could not send photo.');
    setUploadStatus(null);
  }

  setUploadingImage(false);
};

  const handleBack = () => {
    router.navigate('/(tabs)/groups' as any);
  };

  const handleOpenInfo = () => {
    router.push({ pathname: '/group-detail', params: { id: groupId } } as any);
  };

    const renderMessage = ({ item, index }: { item: GroupMessage | PendingUploadMessage; index: number }) => {
    const prevMsg = index > 0 ? visibleMessages[index - 1] : null;
    const showName = !item.mine && (!prevMsg || prevMsg.senderName !== item.senderName);

    return (
      <MessageBubble
        item={item}
        showName={showName}
        onPressMedia={(uri) => setSelectedMediaUri(uri)}
        s={s}
      />
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
  style={s.safe}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={0}
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
                        data={visibleMessages}
            keyExtractor={item => item.id}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                        onContentSizeChange={() => {
              scrollToBottom(false);
              setTimeout(() => scrollToBottom(true), 75);
            }}
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

          {uploadStatus && (
  <View style={s.uploadBanner}>
    <Text style={s.uploadText}>{uploadStatus}</Text>
  </View>
)}

          <View style={s.composer}>
            <TouchableOpacity
              style={[s.attachBtn, uploadingImage && s.attachBtnDim]}
              onPress={() => {
  Alert.alert(
    'Add Media',
    '',
    [
      { text: 'Camera Photo', onPress: handleTakePhoto },
      { text: 'Library (Photo/Video)', onPress: handlePickMedia },
      { text: 'Cancel', style: 'cancel' },
    ]
  );
}}
              disabled={uploadingImage}
            >
              {uploadingImage ? (
  <ActivityIndicator size="small" color={theme.gold} />
) : (
  <Text style={s.attachText}>＋</Text>
)}
            </TouchableOpacity>

             <TextInput
ref={inputRef}
style={[
  s.input,
  { 
    height: Math.max(40, Math.min(120, inputHeight)),
    color: theme.text,
    backgroundColor: theme.raised
  }
]}
              placeholder={`Message ${groupName}…`}
              placeholderTextColor={theme.textMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              onFocus={() => {
                setTimeout(() => scrollToBottom(true), 250);
              }}
              onContentSizeChange={(e) => {
                setInputHeight(e.nativeEvent.contentSize.height);
              }}
            />

            <TouchableOpacity
              style={[s.sendBtn, (!draft.trim() || sending) && s.sendBtnDim]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={theme.bg} />
              ) : (
                <Text style={s.sendText}>↑</Text>
              )}
            </TouchableOpacity>
                    </View>

          <ImageViewerModal
            images={viewerMedia}
            selectedUri={selectedMediaUri}
            onClose={() => setSelectedMediaUri(null)}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatMessageTime(unix: number): string {
  const date = new Date(unix * 1000);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const createStyles = (theme: typeof Colors.light) => StyleSheet.create({
      safe: { flex: 1, backgroundColor: theme.bg },
  container: { flex: 1, backgroundColor: theme.bg },

   header: {
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
    uploadBanner: {
  paddingVertical: 6,
  paddingHorizontal: 12,
  backgroundColor: theme.surface,
  borderTopWidth: 0.5,
  borderTopColor: theme.border,
},

uploadText: {
  color: theme.gold,
  fontSize: 12,
  textAlign: 'center',
  fontWeight: '600',
  letterSpacing: 0.3,
},
  backBtn: { width: 60 },
  backText: { color: theme.gold, fontSize: 14, fontWeight: '600' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: theme.text, fontSize: 15, fontWeight: '700', maxWidth: 180 },
  headerSub: { color: theme.textMuted, fontSize: 10, marginTop: 2 },
  infoBtn: { minWidth: 60, alignItems: 'flex-end' },
  infoText: { color: theme.gold, fontSize: 14, fontWeight: '600' },

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
    backgroundColor: theme.gold,
    borderBottomRightRadius: 4,
  },
    bubbleOther: {
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderBottomLeftRadius: 4,
  },

  senderName: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },

  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextMine: { color: '#111' },
  messageTextOther: { color: theme.text },

   pendingMediaBox: {
    width: 220,
    height: 120,
    borderRadius: 12,
    marginTop: 4,
    backgroundColor: theme.bg,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pendingMediaText: {
    color: theme.gold,
    fontSize: 13,
    fontWeight: '700',
  },
  messageImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginTop: 4,
  },

  messageVideo: {
  width: 220,
  height: 220,
  borderRadius: 12,
  marginTop: 4,
  backgroundColor: '#000',
  overflow: 'hidden',
  alignItems: 'center',
  justifyContent: 'center',
},
messageVideoThumb: {
  width: '100%',
  height: '100%',
},
messageVideoOverlay: {
  ...StyleSheet.absoluteFillObject,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.35)',
},
messageVideoIcon: {
  color: theme.gold,
  fontSize: 34,
  fontWeight: '800',
},

  time: {
    fontSize: 10,
    marginTop: 6,
  },
  timeMine: { color: '#111', textAlign: 'right' },
    timeOther: { color: theme.textMuted },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 36, marginBottom: 14, opacity: 0.7 },
  emptyText: { color: theme.text, fontSize: 16, fontWeight: '600', marginBottom: 6 },
  emptyHint: { color: theme.textMuted, fontSize: 13, textAlign: 'center' },

      composer: {
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 4,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
    backgroundColor: theme.bg,
  },
  attachBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 0.5,
    elevation: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtnDim: { opacity: 0.5 },
  attachText: {
    fontSize: 24,
    color: theme.gold,
    lineHeight: 26,
  },

  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    borderRadius: 20,
    elevation: 1,
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
    elevation: 2,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDim: { opacity: 0.4 },
  sendText: {
    fontSize: 20,
    color: theme.bg,
    fontWeight: '700',
    lineHeight: 22,
  },
});