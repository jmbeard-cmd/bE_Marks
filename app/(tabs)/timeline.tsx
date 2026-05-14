import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageViewerModal, { ViewerImage } from '../../components/ImageViewerModal';
import MediaCollage from '../../components/MediaCollage';
import { DEFAULT_RELAY, fetchFamilyMembers, fetchFamilyMilestones } from '../../src/utils/nostr';
import {
  formatDate,
  getLastFamilyCheck,
  getMilestones,
  saveRemoteMilestone,
  setLastFamilyCheck,
  upsertFamilyMember,
  type Milestone,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

interface FilterState {
  tags: string[];
  mediaType: 'all' | 'photo' | 'video' | 'voice' | 'text';
  dateRange: 'all' | 'week' | 'month' | 'year';
  hasReflection: boolean;
  authorNpub: string | null;
}

type FeedKey = 'profile' | 'family' | 'follows' | 'subscribed';

const FEED_OPTIONS: { key: FeedKey; label: string; hint: string }[] = [
  { key: 'profile', label: 'My Profile', hint: 'Your Marks and profile feed' },
  { key: 'family', label: 'Family', hint: 'Shared family Marks' },
  { key: 'follows', label: 'Follows', hint: 'Nostr follows feed' },
  { key: 'subscribed', label: 'Subscribed', hint: 'Schools, churches, and group feeds' },
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

const DEFAULT_FILTERS: FilterState = {
  tags: [],
  mediaType: 'all',
  dateRange: 'all',
  hasReflection: false,
  authorNpub: null,
};

function countActiveFilters(f: FilterState): number {
  let count = 0;
  if (f.tags.length > 0) count++;
  if (f.mediaType !== 'all') count++;
  if (f.dateRange !== 'all') count++;
  if (f.hasReflection) count++;
  if (f.authorNpub) count++;
  return count;
}

function applyFilters(milestones: Milestone[], filters: FilterState, npub: string | null): Milestone[] {
  const now = Math.floor(Date.now() / 1000);
  return milestones.filter(m => {
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
  const mediaItems = Array.isArray(item.media) ? [...item.media] : [];

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

  return mediaItems;
}

function getMediaPreviewUri(item: any): string | null {
  if (!item) return null;

  if (item.type === 'video') {
    return item.thumbnailUri || item.thumbnailUrl || item.uri || null;
  }

  if (item.type === 'audio') {
    return null;
  }

  return item.uri || item.mediaUrl || null;
}

function CollageTileImage({
  uri,
  type,
}: {
  uri: string | null;
  type: 'image' | 'video';
}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View style={s.markCollageFallback}>
        <Text style={s.markCollageFallbackIcon}>
          {type === 'video' ? '▶' : '🖼️'}
        </Text>
        <Text style={s.markCollageFallbackText}>
          {type === 'video' ? 'Video' : 'Image'}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={s.markCollageImage}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

function TimelineMediaCollage({
  milestone,
  onPressMedia,
}: {
  milestone: Milestone;
  onPressMedia: (index: number) => void;
}) {
  const mediaItems = getMilestoneMediaItems(milestone);
  const visualItems = mediaItems.filter(item => item.type === 'image' || item.type === 'video');
  const audioItems = milestone.audioUri ? [{ uri: milestone.audioUri, type: 'audio' }] : [];

  if (visualItems.length === 0 && audioItems.length > 0) {
    return (
      <View style={s.audioThumb}>
        <Text style={s.audioThumbIcon}>🎙</Text>
        <Text style={s.audioThumbLabel}>Voice note</Text>
      </View>
    );
  }

  if (visualItems.length === 0) return null;

  const totalMedia = visualItems.length;

  const renderTile = (media: any, index: number, tileStyle: any) => {
    const previewUri = getMediaPreviewUri(media);

    return (
      <TouchableOpacity
        key={`${milestone.id}_${media.uri}_${index}`}
        style={tileStyle}
        activeOpacity={0.8}
        onPress={() => onPressMedia(index)}
      >
        <CollageTileImage
  uri={previewUri}
  type={media.type === 'video' ? 'video' : 'image'}
/>

{media.type === 'video' && (
  <View style={s.markCollageVideoOverlay}>
    <View style={s.markCollagePlayCircle}>
      <Text style={s.markCollagePlay}>▶</Text>
    </View>
  </View>
)}

{index === 3 && totalMedia > 4 && (
  <View style={s.markMoreOverlay}>
    <Text style={s.markMoreText}>+{totalMedia - 4}</Text>
  </View>
)}
      </TouchableOpacity>
    );
  };

  if (totalMedia === 1) {
    return (
      <View style={s.markCollageWrap}>
        {renderTile(visualItems[0], 0, s.markCollageTileOne)}
      </View>
    );
  }

  if (totalMedia === 2) {
    return (
      <View style={s.markCollageWrap}>
        {renderTile(visualItems[0], 0, s.markCollageTileTwo)}
        {renderTile(visualItems[1], 1, s.markCollageTileTwo)}
      </View>
    );
  }

  if (totalMedia === 3) {
    return (
      <View style={s.markCollageWrap}>
        <View style={s.markCollageThreeLeft}>
          {renderTile(visualItems[0], 0, s.markCollageFill)}
        </View>

        <View style={s.markCollageThreeRight}>
          {renderTile(visualItems[1], 1, s.markCollageThreeRightTile)}
          {renderTile(visualItems[2], 2, s.markCollageThreeRightTile)}
        </View>

        <View style={s.mediaBadgeRow}>
          <View style={s.mediaBadge}>
            <Text style={s.mediaBadgeIcon}>{totalMedia}</Text>
          </View>

          {visualItems.some(item => item.type === 'video') && (
            <View style={s.mediaBadge}>
              <Text style={s.mediaBadgeIcon}>🎥</Text>
            </View>
          )}

          {audioItems.length > 0 && (
            <View style={s.mediaBadge}>
              <Text style={s.mediaBadgeIcon}>🎙</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={s.markCollageWrap}>
      {visualItems.slice(0, 4).map((media, index) =>
        renderTile(media, index, s.markCollageTileFour)
      )}

      <View style={s.mediaBadgeRow}>
        <View style={s.mediaBadge}>
          <Text style={s.mediaBadgeIcon}>{totalMedia}</Text>
        </View>

        {visualItems.some(item => item.type === 'video') && (
          <View style={s.mediaBadge}>
            <Text style={s.mediaBadgeIcon}>🎥</Text>
          </View>
        )}

        {audioItems.length > 0 && (
          <View style={s.mediaBadge}>
            <Text style={s.mediaBadgeIcon}>🎙</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function getMilestoneAuthorLabel(item: Milestone, currentNpub: string | null): string | null {
  const savedName = item.authorName?.trim();

  if (savedName) return savedName;
  if (item.authorNpub && item.authorNpub === currentNpub) return 'You';
  if (item.authorNpub) return `${item.authorNpub.slice(0, 10)}…`;

  return null;
}

export default function TimelineScreen() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
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
    const { npub, family, theme, themeMode } = useIdentity();

    const load = useCallback(async () => {
    const all = await getMilestones();
    setMilestones(all);

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
    load();
    return () => {};
  }, [load]));

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
    const filtered = applyFilters(source, filters, npub);
  const activeFilterCount = countActiveFilters(filters);
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
  
  function TimelineCard({ item, index }: { item: Milestone; index: number }) {
    const hasTitle = item.note?.includes('\n\n');
    const title = hasTitle ? item.note.split('\n\n')[0] : null;
    const body = hasTitle ? item.note.split('\n\n').slice(1).join('\n\n') : item.note;

        const mediaItems = getMilestoneMediaItems(item);
    const hasVisualMedia = mediaItems.some(m => m.type === 'image' || m.type === 'video');
    const hasAudioOnly = !hasVisualMedia && mediaItems.some(m => m.type === 'audio');

    const isPortrait = false;
    const authorLabel = getMilestoneAuthorLabel(item, npub);

    return (
      <TouchableOpacity
        style={s.item}
        onPress={() => router.push({ pathname: '/mark-detail', params: { id: item.id } } as any)}
        activeOpacity={0.85}
      >
                <View style={s.timelineCol}>
          <View style={[s.dot, themed.dot]} />
          {index < filtered.length - 1 && <View style={[s.line, themed.line]} />}
        </View>

        <View style={s.cardSlot}>
          <View style={[s.card, themed.raised, themed.border, isPortrait && s.cardPortrait]}>
{(hasVisualMedia || hasAudioOnly) && (
  <MediaCollage
    media={mediaItems}
    audioUri={item.audioUri}
    onPressMedia={(mediaIndex) => openViewerForMilestone(item, mediaIndex)}
  />
)}

            <View style={s.cardBody}>
              <Text style={[s.date, themed.mutedText]}>
                {formatDate(item.createdAt)}
                {authorLabel ? ` · By ${authorLabel}` : ''}
              </Text>
              {title && <Text style={[s.cardTitle, themed.primaryText]}>{title}</Text>}
              {body ? <Text style={[s.note, themed.secondaryText]} numberOfLines={title ? 2 : 3}>{body}</Text> : null}

              {item.tags.length > 0 && (
                <View style={s.tags}>
                {item.tags.map(t => <Text key={t} style={[s.tag, themed.surface, { color: theme.gold, borderColor: theme.border }]}>{t}</Text>)}
                </View>
              )}

              <View style={s.cardMeta}>
                {item.publishedToRelay && <Text style={s.relayBadge}>↑ relay</Text>}

                {item.reflections && item.reflections.length > 0 && (
                  <Text style={s.reflectionBadge}>
                    ✦ {item.reflections.length} reflection{item.reflections.length > 1 ? 's' : ''}
                  </Text>
                )}

                {item.authorNpub && item.authorNpub !== npub && (
                  <Text style={s.authorBadge}>👤 {item.authorNpub.slice(0, 8)}…</Text>
                )}
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const renderItem = ({ item, index }: { item: Milestone; index: number }) => {
    return <TimelineCard item={item} index={index} />;
  };

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

      {activeFilterCount > 0 && (
      <View style={[s.filterBar, themed.border]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterBarInner}>
          <TouchableOpacity style={[s.clearChip, themed.surface]} onPress={clearFilters}><Text style={s.clearChipText}>Clear</Text></TouchableOpacity>
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
          <Text style={[s.emptyIcon, themed.mutedText]}>Follows</Text>
          <Text style={[s.emptyText, themed.primaryText]}>Follows feed coming online</Text>
          <Text style={[s.emptyHint, themed.mutedText]}>
            This feed will read your standard Nostr follows list and show posts from those profiles.
          </Text>
        </View>
      ) : feedKey === 'subscribed' ? (
        <View style={s.empty}>
          <Text style={[s.emptyIcon, themed.mutedText]}>Feeds</Text>
          <Text style={[s.emptyText, themed.primaryText]}>No subscribed feeds yet</Text>
          <Text style={[s.emptyHint, themed.mutedText]}>
            School, church, and group relay feeds will appear here once access is available for this identity.
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
          data={filtered}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.gold} />}
        />
      )}

      <TouchableOpacity style={[s.fab, themed.fab]} onPress={() => router.push('/(tabs)/log' as any)} activeOpacity={0.85}>
        <Text style={[s.fabIcon, themed.darkOnGold]}>+</Text>
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
  list: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 },
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
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  note: { fontSize: 14, color: '#888', lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  tag: { fontSize: 11, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 0.5 },
  cardMeta: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  relayBadge: { fontSize: 10, color: '#444' },
  reflectionBadge: { fontSize: 10 },
  authorBadge: { fontSize: 10, color: '#555' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '500' },
  emptyHint: { fontSize: 13, marginTop: 6, textAlign: 'center' },
  emptyActionBtn: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 0.5, },
  emptyActionText: { fontSize: 14, fontWeight: '500' },
 fab: {
  position: 'absolute',
  bottom: 24,
  right: 24,
  width: 58,
  height: 58,
  borderRadius: 29,
  alignItems: 'center',
  justifyContent: 'center',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.4,
  shadowRadius: 8,
  elevation: 8,
},
fabIcon: { fontSize: 32, lineHeight: 36, fontWeight: '300' },
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
