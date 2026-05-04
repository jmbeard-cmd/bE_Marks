import * as DocumentPicker from 'expo-document-picker';
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
  type GroupMediaType,
  type GroupMessage,
  type GroupMessageMedia,
} from '../src/utils/group-messages';
import { getGroupById } from '../src/utils/group-storage';
import {
  compressImageForUpload,
  compressVideoForUpload,
} from '../src/utils/media-compression';
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
  mediaType: GroupMediaType;
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
  const [loadingInitialMessages, setLoadingInitialMessages] = useState(true);
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
    .filter(message => {
      const mediaItems = Array.isArray((message as any).media)
        ? (message as any).media
        : [];

      if (mediaItems.some((item: any) => item.type === 'image' || item.type === 'video')) {
        return true;
      }

      const legacyType = message.mediaType || (message.imageUrl ? 'image' : undefined);

      return legacyType === 'image' || legacyType === 'video';
    })
    .flatMap(message => {
      const mediaItems = Array.isArray((message as any).media)
        ? (message as any).media
        : [];

      if (mediaItems.length > 0) {
        return mediaItems
          .filter((item: any) => item.type === 'image' || item.type === 'video')
          .map((item: any) => ({
            id: item.id || `${message.id}_${item.uri}`,
            uri: item.uri,
            type: item.type as 'image' | 'video',
            thumbnailUrl: item.thumbnailUrl,
          }));
      }

      const legacyUri = message.mediaUrl || message.imageUrl;

      if (!legacyUri) return [];

      const legacyType: 'image' | 'video' =
        message.mediaType === 'video' ? 'video' : 'image';

      return [
        {
          id: message.id,
          uri: legacyUri,
          type: legacyType,
          thumbnailUrl: message.thumbnailUrl,
        },
      ];
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

    setLoadingInitialMessages(true);

    try {
      const localMessages = await getMessagesForGroup(groupId);

      setMessages(localMessages);
      setLoadingInitialMessages(false);
      setTimeout(() => scrollToBottom(false), 50);
    } catch (error) {
      console.warn('[Groups] Local message load error:', error);
      setLoadingInitialMessages(false);
    }

    fetchGroupMessages(groupId, relayUrl)
      .then(async remoteMessages => {
        for (const msg of remoteMessages) {
          const mine = !!npub && msg.senderNpub === npub;

          await saveRemoteGroupMessage({
            id: `nostr_group_${msg.id}`,
            groupId,
            text: msg.text,
            media: msg.media,
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

        const refreshedMessages = await getMessagesForGroup(groupId);

        setMessages(refreshedMessages);
        setTimeout(() => scrollToBottom(false), 50);
      })
      .catch(error => {
        console.warn('[Groups] Remote fetch error:', error);
      });
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
            media: msg.media,
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
    setUploadStatus(null);

    try {
      await sendLocalGroupMessage({
        groupId,
        text,
        mine: true,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
      });

      const localMessages = await getMessagesForGroup(groupId);
      setMessages(localMessages);
      setTimeout(() => scrollToBottom(true), 30);

      setSending(false);

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });

      if (nsec) {
        publishGroupMessage({
          groupId,
          text,
          senderNpub: npub ?? undefined,
          senderName: myDisplayName,
          nsec,
          relayUrl,
        }).then(result => {
          if (!result.success) {
            console.warn('[Groups] publishGroupMessage failed:', result.error);
          }
        }).catch(error => {
          console.warn('[Groups] publishGroupMessage error:', error);
        });
      }
    } catch (error: any) {
      setSending(false);
      Alert.alert('Error', error?.message || 'Could not send message.');

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  };

  const uploadGroupAttachment = async (
    attachment: {
      uri: string;
      type: GroupMediaType;
      fileName?: string;
      mimeType?: string;
    },
    index: number,
    total: number
  ): Promise<GroupMessageMedia | null> => {
    let uploadUri = attachment.uri;
    let thumbnailUrl: string | undefined;

    if (attachment.type === 'image') {
      setUploadStatus(`Optimizing photo ${index + 1} of ${total}...`);

      const compressionResult = await compressImageForUpload({
        uri: attachment.uri,
        onStatus: setUploadStatus,
      });

      uploadUri = compressionResult.uri;

      if (compressionResult.wasCompressed) {
        setUploadStatus(`Uploading optimized photo ${index + 1} of ${total}...`);
      } else {
        setUploadStatus(`Uploading photo ${index + 1} of ${total}...`);
      }
    }

    if (attachment.type === 'video') {
      const compressionResult = await compressVideoForUpload({
        uri: attachment.uri,
        onStatus: setUploadStatus,
        onProgress: progress => {
          setUploadStatus(
            `Compressing video ${index + 1} of ${total}… ${Math.round(progress * 100)}%`
          );
        },
      });

      uploadUri = compressionResult.uri;

      if (compressionResult.wasCompressed) {
        setUploadStatus(`Uploading compressed video ${index + 1} of ${total}...`);
      } else {
        setUploadStatus(`Uploading video ${index + 1} of ${total}...`);
      }
    }

    if (attachment.type === 'file') {
      setUploadStatus(`Uploading file ${index + 1} of ${total}...`);
    }

    const uploadedUrl = await uploadToR2(
      uploadUri,
      attachment.type === 'video'
        ? 'video'
        : attachment.type === 'image'
          ? 'photo'
          : 'file'
    );

    if (!uploadedUrl) {
      console.warn('[Groups] upload failed for attachment:', attachment.uri);
      return null;
    }

    if (attachment.type === 'video') {
      try {
        setUploadStatus(`Creating thumbnail ${index + 1} of ${total}...`);

        const thumbnail = await VideoThumbnails.getThumbnailAsync(uploadUri, {
          time: 1000,
        });

        setUploadStatus(`Uploading thumbnail ${index + 1} of ${total}...`);

        const uploadedThumbnail = await uploadToR2(thumbnail.uri, 'photo');
        thumbnailUrl = uploadedThumbnail || undefined;
      } catch (thumbError) {
        console.warn('[Groups] thumbnail failed:', thumbError);
      }
    }

    return {
      id: `group_media_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`,
      uri: uploadedUrl,
      type: attachment.type,
      thumbnailUrl,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  };

  const sendAttachmentMessage = async (
    attachments: {
      uri: string;
      type: GroupMediaType;
      fileName?: string;
      mimeType?: string;
    }[],
    pendingLabel: string
  ) => {
    if (!groupId || uploadingImage || attachments.length === 0) return;

    setUploadingImage(true);
    setUploadStatus('Preparing attachments...');

    const pendingId = `pending_upload_${Date.now()}`;
    const pendingMediaType = attachments[0]?.type || 'file';

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
        pendingLabel,
      },
    ]);

    setTimeout(() => scrollToBottom(true), 50);

    try {
      const uploadedMedia: GroupMessageMedia[] = [];

      for (let i = 0; i < attachments.length; i++) {
        const uploaded = await uploadGroupAttachment(attachments[i], i, attachments.length);

        if (uploaded) {
          uploadedMedia.push(uploaded);
        }
      }

      if (uploadedMedia.length === 0) {
        Alert.alert('Upload failed', 'Could not upload attachments.');
        setPendingUploads(prev => prev.filter(item => item.id !== pendingId));
        setUploadStatus(null);
        setUploadingImage(false);
        return;
      }

      const primaryMedia = uploadedMedia[0];

      await sendLocalGroupMessage({
        groupId,
        media: uploadedMedia,
        mediaUrl: primaryMedia.uri,
        mediaType: primaryMedia.type,
        thumbnailUrl: primaryMedia.thumbnailUrl,
        imageUrl: primaryMedia.type === 'image' ? primaryMedia.uri : undefined,
        mine: true,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
      });

      setPendingUploads(prev => prev.filter(item => item.id !== pendingId));

      const localMessages = await getMessagesForGroup(groupId);
      setMessages(localMessages);
      setUploadStatus(null);
      setUploadingImage(false);
      setTimeout(() => scrollToBottom(true), 30);

      if (nsec) {
        publishGroupMessage({
          groupId,
          media: uploadedMedia,
          mediaUrl: primaryMedia.uri,
          mediaType: primaryMedia.type,
          thumbnailUrl: primaryMedia.thumbnailUrl,
          imageUrl: primaryMedia.type === 'image' ? primaryMedia.uri : undefined,
          senderNpub: npub ?? undefined,
          senderName: myDisplayName,
          nsec,
          relayUrl,
        }).then(result => {
          if (!result.success) {
            console.warn('[Groups] publishGroupMessage attachments failed:', result.error);
          }
        }).catch(error => {
          console.warn('[Groups] publishGroupMessage attachments error:', error);
        });
      }
    } catch (e: any) {
      setPendingUploads(prev => prev.filter(item => item.id !== pendingId));
      Alert.alert('Error', e?.message || 'Failed to send attachments.');
      setUploadStatus(null);
      setUploadingImage(false);
    }
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
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });

    if (result.canceled || !result.assets?.length) return;

    const attachments = result.assets
      .filter(asset => !!asset.uri)
      .map(asset => ({
        uri: asset.uri,
        type: (asset.type === 'video' ? 'video' : 'image') as GroupMediaType,
        fileName: asset.fileName ?? undefined,
        mimeType: asset.mimeType ?? undefined,
      }));

    const hasVideo = attachments.some(item => item.type === 'video');
    const pendingLabel =
      attachments.length > 1
        ? `Uploading ${attachments.length} attachments…`
        : hasVideo
          ? 'Compressing video…'
          : 'Optimizing photo…';

    await sendAttachmentMessage(attachments, pendingLabel);
  };

  const handlePickFiles = async () => {
    if (!groupId || uploadingImage) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const attachments = result.assets
        .filter(asset => !!asset.uri)
        .map(asset => ({
          uri: asset.uri,
          type: 'file' as GroupMediaType,
          fileName: asset.name,
          mimeType: asset.mimeType,
        }));

      const pendingLabel =
        attachments.length > 1
          ? `Uploading ${attachments.length} files…`
          : 'Uploading file…';

      await sendAttachmentMessage(attachments, pendingLabel);
    } catch (error) {
      console.warn('[Groups] file picker failed:', error);
      Alert.alert('File error', 'Could not open the file picker.');
    }
  };

  const handleTakePhoto = async () => {
    if (!groupId || uploadingImage) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access.');
      return;
    }

    setUploadStatus('Opening camera...');

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.[0]?.uri) {
      setUploadStatus(null);
      return;
    }

    await sendAttachmentMessage(
      [
        {
          uri: result.assets[0].uri,
          type: 'image',
          fileName: result.assets[0].fileName ?? undefined,
          mimeType: result.assets[0].mimeType ?? undefined,
        },
      ],
      'Optimizing photo…'
    );
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
              loadingInitialMessages ? (
                <View style={s.empty}>
                  <ActivityIndicator size="small" color={theme.gold} />
                </View>
              ) : (
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>👥</Text>
                  <Text style={s.emptyText}>No messages yet</Text>
                  <Text style={s.emptyHint}>
                    Send the first message to this group below.
                  </Text>
                </View>
              )
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
    'Add Attachment',
    '',
    [
      { text: 'Camera Photo', onPress: handleTakePhoto },
      { text: 'Library Photos/Videos', onPress: handlePickMedia },
      { text: 'Attach Files', onPress: handlePickFiles },
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
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 20,
    elevation: 0,
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