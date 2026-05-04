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
  addGroupPollVote,
  editGroupMessage,
  getMessagesForGroup,
  markGroupMessageDeleted,
  saveRemoteGroupMessage,
  sendLocalGroupMessage,
  sendLocalGroupPoll,
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
  fetchGroupPollVotes,
  publishGroupMessage,
  publishGroupMessageDelete,
  publishGroupMessageEdit,
  publishGroupMessageReaction,
  publishGroupPollVote,
  subscribeToGroupMessageDeletes,
  subscribeToGroupMessageEdits,
  subscribeToGroupMessageReactions,
  subscribeToGroupMessages,
  subscribeToGroupPollVotes,
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

type VisibleGroupMessage = {
  id: string;
  message: GroupMessage | PendingUploadMessage;
  avatarUrl?: string;
  showName: boolean;
};

const QUICK_REACTIONS = ['❤️', '👍', '😂', '🎉', '🔥', '😮'];

const REACTION_PACKS = [
  {
    title: 'Popular',
    reactions: ['❤️', '👍', '👎', '😂', '🎉', '🔥', '😮', '😢'],
  },
  {
    title: 'Support',
    reactions: ['🙏', '👏', '💪', '⭐', '✅', '🙌', '💛', '🥹'],
  },
  {
    title: 'Sports',
    reactions: ['🏀', '⚾', '🏈', '⚽', '🏐', '🏆', '🥇', '💯'],
  },
  {
    title: 'Family',
    reactions: ['💛', '📸', '🎂', '🎓', '🥳', '✨', '🫶', '🌟'],
  },
];

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
  const [initialListReady, setInitialListReady] = useState(false);
const [sending, setSending] = useState(false);
const [uploadingImage, setUploadingImage] = useState(false);

const [uploadStatus, setUploadStatus] = useState<string | null>(null);
const [pendingUploads, setPendingUploads] = useState<PendingUploadMessage[]>([]);
const [selectedMediaUri, setSelectedMediaUri] = useState<string | null>(null);
const [memberAvatarMap, setMemberAvatarMap] = useState<Record<string, string | undefined>>({});
const [actionMessage, setActionMessage] = useState<GroupMessage | PendingUploadMessage | null>(null);
const [showReactionPicker, setShowReactionPicker] = useState(false);
const [replyTarget, setReplyTarget] = useState<GroupMessage | null>(null);
const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
const [showComposerMenu, setShowComposerMenu] = useState(false);
const [showPollModal, setShowPollModal] = useState(false);
const [pollQuestion, setPollQuestion] = useState('');
const [pollOptions, setPollOptions] = useState(['', '']);
const [creatingPoll, setCreatingPoll] = useState(false);
const [pollDetailsMessage, setPollDetailsMessage] = useState<GroupMessage | PendingUploadMessage | null>(null);

  const listRef = useRef<FlatList<VisibleGroupMessage>>(null);

  const inputRef = useRef<TextInput>(null);
  const isNearBottomRef = useRef(true);
  const didInitialAutoScrollRef = useRef(false);
  const forceNextAutoScrollRef = useRef(false);
  const initialRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myDisplayName =
    profile?.display_name ||
    profile?.name ||
    (npub ? `${npub.slice(0, 12)}…` : 'You');

  const normalizedPollOptions = useMemo(
    () => pollOptions.map(option => option.trim()).filter(Boolean),
    [pollOptions]
  );

  const hasDuplicatePollOptions = useMemo(() => {
    const lowered = normalizedPollOptions.map(option => option.toLowerCase());

    return new Set(lowered).size !== lowered.length;
  }, [normalizedPollOptions]);

  const canCreatePoll = (
    pollQuestion.trim().length > 0 &&
    normalizedPollOptions.length >= 2 &&
    !hasDuplicatePollOptions &&
    !creatingPoll
  );

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

  const visibleMessages = useMemo<VisibleGroupMessage[]>(
    () => {
      const myAvatarUrl =
        (profile as any)?.picture ||
        (profile as any)?.avatarUrl ||
        undefined;

      const sortedMessages = [...messages, ...pendingUploads].sort(
        (a, b) => a.createdAt - b.createdAt
      );

      return sortedMessages.map((message, index) => {
        const previousMessage = index > 0 ? sortedMessages[index - 1] : null;
        const senderNpub = (message as any).senderNpub;

        const avatarUrl =
          message.mine
            ? myAvatarUrl
            : senderNpub
              ? memberAvatarMap[senderNpub]
              : undefined;

        const showName =
          !message.mine &&
          (!previousMessage || previousMessage.senderName !== message.senderName);

        return {
          id: message.id,
          message,
          avatarUrl,
          showName,
        };
      });
    },
    [messages, pendingUploads, memberAvatarMap, profile]
  );

  const chatMessages = useMemo(
    () => [...visibleMessages].reverse(),
    [visibleMessages]
  );

  const getReplyPreviewText = useCallback((message: GroupMessage | PendingUploadMessage): string => {
    if ((message as any).isDeleted) return 'Message deleted';

    const pollQuestion = (message as any).poll?.question?.trim();

    if (pollQuestion) {
      return pollQuestion.length > 80
        ? `Poll: ${pollQuestion.slice(0, 80)}…`
        : `Poll: ${pollQuestion}`;
    }

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

    const poll = (message as any).poll;

    if (poll?.question && Array.isArray(poll.options)) {
      const optionLines = poll.options
        .map((option: any, index: number) => `${index + 1}. ${option.text || 'Option'}`)
        .join('\n');

      return `Poll: ${poll.question}\n\n${optionLines}`;
    }

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
    if ((message as any).poll) return false;

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
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, []);

  const scrollToLatestMessage = useCallback((animated = false) => {
    if (chatMessages.length === 0) return;

    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, [chatMessages.length]);

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
    const { contentOffset } = event.nativeEvent;

    isNearBottomRef.current = contentOffset.y < 140;
  }, []);


  const handleContentSizeChange = useCallback(() => {
    if (!forceNextAutoScrollRef.current) return;

    setTimeout(() => {
      if (!forceNextAutoScrollRef.current) return;

      scrollToBottom(true);
      forceNextAutoScrollRef.current = false;
      isNearBottomRef.current = true;
      didInitialAutoScrollRef.current = true;
    }, 80);
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
    setInitialListReady(false);
    didInitialAutoScrollRef.current = false;
    forceNextAutoScrollRef.current = false;
    isNearBottomRef.current = true;

    if (initialRevealTimerRef.current) {
      clearTimeout(initialRevealTimerRef.current);
      initialRevealTimerRef.current = null;
    }


    try {
      const localMessages = await getMessagesForGroup(groupId);

      setMessages(localMessages);
      setLoadingInitialMessages(false);
      setInitialListReady(true);
      didInitialAutoScrollRef.current = true;
      isNearBottomRef.current = true;

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
            poll: msg.poll,
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

        const [deleteEvents, reactionEvents, editEvents, pollVoteEvents] = await Promise.all([
          fetchGroupMessageDeletes(groupId, relayUrl),
          fetchGroupMessageReactions(groupId, relayUrl),
          fetchGroupMessageEdits(groupId, relayUrl),
          fetchGroupPollVotes(groupId, relayUrl),
        ]);

        for (const pollVoteEvent of pollVoteEvents) {
          await addGroupPollVote({
            groupId,
            messageId: `nostr_group_${pollVoteEvent.messageId}`,
            clientMessageId: pollVoteEvent.clientMessageId,
            optionId: pollVoteEvent.optionId,
            voterNpub: pollVoteEvent.voterNpub,
            voterName: pollVoteEvent.voterName,
            createdAt: pollVoteEvent.createdAt,
          });

          await addGroupPollVote({
            groupId,
            messageId: pollVoteEvent.messageId,
            clientMessageId: pollVoteEvent.clientMessageId,
            optionId: pollVoteEvent.optionId,
            voterNpub: pollVoteEvent.voterNpub,
            voterName: pollVoteEvent.voterName,
            createdAt: pollVoteEvent.createdAt,
          });
        }


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
    if (!groupId || !relayUrl) return;

    let unsubscribeMessages: (() => void) | undefined;
    let unsubscribeDeletes: (() => void) | undefined;
    let unsubscribeReactions: (() => void) | undefined;
    let unsubscribeEdits: (() => void) | undefined;
    let unsubscribePollVotes: (() => void) | undefined;


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
            poll: msg.poll,
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

      unsubscribePollVotes = await subscribeToGroupPollVotes({
        groupId,
        relayUrl,
        onVote: async (pollVoteEvent) => {
          await addGroupPollVote({
            groupId,
            messageId: `nostr_group_${pollVoteEvent.messageId}`,
            clientMessageId: pollVoteEvent.clientMessageId,
            optionId: pollVoteEvent.optionId,
            voterNpub: pollVoteEvent.voterNpub,
            voterName: pollVoteEvent.voterName,
            createdAt: pollVoteEvent.createdAt,
          });

          await addGroupPollVote({
            groupId,
            messageId: pollVoteEvent.messageId,
            clientMessageId: pollVoteEvent.clientMessageId,
            optionId: pollVoteEvent.optionId,
            voterNpub: pollVoteEvent.voterNpub,
            voterName: pollVoteEvent.voterName,
            createdAt: pollVoteEvent.createdAt,
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
      if (unsubscribePollVotes) unsubscribePollVotes();
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

  const closeComposerMenu = useCallback(() => {
    setShowComposerMenu(false);
  }, []);

  const handlePickMedia = async () => {
    closeComposerMenu();

    if (!groupId || uploadingImage) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow media access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
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
    closeComposerMenu();

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
    closeComposerMenu();

    if (!groupId || uploadingImage) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access.');
      return;
    }

    setUploadStatus('Opening camera...');

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
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

  const openPollCreator = () => {
    closeComposerMenu();
    setPollQuestion('');
    setPollOptions(['', '']);
    setShowPollModal(true);
  };

  const closePollCreator = () => {
    if (creatingPoll) return;

    setShowPollModal(false);
    setPollQuestion('');
    setPollOptions(['', '']);
  };

  const updatePollOption = (index: number, value: string) => {
    setPollOptions(current =>
      current.map((option, optionIndex) => (
        optionIndex === index ? value : option
      ))
    );
  };

  const addPollOptionInput = () => {
    setPollOptions(current => {
      if (current.length >= 6) return current;

      return [...current, ''];
    });
  };

  const removePollOptionInput = (index: number) => {
    setPollOptions(current => {
      if (current.length <= 2) return current;

      return current.filter((_, optionIndex) => optionIndex !== index);
    });
  };

  const handleCreatePoll = async () => {
    if (!groupId || creatingPoll) return;

    const question = pollQuestion.trim();
    const options = normalizedPollOptions;

    if (!question) {
      Alert.alert('Poll question needed', 'Add a question for the group.');
      return;
    }

    if (options.length < 2) {
      Alert.alert('Poll options needed', 'Add at least two options.');
      return;
    }

    if (hasDuplicatePollOptions) {
      Alert.alert('Duplicate options', 'Each poll option needs to be different.');
      return;
    }

    const clientMessageId = createClientMessageId(groupId);

    setCreatingPoll(true);

    try {
      const localPollMessage = await sendLocalGroupPoll({
        groupId,
        clientMessageId,
        question,
        options,
        mine: true,
        senderNpub: npub ?? undefined,
        senderName: myDisplayName,
      });

      setShowPollModal(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      setUploadStatus(null);

      const localMessages = await getMessagesForGroup(groupId);
      forceNextAutoScrollRef.current = true;
      setMessages(localMessages);
      forceScrollToBottom(true);
      setCreatingPoll(false);

      if (nsec && localPollMessage.poll) {
        publishGroupMessage({
          groupId,
          clientMessageId,
          poll: localPollMessage.poll,
          senderNpub: npub ?? undefined,
          senderName: myDisplayName,
          nsec,
          relayUrl,
        }).then(result => {
          if (!result.success) {
            console.warn('[Groups] publishGroupMessage poll failed:', result.error);
          }
        }).catch(error => {
          console.warn('[Groups] publishGroupMessage poll error:', error);
        });
      }
    } catch (error: any) {
      setCreatingPoll(false);
      Alert.alert('Poll failed', error?.message || 'Could not create poll.');
    }
  };

  const handleGifPlaceholder = () => {
    closeComposerMenu();
    Alert.alert('GIFs coming later', 'GIF sending will be added through this composer menu later.');
  };


  const handleBack = () => {
    router.navigate('/(tabs)/groups' as any);
  };

  const handleOpenInfo = () => {
    router.push({ pathname: '/group-detail', params: { id: groupId } } as any);
  };

  const closeMessageActions = () => {
    setShowReactionPicker(false);
    setActionMessage(null);
  };

  const handleReactToMessage = async (
    message: GroupMessage | PendingUploadMessage,
    reaction?: string
  ) => {
    if ((message as any).pending || (message as any).isDeleted || !groupId) return;

    const selectedReaction = reaction || '👍';

    if (selectedReaction === '+') {
      setShowReactionPicker(current => !current);
      return;
    }

    setShowReactionPicker(false);
    closeMessageActions();

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

    setShowReactionPicker(false);
    setActionMessage(message);
  }, []);

  const handlePressMessageMedia = useCallback((uri: string) => {
    setSelectedMediaUri(uri);
  }, []);

  const handlePollVote = useCallback(async (message: GroupMessage | PendingUploadMessage, optionId: string) => {
    if (!groupId || !optionId) return;
    if ((message as any).pending || (message as any).isDeleted || !(message as any).poll) return;

    const existingVote = Array.isArray((message as any).poll?.votes)
      ? (message as any).poll.votes.find((vote: any) => vote?.voterNpub && vote.voterNpub === npub)
      : undefined;

    if (existingVote?.optionId === optionId) {
      return;
    }

    try {
      const clientMessageId = (message as GroupMessage).clientMessageId || message.id;

      await addGroupPollVote({
        groupId,
        messageId: message.id,
        clientMessageId,
        optionId,
        voterNpub: npub ?? undefined,
        voterName: myDisplayName,
      });

      const next = await getMessagesForGroup(groupId);
      setMessages(next);

      if (nsec) {
        const relayMessageId = message.id.startsWith('nostr_group_')
          ? message.id.replace('nostr_group_', '')
          : message.id;

        publishGroupPollVote({
          groupId,
          messageId: relayMessageId,
          clientMessageId,
          optionId,
          voterNpub: npub ?? undefined,
          voterName: myDisplayName,
          nsec,
          relayUrl,
        }).then(result => {
          if (!result.success) {
            console.warn('[Groups] publishGroupPollVote failed:', result.error);
          }
        }).catch(error => {
          console.warn('[Groups] publishGroupPollVote error:', error);
        });
      }
    } catch (error) {
      console.warn('[Groups] poll vote failed:', error);
      Alert.alert('Vote failed', 'Could not save your vote.');
    }
  }, [groupId, myDisplayName, npub, nsec, relayUrl]);

  const handlePollDetails = useCallback((message: GroupMessage | PendingUploadMessage) => {
    if ((message as any).pending || (message as any).isDeleted || !(message as any).poll) return;

    setPollDetailsMessage(message);
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: VisibleGroupMessage }) => {
      return (
        <MessageBubble
          item={item.message}
          showName={item.showName}
          avatarUrl={item.avatarUrl}
          onPressMedia={handlePressMessageMedia}
          onLongPress={handleMessageLongPress}
          onPollVote={handlePollVote}
          onPollDetails={handlePollDetails}
          s={s}
        />
      );
    },
    [handlePressMessageMedia, handleMessageLongPress, handlePollVote, handlePollDetails, s]
  );

  const shouldHideInitialList = false;

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
            style={[s.messageList, shouldHideInitialList && s.messageListHidden]}
            data={chatMessages}
            keyExtractor={item => item.id}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            inverted
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleContentSizeChange}
            initialNumToRender={40}
            maxToRenderPerBatch={20}
            updateCellsBatchingPeriod={16}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}

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

          {shouldHideInitialList && (
            <View style={s.initialListOverlay}>
              <ActivityIndicator size="small" color={theme.gold} />
              <Text style={s.initialListOverlayText}>Loading latest messages…</Text>
            </View>
          )}

          {uploadStatus && (
            <View style={s.uploadBanner}>
              <Text style={s.uploadText}>{uploadStatus}</Text>
            </View>
          )}


          {editingMessage && (
            <View style={s.replyComposerPreview}>
              <View style={s.editComposerAccent} />

              <View style={{ flex: 1 }}>
                <Text style={s.editComposerLabel}>
                  Editing message
                </Text>

                <Text style={s.replyComposerText} numberOfLines={1}>
                  {editingMessage.text}
                </Text>
              </View>

              <TouchableOpacity
                style={s.editComposerCancel}
                onPress={clearEditMode}
                activeOpacity={0.75}
              >
                <Text style={s.editComposerCancelText}>Cancel</Text>
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

          {showComposerMenu && (
            <View style={s.composerMenu}>
              <TouchableOpacity
                style={s.composerMenuItem}
                onPress={handlePickMedia}
                activeOpacity={0.82}
              >
                <Text style={s.composerMenuIcon}>🖼️</Text>
                <View style={s.composerMenuTextBlock}>
                  <Text style={s.composerMenuTitle}>Media</Text>
                  <Text style={s.composerMenuHint}>Photos and videos</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.composerMenuItem}
                onPress={handleTakePhoto}
                activeOpacity={0.82}
              >
                <Text style={s.composerMenuIcon}>📷</Text>
                <View style={s.composerMenuTextBlock}>
                  <Text style={s.composerMenuTitle}>Camera</Text>
                  <Text style={s.composerMenuHint}>Take a photo</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.composerMenuItem}
                onPress={handlePickFiles}
                activeOpacity={0.82}
              >
                <Text style={s.composerMenuIcon}>📎</Text>
                <View style={s.composerMenuTextBlock}>
                  <Text style={s.composerMenuTitle}>File</Text>
                  <Text style={s.composerMenuHint}>Docs, PDFs, and attachments</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.composerMenuItem}
                onPress={openPollCreator}
              >
                <Text style={s.composerMenuIcon}>📊</Text>
                <View style={s.composerMenuTextBlock}>
                  <Text style={s.composerMenuTitle}>Poll</Text>
                  <Text style={s.composerMenuHint}>Ask the group to vote</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.composerMenuItem, s.composerMenuItemDim]}
                onPress={handleGifPlaceholder}
                activeOpacity={0.82}
              >
                <Text style={s.composerMenuIcon}>GIF</Text>
                <View style={s.composerMenuTextBlock}>
                  <Text style={s.composerMenuTitle}>GIF</Text>
                  <Text style={s.composerMenuHint}>Coming later</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.composerMenuItem, s.composerMenuCancelItem]}
                onPress={closeComposerMenu}
                activeOpacity={0.82}
              >
                <Text style={s.composerMenuIcon}>×</Text>
                <View style={s.composerMenuTextBlock}>
                  <Text style={s.composerMenuCancelTitle}>Close</Text>
                  <Text style={s.composerMenuHint}>Hide attachment options</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          <View style={s.composer}>
            <TouchableOpacity
              style={[
                s.attachBtn,
                (uploadingImage || !!editingMessage) && s.attachBtnDim,
                showComposerMenu && s.attachBtnActive,
              ]}
              onPress={() => setShowComposerMenu(current => !current)}
              disabled={uploadingImage || !!editingMessage}
              activeOpacity={0.8}
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
                closeComposerMenu();
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
                    {QUICK_REACTIONS.map(reaction => (
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
                      style={[
                        s.reactionMoreBtn,
                        showReactionPicker && s.reactionMoreBtnActive,
                      ]}
                      activeOpacity={0.8}
                      onPress={() => handleReactToMessage(actionMessage, '+')}
                    >
                      <Text style={s.reactionMoreText}>＋</Text>
                    </TouchableOpacity>
                  </View>

                  {showReactionPicker && (
                    <View style={s.reactionPackCard}>
                      {REACTION_PACKS.map(pack => (
                        <View key={pack.title} style={s.reactionPackSection}>
                          <Text style={s.reactionPackTitle}>{pack.title}</Text>

                          <View style={s.reactionPackRow}>
                            {pack.reactions.map(reaction => (
                              <TouchableOpacity
                                key={`${pack.title}_${reaction}`}
                                style={s.reactionPackOption}
                                activeOpacity={0.8}
                                onPress={() => handleReactToMessage(actionMessage, reaction)}
                              >
                                <Text style={s.reactionPackEmoji}>{reaction}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}


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

          <Modal
            visible={!!pollDetailsMessage}
            transparent
            animationType="fade"
            onRequestClose={() => setPollDetailsMessage(null)}
          >
            <View style={s.pollDetailsOverlay}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setPollDetailsMessage(null)}
              />

              {pollDetailsMessage && (pollDetailsMessage as any).poll && (
                <View style={s.pollDetailsCard}>
                  <View style={s.pollDetailsHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.pollDetailsTitle}>Poll results</Text>
                      <Text style={s.pollDetailsQuestion} numberOfLines={3}>
                        {(pollDetailsMessage as any).poll.question}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={s.pollDetailsCloseBtn}
                      onPress={() => setPollDetailsMessage(null)}
                      activeOpacity={0.75}
                    >
                      <Text style={s.pollDetailsCloseText}>×</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={s.pollDetailsBody}>
                    {(pollDetailsMessage as any).poll.options.map((option: any) => {
                      const votes = Array.isArray((pollDetailsMessage as any).poll.votes)
                        ? (pollDetailsMessage as any).poll.votes.filter((vote: any) => vote?.optionId === option.id)
                        : [];

                      return (
                        <View key={option.id} style={s.pollDetailsOptionBlock}>
                          <View style={s.pollDetailsOptionHeader}>
                            <Text style={s.pollDetailsOptionText} numberOfLines={2}>
                              {option.text}
                            </Text>

                            <Text style={s.pollDetailsOptionCount}>
                              {votes.length === 1 ? '1 vote' : `${votes.length} votes`}
                            </Text>
                          </View>

                          {votes.length > 0 ? (
                            <View style={s.pollDetailsVoterList}>
                              {votes.map((vote: any) => {
                                const label =
                                  vote?.voterName ||
                                  (vote?.voterNpub ? `${vote.voterNpub.slice(0, 12)}…` : 'Member');

                                return (
                                  <View
                                    key={vote.id || `${option.id}_${label}`}
                                    style={s.pollDetailsVoterPill}
                                  >
                                    <Text style={s.pollDetailsVoterText} numberOfLines={1}>
                                      {label}
                                    </Text>
                                  </View>
                                );
                              })}
                            </View>
                          ) : (
                            <Text style={s.pollDetailsNoVotes}>No votes yet</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          </Modal>


          <Modal
            visible={showPollModal}
            transparent
            animationType="fade"
            onRequestClose={closePollCreator}
          >
            <View style={s.pollModalOverlay}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={closePollCreator}
              />

              <View style={s.pollModalCard}>
                <Text style={s.pollModalTitle}>Create poll</Text>
                <Text style={s.pollModalHint}>Ask the group to vote.</Text>

                <TextInput
                  style={s.pollQuestionInput}
                  placeholder="Poll question"
                  placeholderTextColor={theme.textMuted}
                  value={pollQuestion}
                  onChangeText={setPollQuestion}
                  multiline
                  maxLength={180}
                />

                <View style={s.pollOptionsBlock}>
                  {pollOptions.map((option, index) => (
                    <View key={`poll_option_input_${index}`} style={s.pollOptionInputRow}>
                      <TextInput
                        style={s.pollOptionInput}
                        placeholder={`Option ${index + 1}`}
                        placeholderTextColor={theme.textMuted}
                        value={option}
                        onChangeText={(value) => updatePollOption(index, value)}
                        maxLength={80}
                      />

                      {pollOptions.length > 2 && (
                        <TouchableOpacity
                          style={s.pollOptionRemoveBtn}
                          onPress={() => removePollOptionInput(index)}
                          activeOpacity={0.75}
                        >
                          <Text style={s.pollOptionRemoveText}>×</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>

                {pollOptions.length < 6 && (
                  <TouchableOpacity
                    style={s.pollAddOptionBtn}
                    onPress={addPollOptionInput}
                    activeOpacity={0.8}
                  >
                    <Text style={s.pollAddOptionText}>＋ Add option</Text>
                  </TouchableOpacity>
                )}

                <View style={s.pollModalActions}>
                  <TouchableOpacity
                    style={s.pollCancelBtn}
                    onPress={closePollCreator}
                    disabled={creatingPoll}
                    activeOpacity={0.8}
                  >
                    <Text style={s.pollCancelText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      s.pollCreateBtn,
                      !canCreatePoll && s.sendBtnDim,
                    ]}
                    onPress={handleCreatePoll}
                    disabled={!canCreatePoll}
                    activeOpacity={0.8}
                  >
                    {creatingPoll ? (
                      <ActivityIndicator size="small" color={theme.bg} />
                    ) : (
                      <Text style={s.pollCreateText}>Create</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
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

function themeModeAwareOverlay(theme: typeof Colors.light): string {
  return theme.bg === Colors.light.bg
    ? 'rgba(17, 24, 28, 0.28)'
    : 'rgba(0, 0, 0, 0.58)';
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

  messageList: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  messageListHidden: {
    opacity: 0,
  },
  list: {
    padding: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  initialListOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 62,
    bottom: 70,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg,
    zIndex: 5,
    gap: 10,
  },
  initialListOverlayText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
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
  editComposerLabel: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
  },
  editComposerCancel: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  editComposerCancelText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '900',
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
  attachBtnActive: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  attachBtnDim: { opacity: 0.5 },
  attachText: {
    fontSize: 24,
    color: theme.gold,
    lineHeight: 26,
  },
  composerMenu: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 18,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  composerMenuItem: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
  },
  composerMenuItemDim: {
    opacity: 0.62,
  },
  composerMenuIcon: {
    width: 34,
    color: theme.gold,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  composerMenuTextBlock: {
    flex: 1,
  },
  composerMenuTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '900',
  },
  composerMenuCancelItem: {
    borderBottomWidth: 0,
    backgroundColor: theme.raised,
  },
  composerMenuCancelTitle: {
    color: theme.gold,
    fontSize: 14,
    fontWeight: '900',
  },
  composerMenuHint: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
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

  pollDetailsOverlay: {
    flex: 1,
    backgroundColor: themeModeAwareOverlay(theme),
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pollDetailsCard: {
    maxHeight: '78%',
    borderRadius: 20,
    padding: 16,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  pollDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  pollDetailsTitle: {
    color: theme.gold,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  pollDetailsQuestion: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
  },
  pollDetailsCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  pollDetailsCloseText: {
    color: theme.textMuted,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  pollDetailsBody: {
    gap: 10,
  },
  pollDetailsOptionBlock: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: theme.bg,
    borderWidth: 0.5,
    borderColor: theme.border,
    gap: 8,
  },
  pollDetailsOptionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  pollDetailsOptionText: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  pollDetailsOptionCount: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '900',
  },
  pollDetailsVoterList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pollDetailsVoterPill: {
    maxWidth: '100%',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  pollDetailsVoterText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '800',
  },
  pollDetailsNoVotes: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },

  pollModalOverlay: {
    flex: 1,
    backgroundColor: themeModeAwareOverlay(theme),
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pollModalCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  pollModalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '900',
  },
  pollModalHint: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  pollQuestionInput: {
    minHeight: 52,
    maxHeight: 96,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
    textAlignVertical: 'top',
  },
  pollOptionsBlock: {
    marginTop: 12,
    gap: 8,
  },
  pollOptionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pollOptionInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  pollOptionRemoveBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  pollOptionRemoveText: {
    color: theme.textMuted,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  pollAddOptionBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  pollAddOptionText: {
    color: theme.gold,
    fontSize: 13,
    fontWeight: '900',
  },
  pollModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  pollCancelBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  pollCancelText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  pollCreateBtn: {
    minHeight: 40,
    minWidth: 90,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.gold,
  },
  pollCreateText: {
    color: theme.bg,
    fontSize: 14,
    fontWeight: '900',
  },

  messageActionOverlay: {
    flex: 1,
    backgroundColor: themeModeAwareOverlay(theme),
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
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  reactionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
  },
  reactionEmoji: {
    fontSize: 24,
  },
  reactionMoreBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  reactionMoreText: {
    color: theme.gold,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 26,
  },
  reactionMoreBtnActive: {
    borderColor: theme.gold,
  },
  reactionPackCard: {
    alignSelf: 'center',
    width: '92%',
    maxWidth: 390,
    borderRadius: 18,
    padding: 14,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    gap: 12,
  },
  reactionPackSection: {
    gap: 8,
  },
  reactionPackTitle: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  reactionPackRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionPackOption: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPackEmoji: {
    fontSize: 23,
  },
  messageActionCard: {
    alignSelf: 'center',
    width: '82%',
    maxWidth: 360,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  messageActionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
  },
  messageActionRowLast: {
    borderBottomWidth: 0,
  },
  messageActionIcon: {
    width: 28,
    color: theme.gold,
    fontSize: 22,
    textAlign: 'center',
  },
  messageActionText: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
  },
  messageActionDanger: {
    color: theme.danger,
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