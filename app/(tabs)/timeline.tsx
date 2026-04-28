import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
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
import BEHeader from '../../components/BEHeader';
import ImageViewerModal, { ViewerImage } from '../../components/ImageViewerModal';
import { DEFAULT_RELAY, fetchFamilyMembers, fetchFamilyMilestones } from '../../src/utils/nostr';
import {
  formatDate,
  getFamilyMemberCount,
  getLastFamilyCheck,
  getMilestones,
  saveRemoteMilestone,
  setLastFamilyCheck,
  upsertFamilyMember,
  type Milestone,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

const { width } = Dimensions.get('window');

interface FilterState {
  tags: string[];
  mediaType: 'all' | 'photo' | 'video' | 'voice' | 'text';
  dateRange: 'all' | 'week' | 'month' | 'year';
  hasReflection: boolean;
  authorNpub: string | null;
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

// MilestoneImage handles loading states and broken URLs gracefully
function MilestoneImage({
  uri,
  onRatio,
}: {
  uri: string;
  onRatio?: (ratio: number) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [ratio, setRatio] = useState(4 / 3);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    setError(false);

    Image.getSize(
      uri,
      (w, h) => {
        if (!mounted || !w || !h) return;

        const rawRatio = w / h;
        const safeRatio = Math.max(0.56, Math.min(rawRatio, 1.8));

        setRatio(safeRatio);
        onRatio?.(safeRatio);
      },
      () => {
        if (!mounted) return;
        setError(true);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
    };
  }, [uri, onRatio]);

  if (error) {
    return (
      <View style={s.imageFallback}>
        <Text style={s.imageFallbackIcon}>🖼️</Text>
        <Text style={s.imageFallbackText}>Image unavailable</Text>
      </View>
    );
  }

  const imageHeight = ratio < 0.9 ? 420 : ratio > 1.4 ? 190 : 260;

  return (
    <View style={[s.imageContainer, { height: imageHeight }]}>
      <Image
        source={{ uri }}
        style={s.photo}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />

      {loading && (
        <View style={s.imageLoadingOverlay}>
          <ActivityIndicator size="small" color="#c9973a" />
        </View>
      )}
    </View>
  );
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
            <Text style={s.markCollagePlay}>▶</Text>
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

export default function TimelineScreen() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<'mine' | 'family'>('mine');
    const [newFamilyCount, setNewFamilyCount] = useState(0);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
const [selectedViewerUri, setSelectedViewerUri] = useState<string | null>(null);
  const [familyMemberCount, setFamilyMemberCount] = useState(0);
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
  const { npub, family } = useIdentity();

    const load = useCallback(async () => {
    const all = await getMilestones();
    setMilestones(all);

    if (family) {
      const memberCount = await getFamilyMemberCount(family.id);
      setFamilyMemberCount(memberCount);

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

    setFamilyMemberCount(0);
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
            publishedToRelay: true,
            nostrEventId: event.id,
          });

          addedCount++;
        } catch {}
      }

      if (addedCount > 0) {
        await load();
      } else {
        const memberCount = await getFamilyMemberCount(family.id);
        setFamilyMemberCount(memberCount);
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
    setTab('family');
    setShowBanner(false);
    setFilters(DEFAULT_FILTERS);
    syncFamilyMilestones();
  };

  const myMilestones = milestones.filter(m => !m.familyId || m.authorNpub === npub);
  const familyMilestones = family ? milestones.filter(m => m.familyId === family.id) : [];
  const source = tab === 'mine' ? myMilestones : familyMilestones;
  const familyAuthors = Array.from(new Set(familyMilestones.map(m => m.authorNpub).filter(Boolean))) as string[];
  const allTags = Array.from(new Set(source.flatMap(m => m.tags)));
  const filtered = applyFilters(source, filters, npub);
  const activeFilterCount = countActiveFilters(filters);

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
    const [mediaRatio, setMediaRatio] = useState(1.2);

    const hasTitle = item.note?.includes('\n\n');
    const title = hasTitle ? item.note.split('\n\n')[0] : null;
    const body = hasTitle ? item.note.split('\n\n').slice(1).join('\n\n') : item.note;

        const mediaItems = getMilestoneMediaItems(item);
    const hasVisualMedia = mediaItems.some(m => m.type === 'image' || m.type === 'video');
    const hasAudioOnly = !hasVisualMedia && mediaItems.some(m => m.type === 'audio');

    const isPortrait = false;

    return (
      <TouchableOpacity
        style={s.item}
        onPress={() => router.push({ pathname: '/mark-detail', params: { id: item.id } } as any)}
        activeOpacity={0.85}
      >
        <View style={s.timelineCol}>
          <View style={s.dot} />
          {index < filtered.length - 1 && <View style={s.line} />}
        </View>

        <View style={s.cardSlot}>
          <View style={[s.card, isPortrait && s.cardPortrait]}>
                        {(hasVisualMedia || hasAudioOnly) && (
              <TimelineMediaCollage
  milestone={item}
  onPressMedia={(index) => openViewerForMilestone(item, index)}
/>
            )}

            <View style={s.cardBody}>
              <Text style={s.date}>{formatDate(item.createdAt)}</Text>
              {title && <Text style={s.cardTitle}>{title}</Text>}
              {body ? <Text style={s.note} numberOfLines={title ? 2 : 3}>{body}</Text> : null}

              {item.tags.length > 0 && (
                <View style={s.tags}>
                  {item.tags.map(t => <Text key={t} style={s.tag}>{t}</Text>)}
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
    <SafeAreaView style={s.safe}>
      <BEHeader title="Timeline" />

      {showBanner && family && (
        <TouchableOpacity style={s.banner} onPress={switchToFamily} activeOpacity={0.85}>
          <View style={s.bannerContent}>
            <Text style={s.bannerIcon}>👨‍👩‍👧‍👦</Text>
            <View style={s.bannerText}>
              <Text style={s.bannerTitle}>{newFamilyCount === 1 ? '1 new family milestone' : `${newFamilyCount} new family milestones`}</Text>
              <Text style={s.bannerHint}>Tap to view {family.name}</Text>
            </View>
            <TouchableOpacity onPress={() => setShowBanner(false)} style={s.bannerDismiss}>
              <Text style={s.bannerDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, tab === 'mine' && s.tabBtnActive]} onPress={() => { setTab('mine'); setFilters(DEFAULT_FILTERS); }}>
          <Text style={[s.tabText, tab === 'mine' && s.tabTextActive]}>My Timeline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'family' && s.tabBtnActive]}
          onPress={() => { setTab('family'); setShowBanner(false); setFilters(DEFAULT_FILTERS); syncFamilyMilestones(); }}
        >
          <View style={s.tabLabelRow}>
                        <Text style={[s.tabText, tab === 'family' && s.tabTextActive]}>
              {family ? `${family.name} (${familyMemberCount})` : 'Family'}
            </Text>
            {showBanner && newFamilyCount > 0 && <View style={s.tabBadge}><Text style={s.tabBadgeText}>{newFamilyCount}</Text></View>}
            {syncing && tab === 'family' && <ActivityIndicator size="small" color="#c9973a" style={{ marginLeft: 4 }} />}
          </View>
        </TouchableOpacity>
      </View>

      <View style={s.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterBarInner}>
          {activeFilterCount > 0 && <TouchableOpacity style={s.clearChip} onPress={clearFilters}><Text style={s.clearChipText}>✕ Clear</Text></TouchableOpacity>}
          {filters.tags.map(t => <View key={t} style={s.activeChip}><Text style={s.activeChipText}>{t}</Text></View>)}
          {filters.mediaType !== 'all' && <View style={s.activeChip}><Text style={s.activeChipText}>{filters.mediaType}</Text></View>}
          {filters.dateRange !== 'all' && <View style={s.activeChip}><Text style={s.activeChipText}>{filters.dateRange === 'week' ? 'This week' : filters.dateRange === 'month' ? 'This month' : 'This year'}</Text></View>}
          {filters.hasReflection && <View style={s.activeChip}><Text style={s.activeChipText}>Has reflection</Text></View>}
        </ScrollView>
        <TouchableOpacity style={[s.filterBtn, activeFilterCount > 0 && s.filterBtnActive]} onPress={openDrawer}>
          <Text style={[s.filterBtnText, activeFilterCount > 0 && s.filterBtnTextActive]}>{activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'family' && !family ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>👨‍👩‍👧‍👦</Text>
          <Text style={s.emptyText}>No family group yet</Text>
          <Text style={s.emptyHint}>Go to Settings to create or join a family.</Text>
          <TouchableOpacity style={s.emptyActionBtn} onPress={() => router.push('/(tabs)/settings' as any)}><Text style={s.emptyActionText}>Go to Settings</Text></TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>{activeFilterCount > 0 ? '🔍' : syncing ? '⟳' : '◎'}</Text>
          <Text style={s.emptyText}>{syncing ? 'Syncing…' : activeFilterCount > 0 ? 'No matches' : tab === 'family' ? 'No family milestones yet' : 'No milestones yet'}</Text>
          <Text style={s.emptyHint}>{syncing ? '' : activeFilterCount > 0 ? 'Try adjusting your filters.' : tab === 'family' ? 'Save a milestone and tag it to your family.' : 'Tap + to capture your first moment.'}</Text>
          {activeFilterCount > 0 && <TouchableOpacity style={s.emptyActionBtn} onPress={clearFilters}><Text style={s.emptyActionText}>Clear filters</Text></TouchableOpacity>}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c9973a" />}
        />
      )}

      <TouchableOpacity style={s.fab} onPress={() => router.push('/(tabs)/log' as any)} activeOpacity={0.85}>
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>

      <Modal visible={showFilterDrawer} transparent animationType="slide" onRequestClose={() => setShowFilterDrawer(false)}>
        <TouchableOpacity style={s.drawerOverlay} activeOpacity={1} onPress={() => setShowFilterDrawer(false)}>
          <Animated.View style={[s.drawer, { transform: [{ translateY: drawerTranslateY }] }]}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={s.drawerHandle} {...drawerPan.panHandlers} />
            <Text style={s.drawerTitle}>Filter milestones</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {allTags.length > 0 && (
                <View style={s.drawerSection}>
                  <Text style={s.drawerSectionLabel}>TAGS</Text>
                  <View style={s.drawerChips}>
                    {allTags.map(t => (
                      <TouchableOpacity key={t} style={[s.drawerChip, pendingFilters.tags.includes(t) && s.drawerChipActive]} onPress={() => togglePendingTag(t)}>
                        <Text style={[s.drawerChipText, pendingFilters.tags.includes(t) && s.drawerChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              <View style={s.drawerSection}>
                <Text style={s.drawerSectionLabel}>MEDIA TYPE</Text>
                <View style={s.drawerChips}>
                  {(['all', 'photo', 'video', 'voice', 'text'] as const).map(m => (
                    <TouchableOpacity key={m} style={[s.drawerChip, pendingFilters.mediaType === m && s.drawerChipActive]} onPress={() => setPendingFilters(prev => ({ ...prev, mediaType: m }))}>
                      <Text style={[s.drawerChipText, pendingFilters.mediaType === m && s.drawerChipTextActive]}>{m === 'all' ? 'All media' : m === 'photo' ? '📷 Photo' : m === 'video' ? '🎥 Video' : m === 'voice' ? '🎙 Voice' : '📝 Text only'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={s.drawerSection}>
                <Text style={s.drawerSectionLabel}>DATE RANGE</Text>
                <View style={s.drawerChips}>
                  {([['all', 'All time'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']] as const).map(([val, label]) => (
                    <TouchableOpacity key={val} style={[s.drawerChip, pendingFilters.dateRange === val && s.drawerChipActive]} onPress={() => setPendingFilters(prev => ({ ...prev, dateRange: val }))}>
                      <Text style={[s.drawerChipText, pendingFilters.dateRange === val && s.drawerChipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {tab === 'family' && familyAuthors.length > 1 && (
                <View style={s.drawerSection}>
                  <Text style={s.drawerSectionLabel}>FAMILY MEMBER</Text>
                  <View style={s.drawerChips}>
                    <TouchableOpacity style={[s.drawerChip, pendingFilters.authorNpub === null && s.drawerChipActive]} onPress={() => setPendingFilters(prev => ({ ...prev, authorNpub: null }))}>
                      <Text style={[s.drawerChipText, pendingFilters.authorNpub === null && s.drawerChipTextActive]}>Everyone</Text>
                    </TouchableOpacity>
                    {familyAuthors.map(a => (
                      <TouchableOpacity key={a} style={[s.drawerChip, pendingFilters.authorNpub === a && s.drawerChipActive]} onPress={() => setPendingFilters(prev => ({ ...prev, authorNpub: a }))}>
                        <Text style={[s.drawerChipText, pendingFilters.authorNpub === a && s.drawerChipTextActive]}>{a === npub ? 'Me' : `${a.slice(0, 8)}…`}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              <View style={s.drawerSection}>
                <Text style={s.drawerSectionLabel}>REFLECTIONS</Text>
                <TouchableOpacity style={[s.drawerChip, pendingFilters.hasReflection && s.drawerChipActive]} onPress={() => setPendingFilters(prev => ({ ...prev, hasReflection: !prev.hasReflection }))}>
                  <Text style={[s.drawerChipText, pendingFilters.hasReflection && s.drawerChipTextActive]}>✦ Has reflection</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
            <View style={s.drawerActions}>
              <TouchableOpacity style={s.drawerClearBtn} onPress={clearFilters}><Text style={s.drawerClearText}>Clear all</Text></TouchableOpacity>
              <TouchableOpacity style={s.drawerApplyBtn} onPress={applyDrawer}><Text style={s.drawerApplyText}>Apply filters</Text></TouchableOpacity>
            </View>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
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
  safe: { flex: 1, backgroundColor: '#111' },
  banner: { backgroundColor: '#1e1600', borderBottomWidth: 0.5, borderBottomColor: '#c9973a33' },
  bannerContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  bannerIcon: { fontSize: 22 },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 14, color: '#c9973a', fontWeight: '600' },
  bannerHint: { fontSize: 12, color: '#7a5a1a', marginTop: 2 },
  bannerDismiss: { padding: 4 },
  bannerDismissText: { fontSize: 14, color: '#555' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#c9973a' },
  tabText: { fontSize: 13, color: '#444', fontWeight: '500' },
  tabTextActive: { color: '#c9973a', fontWeight: '700' },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBadge: { backgroundColor: '#c9973a', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 18, alignItems: 'center' },
  tabBadgeText: { fontSize: 10, color: '#111', fontWeight: '700' },
  filterBar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e', paddingRight: 12 },
  filterBarInner: { paddingHorizontal: 12, paddingVertical: 9, gap: 6, flexDirection: 'row', alignItems: 'center' },
  activeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#1e1600', borderWidth: 0.5, borderColor: '#c9973a33' },
  activeChipText: { fontSize: 11, color: '#c9973a' },
  clearChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#2a1a1a', borderWidth: 0.5, borderColor: '#c00' },
  clearChipText: { fontSize: 11, color: '#c00' },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a', marginLeft: 4 },
  filterBtnActive: { borderColor: '#c9973a', backgroundColor: '#1e1600' },
  filterBtnText: { fontSize: 12, color: '#555', fontWeight: '500' },
  filterBtnTextActive: { color: '#c9973a', fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 },
  item: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  timelineCol: { alignItems: 'center', width: 12, paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#c9973a' },
  line: { flex: 1, width: 1, backgroundColor: '#222', marginTop: 4 },
    cardSlot: { flex: 1, alignItems: 'stretch' },
  card: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#222',
    backgroundColor: '#0d0d0d',
    overflow: 'hidden',
  },
      cardPortrait: {
    width: width * 0.58,
    maxWidth: 280,
    alignSelf: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Image rendering
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
  markCollagePlay: {
    color: '#c9973a',
    fontSize: 28,
    fontWeight: '900',
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
  videoPlayCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(201,151,58,0.85)', alignItems: 'center', justifyContent: 'center' },
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
  tag: { fontSize: 11, color: '#c9973a', backgroundColor: '#1e1600', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 0.5, borderColor: '#3a2800' },
  cardMeta: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  relayBadge: { fontSize: 10, color: '#444' },
  reflectionBadge: { fontSize: 10, color: '#c9973a' },
  authorBadge: { fontSize: 10, color: '#555' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, color: '#333', marginBottom: 12 },
  emptyText: { fontSize: 17, color: '#555', fontWeight: '500' },
  emptyHint: { fontSize: 13, color: '#333', marginTop: 6, textAlign: 'center' },
  emptyActionBtn: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 0.5, borderColor: '#c9973a' },
  emptyActionText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center', shadowColor: '#c9973a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
  fabIcon: { fontSize: 32, color: '#111', lineHeight: 36, fontWeight: '300' },
  drawerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  drawer: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 40, maxHeight: '80%' },
  drawerHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  drawerTitle: { fontSize: 17, fontWeight: '600', color: '#fff', marginBottom: 20 },
  drawerSection: { marginBottom: 22 },
  drawerSectionLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 },
  drawerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  drawerChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#111' },
  drawerChipActive: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  drawerChipText: { fontSize: 13, color: '#666' },
  drawerChipTextActive: { color: '#111', fontWeight: '600' },
  drawerActions: { flexDirection: 'row', gap: 12, marginTop: 8, paddingTop: 16, borderTopWidth: 0.5, borderTopColor: '#2a2a2a' },
  drawerClearBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  drawerClearText: { fontSize: 14, color: '#555' },
  drawerApplyBtn: { flex: 2, padding: 14, borderRadius: 10, backgroundColor: '#c9973a', alignItems: 'center' },
  drawerApplyText: { fontSize: 14, color: '#111', fontWeight: '700' },
});