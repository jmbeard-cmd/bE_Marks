import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
  addGroupMessageReaction,
  editGroupMessage,
  getMessagesForGroup,
  markGroupMessageDeleted,
  saveRemoteGroupMessage,
  sendLocalGroupMessage,
  type GroupMediaType,
  type GroupMessage,
  type GroupMessageMedia,
} from '../src/utils/group-messages';
import {
  getGroupById,
  getGroupMembers,
} from '../src/utils/group-storage';
import {
  compressImageForUpload,
  compressVideoForUpload,
} from '../src/utils/media-compression';
import {
  fetchGroupMessageDeletes,
  fetchGroupMessageEdits,
  fetchGroupMessageReactions,
  fetchGroupMessages,
  publishGroupMessage,
  publishGroupMessageDelete,
  publishGroupMessageEdit,
  publishGroupMessageReaction,
  subscribeToGroupMessageDeletes,
  subscribeToGroupMessageEdits,
  subscribeToGroupMessageReactions,
  subscribeToGroupMessages,
} from '../src/utils/nostr';
import { uploadToR2 } from '../src/utils/r2';
import { useIdentity } from './_layout';
function createClientMessageId(groupId: string): string {
  return `client_msg_${groupId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

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
const [memberAvatarMap, setMemberAvatarMap] = useState<Record<string, string | undefined>>({});
const [actionMessage, setActionMessage] = useState<GroupMessage | PendingUploadMessage | null>(null);
const [replyTarget, setReplyTarget] = useState<GroupMessage | null>(null);
const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);

  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const isNearBottomRef = useRef(true);
  const didInitialAutoScrollRef = useRef(false);
  const forceNextAutoScrollRef = useRef(false);

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
    () => {
      const myAvatarUrl =
        (profile as any)?.picture ||
        (profile as any)?.avatarUrl ||
        undefined;

      return [...messages, ...pendingUploads]
        .map(message => {
          const senderNpub = (message as any).senderNpub;
          const avatarUrl =
            message.mine
              ? myAvatarUrl
              : senderNpub
                ? memberAvatarMap[senderNpub]
                : undefined;

          return {
            ...message,
            avatarUrl,
          };
        })
        .sort((a, b) => a.createdAt - b.createdAt);
    },
    [messages, pendingUploads, memberAvatarMap, profile]
  );

  const getReplyPreviewText = useCallback((message: GroupMessage | PendingUploadMessage): string => {
    if ((message as any).isDeleted) return 'Message deleted';

    const text = message.text?.trim();
    if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text;

    const mediaItems = Array.isArray((message as any).media)
      ? (message as any).media
      : [];

    if (mediaItems.length > 1) return `${mediaItems.length} attachments`;

    const firstMedia = mediaItems[0];

    if (firstMedia?.type === 'video') return 'Video';
    if (firstMedia?.type === 'file') return firstMedia.fileName || 'File';
    if (firstMedia?.type === 'image') return 'Photo';

    if ((message as any).mediaType === 'video') return 'Video';
    if ((message as any).mediaType === 'file') return 'File';
    if ((message as any).mediaUrl || (message as any).imageUrl) return 'Photo';

    return 'Message';
  }, []);

  const getReplyPreviewSenderName = useCallback((message: GroupMessage | PendingUploadMessage): string => {
    if (message.mine) return 'You';

    return message.senderName || 'Member';
  }, []);

  const getCopyTextForMessage = useCallback((message: GroupMessage | PendingUploadMessage): string => {
    if ((message as any).isDeleted) return 'Message deleted';

    const text = message.text?.trim();

    if (text) return text;

    const mediaItems = Array.isArray((message as any).media)
      ? (message as any).media
      : [];

    if (mediaItems.length > 0) {
      return mediaItems
        .map((item: any, index: number) => {
          const label =
            item.type === 'video'
              ? 'Video'
              : item.type === 'file'
                ? item.fileName || 'File'
                : 'Photo';

          return `${label} ${index + 1}: ${item.uri}`;
        })
        .join('\n');
    }

    const legacyUrl = (message as any).mediaUrl || (message as any).imageUrl;

    if (legacyUrl) {
      const label = (message as any).mediaType === 'video' ? 'Video' : 'Photo';
      return `${label}: ${legacyUrl}`;
    }

    return '';
  }, []);

  const canEditMessage = useCallback((message: GroupMessage | PendingUploadMessage): boolean => {
    if (!message.mine) return false;
    if ((message as any).pending) return false;
    if ((message as any).isDeleted) return false;

    const text = message.text?.trim();
    if (!text) return false;

    const mediaItems = Array.isArray((message as any).media)
      ? (message as any).media
      : [];

    if (mediaItems.length > 0) return false;
    if ((message as any).mediaUrl) return false;
    if ((message as any).imageUrl) return false;

    return true;
  }, []);

  const clearEditMode = useCallback(() => {
    setEditingMessage(null);
    setDraft('');
    setInputHeight(40);
  }, []);

  const scrollToBottom = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const scrollToLatestMessage = useCallback((animated = false) => {
    const lastIndex = visibleMessages.length - 1;

    if (lastIndex < 0) return;

    try {
      listRef.current?.scrollToIndex({
        index: lastIndex,
        animated,
        viewPosition: 1,
      });
    } catch {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated });
      }, 80);
    }
  }, [visibleMessages.length]);

  const forceScrollToBottom = useCallback((animated = true) => {
    forceNextAutoScrollRef.current = true;

    setTimeout(() => {
      scrollToBottom(animated);
      forceNextAutoScrollRef.current = false;
      isNearBottomRef.current = true;
    }, 30);
  }, [scrollToBottom]);

  const scrollToBottomIfAppropriate = useCallback((animated = true) => {
    if (
      forceNextAutoScrollRef.current ||
      isNearBottomRef.current ||
      !didInitialAutoScrollRef.current
    ) {
      scrollToBottom(animated);
      didInitialAutoScrollRef.current = true;
      forceNextAutoScrollRef.current = false;
      isNearBottomRef.current = true;
    }
  }, [scrollToBottom]);

  const handleListScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;

    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);

    isNearBottomRef.current = distanceFromBottom < 140;
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (!forceNextAutoScrollRef.current) return;

    setTimeout(() => {
      if (!forceNextAutoScrollRef.current) return;

      const animated = didInitialAutoScrollRef.current;

      scrollToBottom(animated);
      forceNextAutoScrollRef.current = false;
      isNearBottomRef.current = true;
      didInitialAutoScrollRef.current = true;
    }, 90);
  }, [scrollToBottom]);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;

    const group = await getGroupById(groupId);

    if (group) {
      setGroupName(group.name);
      setRelayUrl(group.relayUrl);
    }

    try {
      const groupMembers = await getGroupMembers(groupId);
      const nextAvatarMap: Record<string, string | undefined> = {};

      groupMembers.forEach(member => {
        nextAvatarMap[member.npub] = member.avatarUrl;
      });

      setMemberAvatarMap(nextAvatarMap);
    } catch (error) {
      console.warn('[Groups] failed to load member avatars:', error);
    }
  }, [groupId]);

  const loadMessages = useCallback(async () => {
    if (!groupId) return;

    setLoadingInitialMessages(true);

    try {
      const localMessages = await getMessagesForGroup(groupId);

      setMessages(localMessages);
      setLoadingInitialMessages(false);
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
            clientMessageId: msg.clientMessageId,
            groupId,
            text: msg.text,
            replyToMessageId: msg.replyToMessageId,
            replyToClientMessageId: msg.replyToClientMessageId,
            replyPreviewText: msg.replyPreviewText,
            replyPreviewSenderName: msg.replyPreviewSenderName,
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

        const [deleteEvents, reactionEvents, editEvents] = await Promise.all([
          fetchGroupMessageDeletes(groupId, relayUrl),
          fetchGroupMessageReactions(groupId, relayUrl),
          fetchGroupMessageEdits(groupId, relayUrl),
        ]);

        for (const deleteEvent of deleteEvents) {
          await markGroupMessageDeleted({
            groupId,
            messageId: `nostr_group_${deleteEvent.messageId}`,
            clientMessageId: deleteEvent.clientMessageId,
            deletedByNpub: deleteEvent.deletedByNpub,
            deletedAt: deleteEvent.deletedAt,
          });

          await markGroupMessageDeleted({
            groupId,
            messageId: deleteEvent.messageId,
            clientMessageId: deleteEvent.clientMessageId,
            deletedByNpub: deleteEvent.deletedByNpub,
            deletedAt: deleteEvent.deletedAt,
          });
        }

        for (const reactionEvent of reactionEvents) {
          await addGroupMessageReaction({
            groupId,
            messageId: `nostr_group_${reactionEvent.messageId}`,
            clientMessageId: reactionEvent.clientMessageId,
            reaction: reactionEvent.reaction,
            reactorNpub: reactionEvent.reactorNpub,
            reactorName: reactionEvent.reactorName,
            createdAt: reactionEvent.createdAt,
          });

          await addGroupMessageReaction({
            groupId,
            messageId: reactionEvent.messageId,
            clientMessageId: reactionEvent.clientMessageId,
            reaction: reactionEvent.reaction,
            reactorNpub: reactionEvent.reactorNpub,
            reactorName: reactionEvent.reactorName,
            createdAt: reactionEvent.createdAt,
          });
        }

        for (const editEvent of editEvents) {
          await editGroupMessage({
            groupId,
            messageId: `nostr_group_${editEvent.messageId}`,
            clientMessageId: editEvent.clientMessageId,
            text: editEvent.text,
            editedAt: editEvent.editedAt,
          });

          await editGroupMessage({
            groupId,
            messageId: editEvent.messageId,
            clientMessageId: editEvent.clientMessageId,
            text: editEvent.text,
            editedAt: editEvent.editedAt,
          });
        }

        const refreshedMessages = await getMessagesForGroup(groupId);

        setMessages(refreshedMessages);
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
    if (!groupId || visibleMessages.length === 0 || didInitialAutoScrollRef.current) return;

    const timers = [180, 450, 900, 1300].map((delay, index, arr) =>
      setTimeout(() => {
        scrollToLatestMessage(false);

        if (index === arr.length - 1) {
          didInitialAutoScrollRef.current = true;
          forceNextAutoScrollRef.current = false;
          isNearBottomRef.current = true;
        }
      }, delay)
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [groupId, visibleMessages.length, scrollToLatestMessage]);

    useEffect(() => {
    const keyboardEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';

    const subscription = Keyboard.addListener(keyboardEvent, () => {
      setTimeout(() => {
        forceScrollToBottom(true);
      }, Platform.OS === 'ios' ? 120 : 220);
    });

    return () => {
      subscription.remove();
    };
  }, [forceScrollToBottom]);

  useEffect(() => {
    if (!groupId || !relayUrl) return;

    let unsubscribeMessages: (() => void) | undefined;
    let unsubscribeDeletes: (() => void) | undefined;
    let unsubscribeReactions: (() => void) | undefined;
    let unsubscribeEdits: (() => void) | undefined;

    async function startLiveGroupSync() {
      unsubscribeMessages = await subscribeToGroupMessages({
        groupId,
        relayUrl,
        onMessage: async (msg) => {
          const mine = !!npub && msg.senderNpub === npub;

          await saveRemoteGroupMessage({
            id: `nostr_group_${msg.id}`,
            clientMessageId: msg.clientMessageId,
            groupId,
            text: msg.text,
            replyToMessageId: msg.replyToMessageId,
            replyToClientMessageId: msg.replyToClientMessageId,
            replyPreviewText: msg.replyPreviewText,
            replyPreviewSenderName: msg.replyPreviewSenderName,
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

          if (mine || isNearBottomRef.current) {
            forceNextAutoScrollRef.current = true;
          }

          setTimeout(() => scrollToBottomIfAppropriate(true), 50);
        },
      });

      unsubscribeDeletes = await subscribeToGroupMessageDeletes({
        groupId,
        relayUrl,
        onDelete: async (deleteEvent) => {
          await markGroupMessageDeleted({
            groupId,
            messageId: `nostr_group_${deleteEvent.messageId}`,
            clientMessageId: deleteEvent.clientMessageId,
            deletedByNpub: deleteEvent.deletedByNpub,
            deletedAt: deleteEvent.deletedAt,
          });

          await markGroupMessageDeleted({
            groupId,
            messageId: deleteEvent.messageId,
            clientMessageId: deleteEvent.clientMessageId,
            deletedByNpub: deleteEvent.deletedByNpub,
            deletedAt: deleteEvent.deletedAt,
          });

          const next = await getMessagesForGroup(groupId);
          setMessages(next);
        },
      });

      unsubscribeReactions = await subscribeToGroupMessageReactions({
        groupId,
        relayUrl,
        onReaction: async (reactionEvent) => {
          await addGroupMessageReaction({
            groupId,
            messageId: `nostr_group_${reactionEvent.messageId}`,
            clientMessageId: reactionEvent.clientMessageId,
            reaction: reactionEvent.reaction,
            reactorNpub: reactionEvent.reactorNpub,
            reactorName: reactionEvent.reactorName,
            createdAt: reactionEvent.createdAt,
          });

          await addGroupMessageReaction({
            groupId,
            messageId: reactionEvent.messageId,
            clientMessageId: reactionEvent.clientMessageId,
            reaction: reactionEvent.reaction,
            reactorNpub: reactionEvent.reactorNpub,
            reactorName: reactionEvent.reactorName,
            createdAt: reactionEvent.createdAt,
          });

          const next = await getMessagesForGroup(groupId);
          setMessages(next);
        },
      });

      unsubscribeEdits = await subscribeToGroupMessageEdits({
        groupId,
        relayUrl,
        onEdit: async (editEvent) => {
          await editGroupMessage({
            groupId,
            messageId: `nostr_group_${editEvent.messageId}`,
            clientMessageId: editEvent.clientMessageId,
            text: editEvent.text,
            editedAt: editEvent.editedAt,
          });

          await editGroupMessage({
            groupId,
            messageId: editEvent.messageId,
            clientMessageId: editEvent.clientMessageId,
            text: editEvent.text,
            editedAt: editEvent.editedAt,
          });

          const next = await getMessagesForGroup(groupId);
          setMessages(next);
        },
      });
    }

    startLiveGroupSync();

    return () => {
      if (unsubscribeMessages) unsubscribeMessages();
      if (unsubscribeDeletes) unsubscribeDeletes();
      if (unsubscribeReactions) unsubscribeReactions();
      if (unsubscribeEdits) unsubscribeEdits();
    };
  }, [groupId, relayUrl, npub, scrollToBottom]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !groupId || sending) return;

    if (editingMessage) {
      setSending(true);

      try {
        const clientMessageId = editingMessage.clientMessageId || editingMessage.id;

        const edited = await editGroupMessage({
          groupId,
          messageId: editingMessage.id,
          clientMessageId,
          text,
        });

        if (!edited) {
          setSending(false);
          Alert.alert('Edit failed', 'This message can no longer be edited.');
          return;
        }

        setDraft('');
        setInputHeight(40);
        setEditingMessage(null);
        setUploadStatus(null);

        const next = await getMessagesForGroup(groupId);
        setMessages(next);
        setSending(false);

        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });

        if (nsec) {
          const relayMessageId = editingMessage.id.startsWith('nostr_group_')
            ? editingMessage.id.replace('nostr_group_', '')
            : editingMessage.id;

          publishGroupMessageEdit({
            groupId,
            messageId: relayMessageId,
            clientMessageId,
            text,
            editedByNpub: npub ?? undefined,
            nsec,
            relayUrl,
          }).then(result => {
            if (!result.success) {
              console.warn('[Groups] publishGroupMessageEdit failed:', result.error);
            }
          }).catch(error => {
            console.warn('[Groups] publishGroupMessageEdit error:', error);
          });
        }

        return;
      } catch (error: any) {
        setSending(false);
        Alert.alert('Edit failed', error?.message || 'Could not edit message.');

        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });

        return;
      }
    }

    const clientMessageId = createClientMessageId(groupId);
    const activeReplyTarget = replyTarget;

    const replyMetadata = activeReplyTarget
      ? {
          replyToMessageId: activeReplyTarget.id,
          replyToClientMessageId: activeReplyTarget.clientMessageId,
          replyPreviewText: getReplyPreviewText(activeReplyTarget),
          replyPreviewSenderName: getReplyPreviewSenderName(activeReplyTarget),
        }
      : {};

    setSending(true);
    setDraft('');
    setInputHeight(40);
    setReplyTarget(null);
    setUploadStatus(null);

    try {
      await sendLocalGroupMessage({
        groupId,
        clientMessageId,
        text,
        ...replyMetadata,
        mine: true,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
      });

      const localMessages = await getMessagesForGroup(groupId);
      forceNextAutoScrollRef.current = true;
      setMessages(localMessages);
      forceScrollToBottom(true);

      setSending(false);

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });

      if (nsec) {
        publishGroupMessage({
          groupId,
          clientMessageId,
          text,
          ...replyMetadata,
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

    const clientMessageId = createClientMessageId(groupId);
    const activeReplyTarget = replyTarget;

    const replyMetadata = activeReplyTarget
      ? {
          replyToMessageId: activeReplyTarget.id,
          replyToClientMessageId: activeReplyTarget.clientMessageId,
          replyPreviewText: getReplyPreviewText(activeReplyTarget),
          replyPreviewSenderName: getReplyPreviewSenderName(activeReplyTarget),
        }
      : {};

    setReplyTarget(null);
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

    forceScrollToBottom(true);

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
        clientMessageId,
        ...replyMetadata,
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
      forceNextAutoScrollRef.current = true;
      setMessages(localMessages);
      setUploadStatus(null);
      setUploadingImage(false);
      forceScrollToBottom(true);

      if (nsec) {
        publishGroupMessage({
          groupId,
          clientMessageId,
          ...replyMetadata,
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

  const closeMessageActions = () => {
    setActionMessage(null);
  };

  const handleReactToMessage = async (
    message: GroupMessage | PendingUploadMessage,
    reaction?: string
  ) => {
    closeMessageActions();

    if ((message as any).pending || (message as any).isDeleted || !groupId) return;

    const selectedReaction = reaction || '👍';

    if (selectedReaction === '+') {
      Alert.alert('More reactions', 'Custom reaction picker will be added later.');
      return;
    }

    try {
      const clientMessageId = (message as GroupMessage).clientMessageId || message.id;

      await addGroupMessageReaction({
        groupId,
        messageId: message.id,
        clientMessageId,
        reaction: selectedReaction,
        reactorNpub: npub ?? undefined,
        reactorName: myDisplayName,
      });

      const next = await getMessagesForGroup(groupId);
      setMessages(next);

      if (nsec) {
        const relayMessageId = message.id.startsWith('nostr_group_')
          ? message.id.replace('nostr_group_', '')
          : message.id;

        publishGroupMessageReaction({
          groupId,
          messageId: relayMessageId,
          clientMessageId,
          reaction: selectedReaction,
          reactorNpub: npub ?? undefined,
          reactorName: myDisplayName,
          nsec,
          relayUrl,
        }).then(result => {
          if (!result.success) {
            console.warn('[Groups] publishGroupMessageReaction failed:', result.error);
          }
        }).catch(error => {
          console.warn('[Groups] publishGroupMessageReaction error:', error);
        });
      }
    } catch (error) {
      console.warn('[Groups] reaction failed:', error);
      Alert.alert('Reaction failed', 'Could not add your reaction.');
    }
  };

  const handleReplyToMessage = (message: GroupMessage | PendingUploadMessage) => {
    closeMessageActions();

    if ((message as any).pending || (message as any).isDeleted) return;

    setReplyTarget(message as GroupMessage);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleEditMessage = (message: GroupMessage | PendingUploadMessage) => {
    closeMessageActions();

    if (!canEditMessage(message)) {
      Alert.alert('Cannot edit', 'Only your own text-only messages can be edited right now.');
      return;
    }

    const text = message.text?.trim();

    if (!text) {
      Alert.alert('Cannot edit', 'This message does not have editable text.');
      return;
    }

    setReplyTarget(null);
    setEditingMessage(message as GroupMessage);
    setDraft(text);
    setInputHeight(40);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleDeleteMessage = (message: GroupMessage | PendingUploadMessage) => {
    closeMessageActions();

    if (!message.mine || (message as any).pending || !groupId) return;

    Alert.alert(
      'Delete message?',
      'This will delete the message from your group chat. Other devices will update after the delete syncs through the relay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const clientMessageId = (message as GroupMessage).clientMessageId || message.id;

              const deleted = await markGroupMessageDeleted({
                groupId,
                messageId: message.id,
                clientMessageId,
                deletedByNpub: npub ?? undefined,
              });

              if (!deleted) {
                Alert.alert('Not found', 'Could not find this message locally.');
                return;
              }

              const next = await getMessagesForGroup(groupId);
              setMessages(next);

              if (nsec) {
                const relayMessageId = message.id.startsWith('nostr_group_')
                  ? message.id.replace('nostr_group_', '')
                  : message.id;

                publishGroupMessageDelete({
                  groupId,
                  messageId: relayMessageId,
                  clientMessageId,
                  deletedByNpub: npub ?? undefined,
                  nsec,
                  relayUrl,
                }).then(result => {
                  if (!result.success) {
                    console.warn('[Groups] publishGroupMessageDelete failed:', result.error);
                  }
                }).catch(error => {
                  console.warn('[Groups] publishGroupMessageDelete error:', error);
                });
              }
            } catch (error) {
              console.warn('[Groups] local delete failed:', error);
              Alert.alert('Delete failed', 'Could not delete this message.');
            }
          },
        },
      ]
    );
  };

  const handleCopyMessage = async (message: GroupMessage | PendingUploadMessage) => {
    closeMessageActions();

    try {
      const copyText = getCopyTextForMessage(message);

      if (!copyText) {
        Alert.alert('Nothing to copy', 'This message does not have text or attachment links to copy.');
        return;
      }

      await Clipboard.setStringAsync(copyText);

      Alert.alert('Copied', 'Message copied to clipboard.');
    } catch (error) {
      console.warn('[Groups] copy message failed:', error);
      Alert.alert('Copy failed', 'Could not copy this message.');
    }
  };

  const handleMessageLongPress = useCallback((message: GroupMessage | PendingUploadMessage) => {
    if ((message as any).pending) {
      Alert.alert('Uploading', 'This message is still uploading.');
      return;
    }

    setActionMessage(message);
  }, []);


  const handlePressMessageMedia = useCallback((uri: string) => {
    setSelectedMediaUri(uri);
  }, []);

  const renderMessage = useCallback(
    ({ item, index }: { item: GroupMessage | PendingUploadMessage; index: number }) => {
      const prevMsg = index > 0 ? visibleMessages[index - 1] : null;
      const showName = !item.mine && (!prevMsg || prevMsg.senderName !== item.senderName);

      return (
        <MessageBubble
          item={item}
          showName={showName}
          onPressMedia={handlePressMessageMedia}
          onLongPress={handleMessageLongPress}
          s={s}
        />
      );
    },
    [visibleMessages, handlePressMessageMedia, handleMessageLongPress, s]
  );

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
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleContentSizeChange}
            initialNumToRender={14}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={50}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}
            onScrollToIndexFailed={() => {
              setTimeout(() => {
                scrollToBottom(false);
              }, 120);
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

          {editingMessage && (
            <View style={s.replyComposerPreview}>
              <View style={s.editComposerAccent} />

              <View style={{ flex: 1 }}>
                <Text style={s.replyComposerLabel}>
                  Editing message
                </Text>

                <Text style={s.replyComposerText} numberOfLines={1}>
                  {editingMessage.text}
                </Text>
              </View>

              <TouchableOpacity
                style={s.replyComposerClose}
                onPress={clearEditMode}
                activeOpacity={0.75}
              >
                <Text style={s.replyComposerCloseText}>×</Text>
              </TouchableOpacity>
            </View>
          )}

          {!editingMessage && replyTarget && (
            <View style={s.replyComposerPreview}>
              <View style={s.replyComposerAccent} />

              <View style={{ flex: 1 }}>
                <Text style={s.replyComposerLabel}>
                  Replying to {getReplyPreviewSenderName(replyTarget)}
                </Text>

                <Text style={s.replyComposerText} numberOfLines={1}>
                  {getReplyPreviewText(replyTarget)}
                </Text>
              </View>

              <TouchableOpacity
                style={s.replyComposerClose}
                onPress={() => setReplyTarget(null)}
                activeOpacity={0.75}
              >
                <Text style={s.replyComposerCloseText}>×</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={s.composer}>
            <TouchableOpacity
              style={[s.attachBtn, (uploadingImage || !!editingMessage) && s.attachBtnDim]}
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
              disabled={uploadingImage || !!editingMessage}
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
              placeholder={editingMessage ? 'Edit message…' : `Message ${groupName}…`}
              placeholderTextColor={theme.textMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              onFocus={() => {
                forceScrollToBottom(true);
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
                <Text style={s.sendText}>{editingMessage ? '✓' : '↑'}</Text>
              )}
            </TouchableOpacity>
                    </View>

          <Modal
            visible={!!actionMessage}
            transparent
            animationType="fade"
            onRequestClose={closeMessageActions}
          >
            <View style={s.messageActionOverlay}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={closeMessageActions}
              />

              {actionMessage && (
                <View style={s.messageActionContent}>
                  <View style={s.reactionTray}>
                    {['❤️', '👍', '👎', '😂', '🎉', '🔥', '😮'].map(reaction => (
                      <TouchableOpacity
                        key={reaction}
                        style={s.reactionBtn}
                        activeOpacity={0.8}
                        onPress={() => handleReactToMessage(actionMessage, reaction)}
                      >
                        <Text style={s.reactionEmoji}>{reaction}</Text>
                      </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                      style={s.reactionMoreBtn}
                      activeOpacity={0.8}
                      onPress={() => handleReactToMessage(actionMessage, '+')}
                    >
                      <Text style={s.reactionMoreText}>＋</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={s.messageActionCard}>
                    <TouchableOpacity
                      style={s.messageActionRow}
                      activeOpacity={0.75}
                      onPress={() => handleReplyToMessage(actionMessage)}
                    >
                      <Text style={s.messageActionIcon}>↩</Text>
                      <Text style={s.messageActionText}>Reply</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={s.messageActionRow}
                      activeOpacity={0.75}
                      onPress={() => handleCopyMessage(actionMessage)}
                    >
                      <Text style={s.messageActionIcon}>⧉</Text>
                      <Text style={s.messageActionText}>Copy</Text>
                    </TouchableOpacity>

                    {canEditMessage(actionMessage) && (
                      <TouchableOpacity
                        style={s.messageActionRow}
                        activeOpacity={0.75}
                        onPress={() => handleEditMessage(actionMessage)}
                      >
                        <Text style={s.messageActionIcon}>✎</Text>
                        <Text style={s.messageActionText}>Edit message</Text>
                      </TouchableOpacity>
                    )}

                    {actionMessage.mine && (
                      <TouchableOpacity
                        style={s.messageActionRow}
                        activeOpacity={0.75}
                        onPress={() => handleDeleteMessage(actionMessage)}
                      >
                        <Text style={[s.messageActionIcon, s.messageActionDanger]}>⌫</Text>
                        <Text style={[s.messageActionText, s.messageActionDanger]}>
                          Delete message
                        </Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[s.messageActionRow, s.messageActionRowLast]}
                      activeOpacity={0.75}
                      onPress={closeMessageActions}
                    >
                      <Text style={s.messageActionIcon}>×</Text>
                      <Text style={s.messageActionText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </Modal>

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

  replyComposerPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    backgroundColor: theme.surface,
  },
  replyComposerAccent: {
    width: 3,
    height: 34,
    borderRadius: 999,
    backgroundColor: theme.gold,
  },
  editComposerAccent: {
    width: 3,
    height: 34,
    borderRadius: 999,
    backgroundColor: theme.textMuted,
  },
  replyComposerLabel: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
  },
  replyComposerText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  replyComposerClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  replyComposerCloseText: {
    color: theme.textMuted,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },

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

  messageActionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  messageActionContent: {
    alignSelf: 'stretch',
    gap: 12,
  },
  reactionTray: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(24,24,24,0.96)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  reactionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: {
    fontSize: 25,
  },
  reactionMoreBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050505',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  reactionMoreText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 26,
  },
  messageActionCard: {
    alignSelf: 'center',
    width: '82%',
    maxWidth: 360,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(34,34,34,0.98)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  messageActionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  messageActionRowLast: {
    borderBottomWidth: 0,
  },
  messageActionIcon: {
    width: 28,
    color: '#fff',
    fontSize: 24,
    textAlign: 'center',
  },
  messageActionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  messageActionDanger: {
    color: '#ff6b6b',
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