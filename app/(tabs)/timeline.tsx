import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  Image,
  Keyboard,
  Modal,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type GestureResponderEvent
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import EmojiReactionStrip from '../../components/EmojiReactionStrip';
import ImageViewerModal, { ViewerImage } from '../../components/ImageViewerModal';
import LivingPromptNudgeCard from '../../components/LivingPromptNudgeCard';
import MarkActionRow from '../../components/MarkActionRow';
import MarkCommentsSheet from '../../components/MarkCommentsSheet';
import MediaCollage from '../../components/MediaCollage';
import BroadcastsFeed from '../../components/timeline/BroadcastsFeed';
import FollowingFeed from '../../components/timeline/FollowingFeed';
import MyMarksFeed, {
  buildMyMarksFeedItems,
  getMyMarksFeedMediaItems,
  type MyMarksFeedItem,
} from '../../components/timeline/MyMarksFeed';
import TimelineTextMarkCard from '../../components/TimelineTextMarkCard';
import TimelineVoiceMarkCard from '../../components/TimelineVoiceMarkCard';
import type { LivingMarkPromptCard } from '../../src/types/living-spaces';
import {
  applyLivingMarkPromptAction,
  getLivingMarkPromptCards,
} from '../../src/utils/living-spaces-storage';
import { DEFAULT_RELAY, fetchFamilyMembers, fetchFamilyMilestones, publishFamilyMilestone } from '../../src/utils/nostr';
import {
  getMilestones,
  saveRemoteMilestone,
  updateMilestone,
  upsertFamilyMember,
  type Milestone,
  type MilestoneLiftUp,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

type FeedKey = 'profile' | 'follows' | 'subscribed';
type ComposerMode = 'reflect' | 'comment';

type TimelineFeedItem = MyMarksFeedItem;

type SheetComposerState = {
  item: TimelineFeedItem;
  mode: ComposerMode;
};

const FEED_OPTIONS: { key: FeedKey; label: string; hint: string }[] = [
  { key: 'profile', label: 'My Marks', hint: 'Marks you created and saved' },
  { key: 'follows', label: 'Following', hint: 'Marks from people you follow' },
  { key: 'subscribed', label: 'Broadcasts', hint: 'Community and public feeds you subscribe to' },
];

const LIFT_UP_CHOICES: Pick<MilestoneLiftUp, 'type' | 'label' | 'emoji'>[] = [
  { type: 'lifted', label: 'Loved', emoji: '❤️' },
  { type: 'cheered', label: 'Liked', emoji: '👍' },
  { type: 'proud', label: 'Laughing', emoji: '😂' },
  { type: 'grateful', label: 'Celebrating', emoji: '🎉' },
  { type: 'celebrating', label: 'Fired up', emoji: '🔥' },
  { type: 'encouraged', label: 'Surprised', emoji: '😮' },
];

function getTimelineCommentCount(milestone: Milestone): number {
  return Array.isArray(milestone.reflections) ? milestone.reflections.length : 0;
}

function getTimelineLiftUpCount(milestone: Milestone): number {
  const mark = milestone as any;

  if (Array.isArray(mark.liftUps)) return mark.liftUps.length;
  if (Array.isArray(mark.encouragements)) return mark.encouragements.length;

  if (Array.isArray(mark.reactions)) {
    return mark.reactions.filter((reaction: any) => {
      const value = String(reaction?.type || reaction?.emoji || reaction?.label || '').toLowerCase();

      return (
        value.includes('lift') ||
        value.includes('sparkle') ||
        value.includes('encourage') ||
        value === '✨' ||
        value === '🙌' ||
        value === '⭐'
      );
    }).length;
  }

  return 0;
}

export default function TimelineScreen() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [livingPromptCard, setLivingPromptCard] = useState<LivingMarkPromptCard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedKey, setFeedKey] = useState<FeedKey>('profile');
  const [showFeedMenu, setShowFeedMenu] = useState(false);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
  const [selectedViewerUri, setSelectedViewerUri] = useState<string | null>(null);
  const [sheetComposer, setSheetComposer] = useState<SheetComposerState | null>(null);
  const [liftUpSheetItem, setLiftUpSheetItem] = useState<TimelineFeedItem | null>(null);
  const [liftUpAnchor, setLiftUpAnchor] = useState<{ x: number; y: number } | null>(null);
  const [composerDraft, setComposerDraft] = useState('');
  const [savingComposer, setSavingComposer] = useState(false);
  const [savingLiftUp, setSavingLiftUp] = useState(false);
  const [savingPromptAction, setSavingPromptAction] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const composerInputRef = useRef<TextInput>(null);
  const composerTextRef = useRef('');
  const composerFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFeedScrollYRef = useRef(0);
  const dockHiddenRef = useRef(false);
  const hasLoadedTimelineOnceRef = useRef(false);
  const [activeVideoMarkId, setActiveVideoMarkId] = useState<string | null>(null);

  const timelineViewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 35,
    minimumViewTime: 0,
  });

  const onViewableTimelineItemsChangedRef = useRef(({ viewableItems }: any) => {
    const firstVisibleVideo = viewableItems
      .map((entry: any) => entry.item as TimelineFeedItem)
      .find((feedItem: TimelineFeedItem | undefined) => (
        !!feedItem?.hasVisualMedia &&
        Array.isArray(feedItem.mediaItems) &&
        feedItem.mediaItems.some((media: any) => (
          media?.type === 'video' || media?.mediaType === 'video'
        ))
      ));

    setActiveVideoMarkId(firstVisibleVideo?.id ?? null);
  });
  const insets = useSafeAreaInsets();

  const setFloatingDockHidden = useCallback((hidden: boolean) => {
    if (dockHiddenRef.current === hidden) return;

    dockHiddenRef.current = hidden;
    DeviceEventEmitter.emit('be:floatingDock:setHidden', hidden);
  }, []);

  const handleFeedScroll = useCallback((event: any) => {
    const y = event.nativeEvent.contentOffset.y;
    const previousY = lastFeedScrollYRef.current;
    const deltaY = y - previousY;

    lastFeedScrollYRef.current = y;

    if (y < 24) {
      setFloatingDockHidden(false);
      return;
    }

    if (deltaY > 8) {
      setFloatingDockHidden(true);
      return;
    }

    if (deltaY < -8) {
      setFloatingDockHidden(false);
    }
  }, [setFloatingDockHidden]);

  const router = useRouter();
    const { npub, nsec, family, profile, relays, theme, themeMode } = useIdentity();

    const load = useCallback(async () => {
    const all = await getMilestones();
    setMilestones(all);

    try {
      const promptCards = await getLivingMarkPromptCards({
        currentNpub: npub,
        limit: 1,
      });
      setLivingPromptCard(promptCards[0] ?? null);
    } catch (error) {
      console.warn('[Living Spaces] failed to load prompt card:', error);
      setLivingPromptCard(null);
    }

  }, [npub]);

    const syncFamilyMilestones = useCallback(async () => {
    if (!family || !npub) return;

    setSyncing(true);

    try {
      const relayUrl = DEFAULT_RELAY;

      const remoteMembers = await fetchFamilyMembers(family.id, relayUrl);

      for (const member of remoteMembers) {
        if (!member.memberNpub) continue;

        await upsertFamilyMember({
          familyId: family.id,
          npub: member.memberNpub,
          displayName: member.familyName || 'Member',
          role: member.role === 'admin' ? 'admin' : 'member',
          joinedAt: member.joinedAt,
          status: 'active',
        });
      }

      const remoteEvents = await fetchFamilyMilestones(family.id);
      let addedCount = 0;

      for (const event of remoteEvents) {
        try {
          const data = JSON.parse(event.content);

          await saveRemoteMilestone({
            id: data.id,
            note: data.note ?? '',
            tags: data.tags ?? [],
            photoUri: data.photoUri,
            videoUri: data.videoUri,
            audioUri: data.audioUri,
            media: Array.isArray(data.media) ? data.media : [],
            reflections: Array.isArray(data.reflections) ? data.reflections : [],
            createdAt: data.createdAt ?? event.created_at,
            familyId: family.id,
            authorNpub: data.authorNpub,
            authorName: data.authorName,
            publishedToRelay: true,
            nostrEventId: event.id,
          });

          addedCount++;
        } catch {}
      }

      if (addedCount > 0) {
        await load();
      }
    } catch (e) {
      console.warn('[Family Sync] Fetch error:', e);
    }

    setSyncing(false);
  }, [family, npub, load]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;

    if (!hasLoadedTimelineOnceRef.current) {
      Promise.resolve()
        .then(load)
        .then(() => {
          if (!cancelled) {
            hasLoadedTimelineOnceRef.current = true;
          }
        })
        .catch(error => {
          console.warn('[Timeline] initial load failed:', error);
        });
    }

    return () => {
      cancelled = true;
      setFloatingDockHidden(false);
    };
  }, [load, setFloatingDockHidden]));

  const onRefresh = async () => {
  setRefreshing(true);

  if (family) {
    await syncFamilyMilestones();
  }

  await load();
  setRefreshing(false);
};

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, event => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (composerFocusTimerRef.current) {
      clearTimeout(composerFocusTimerRef.current);
      composerFocusTimerRef.current = null;
    }

    if (!sheetComposer) return;

    composerFocusTimerRef.current = setTimeout(() => {
      composerInputRef.current?.focus();
      composerFocusTimerRef.current = null;
    }, 180);

    return () => {
      if (composerFocusTimerRef.current) {
        clearTimeout(composerFocusTimerRef.current);
        composerFocusTimerRef.current = null;
      }
    };
  }, [sheetComposer]);

  const myMilestones = milestones.filter(m => !m.familyId || m.authorNpub === npub);
  const source = feedKey === 'profile' ? myMilestones : [];
  const activeFeed = FEED_OPTIONS.find(option => option.key === feedKey) ?? FEED_OPTIONS[0];
  const feedItems = buildMyMarksFeedItems({
    milestones: source,
    currentNpub: npub,
    currentProfile: profile,
    familyName: family?.name,
  });

  const headerLogo =
    themeMode === 'light'
      ? require('../../assets/images/bE_logo_dark.png')
      : require('../../assets/images/bE_logo_light.png');

  const themed = {
    safe: { backgroundColor: theme.bg },
    banner: { backgroundColor: theme.surface, borderBottomColor: theme.border },
    goldText: { color: theme.gold },
    mutedText: { color: theme.textMuted },
    secondaryText: { color: theme.textSecondary },
    primaryText: { color: theme.text },
    border: { borderColor: theme.border },
    surface: { backgroundColor: theme.surface },
    raised: { backgroundColor: theme.raised },
    goldBg: { backgroundColor: theme.gold },
    dot: { backgroundColor: theme.gold },
    line: { backgroundColor: theme.border },
    fab: {
      backgroundColor: theme.gold,
      shadowColor: theme.gold,
    },
    darkOnGold: { color: theme.bg },
  };

  function openViewerForMilestone(milestone: Milestone, startIndex: number) {
  const mediaItems = getMyMarksFeedMediaItems(milestone).filter(
    m => m.type === 'image' || m.type === 'video'
  );

  const images: ViewerImage[] = mediaItems.map((m, index) => {
    const viewerType: 'image' | 'video' = m.type === 'video' ? 'video' : 'image';

    return {
      id: `${milestone.id}_${index}`,
      uri: m.uri,
      type: viewerType,
      thumbnailUrl: m.thumbnailUri || m.thumbnailUrl,
    };
  });

  if (images.length === 0) return;

  setViewerImages(images);
  setSelectedViewerUri(images[startIndex]?.uri ?? null);
}  
  
  const openMarkDetail = (item: TimelineFeedItem) => {
    router.push({ pathname: '/mark-detail', params: { id: item.milestone.id } } as any);
  };

  const openPromptMarkDetail = (card: LivingMarkPromptCard) => {
    router.push({ pathname: '/mark-detail', params: { id: card.view.milestone.id } } as any);
  };

  const shareFeedItem = async (item: TimelineFeedItem) => {
    const firstMedia = item.mediaItems.find(media => media?.uri || media?.mediaUrl);
    const mediaUrl = firstMedia?.uri || firstMedia?.mediaUrl;
    const message = [item.title, item.body, mediaUrl].filter(Boolean).join('\n\n');

    try {
      if (!message.trim()) {
        openMarkDetail(item);
        return;
      }

      await Share.share({ title: item.title || 'bE Mark', message });
    } catch (error) {
      console.warn('[Timeline] share failed:', error);
      openMarkDetail(item);
    }
  };

  const openSheetComposer = (item: TimelineFeedItem, mode: ComposerMode) => {
    setSheetComposer({ item, mode });
    composerTextRef.current = '';
    setComposerDraft('');
  };

  const openLiftUpSheet = (item: TimelineFeedItem, event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;

    setLiftUpAnchor({ x: pageX, y: pageY });
    setLiftUpSheetItem(item);
  };

  const closeLiftUpSheet = () => {
    if (savingLiftUp) return;
    setLiftUpSheetItem(null);
    setLiftUpAnchor(null);
  };

  const saveLiftUp = async (choice: Pick<MilestoneLiftUp, 'type' | 'label' | 'emoji'>) => {
    if (!liftUpSheetItem || savingLiftUp) return;

    const milestone = liftUpSheetItem.milestone;
    const createdAt = Math.floor(Date.now() / 1000);
    const nextLiftUp: MilestoneLiftUp = {
      id: `lift_${milestone.id}_${npub ?? 'local'}_${choice.type}_${createdAt}`,
      type: choice.type,
      label: choice.label,
      emoji: choice.emoji,
      createdAt,
      authorNpub: npub ?? undefined,
    };

    const existingLiftUps = milestone.liftUps ?? [];
    const alreadyLiftedIndex = npub
      ? existingLiftUps.findIndex(item => item.authorNpub === npub)
      : -1;

    const updatedLiftUps =
      alreadyLiftedIndex >= 0
        ? existingLiftUps.map((item, index) => (
            index === alreadyLiftedIndex ? nextLiftUp : item
          ))
        : [...existingLiftUps, nextLiftUp];

    const updatedMilestone = {
      ...milestone,
      liftUps: updatedLiftUps,
    };

    setSavingLiftUp(true);

    try {
      await updateMilestone(milestone.id, { liftUps: updatedLiftUps });

      setMilestones(prev =>
        prev.map(existing =>
          existing.id === milestone.id
            ? { ...existing, liftUps: updatedLiftUps }
            : existing
        )
      );

      setLiftUpSheetItem(current =>
        current && current.id === liftUpSheetItem.id
          ? {
              ...current,
              milestone: updatedMilestone,
            }
          : current
      );

      setSheetComposer(current =>
        current && current.item.id === liftUpSheetItem.id
          ? {
              ...current,
              item: {
                ...current.item,
                milestone: updatedMilestone,
              },
            }
          : current
      );

      setLiftUpSheetItem(null);
      setLiftUpAnchor(null);
    } catch (error) {
      console.warn('[Timeline Lift Up] Save failed:', error);
    } finally {
      setSavingLiftUp(false);
    }
  };

  const refreshPromptCard = async () => {
    const promptCards = await getLivingMarkPromptCards({
      currentNpub: npub,
      limit: 1,
    });
    setLivingPromptCard(promptCards[0] ?? null);
  };

  const handlePromptSnooze = async () => {
    if (!livingPromptCard || savingPromptAction) return;

    setSavingPromptAction(true);
    try {
      await applyLivingMarkPromptAction({
        promptId: livingPromptCard.prompt.id,
        action: 'snooze',
        currentNpub: npub,
      });
      await refreshPromptCard();
    } catch (error) {
      console.warn('[Living Spaces] prompt snooze failed:', error);
    } finally {
      setSavingPromptAction(false);
    }
  };

  const handlePromptDone = async () => {
    if (!livingPromptCard || savingPromptAction) return;

    if (!livingPromptCard.canCompleteInline) {
      openPromptMarkDetail(livingPromptCard);
      return;
    }

    setSavingPromptAction(true);
    try {
      const result = await applyLivingMarkPromptAction({
        promptId: livingPromptCard.prompt.id,
        action: 'done',
        currentNpub: npub,
      });

      if (!result.handledInline) {
        openPromptMarkDetail(livingPromptCard);
        return;
      }

      await load();
    } catch (error) {
      console.warn('[Living Spaces] prompt action failed:', error);
    } finally {
      setSavingPromptAction(false);
    }
  };

  const closeSheetComposer = () => {
    if (composerFocusTimerRef.current) {
      clearTimeout(composerFocusTimerRef.current);
      composerFocusTimerRef.current = null;
    }

    Keyboard.dismiss();
    setSheetComposer(null);
    composerTextRef.current = '';
    setComposerDraft('');
  };

  const saveSheetComposer = async () => {
    if (!sheetComposer) return;

    const text = composerDraft.trim();

    if (!text || savingComposer) return;

    const item = sheetComposer.item;
    const milestone = item.milestone;
    const reflection = {
      text,
      createdAt: Math.floor(Date.now() / 1000),
      authorNpub: npub ?? undefined,
    };
    const updatedReflections = [...(milestone.reflections ?? []), reflection];
    const updatedMilestone = {
      ...milestone,
      reflections: updatedReflections,
    };

    setSavingComposer(true);

    try {
      await updateMilestone(milestone.id, { reflections: updatedReflections });
      setMilestones(prev =>
        prev.map(existing =>
          existing.id === milestone.id
            ? { ...existing, reflections: updatedReflections }
            : existing
        )
      );

      setSheetComposer(current =>
        current
          ? {
              ...current,
              item: {
                ...current.item,
                milestone: updatedMilestone,
              },
            }
          : current
      );

      composerTextRef.current = '';
      setComposerDraft('');

      if (updatedMilestone.familyId && nsec && npub) {
        publishFamilyMilestone(
          {
            id: updatedMilestone.id,
            note: updatedMilestone.note,
            tags: updatedMilestone.tags ?? [],
            photoUri: updatedMilestone.photoUri,
            videoUri: updatedMilestone.videoUri,
            audioUri: updatedMilestone.audioUri,
            media: updatedMilestone.media ?? [],
            reflections: updatedReflections,
            createdAt: updatedMilestone.createdAt,
            familyId: updatedMilestone.familyId,
            authorNpub: updatedMilestone.authorNpub ?? npub,
            authorName: updatedMilestone.authorName,
          },
          nsec,
          relays
        ).then(result => {
          if (!result.success) {
            console.warn('[Family Reflection Sync] Failed:', result.error);
          } else {
            console.log('[Family Reflection Sync] Published:', result.eventId);
          }
        });
      }
    } catch (error) {
      console.warn('[Timeline Sheet Composer] Save failed:', error);
    } finally {
      setSavingComposer(false);
    }
  };

  function renderTimelineCard(
    item: TimelineFeedItem,
    shouldAutoPlayVideo: boolean
  ) {
    const milestone = item.milestone;
    const visibleTags = milestone.tags.slice(0, 2);
    const hiddenTagCount = Math.max(0, milestone.tags.length - visibleTags.length);
    const commentCount = getTimelineCommentCount(milestone);
    const liftUpCount = getTimelineLiftUpCount(milestone);

    if (item.hasVisualMedia) {
      return (
        <View
          style={[
            s.feedMarkCardImmersive,
            {
              borderColor: `${theme.gold}55`,
              shadowColor: theme.gold,
            },
          ]}
        >
          <View style={s.feedMarkMediaFrame}>
            <MediaCollage
              media={item.mediaItems}
              fitMode="cover"
              fixedHeight={500}
              autoPlayVideos
              playVideos={shouldAutoPlayVideo}
              videoMuted
              videoLoop
              onPressMedia={(mediaIndex) => openViewerForMilestone(milestone, mediaIndex)}
            />

            <View pointerEvents="none" style={s.feedMarkOverlayTop}>
              <View style={s.feedMarkOverlayAuthor}>
                <View style={s.feedMarkOverlayAvatar}>
                  {item.authorAvatar ? (
                    <Image source={{ uri: item.authorAvatar }} style={s.feedMarkOverlayAvatarImage} />
                  ) : (
                    <Text style={s.feedMarkOverlayAvatarText}>{item.authorInitials}</Text>
                  )}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.feedMarkOverlayAuthorName} numberOfLines={1}>
                    {item.authorName}
                  </Text>
                  <Text style={s.feedMarkOverlayMeta} numberOfLines={1}>
                    {item.contextLabel} - {item.timeLabel}
                  </Text>
                </View>
              </View>
            </View>

            <View style={s.feedMarkOverlayBottom}>
              <TouchableOpacity
                style={s.feedMarkOverlayCopyTap}
                onPress={() => openMarkDetail(item)}
                activeOpacity={0.9}
              >
                {item.title ? (
                  <Text style={s.feedMarkOverlayTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                ) : null}

                {item.body ? (
                  <Text style={s.feedMarkOverlayBody} numberOfLines={1}>
                    {item.body}
                  </Text>
                ) : null}

                {(visibleTags.length > 0 || hiddenTagCount > 0) && (
                  <View style={s.feedMarkOverlayTagRow}>
                    <Text style={s.feedMarkOverlayTagText} numberOfLines={1}>
                      {visibleTags.join(' · ')}
                    </Text>

                    {hiddenTagCount > 0 && (
                      <View style={s.feedMarkOverlayTagBadge}>
                        <Text style={s.feedMarkOverlayTagBadgeText}>+{hiddenTagCount}</Text>
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>

              <MarkActionRow
                variant="overlay"
                theme={theme}
                commentCount={commentCount}
                liftUpCount={liftUpCount}
                onComment={() => openSheetComposer(item, 'comment')}
                onLiftUp={(event) => openLiftUpSheet(item, event)}
                onShare={() => shareFeedItem(item)}
                style={s.feedMarkOverlayActions}
              />
            </View>
          </View>
        </View>
      );
    }

    if (!item.hasAudioOnly) {
      return (
        <TimelineTextMarkCard
          item={item}
          theme={theme}
          themeMode={themeMode}
          commentCount={commentCount}
          liftUpCount={liftUpCount}
          onOpenDetail={() => openMarkDetail(item)}
          onComment={() => openSheetComposer(item, 'comment')}
          onLiftUp={(event) => openLiftUpSheet(item, event)}
          onShare={() => shareFeedItem(item)}
        />
      );
    }

    if (item.hasAudioOnly) {
      return (
        <TimelineVoiceMarkCard
          item={item}
          theme={theme}
          themeMode={themeMode}
          commentCount={commentCount}
          liftUpCount={liftUpCount}
          onOpenDetail={() => openMarkDetail(item)}
          onComment={() => openSheetComposer(item, 'comment')}
          onLiftUp={(event) => openLiftUpSheet(item, event)}
          onShare={() => shareFeedItem(item)}
          onPressMedia={(mediaIndex) => openViewerForMilestone(milestone, mediaIndex)}
        />
      );
    }

    return (
      <View style={[s.socialCard, themed.raised, themed.border]}>
        <TouchableOpacity onPress={() => openMarkDetail(item)} activeOpacity={0.85}>
          <View style={s.socialHeader}>
            <View style={[s.authorAvatar, themed.surface, themed.border]}>
              {item.authorAvatar ? (
                <Image source={{ uri: item.authorAvatar }} style={s.authorAvatarImage} />
              ) : (
                <Text style={[s.authorAvatarText, themed.goldText]}>{item.authorInitials}</Text>
              )}
            </View>

            <View style={s.socialHeaderCopy}>
              <Text style={[s.authorName, themed.primaryText]} numberOfLines={1}>
                {item.authorName}
              </Text>
              <Text style={[s.feedContext, themed.mutedText]} numberOfLines={1}>
                {item.contextLabel} - {item.timeLabel}
              </Text>
            </View>

            {milestone.publishedToRelay && (
              <Text style={[s.relayBadge, themed.mutedText]}>relay</Text>
            )}
          </View>
        </TouchableOpacity>

        {item.hasAudioOnly && (
          <MediaCollage
            media={item.mediaItems}
            audioUri={milestone.audioUri}
            onPressMedia={(mediaIndex) => openViewerForMilestone(milestone, mediaIndex)}
          />
        )}

        <TouchableOpacity onPress={() => openMarkDetail(item)} activeOpacity={0.85}>
          <View style={s.socialBody}>
            {item.title && <Text style={[s.cardTitle, themed.primaryText]}>{item.title}</Text>}
            {item.body ? (
              <Text style={[s.note, themed.secondaryText]} numberOfLines={item.title ? 4 : 5}>
                {item.body}
              </Text>
            ) : null}

            {milestone.tags.length > 0 && (
              <View style={s.tags}>
                {milestone.tags.map(t => (
                  <Text key={t} style={[s.tag, themed.surface, { color: theme.gold, borderColor: theme.border }]}>
                    {t}
                  </Text>
                ))}
              </View>
            )}

            <View style={s.cardMeta}>
              {milestone.reflections && milestone.reflections.length > 0 && (
                <Text style={[s.reflectionBadge, themed.mutedText]}>
                  {milestone.reflections.length} reflection{milestone.reflections.length > 1 ? 's' : ''}
                </Text>
              )}

              {milestone.authorNpub && milestone.authorNpub !== npub && (
                <Text style={[s.authorBadge, themed.mutedText]}>{milestone.authorNpub.slice(0, 10)}...</Text>
              )}
            </View>
          </View>
        </TouchableOpacity>

        <View style={[s.socialActions, themed.border]}>
          <TouchableOpacity
            style={s.socialAction}
            onPress={() => openSheetComposer(item, 'comment')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Comment on this Mark"
          >
            <Ionicons name="chatbubble-outline" size={21} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.socialAction}
            onPress={() => shareFeedItem(item)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Share this Mark"
          >
            <Ionicons name="share-social-outline" size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderItem = ({ item }: { item: TimelineFeedItem }) => {
    return renderTimelineCard(item, item.id === activeVideoMarkId);
  };

  const composerBottom = keyboardHeight > 0
    ? keyboardHeight + 8
    : Math.max(insets.bottom, 12) + 76;

  return (
        <SafeAreaView style={[s.safe, themed.safe]}>
      <View style={[s.feedHeader, themed.safe]}>
        <View style={s.feedHeaderSide}>
          <Image source={headerLogo} style={s.feedHeaderLogo} resizeMode="contain" />
        </View>

        <TouchableOpacity
          style={[s.feedSelector, themed.raised, themed.border]}
          onPress={() => setShowFeedMenu(true)}
          activeOpacity={0.86}
        >
          <Text style={[s.feedSelectorText, themed.primaryText]} numberOfLines={1}>
            {activeFeed.label}
          </Text>
          <Text style={[s.feedSelectorCaret, themed.mutedText]}>v</Text>
        </TouchableOpacity>

        <View style={s.feedHeaderSide} />
      </View>

      {livingPromptCard && (
        <LivingPromptNudgeCard
          card={livingPromptCard}
          theme={theme}
          saving={savingPromptAction}
          onOpenDetail={openPromptMarkDetail}
          onSnooze={handlePromptSnooze}
          onDone={handlePromptDone}
        />
      )}

      {feedKey === 'follows' ? (
        <FollowingFeed theme={theme} />
      ) : feedKey === 'subscribed' ? (
        <BroadcastsFeed theme={theme} />
      ) : (
        <MyMarksFeed
          items={feedItems}
          syncing={syncing}
          refreshing={refreshing}
          theme={theme}
          renderItem={renderItem}
          onRefresh={onRefresh}
          onScroll={handleFeedScroll}
          viewabilityConfig={timelineViewabilityConfigRef.current}
          onViewableItemsChanged={onViewableTimelineItemsChangedRef.current}
        />
      )}

      <TouchableOpacity
        style={[
          s.markFab,
          {
            backgroundColor:
              theme.bg === '#0D0F0E'
                ? 'rgba(7,18,13,0.72)'
                : 'rgba(255,255,255,0.78)',
            borderColor: `${theme.gold}88`,
            shadowColor: theme.gold,
          },
        ]}
        onPress={() => router.push('/(tabs)/log' as any)}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel="Create a new Mark"
      >
        <Text style={[s.markFabText, { color: theme.gold }]}>+</Text>
      </TouchableOpacity>

      <Modal visible={showFeedMenu} transparent animationType="fade" onRequestClose={() => setShowFeedMenu(false)}>
        <TouchableOpacity
          style={s.feedMenuBackdrop}
          activeOpacity={1}
          onPress={() => setShowFeedMenu(false)}
        >
          <View style={[s.feedMenu, themed.raised, themed.border]}>
            {FEED_OPTIONS.map(option => {
              const active = option.key === feedKey;

              return (
                <TouchableOpacity
                  key={option.key}
                  style={s.feedMenuItem}
                  activeOpacity={0.86}
                  onPress={() => {
                    setFeedKey(option.key);
                    setShowFeedMenu(false);
                  }}
                >
                  <View style={s.feedMenuCopy}>
                    <Text style={[s.feedMenuLabel, themed.primaryText]}>{option.label}</Text>
                    <Text style={[s.feedMenuHint, themed.mutedText]}>{option.hint}</Text>
                  </View>

                  {active && <Text style={[s.feedMenuCheck, themed.goldText]}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      <ImageViewerModal
        images={viewerImages}
        selectedUri={selectedViewerUri}
        onClose={() => setSelectedViewerUri(null)}
      />

            {liftUpSheetItem && (
        <View style={s.composerOverlay} pointerEvents="box-none">
          <EmojiReactionStrip
            choices={LIFT_UP_CHOICES.map(choice => ({
              id: choice.type,
              emoji: choice.emoji,
              label: choice.label,
            }))}
            onSelect={(choice) => {
              const liftUpChoice = LIFT_UP_CHOICES.find(item => item.type === choice.id);

              if (liftUpChoice) {
                saveLiftUp(liftUpChoice);
              }
            }}
            onClose={closeLiftUpSheet}
            disabled={savingLiftUp}
            theme={theme}
            anchor={liftUpAnchor}
          />
        </View>
      )}

      {sheetComposer && (
        <MarkCommentsSheet
          item={sheetComposer.item}
          currentNpub={npub}
          draft={composerDraft}
          saving={savingComposer}
          theme={theme}
          bottom={composerBottom}
          bottomPadding={Math.max(insets.bottom, 12) + 12}
          inputRef={composerInputRef}
          onDraftChange={(text) => {
            composerTextRef.current = text;
            setComposerDraft(text);
          }}
          onClose={closeSheetComposer}
          onSend={saveSheetComposer}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  feedHeader: {
    minHeight: 68,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0.5,
    borderBottomColor: '#242424',
  },
  feedHeaderSide: {
    width: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedHeaderLogo: {
    width: 36,
    height: 36,
  },
  feedSelector: {
    maxWidth: 176,
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 0.5,
  },
  feedSelectorText: {
    fontSize: 15,
    fontWeight: '800',
  },
  feedSelectorCaret: {
    fontSize: 11,
    fontWeight: '800',
  },
  feedMenuBackdrop: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 118,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  feedMenu: {
    width: 270,
    borderRadius: 18,
    borderWidth: 0.5,
    paddingVertical: 8,
  },
  feedMenuItem: {
    minHeight: 70,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  feedMenuCopy: {
    flex: 1,
    minWidth: 0,
  },
  feedMenuLabel: {
    fontSize: 18,
    fontWeight: '900',
  },
  feedMenuHint: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
    fontWeight: '600',
  },
  feedMenuCheck: {
    fontSize: 22,
    fontWeight: '900',
  },
  list: { paddingHorizontal: 10, paddingTop: 12, paddingBottom: 116 },
  feedMarkCardImmersive: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 14,
    backgroundColor: '#000',
    borderWidth: 0.7,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  feedMarkMediaFrame: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  feedMarkOverlayTop: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedMarkOverlayAuthor: {
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  feedMarkOverlayAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  feedMarkOverlayAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
  },
  feedMarkOverlayAvatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  feedMarkOverlayAuthorName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  feedMarkOverlayMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  feedMarkOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.50)',
  },
  feedMarkOverlayCopyTap: {
    marginBottom: 8,
  },
  feedMarkOverlayTitle: {
    color: '#fff',
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  feedMarkOverlayBody: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 3,
  },
  feedMarkOverlayTagRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedMarkOverlayTagText: {
    flex: 1,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 10,
    fontWeight: '800',
  },
  feedMarkOverlayTagBadge: {
    minWidth: 24,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  feedMarkOverlayTagBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  feedMarkOverlayActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  socialCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
    marginBottom: 12,
  },
  socialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  authorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  authorAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  authorAvatarText: {
    fontSize: 14,
    fontWeight: '900',
  },
  socialHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    fontSize: 15,
    fontWeight: '900',
  },
  feedContext: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  socialBody: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  composerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
  },
  socialActions: {
    borderTopWidth: 0.5,
    flexDirection: 'row',
  },
  socialAction: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialActionText: {
    fontSize: 13,
    fontWeight: '800',
  },
  item: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  timelineCol: { alignItems: 'center', width: 12, paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  line: { flex: 1, width: 1, marginTop: 4 },
    cardSlot: { flex: 1, alignItems: 'stretch' },
  card: {
  width: '100%',
  borderRadius: 12,
  borderWidth: 0.5,
  overflow: 'hidden',
},
      cardPortrait: {
    width: '58%',
    maxWidth: 280,
    alignSelf: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
    // Image rendering
  photoWrapper: { position: 'relative', backgroundColor: '#0d0d0d' },
    imageContainer: {
    width: '100%',
    backgroundColor: '#0d0d0d',
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  imageLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d0d',
  },
  imageFallback: {
    width: '100%',
    height: 96,
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e1e1e',
  },
  imageFallbackIcon: { fontSize: 16 },
  imageFallbackText: { fontSize: 12, color: '#444' },
      mediaBadgeRow: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    gap: 6,
  },
  mediaBadge: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    minWidth: 34,
    alignItems: 'center',
  },
  mediaBadgeIcon: {
    fontSize: 14,
  },
  markCollageThreeLeft: {
  width: '60%',
  height: '100%',
  overflow: 'hidden',
  backgroundColor: '#0d0d0d',
},

markCollageThreeRight: {
  width: '40%',
  height: '100%',
  overflow: 'hidden',
  backgroundColor: '#0d0d0d',
},

markCollageThreeRightTile: {
  width: '100%',
  height: '50%',
  overflow: 'hidden',
  backgroundColor: '#0d0d0d',
},

markCollageFill: {
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  backgroundColor: '#0d0d0d',
},
  markCollageFallback: {
  width: '100%',
  height: '100%',
  backgroundColor: '#111',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
},
markCollageFallbackIcon: {
  color: '#c9973a',
  fontSize: 24,
  fontWeight: '900',
},
markCollageFallbackText: {
  color: '#666',
  fontSize: 12,
  fontWeight: '700',
},
    markCollageWrap: {
    width: '100%',
    height: 230,
    backgroundColor: '#0d0d0d',
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
    position: 'relative',
  },
  markCollageTileOne: {
    width: '100%',
    height: '100%',
  },
  markCollageTileTwo: {
    width: '50%',
    height: '100%',
  },
  markCollageTileThreeLarge: {
    width: '60%',
    height: '100%',
  },
  markCollageTileThreeSmall: {
  width: '40%',
  height: '50%',
  backgroundColor: '#0d0d0d',
  overflow: 'hidden',
},
  markCollageTileFour: {
  width: '50%',
  height: '50%',
  backgroundColor: '#0d0d0d',
  overflow: 'hidden',
},
  markCollageImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  markCollageVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  markCollagePlayCircle: {
  width: 46,
  height: 46,
  borderRadius: 23,
  backgroundColor: 'rgba(201,151,58,0.9)',
  alignItems: 'center',
  justifyContent: 'center',
},
markCollagePlay: {
  color: '#111',
  fontSize: 20,
  fontWeight: '900',
  marginLeft: 3,
},
  markMoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  markMoreText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },
  videoThumb: { width: '100%', height: 120, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  videoPlayCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  videoPlayIcon: { fontSize: 16, color: '#111', marginLeft: 3 },
  videoThumbLabel: { fontSize: 12, color: '#555' },
  audioThumb: { width: '100%', height: 56, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  audioThumbIcon: { fontSize: 18 },
  audioThumbLabel: { fontSize: 12, color: '#555' },
  cardBody: { padding: 14 },
  date: { fontSize: 11, color: '#444', marginBottom: 4, fontWeight: '500' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 5 },
  note: { fontSize: 14, color: '#888', lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  tag: { fontSize: 11, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 0.5 },
  cardMeta: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  relayBadge: { fontSize: 10, fontWeight: '800' },
  reflectionBadge: { fontSize: 10 },
  authorBadge: { fontSize: 10, color: '#555' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '500' },
  emptyHint: { fontSize: 13, marginTop: 6, textAlign: 'center' },
  emptyActionBtn: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 0.5, },
  emptyActionText: { fontSize: 14, fontWeight: '500' },
  markFab: {
    position: 'absolute',
    right: 20,
    bottom: 96,
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
    elevation: 7,
    zIndex: 20,
  },
  markFabText: {
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 32,
    marginTop: -1,
  },
});
