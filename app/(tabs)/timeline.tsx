import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  FlatList,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView,
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
import MarkActionRow from '../../components/MarkActionRow';
import MarkCommentsSheet from '../../components/MarkCommentsSheet';
import MediaCollage from '../../components/MediaCollage';
import TimelineTextMarkCard from '../../components/TimelineTextMarkCard';
import TimelineVoiceMarkCard from '../../components/TimelineVoiceMarkCard';
import type { LivingMarkLogFilter, LivingMarkPromptCard, LivingMarkView } from '../../src/types/living-spaces';
import { SYSTEM_LIVING_SPACE_IDS } from '../../src/utils/living-space-routing';
import {
  applyLivingMarkPromptAction,
  getLivingMarkPromptCards,
  getLivingMarkViewsForMilestones,
} from '../../src/utils/living-spaces-storage';
import { DEFAULT_RELAY, fetchFamilyMembers, fetchFamilyMilestones, publishFamilyMilestone } from '../../src/utils/nostr';
import {
  formatDate,
  getLastFamilyCheck,
  getMilestones,
  saveRemoteMilestone,
  setLastFamilyCheck,
  updateMilestone,
  upsertFamilyMember,
  type Milestone,
  type MilestoneLiftUp,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

interface FilterState {
  logMode: LivingMarkLogFilter;
  tags: string[];
  mediaType: 'all' | 'photo' | 'video' | 'voice' | 'text';
  dateRange: 'all' | 'week' | 'month' | 'year';
  hasReflection: boolean;
  authorNpub: string | null;
}

type FeedKey = 'profile' | 'family' | 'follows' | 'subscribed';
type ComposerMode = 'reflect' | 'comment';

type TimelineFeedItem = {
  id: string;
  milestone: Milestone;
  authorName: string;
  authorInitials: string;
  authorAvatar?: string;
  contextLabel: string;
  timeLabel: string;
  title: string | null;
  body: string;
  mediaItems: any[];
  hasVisualMedia: boolean;
  hasAudioOnly: boolean;
};

type SheetComposerState = {
  item: TimelineFeedItem;
  mode: ComposerMode;
};

const FEED_OPTIONS: { key: FeedKey; label: string; hint: string }[] = [
  { key: 'profile', label: 'My Marks', hint: 'Marks you created and saved' },
  { key: 'family', label: 'Family Marks', hint: 'Shared family Marks' },
  { key: 'follows', label: 'Following', hint: 'Marks and posts from people you follow' },
  { key: 'subscribed', label: 'Community Feeds', hint: 'Town, school, church, and relay feeds' },
];

const DEFAULT_TAG_FILTERS = [
  'Family',
  'Faith',
  'School',
  'Sports',
  'Travel',
  'Achievement',
  'Health',
  'Personal',
];

const MAX_RECENT_CUSTOM_TAGS = 12;

const LOG_FILTER_OPTIONS: { key: LivingMarkLogFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'people', label: 'People' },
  { key: 'spaces', label: 'Spaces' },
  { key: 'years', label: 'Years' },
  { key: 'tags', label: 'Tags' },
  { key: 'places', label: 'Places' },
];

const LIFT_UP_CHOICES: Pick<MilestoneLiftUp, 'type' | 'label' | 'emoji'>[] = [
  { type: 'lifted', label: 'Loved', emoji: '❤️' },
  { type: 'cheered', label: 'Liked', emoji: '👍' },
  { type: 'proud', label: 'Laughing', emoji: '😂' },
  { type: 'grateful', label: 'Celebrating', emoji: '🎉' },
  { type: 'celebrating', label: 'Fired up', emoji: '🔥' },
  { type: 'encouraged', label: 'Surprised', emoji: '😮' },
];

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawTag of tags) {
    const clean = rawTag.trim();
    if (!clean) continue;

    const normalized = normalizeTag(clean);
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(clean);
  }

  return result;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

const DEFAULT_FILTERS: FilterState = {
  logMode: 'all',
  tags: [],
  mediaType: 'all',
  dateRange: 'all',
  hasReflection: false,
  authorNpub: null,
};

function countActiveFilters(f: FilterState): number {
  let count = 0;
  if (f.logMode !== 'all') count++;
  if (f.tags.length > 0) count++;
  if (f.mediaType !== 'all') count++;
  if (f.dateRange !== 'all') count++;
  if (f.hasReflection) count++;
  if (f.authorNpub) count++;
  return count;
}

function passesLogMode(
  milestone: Milestone,
  mode: LivingMarkLogFilter,
  view?: LivingMarkView
): boolean {
  if (mode === 'all') return true;
  if (mode === 'people') return (view?.metadata.peopleIds?.length ?? 0) > 0;
  if (mode === 'spaces') {
    return (view?.placement.spaceIds ?? []).some(spaceId => spaceId !== SYSTEM_LIVING_SPACE_IDS.profile);
  }
  if (mode === 'years') return !!(view?.metadata.capturedAt ?? view?.metadata.occurredAt ?? milestone.createdAt);
  if (mode === 'tags') return (milestone.tags ?? []).length > 0;
  if (mode === 'places') return !!view?.metadata.place;

  return true;
}

function applyFilters(
  milestones: Milestone[],
  filters: FilterState,
  npub: string | null,
  livingViewsByMarkId: Record<string, LivingMarkView>
): Milestone[] {
  const now = Math.floor(Date.now() / 1000);
  return milestones.filter(m => {
    if (!passesLogMode(m, filters.logMode, livingViewsByMarkId[m.id])) return false;
    if (filters.tags.length > 0 && !filters.tags.some(t => m.tags.includes(t))) return false;
    if (filters.mediaType === 'photo' && !m.photoUri) return false;
    if (filters.mediaType === 'video' && !m.videoUri) return false;
    if (filters.mediaType === 'voice' && !m.audioUri) return false;
    if (filters.mediaType === 'text' && (m.photoUri || m.videoUri || m.audioUri)) return false;
    if (filters.dateRange === 'week' && m.createdAt < now - 7 * 86400) return false;
    if (filters.dateRange === 'month' && m.createdAt < now - 30 * 86400) return false;
    if (filters.dateRange === 'year' && m.createdAt < now - 365 * 86400) return false;
    if (filters.hasReflection && (!m.reflections || m.reflections.length === 0)) return false;
    if (filters.authorNpub && m.authorNpub !== filters.authorNpub) return false;
    return true;
  });
}

function getMilestoneMediaItems(item: Milestone): any[] {
  const mediaItems: any[] = Array.isArray(item.media) ? [...item.media] : [];

  if (item.photoUri && !mediaItems.some(m => m.uri === item.photoUri)) {
    mediaItems.push({
      id: `${item.id}_legacy_photo`,
      uri: item.photoUri,
      type: 'image',
    });
  }

  if (item.videoUri && !mediaItems.some(m => m.uri === item.videoUri)) {
    mediaItems.push({
      id: `${item.id}_legacy_video`,
      uri: item.videoUri,
      type: 'video',
    });
  }

  if (item.audioUri && !mediaItems.some(m => m.uri === item.audioUri)) {
    mediaItems.push({
      id: `${item.id}_legacy_audio`,
      uri: item.audioUri,
      type: 'audio',
    });
  }

  return mediaItems;
}

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

function getMilestoneAuthorLabel(item: Milestone, currentNpub: string | null): string | null {
  const savedName = item.authorName?.trim();

  if (savedName) return savedName;
  if (item.authorNpub && item.authorNpub === currentNpub) return 'You';
  if (item.authorNpub) return `${item.authorNpub.slice(0, 10)}…`;

  return null;
}

function createTimelineFeedItem(input: {
  milestone: Milestone;
  currentNpub: string | null;
  currentProfile?: any;
  feedKey: FeedKey;
  familyName?: string;
}): TimelineFeedItem {
  const { milestone, currentNpub, currentProfile, feedKey, familyName } = input;
  const hasTitle = milestone.note?.includes('\n\n');
  const title = hasTitle ? milestone.note.split('\n\n')[0] : null;
  const body = hasTitle ? milestone.note.split('\n\n').slice(1).join('\n\n') : milestone.note;
  const mediaItems = getMilestoneMediaItems(milestone);
  const hasVisualMedia = mediaItems.some(m => m.type === 'image' || m.type === 'video');
  const hasAudioOnly = !hasVisualMedia && mediaItems.some(m => m.type === 'audio');
  const authorName =
    getMilestoneAuthorLabel(milestone, currentNpub) ||
    currentProfile?.display_name ||
    currentProfile?.name ||
    'You';
  const isMine = !milestone.authorNpub || milestone.authorNpub === currentNpub;
  const contextLabel =
    feedKey === 'family'
      ? familyName || 'Family Marks'
      : milestone.familyId
        ? familyName || 'Family Marks'
        : isMine
          ? 'My Marks'
          : 'Following';

  return {
    id: milestone.id,
    milestone,
    authorName,
    authorInitials: getInitials(authorName),
    authorAvatar: isMine ? currentProfile?.picture : undefined,
    contextLabel,
    timeLabel: formatDate(milestone.createdAt),
    title,
    body,
    mediaItems,
    hasVisualMedia,
    hasAudioOnly,
  };
}

export default function TimelineScreen() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [livingViewsByMarkId, setLivingViewsByMarkId] = useState<Record<string, LivingMarkView>>({});
  const [livingPromptCard, setLivingPromptCard] = useState<LivingMarkPromptCard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedKey, setFeedKey] = useState<FeedKey>('profile');
  const [showFeedMenu, setShowFeedMenu] = useState(false);
    const [newFamilyCount, setNewFamilyCount] = useState(0);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
const [selectedViewerUri, setSelectedViewerUri] = useState<string | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [pendingFilters, setPendingFilters] = useState<FilterState>(DEFAULT_FILTERS);
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

  // Swipe-to-close for filter drawer
  const drawerTranslateY = useRef(new Animated.Value(0)).current;
  const drawerPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) drawerTranslateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(drawerTranslateY, {
            toValue: 600, duration: 200, useNativeDriver: true,
          }).start(() => {
            drawerTranslateY.setValue(0);
            setShowFilterDrawer(false);
          });
        } else {
          Animated.spring(drawerTranslateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;
  const router = useRouter();
    const { npub, nsec, family, profile, relays, theme, themeMode } = useIdentity();

    const load = useCallback(async () => {
    const all = await getMilestones();
    setMilestones(all);

    try {
      const livingViews = await getLivingMarkViewsForMilestones({
        milestones: all,
        currentNpub: npub,
      });
      setLivingViewsByMarkId(
        livingViews.reduce(
          (acc, view) => {
            acc[view.milestone.id] = view;
            return acc;
          },
          {} as Record<string, LivingMarkView>
        )
      );
    } catch (error) {
      console.warn('[Living Spaces] failed to load Log filters:', error);
      setLivingViewsByMarkId({});
    }

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

    if (family) {
      const lastCheck = await getLastFamilyCheck(family.id);
      const familyMilestones = all.filter(m => m.familyId === family.id);
      const newOnes = familyMilestones.filter(m => m.authorNpub !== npub && m.createdAt > lastCheck);

      if (newOnes.length > 0) {
        setNewFamilyCount(newOnes.length);
        setShowBanner(true);
      }

      await setLastFamilyCheck(family.id, Math.floor(Date.now() / 1000));
      return;
    }

  }, [family, npub]);

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

  const openDrawer = () => { setPendingFilters(filters); setShowFilterDrawer(true); };
  const applyDrawer = () => { setFilters(pendingFilters); setShowFilterDrawer(false); };
  const clearFilters = () => { setPendingFilters(DEFAULT_FILTERS); setFilters(DEFAULT_FILTERS); setShowFilterDrawer(false); };

  const togglePendingTag = (tag: string) => {
    setPendingFilters(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));
  };

  const switchToFamily = () => {
    setFeedKey('family');
    setShowBanner(false);
    setFilters(DEFAULT_FILTERS);
    syncFamilyMilestones();
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
  const familyMilestones = family ? milestones.filter(m => m.familyId === family.id) : [];
  const source =
    feedKey === 'family'
      ? familyMilestones
      : feedKey === 'profile'
        ? myMilestones
        : [];
  const activeFeed = FEED_OPTIONS.find(option => option.key === feedKey) ?? FEED_OPTIONS[0];
  const tab = feedKey === 'family' ? 'family' : 'mine';
  const familyAuthors = Array.from(new Set(familyMilestones.map(m => m.authorNpub).filter(Boolean))) as string[];
  const allTags = uniqueTags(source.flatMap(m => m.tags ?? []));

  const usedTagLookup = new Set(allTags.map(normalizeTag));

  const presetTags = DEFAULT_TAG_FILTERS.filter(tag =>
    usedTagLookup.has(normalizeTag(tag))
  );

  const recentCustomTags = uniqueTags(
    [...source]
      .sort((a, b) => b.createdAt - a.createdAt)
      .flatMap(m => m.tags ?? [])
      .filter(tag => !DEFAULT_TAG_FILTERS.some(defaultTag =>
        normalizeTag(defaultTag) === normalizeTag(tag)
      ))
  ).slice(0, MAX_RECENT_CUSTOM_TAGS);

  const visibleDrawerTags = new Set(
    [...presetTags, ...recentCustomTags].map(normalizeTag)
  );

  const selectedHiddenTags = pendingFilters.tags.filter(tag =>
    !visibleDrawerTags.has(normalizeTag(tag))
  );
    const filtered = applyFilters(source, filters, npub, livingViewsByMarkId);
  const activeFilterCount = countActiveFilters(filters);
  const feedItems = filtered.map(milestone =>
    createTimelineFeedItem({
      milestone,
      currentNpub: npub,
      currentProfile: profile,
      feedKey,
      familyName: family?.name,
    })
  );

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
  const mediaItems = getMilestoneMediaItems(milestone).filter(
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

  function LivingPromptNudgeCard({ card }: { card: LivingMarkPromptCard }) {
    const spaceName = card.prompt.suggestedSpaceIds?.[0]
      ? card.view.spaces.find(space => space.id === card.prompt.suggestedSpaceIds?.[0])?.name
      : undefined;
    const actionLabel = card.canCompleteInline ? 'Done' : 'Add details';

    return (
      <View style={[s.nudgeWrap, themed.safe, themed.border]}>
        <View style={[s.nudgeCard, themed.raised, themed.border]}>
          <View style={s.nudgeHeader}>
            <View style={[s.nudgeIcon, themed.surface, themed.border]}>
              <Ionicons name="sparkles-outline" size={17} color={theme.gold} />
            </View>
            <View style={s.nudgeCopy}>
              <Text style={[s.nudgeEyebrow, themed.goldText]}>Complete this Mark</Text>
              <Text style={[s.nudgeQuestion, themed.primaryText]}>{card.prompt.question}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[s.nudgeMarkPreview, themed.surface, themed.border]}
            onPress={() => openPromptMarkDetail(card)}
            activeOpacity={0.82}
          >
            <Text style={[s.nudgeMarkTitle, themed.primaryText]} numberOfLines={1}>
              {card.markTitle || 'Mark'}
            </Text>
            <Text style={[s.nudgeMarkText, themed.mutedText]} numberOfLines={2}>
              {card.markPreview}
            </Text>
            {spaceName && (
              <Text style={[s.nudgeSpaceHint, themed.goldText]} numberOfLines={1}>
                Suggested Space: {spaceName}
              </Text>
            )}
          </TouchableOpacity>

          <View style={s.nudgeActions}>
            <TouchableOpacity
              style={[s.nudgeActionBtn, themed.surface, themed.border]}
              onPress={() => openPromptMarkDetail(card)}
              disabled={savingPromptAction}
              activeOpacity={0.78}
            >
              <Text style={[s.nudgeActionText, themed.primaryText]}>Review</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.nudgeActionBtn, themed.surface, themed.border]}
              onPress={handlePromptSnooze}
              disabled={savingPromptAction}
              activeOpacity={0.78}
            >
              <Text style={[s.nudgeActionText, themed.mutedText]}>Not now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.nudgeDoneBtn, themed.goldBg, savingPromptAction && s.nudgeDisabled]}
              onPress={handlePromptDone}
              disabled={savingPromptAction}
              activeOpacity={0.78}
            >
              <Text style={[s.nudgeDoneText, themed.darkOnGold]}>
                {savingPromptAction ? 'Saving...' : actionLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

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

        <View style={s.feedHeaderSide}>
          <TouchableOpacity
            style={[s.feedHeaderBtn, themed.raised, themed.border]}
            onPress={openDrawer}
            activeOpacity={0.86}
          >
            <Text style={[s.feedHeaderBtnText, themed.primaryText]}>Filter</Text>
            {activeFilterCount > 0 && (
              <View style={[s.feedHeaderBadge, themed.goldBg]}>
                <Text style={[s.feedHeaderBadgeText, themed.darkOnGold]}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {showBanner && family && (
                <TouchableOpacity style={[s.banner, themed.banner]} onPress={switchToFamily} activeOpacity={0.85}>
          <View style={s.bannerContent}>
            <Text style={s.bannerIcon}>👨‍👩‍👧‍👦</Text>
            <View style={s.bannerText}>
                            <Text style={[s.bannerTitle, themed.goldText]}>{newFamilyCount === 1 ? '1 new family Mark' : `${newFamilyCount} new family Mark`}</Text>
              <Text style={[s.bannerHint, themed.mutedText]}>Tap to view {family.name}</Text>
            </View>
            <TouchableOpacity onPress={() => setShowBanner(false)} style={s.bannerDismiss}>
              <Text style={s.bannerDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {livingPromptCard && (
        <LivingPromptNudgeCard card={livingPromptCard} />
      )}

      {activeFilterCount > 0 && (
      <View style={[s.filterBar, themed.border]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterBarInner}>
          <TouchableOpacity style={[s.clearChip, themed.surface]} onPress={clearFilters}><Text style={s.clearChipText}>Clear</Text></TouchableOpacity>
          {filters.logMode !== 'all' && (
            <View style={[s.activeChip, themed.surface, { borderColor: theme.border }]}>
              <Text style={[s.activeChipText, themed.goldText]}>
                {LOG_FILTER_OPTIONS.find(option => option.key === filters.logMode)?.label ?? filters.logMode}
              </Text>
            </View>
          )}
          {filters.tags.map(t => <View key={t} style={[s.activeChip, themed.surface, { borderColor: theme.border }]}><Text style={[s.activeChipText, themed.goldText]}>{t}</Text></View>)}
          {filters.mediaType !== 'all' && <View style={s.activeChip}><Text style={s.activeChipText}>{filters.mediaType}</Text></View>}
          {filters.dateRange !== 'all' && <View style={s.activeChip}><Text style={s.activeChipText}>{filters.dateRange === 'week' ? 'This week' : filters.dateRange === 'month' ? 'This month' : 'This year'}</Text></View>}
          {filters.hasReflection && <View style={s.activeChip}><Text style={s.activeChipText}>Has reflection</Text></View>}
        </ScrollView>
      </View>
      )}

      {feedKey === 'family' && !family ? (
        <View style={s.empty}>
          <Text style={[s.emptyIcon, themed.mutedText]}>👨‍👩‍👧‍👦</Text>
          <Text style={[s.emptyText, themed.primaryText]}>No family group yet</Text>
          <Text style={[s.emptyHint, themed.mutedText]}>Go to Settings to create or join a family.</Text>
    <TouchableOpacity
  style={[s.emptyActionBtn, { backgroundColor: theme.gold }]}
  onPress={() => router.push('/(tabs)/settings' as any)}
>
  <Text style={[s.emptyActionText, { color: theme.bg }]}>Go to Settings</Text>
</TouchableOpacity>
        </View>
      ) : feedKey === 'follows' ? (
        <View style={s.empty}>
          <Text style={[s.emptyIcon, themed.mutedText]}>Following</Text>
          <Text style={[s.emptyText, themed.primaryText]}>Following feed coming online</Text>
          <Text style={[s.emptyHint, themed.mutedText]}>
            This feed will show Marks and posts from people you follow across Nostr.
          </Text>
        </View>
      ) : feedKey === 'subscribed' ? (
        <View style={s.empty}>
          <Text style={[s.emptyIcon, themed.mutedText]}>Community</Text>
          <Text style={[s.emptyText, themed.primaryText]}>No community feeds yet</Text>
          <Text style={[s.emptyHint, themed.mutedText]}>
            Town, school, church, and bE Community relay feeds will appear here as you subscribe to them.
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.empty}>
          <Text style={[s.emptyIcon, themed.mutedText]}>{activeFilterCount > 0 ? '🔍' : syncing ? '⟳' : '◎'}</Text>
          <Text style={[s.emptyText, themed.primaryText]}>{syncing ? 'Syncing…' : activeFilterCount > 0 ? 'No matches' : tab === 'family' ? 'No family Marks yet' : 'No Marks yet'}</Text>
          <Text style={[s.emptyHint, themed.mutedText]}>{syncing ? '' : activeFilterCount > 0 ? 'Try adjusting your filters.' : tab === 'family' ? 'Save a Mark and tag it to your family.' : 'Tap + to capture your first Mark.'}</Text>
{activeFilterCount > 0 && (
  <TouchableOpacity
    style={[s.emptyActionBtn, { backgroundColor: theme.gold }]}
    onPress={clearFilters}
  >
    <Text style={[s.emptyActionText, { color: theme.bg }]}>Clear filters</Text>
  </TouchableOpacity>
)}
        </View>
      ) : (
        <FlatList
          data={feedItems}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          viewabilityConfig={timelineViewabilityConfigRef.current}
          onViewableItemsChanged={onViewableTimelineItemsChangedRef.current}
          contentContainerStyle={s.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          updateCellsBatchingPeriod={24}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          onScroll={handleFeedScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.gold} />}
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
                    setShowBanner(false);
                    setFilters(DEFAULT_FILTERS);

                    if (option.key === 'family') {
                      syncFamilyMilestones();
                    }
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

        <Modal visible={showFilterDrawer} transparent animationType="slide" onRequestClose={() => setShowFilterDrawer(false)}>
<View style={[s.drawerOverlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
  <TouchableOpacity
    style={s.drawerBackdrop}
    activeOpacity={1}
    onPress={() => setShowFilterDrawer(false)}
  />

  <Animated.View
    style={[
      s.drawer,
      themed.surface,
      themed.border,
      {
        transform: [{ translateY: drawerTranslateY }],
        borderTopWidth: 0.5,
      },
    ]}
  >
         <View style={[s.drawerHandle, { backgroundColor: theme.border }]} {...drawerPan.panHandlers} />
          <Text style={[s.drawerTitle, themed.primaryText]}>Filter Marks</Text>

            <ScrollView
              style={s.drawerScroll}
              contentContainerStyle={s.drawerScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={s.drawerSection}>
                <Text style={[s.drawerSectionLabel, themed.mutedText]}>MARK VIEW</Text>
                <View style={s.drawerChips}>
                  {LOG_FILTER_OPTIONS.map(option => {
                    const active = pendingFilters.logMode === option.key;

                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          s.drawerChip,
                          themed.raised,
                          themed.border,
                          active && {
                            backgroundColor: theme.gold,
                            borderColor: theme.gold,
                          },
                        ]}
                        onPress={() => setPendingFilters(prev => ({ ...prev, logMode: option.key }))}
                      >
                        <Text
                          style={[
                            s.drawerChipText,
                            themed.primaryText,
                            active && {
                              color: theme.bg,
                              fontWeight: '600',
                            },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {(presetTags.length > 0 || recentCustomTags.length > 0 || selectedHiddenTags.length > 0) && (
                <View style={s.drawerSection}>
                  <Text style={[s.drawerSectionLabel, themed.mutedText]}>TAGS</Text>

                  {presetTags.length > 0 && (
                    <>
                      <Text style={[s.drawerSubLabel, themed.mutedText]}>Featured</Text>
                      <View style={s.drawerChips}>
                        {presetTags.map(t => {
                          const isSelected = pendingFilters.tags.some(tag => normalizeTag(tag) === normalizeTag(t));

                          return (
                            <TouchableOpacity
                              key={`preset_${t}`}
                              style={[
                                s.drawerChip,
                                themed.raised,
                                themed.border,
                                isSelected && {
                                  backgroundColor: theme.gold,
                                  borderColor: theme.gold,
                                },
                              ]}
                              onPress={() => togglePendingTag(t)}
                            >
                              <Text
                                style={[
                                  s.drawerChipText,
                                  themed.primaryText,
                                  isSelected && {
                                    color: theme.bg,
                                    fontWeight: '600',
                                  },
                                ]}
                              >
                                {t}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {recentCustomTags.length > 0 && (
                    <>
                      <Text style={[s.drawerSubLabel, themed.mutedText]}>Recent custom tags</Text>
                      <View style={s.drawerChips}>
                        {recentCustomTags.map(t => {
                          const isSelected = pendingFilters.tags.some(tag => normalizeTag(tag) === normalizeTag(t));

                          return (
                            <TouchableOpacity
                              key={`recent_${t}`}
                              style={[
                                s.drawerChip,
                                themed.raised,
                                themed.border,
                                isSelected && {
                                  backgroundColor: theme.gold,
                                  borderColor: theme.gold,
                                },
                              ]}
                              onPress={() => togglePendingTag(t)}
                            >
                              <Text
                                style={[
                                  s.drawerChipText,
                                  themed.primaryText,
                                  isSelected && {
                                    color: theme.bg,
                                    fontWeight: '600',
                                  },
                                ]}
                              >
                                {t}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {selectedHiddenTags.length > 0 && (
                    <>
                      <Text style={[s.drawerSubLabel, themed.mutedText]}>Selected</Text>
                      <View style={s.drawerChips}>
                        {selectedHiddenTags.map(t => (
                          <TouchableOpacity
                            key={`selected_hidden_${t}`}
                            style={[
                              s.drawerChip,
                              {
                                backgroundColor: theme.gold,
                                borderColor: theme.gold,
                              },
                            ]}
                            onPress={() => togglePendingTag(t)}
                          >
                            <Text
                              style={[
                                s.drawerChipText,
                                {
                                  color: theme.bg,
                                  fontWeight: '600',
                                },
                              ]}
                            >
                              {t}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              )}

              <View style={s.drawerSection}>
                <Text style={[s.drawerSectionLabel, themed.mutedText]}>MEDIA TYPE</Text>
                <View style={s.drawerChips}>
                  {(['all', 'photo', 'video', 'voice', 'text'] as const).map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[
                        s.drawerChip,
                        themed.raised,
                        themed.border,
                        pendingFilters.mediaType === m && {
                          backgroundColor: theme.gold,
                          borderColor: theme.gold,
                        },
                      ]}
                      onPress={() => setPendingFilters(prev => ({ ...prev, mediaType: m }))}
                    >
                      <Text
                        style={[
                          s.drawerChipText,
                          themed.primaryText,
                          pendingFilters.mediaType === m && {
                            color: theme.bg,
                            fontWeight: '600',
                          },
                        ]}
                      >
                        {m === 'all'
                          ? 'All media'
                          : m === 'photo'
                            ? '📷 Photo'
                            : m === 'video'
                              ? '🎥 Video'
                              : m === 'voice'
                                ? '🎙 Voice'
                                : '📝 Text only'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {tab === 'family' && familyAuthors.length > 1 && (
                <View style={s.drawerSection}>
                  <Text style={[s.drawerSectionLabel, themed.mutedText]}>FAMILY MEMBER</Text>
                  <View style={s.drawerChips}>
<TouchableOpacity
  style={[
    s.drawerChip,
    themed.raised,
    themed.border,
    pendingFilters.authorNpub === null && {
      backgroundColor: theme.gold,
      borderColor: theme.gold,
    },
  ]}
  onPress={() => setPendingFilters(prev => ({ ...prev, authorNpub: null }))}
>
  <Text
    style={[
      s.drawerChipText,
      themed.primaryText,
      pendingFilters.authorNpub === null && {
        color: theme.bg,
        fontWeight: '600',
      },
    ]}
  >
    Everyone
  </Text>
</TouchableOpacity>
                    {familyAuthors.map(a => (
<TouchableOpacity
  key={a}
  style={[
    s.drawerChip,
    themed.raised,
    themed.border,
    pendingFilters.authorNpub === a && {
      backgroundColor: theme.gold,
      borderColor: theme.gold,
    },
  ]}
  onPress={() => setPendingFilters(prev => ({ ...prev, authorNpub: a }))}
>
  <Text
    style={[
      s.drawerChipText,
      themed.primaryText,
      pendingFilters.authorNpub === a && {
        color: theme.bg,
        fontWeight: '600',
      },
    ]}
  >
    {a === npub ? 'Me' : `${a.slice(0, 8)}…`}
  </Text>
</TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <View style={s.drawerSection}>
                <Text style={[s.drawerSectionLabel, themed.mutedText]}>REFLECTIONS</Text>
                <TouchableOpacity
                  style={[
                    s.drawerChip,
                    themed.raised,
                    themed.border,
                    pendingFilters.hasReflection && {
                      backgroundColor: theme.gold,
                      borderColor: theme.gold,
                    },
                  ]}
                  onPress={() => setPendingFilters(prev => ({ ...prev, hasReflection: !prev.hasReflection }))}
                >
                  <Text
                    style={[
                      s.drawerChipText,
                      themed.primaryText,
                      pendingFilters.hasReflection && {
                        color: theme.bg,
                        fontWeight: '600',
                      },
                    ]}
                  >
                    ✦ Has reflection
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

          <View style={[s.drawerActions, themed.border]}>
  <TouchableOpacity
    style={[s.drawerClearBtn, themed.surface, themed.border]}
    onPress={clearFilters}
  >
    <Text style={[s.drawerClearText, themed.mutedText]}>Clear all</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[s.drawerApplyBtn, themed.goldBg]}
    onPress={applyDrawer}
  >
    <Text style={[s.drawerApplyText, themed.darkOnGold]}>Apply filters</Text>
  </TouchableOpacity>
</View>
          </Animated.View>
        </View>
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
  feedHeaderBtn: {
    minWidth: 64,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    paddingHorizontal: 12,
  },
  feedHeaderBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  feedHeaderBadge: {
    position: 'absolute',
    top: -5,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedHeaderBadgeText: {
    fontSize: 10,
    fontWeight: '900',
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
  banner: { backgroundColor: '#1e1600', borderBottomWidth: 0.5, borderBottomColor: '#c9973a33' },
  bannerContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  bannerIcon: { fontSize: 22 },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 14, color: '#c9973a', fontWeight: '600' },
  bannerHint: { fontSize: 12, color: '#7a5a1a', marginTop: 2 },
  bannerDismiss: { padding: 4 },
  bannerDismissText: { fontSize: 14, color: '#555' },
  nudgeWrap: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
  },
  nudgeCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
  },
  nudgeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  nudgeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeCopy: {
    flex: 1,
    minWidth: 0,
  },
  nudgeEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  nudgeQuestion: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  nudgeMarkPreview: {
    borderRadius: 10,
    borderWidth: 0.5,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  nudgeMarkTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 3,
  },
  nudgeMarkText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  nudgeSpaceHint: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
  },
  nudgeActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  nudgeActionBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  nudgeActionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  nudgeDoneBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  nudgeDoneText: {
    fontSize: 12,
    fontWeight: '900',
  },
  nudgeDisabled: {
    opacity: 0.55,
  },
  tabRow: { flexDirection: 'row', borderBottomWidth: 0.5 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2 },
  tabText: { fontSize: 13, color: '#444', fontWeight: '500' },
  tabTextActive: { fontWeight: '700' },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBadge: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 18, alignItems: 'center' },
  tabBadgeText: { fontSize: 10, fontWeight: '700' },
  filterBar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5 },
  filterBarInner: { paddingHorizontal: 12, paddingVertical: 9, gap: 6, flexDirection: 'row', alignItems: 'center' },
  activeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#1e1600', borderWidth: 0.5, borderColor: '#c9973a33' },
  activeChipText: { fontSize: 11 },
  clearChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#2a1a1a', borderWidth: 0.5, borderColor: '#c00' },
  clearChipText: { fontSize: 11, color: '#c00' },
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
drawerOverlay: { flex: 1, justifyContent: 'flex-end' },
drawer: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 24, maxHeight: '88%' },
drawerBackdrop: { 
  ...StyleSheet.absoluteFillObject
}, 
  drawerScroll: { flexGrow: 0 },
  drawerScrollContent: { paddingBottom: 12 },
drawerHandle: { 
  width: 36, 
  height: 4, 
  borderRadius: 2, 
  alignSelf: 'center', 
  marginTop: 12, 
  marginBottom: 16 
},
drawerTitle: { 
  fontSize: 17, 
  fontWeight: '600', 
  marginBottom: 20 
},
drawerSection: { 
  marginBottom: 22 
},
drawerSectionLabel: { 
  fontSize: 11, 
  fontWeight: '600', 
  letterSpacing: 0.8, 
  marginBottom: 10 
},
drawerSubLabel: {
  fontSize: 10,
  fontWeight: '700',
  letterSpacing: 0.7,
  textTransform: 'uppercase',
  marginTop: 4,
  marginBottom: 8,
  opacity: 0.72,
},
  drawerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
drawerChip: { 
  paddingHorizontal: 14, 
  paddingVertical: 8, 
  borderRadius: 20, 
  borderWidth: 0.5 
},
drawerChipActive: { 
},
drawerChipText: { 
  fontSize: 13 
},
drawerChipTextActive: { 
  fontWeight: '600' 
},
drawerActions: { 
  flexDirection: 'row', 
  gap: 12, 
  marginTop: 8, 
  paddingTop: 16, 
  borderTopWidth: 0.5 
},
drawerClearBtn: { 
  flex: 1, 
  padding: 14, 
  borderRadius: 10, 
  borderWidth: 0.5, 
  alignItems: 'center' 
},
drawerClearText: { 
  fontSize: 14,
  fontWeight: '700',
},
drawerApplyBtn: { 
  flex: 2, 
  padding: 14, 
  borderRadius: 10, 
  alignItems: 'center' 
},
drawerApplyText: { 
  fontSize: 14,
  fontWeight: '700' 
},
});
