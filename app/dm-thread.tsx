import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { nip19 } from 'nostr-tools';
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
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DMComposer from '../components/chat/DMComposer';
import ImageViewerModal, { type ViewerImage } from '../components/ImageViewerModal';
import { Colors } from '../src/constants/theme';
import { subscribeToDMEvents } from '../src/utils/dm-events';
import {
  getCachedDMProfiles,
  saveCachedDMProfile,
} from '../src/utils/dm-profile-cache';
import {
  getDMMessagePreview,
  getDMThreadById,
  getRecentMessagesForThread,
  markThreadRead,
  saveRemoteDMMessage,
  sendLocalDM,
  type DMMessage,
  type DMMessageMedia
} from '../src/utils/dm-storage';
import {
  compressImageForUpload,
  compressVideoForUpload,
} from '../src/utils/media-compression';
import {
  decodeNostrDMContent,
  encodeNostrDMContent,
  fetchNostrDMs,
  fetchNostrProfile,
  sendNostrDM,
} from '../src/utils/nostr';
import { sendRemoteDMNotification } from '../src/utils/push-notifications';
import { uploadToR2 } from '../src/utils/r2';
import { useIdentity } from './_layout';

type DMThreadRouteParams = {
  id?: string | string[];
  title?: string | string[];
  eventId?: string | string[];
  senderPubkey?: string | string[];
  senderNpub?: string | string[];
  senderName?: string | string[];
  body?: string | string[];
  createdAt?: string | string[];
};

function getRouteParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function makeNotificationMessageId(input: {
  eventId?: string;
  senderPubkey?: string;
  createdAt?: number;
  body?: string;
}) {
  const eventId = input.eventId?.trim();

  if (eventId) {
    return `push_${eventId}`;
  }

  const source = [
    input.senderPubkey?.trim() || 'unknown',
    String(input.createdAt || 0),
    input.body?.trim() || '',
  ].join('|');

  let hash = 0;

  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }

  return `push_${Math.abs(hash)}`;
}

function buildNotificationPreviewMessage(
  params: DMThreadRouteParams,
  threadId: string
): DMMessage | null {
  const body = getRouteParam(params.body)?.trim();

  if (!threadId || !body) return null;

  const createdAtRaw = Number(getRouteParam(params.createdAt));
  const createdAt =
    Number.isFinite(createdAtRaw) && createdAtRaw > 0
      ? createdAtRaw
      : Math.floor(Date.now() / 1000);
  const eventId = getRouteParam(params.eventId);
  const senderPubkey = getRouteParam(params.senderPubkey);

  return {
    id: makeNotificationMessageId({
      eventId,
      senderPubkey,
      createdAt,
      body,
    }),
    threadId,
    text: body,
    mine: false,
    createdAt,
    provisional: true,
    provisionalEventId: eventId,
  };
}

function mergeNewestFirstMessages(
  messages: DMMessage[],
  preview?: DMMessage | null
): DMMessage[] {
  const byId = new Map<string, DMMessage>();

  for (const message of messages) {
    byId.set(message.id, message);
  }

  if (preview) {
    const confirmedMatch = messages.some(message =>
      !message.provisional &&
      message.threadId === preview.threadId &&
      message.mine === preview.mine &&
      (
        (!!preview.provisionalEventId && message.provisionalEventId === preview.provisionalEventId) ||
        (
          message.text === preview.text &&
          Math.abs(message.createdAt - preview.createdAt) <= 180
        )
      )
    );

    if (!confirmedMatch) {
      byId.set(preview.id, preview);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeDMMessageForRender(message: DMMessage): DMMessage {
  const existingMedia = Array.isArray(message.media) ? message.media : [];

  if (existingMedia.length > 0) {
    return message;
  }

  const decoded = decodeNostrDMContent(message.text || '');

  if (decoded.media.length === 0) {
    return message;
  }

  return {
    ...message,
    text: decoded.text,
    media: decoded.media,
  };
}

export default function DmThreadScreen() {
  const { theme, npub, profile } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);

  const router = useRouter();
  const params = useLocalSearchParams<DMThreadRouteParams>();
  const threadId = useMemo(() => getRouteParam(params.id) || '', [params.id]);
  const title = useMemo(() => getRouteParam(params.title) || 'Conversation', [params.title]);
  const notificationEventId = useMemo(() => getRouteParam(params.eventId), [params.eventId]);
  const notificationBody = useMemo(() => getRouteParam(params.body), [params.body]);
  const notificationCreatedAt = useMemo(() => getRouteParam(params.createdAt), [params.createdAt]);
  const notificationSenderPubkey = useMemo(
    () => getRouteParam(params.senderPubkey),
    [params.senderPubkey]
  );
  const notificationSenderName = useMemo(
    () => getRouteParam(params.senderName),
    [params.senderName]
  );
  const notificationPreview = useMemo(
    () => buildNotificationPreviewMessage(
      {
        body: notificationBody,
        createdAt: notificationCreatedAt,
        eventId: notificationEventId,
        senderPubkey: notificationSenderPubkey,
      },
      threadId
    ),
    [
      notificationBody,
      notificationCreatedAt,
      notificationEventId,
      notificationSenderPubkey,
      threadId,
    ]
  );
  const openedFromNotification = !!notificationPreview;

  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
  const [messages, setMessages] = useState<DMMessage[]>(
    () => notificationPreview ? [notificationPreview] : []
  );
  const [loadingInitialMessages, setLoadingInitialMessages] = useState(!notificationPreview);
  const [sending, setSending] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [selectedDMImageUri, setSelectedDMImageUri] = useState<string | null>(null);
  const [activeDMViewerImages, setActiveDMViewerImages] = useState<ViewerImage[]>([]);
  const [hasPubkey, setHasPubkey] = useState(!!notificationSenderPubkey);
  const [profileName, setProfileName] = useState<string | null>(notificationSenderName || null);
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
  const notificationPreviewRef = useRef<DMMessage | null>(notificationPreview);

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

  useEffect(() => {
    notificationPreviewRef.current = notificationPreview;

    if (!notificationPreview) return;

    console.log('[DM THREAD] notification preview painted', {
      threadId,
      messageId: notificationPreview.id,
    });

    setMessages(prev => mergeNewestFirstMessages(prev, notificationPreview));
    setLoadingInitialMessages(false);

    if (notificationSenderPubkey) {
      setHasPubkey(true);
    }

    if (notificationSenderName) {
      setProfileName(notificationSenderName);
    }
  }, [notificationPreview, notificationSenderName, notificationSenderPubkey, threadId]);

  const hydrateThreadProfile = useCallback(async (
    participantPubkey: string,
    fallbackTitle: string
  ) => {
    if (hydratedProfilePubkeyRef.current === participantPubkey) return;

    hydratedProfilePubkeyRef.current = participantPubkey;

    try {
      const cachedProfiles = await getCachedDMProfiles([participantPubkey]);
      const cachedProfile = cachedProfiles[participantPubkey];

      if (cachedProfile && !leavingRef.current) {
        setProfileName(cachedProfile.displayName || fallbackTitle);
        setProfilePicture(cachedProfile.picture || null);
      }
    } catch (error) {
      console.warn('[DM THREAD] cached profile load failed:', error);
    }

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

      await saveCachedDMProfile({
        pubkey: participantPubkey,
        displayName,
        picture: profile.picture,
      });
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
    setLoadingInitialMessages(!notificationPreviewRef.current);

    try {
      const localMessages = await getRecentMessagesForThread(threadId, 30);        

      if (leavingRef.current) return;

      const newestFirstMessages = localMessages
        .map(normalizeDMMessageForRender)
        .sort((a, b) => b.createdAt - a.createdAt);

      setMessages(mergeNewestFirstMessages(
        newestFirstMessages,
        notificationPreviewRef.current
      ));
      setLoadingInitialMessages(false);

      getDMThreadById(threadId)
        .then(thread => {
          if (leavingRef.current) return;

          const participantPubkey = thread?.participantPubkey || notificationSenderPubkey;
          setHasPubkey(!!participantPubkey);

          if (participantPubkey) {
            hydrateThreadProfile(
              participantPubkey,
              thread?.title || notificationSenderName || title
            );
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
  }, [
    threadId,
    hydrateThreadProfile,
    scheduleMarkThreadRead,
    notificationSenderName,
    notificationSenderPubkey,
    title,
  ]);

  const catchUpThreadFromRelay = useCallback(async () => {
  if (!threadId || leavingRef.current) return;
  if (threadCatchUpInFlightRef.current) return;

  threadCatchUpInFlightRef.current = true;
  const catchUpStartedAt = Date.now();

  try {
    const thread = await getDMThreadById(threadId);
    const participantPubkey = notificationSenderPubkey || thread?.participantPubkey;

    if (!participantPubkey || leavingRef.current) return;

    console.log('[DM THREAD] notification catch-up started', {
      threadId,
      participant: participantPubkey.slice(0, 12),
      notificationOpen: openedFromNotification,
    });

    const remoteMessages = await fetchNostrDMs({
      withPubkey: participantPubkey,
      limit: openedFromNotification ? 8 : 20,
      timeoutMs: openedFromNotification ? 1200 : 1800,
    });

    if (leavingRef.current) return;

    for (const msg of remoteMessages) {
      const decodedContent = decodeNostrDMContent(msg.content);

      await saveRemoteDMMessage({
        id: `nostr_${msg.id}`,
        threadId,
        text: decodedContent.text,
        media: decodedContent.media,
        mine: msg.isMine,
        createdAt: msg.createdAt,
        provisionalEventId: msg.rawEvent?.id,
      });
    }

    if (leavingRef.current) return;

    const refreshed = await getRecentMessagesForThread(threadId, 30);
    const newestFirstMessages = refreshed
      .map(normalizeDMMessageForRender)
      .sort((a, b) => b.createdAt - a.createdAt);

    setMessages(mergeNewestFirstMessages(
      newestFirstMessages,
      notificationPreviewRef.current
    ));
    scheduleMarkThreadRead();

    console.log('[DM THREAD] notification catch-up finished', {
      threadId,
      remoteCount: remoteMessages.length,
      elapsedMs: Date.now() - catchUpStartedAt,
    });
  } catch (error) {
    console.warn('[DM THREAD] targeted relay catch-up failed:', error);
  } finally {
    threadCatchUpInFlightRef.current = false;
  }
}, [threadId, notificationSenderPubkey, openedFromNotification, scheduleMarkThreadRead]);

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
  content: encodeNostrDMContent({ text }),
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
    eventId: result.eventIds?.[0],
    createdAt: localMessage.createdAt,
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

    const uploadDMMediaAttachment = async (
    attachment: {
      uri: string;
      type: 'image' | 'video' | 'file';
      fileName?: string;
      mimeType?: string;
    },
    index: number,
    total: number
  ): Promise<DMMessageMedia | null> => {
    let uploadUri = attachment.uri;
    let thumbnailUrl: string | undefined;

    if (attachment.type === 'image') {
      setUploadStatus(`Optimizing photo ${index + 1} of ${total}...`);

      const compressionResult = await compressImageForUpload({
        uri: attachment.uri,
        onStatus: setUploadStatus,
      });

      uploadUri = compressionResult.uri;

      setUploadStatus(
        compressionResult.wasCompressed
          ? `Uploading optimized photo ${index + 1} of ${total}...`
          : `Uploading photo ${index + 1} of ${total}...`
      );
    }

    if (attachment.type === 'video') {
      const compressionResult = await compressVideoForUpload({
        uri: attachment.uri,
        onStatus: setUploadStatus,
        onProgress: progress => {
          setUploadStatus(
            `Compressing video ${index + 1} of ${total}... ${Math.round(progress * 100)}%`
          );
        },
      });

      uploadUri = compressionResult.uri;

      setUploadStatus(
        compressionResult.wasCompressed
          ? `Uploading compressed video ${index + 1} of ${total}...`
          : `Uploading video ${index + 1} of ${total}...`
      );
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
      console.warn('[DM] upload failed for attachment:', attachment.uri);
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
        console.warn('[DM] thumbnail failed:', thumbError);
      }
    }

    return {
      id: `dm_media_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`,
      uri: uploadedUrl,
      type: attachment.type,
      thumbnailUrl,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  };

  const sendDMMediaAttachments = async (
    attachments: {
      uri: string;
      type: 'image' | 'video' | 'file';
      fileName?: string;
      mimeType?: string;
    }[],
    pendingLabel: string
  ) => {
    if (!threadId || leavingRef.current || uploadingAttachment || attachments.length === 0) return;

    const caption = draft.trim();

    setUploadingAttachment(true);
    setUploadStatus(pendingLabel);
    setDraft('');
    setInputHeight(40);

    try {
      const uploadedMedia: DMMessageMedia[] = [];

      for (let i = 0; i < attachments.length; i += 1) {
        const uploaded = await uploadDMMediaAttachment(attachments[i], i, attachments.length);

        if (uploaded) {
          uploadedMedia.push(uploaded);
        }
      }

      if (uploadedMedia.length === 0) {
        Alert.alert('Upload failed', 'Could not upload the selected attachment.');
        return;
      }

      const localMessage = await sendLocalDM({
        threadId,
        text: caption,
        media: uploadedMedia,
        mine: true,
      });

      if (!leavingRef.current) {
        setMessages(prev => {
          const exists = prev.some(message => message.id === localMessage.id);
          if (exists) return prev;

          const next = [localMessage, ...prev].sort((a, b) => b.createdAt - a.createdAt);
          requestAnimationFrame(() => scrollToLatest(true));
          return next;
        });
      }

      const thread = await getDMThreadById(threadId);
      const recipientPubkey = thread?.participantPubkey;

      if (recipientPubkey) {
        const recipientNpub =
          thread.participantNpub ||
          nip19.npubEncode(recipientPubkey);

        const encryptedContent = encodeNostrDMContent({
          text: caption,
          media: uploadedMedia,
        });

        const preview = getDMMessagePreview({
          text: caption,
          media: uploadedMedia,
        });

        sendNostrDM({
          toPubkey: recipientPubkey,
          content: encryptedContent,
        }).then(result => {
          if (!result.success) {
            console.warn('[DM] media send failed:', result.error);
            return;
          }

          if (!npub) {
            console.log('[DM] remote media push skipped; missing sender npub');
            return;
          }

          let senderPubkey = '';

          try {
            const decoded = nip19.decode(npub);

            if (decoded.type === 'npub') {
              senderPubkey = decoded.data as string;
            }
          } catch (error) {
            console.warn('[DM] failed to decode sender npub for media push:', error);
          }

          if (!senderPubkey) {
            console.log('[DM] remote media push skipped; missing sender pubkey');
            return;
          }

          sendRemoteDMNotification({
            recipientNpub,
            senderNpub: npub,
            senderPubkey,
            senderName: myDisplayName,
            body: preview || 'Attachment',
            eventId: result.eventIds?.[0],
            createdAt: localMessage.createdAt,
          }).catch(error => {
            console.warn('[DM] remote media push failed:', error);
          });
        }).catch(error => {
          console.warn('[DM] media publish error:', error);
        });
      }
    } catch (error: any) {
      Alert.alert('Attachment failed', error?.message || 'Could not send the attachment.');
    } finally {
      setUploadingAttachment(false);
      setUploadStatus(null);

      requestAnimationFrame(() => {
        if (!leavingRef.current) {
          inputRef.current?.focus();
        }
      });
    }
  };

  const handlePickDMMedia = async () => {
    if (uploadingAttachment) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow media access to attach photos or videos.');
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
        type: (asset.type === 'video' ? 'video' : 'image') as 'image' | 'video',
        fileName: asset.fileName ?? undefined,
        mimeType: asset.mimeType ?? undefined,
      }));

    const hasVideo = attachments.some(item => item.type === 'video');
    const pendingLabel =
      attachments.length > 1
        ? `Uploading ${attachments.length} attachments...`
        : hasVideo
          ? 'Preparing video...'
          : 'Preparing photo...';

    await sendDMMediaAttachments(attachments, pendingLabel);
  };

  const handleTakeDMPhoto = async () => {
    if (uploadingAttachment) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to take a photo.');
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

    await sendDMMediaAttachments(
      [
        {
          uri: result.assets[0].uri,
          type: 'image',
          fileName: result.assets[0].fileName ?? undefined,
          mimeType: result.assets[0].mimeType ?? undefined,
        },
      ],
      'Preparing photo...'
    );
  };

  const openDMImageViewer = useCallback((
    mediaItems: DMMessageMedia[],
    selectedUri: string
  ) => {
    const images: ViewerImage[] = mediaItems
      .filter(media => media.type === 'image' && !!media.uri)
      .map(media => ({
        id: media.id || media.uri,
        uri: media.uri,
        thumbnailUrl: media.thumbnailUrl,
      }));

    if (images.length === 0) return;

    setActiveDMViewerImages(images);
    setSelectedDMImageUri(selectedUri);
  }, []);

  const closeDMImageViewer = useCallback(() => {
    setSelectedDMImageUri(null);
    setActiveDMViewerImages([]);
  }, []);

  const handlePickDMFiles = async () => {
    if (uploadingAttachment) return;

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
          type: 'file' as const,
          fileName: asset.name,
          mimeType: asset.mimeType,
        }));

      const pendingLabel =
        attachments.length > 1
          ? `Uploading ${attachments.length} files...`
          : 'Uploading file...';

      await sendDMMediaAttachments(attachments, pendingLabel);
    } catch (error) {
      console.warn('[DM] file picker failed:', error);
      Alert.alert('File error', 'Could not open the file picker.');
    }
  };

  const handleDMGifPlaceholder = () => {
    Alert.alert('GIFs coming later', 'GIF and sticker sending will use this composer menu later.');
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
    const displayItem = normalizeDMMessageForRender(item);
    const senderName = item.mine ? 'You' : profileName || title || 'Member';
    const initials = getInitials(senderName);
    const mediaItems = Array.isArray(displayItem.media) ? displayItem.media : [];

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
            {mediaItems.length > 0 && (
              <View style={s.dmMediaStack}>
                {mediaItems.map(media => {
                  if (media.type === 'image') {
                    return (
                      <TouchableOpacity
                        key={media.id}
                        onPress={() => openDMImageViewer(mediaItems, media.uri)}
                        activeOpacity={0.88}
                      >
                        <Image
                          source={{ uri: media.uri }}
                          style={s.dmMediaImage}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>
                    );
                  }

                  if (media.type === 'video') {
                    return media.thumbnailUrl ? (
                      <Image
                        key={media.id}
                        source={{ uri: media.thumbnailUrl }}
                        style={s.dmMediaImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View key={media.id} style={s.dmMediaFile}>
                        <Text style={s.dmMediaFileText}>Video</Text>
                      </View>
                    );
                  }

                  return (
                    <View key={media.id} style={s.dmMediaFile}>
                      <Text style={s.dmMediaFileText} numberOfLines={1}>
                        {media.fileName || 'File'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {!!displayItem.text.trim() && (
              <Text style={s.dmMessageText}>{displayItem.text}</Text>
            )}

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

                    {!!uploadStatus && (
            <View style={s.uploadStatus}>
              <Text style={s.uploadStatusText}>{uploadStatus}</Text>
            </View>
          )}

          <DMComposer
            theme={theme}
            value={draft}
            placeholder={`Message ${profileName || title}...`}
            inputRef={inputRef}
            inputHeight={inputHeight}
            sending={sending}
            uploading={uploadingAttachment}
            onChangeText={setDraft}
            onContentSizeChange={setInputHeight}
            onFocus={() => {
              setTimeout(() => scrollToLatest(true), 200);
            }}
            onSend={handleSend}
            onPickPhotos={handlePickDMMedia}
            onTakePhoto={handleTakeDMPhoto}
            onPickFiles={handlePickDMFiles}
            onPickGif={handleDMGifPlaceholder}
          />

          <ImageViewerModal
            images={activeDMViewerImages}
            selectedUri={selectedDMImageUri}
            onClose={closeDMImageViewer}
          />
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
  dmMediaStack: {
    gap: 8,
    marginBottom: 8,
  },
  dmMediaImage: {
    width: 220,
    height: 160,
    borderRadius: 14,
    backgroundColor: theme.surface,
  },
  dmMediaFile: {
    minWidth: 190,
    maxWidth: 240,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dmMediaFileText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '800',
  },
  uploadStatus: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  uploadStatusText: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '800',
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
