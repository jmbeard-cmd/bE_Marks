import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../src/constants/theme';
import { setAppActivity } from '../src/utils/app-activity';
import {
  getMilestones,
  type MarkMedia,
  type Milestone,
} from '../src/utils/storage';
import { useIdentity } from './_layout';

type RiverMedia = MarkMedia & {
  type: 'image' | 'video';
};

type RiverSlide = {
  id: string;
  mark: Milestone;
  media?: RiverMedia;
  mediaIndex: number;
  mediaCount: number;
};

function getRiverSlideCount(mark: Milestone): number {
  return Math.max(getVisualMedia(mark).length, 1);
}

function getRiverStartIndex(marks: Milestone[], requestedMarkIndex: number): number {
  const safeMarkIndex = Math.min(
    Math.max(Number.isFinite(requestedMarkIndex) ? requestedMarkIndex : 0, 0),
    Math.max(marks.length - 1, 0)
  );

  return marks
    .slice(0, safeMarkIndex)
    .reduce((total, mark) => total + getRiverSlideCount(mark), 0);
}

function buildRiverSlides(marks: Milestone[]): RiverSlide[] {
  return marks.flatMap(mark => {
    const visualMedia = getVisualMedia(mark);

    if (visualMedia.length === 0) {
      return [{
        id: `${mark.id}_text_audio`,
        mark,
        mediaIndex: 0,
        mediaCount: 1,
      }];
    }

    return visualMedia.map((media, index) => ({
      id: `${mark.id}_${media.id || media.uri}_${index}`,
      mark,
      media,
      mediaIndex: index,
      mediaCount: visualMedia.length,
    }));
  });
}

function getParamValue(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseIds(value?: string | string[]): string[] {
  const raw = getParamValue(value);
  if (!raw) return [];

  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function getMilestoneText(mark: Milestone): { title: string; body: string } {
  const note = mark.note?.trim() ?? '';
  const parts = note.split(/\n\s*\n/);

  if (parts.length > 1) {
    return {
      title: parts[0].trim() || 'Untitled Mark',
      body: parts.slice(1).join('\n\n').trim(),
    };
  }

  return {
    title: note || 'Untitled Mark',
    body: '',
  };
}

function getVisualMedia(mark: Milestone): RiverMedia[] {
  const mediaItems = Array.isArray(mark.media) ? [...mark.media] : [];

  if (mark.photoUri && !mediaItems.some(item => item.uri === mark.photoUri)) {
    mediaItems.push({
      id: `${mark.id}_legacy_photo`,
      uri: mark.photoUri,
      type: 'image',
      source: mark.photoUri.startsWith('http') ? 'r2' : 'local',
    });
  }

  if (mark.videoUri && !mediaItems.some(item => item.uri === mark.videoUri)) {
    mediaItems.push({
      id: `${mark.id}_legacy_video`,
      uri: mark.videoUri,
      type: 'video',
      source: mark.videoUri.startsWith('http') ? 'r2' : 'local',
    });
  }

  return mediaItems.filter((item): item is RiverMedia =>
    item.type === 'image' || item.type === 'video'
  );
}

function formatRiverDate(timestamp?: number): string {
  if (!timestamp) return 'Date unknown';

  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function RiverVideo({
  uri,
  thumbnailUri,
  active,
}: {
  uri: string;
  thumbnailUri?: string;
  active: boolean;
}) {
  const [ready, setReady] = useState(false);

  const player = useVideoPlayer({ uri }, p => {
    p.loop = false;
  });

  useEffect(() => {
    setReady(false);
  }, [uri]);

  useEffect(() => {
    if (active) {
      player.play();
      return;
    }

    player.pause();
  }, [active, player]);

  return (
    <View style={s.videoWrap}>
      {!!thumbnailUri && !ready && (
        <Image
          source={{ uri: thumbnailUri }}
          style={s.media}
          resizeMode="contain"
        />
      )}
      <VideoView
        player={player}
        style={[s.media, !ready && { opacity: thumbnailUri ? 0 : 1 }]}
        contentFit="contain"
        nativeControls
        onFirstFrameRender={() => setReady(true)}
      />
    </View>
  );
}

export default function RiverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    ids?: string;
    start?: string;
    title?: string;
    subtitle?: string;
    returnToGroupId?: string;
    returnToGroupTab?: string;
  }>();
  const { theme } = useIdentity();
  const localStyles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const markIds = useMemo(() => parseIds(params.ids), [params.ids]);
  const requestedStart = Number.parseInt(getParamValue(params.start) ?? '0', 10);
  const [loading, setLoading] = useState(true);
  const [marks, setMarks] = useState<Milestone[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const riverSlides = useMemo(() => buildRiverSlides(marks), [marks]);

  const title = getParamValue(params.title) || 'River';
  const subtitle = getParamValue(params.subtitle) || 'Move through these Marks';
  const returnToGroupId = getParamValue(params.returnToGroupId);
  const returnToGroupTab = getParamValue(params.returnToGroupTab) || 'mantle';

  useEffect(() => {
    setAppActivity('media-viewer', true);

    return () => {
      setAppActivity('media-viewer', false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const allMarks = await getMilestones();
      const byId = new Map(allMarks.map(mark => [mark.id, mark]));
      const ordered = markIds
        .map(id => byId.get(id))
        .filter((mark): mark is Milestone => !!mark);

      if (!cancelled) {
        const nextStartIndex = getRiverStartIndex(ordered, requestedStart || 0);

        setMarks(ordered);
        setActiveIndex(nextStartIndex);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [markIds, requestedStart]);

  const handleBack = () => {
    if (returnToGroupId) {
      router.replace({
        pathname: '/group-detail',
        params: { id: returnToGroupId, tab: returnToGroupTab },
      } as any);
      return;
    }

    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/timeline' as any);
  };

  const openDetail = (markId: string) => {
    router.push({
      pathname: '/mark-detail',
      params: { id: markId },
    } as any);
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;

    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
    if (nextIndex >= 0 && nextIndex < riverSlides.length) {
      setActiveIndex(nextIndex);
      setControlsVisible(true);
    }
  };

  const renderSlide = ({ item, index }: { item: RiverSlide; index: number }) => {
    const mark = item.mark;
    const text = getMilestoneText(mark);
    const primaryMedia = item.media;
    const isActive = index === activeIndex;

    return (
      <Pressable
        style={[localStyles.slide, { width }]}
        onPress={() => setControlsVisible(current => !current)}
      >
        <View style={localStyles.mediaStage}>
          {primaryMedia?.type === 'image' ? (
            <Image
              source={{ uri: primaryMedia.uri }}
              style={localStyles.media}
              resizeMode="contain"
            />
          ) : primaryMedia?.type === 'video' ? (
            <RiverVideo
              uri={primaryMedia.uri}
              thumbnailUri={primaryMedia.thumbnailUri}
              active={isActive}
            />
          ) : mark.audioUri ? (
            <View style={localStyles.audioOnly}>
              <Ionicons name="mic-outline" size={34} color={theme.gold} />
              <Text style={localStyles.audioTitle}>Voice Mark</Text>
              <Text style={localStyles.audioHint}>Open details to play the full audio note.</Text>
            </View>
          ) : (
            <View style={localStyles.textOnly}>
              <Text style={localStyles.textOnlyKicker}>Mark</Text>
              <Text style={localStyles.textOnlyTitle} numberOfLines={7}>
                {text.title}
              </Text>
            </View>
          )}
        </View>

        {controlsVisible && (
        <View style={localStyles.captionPanel}>
          <View style={localStyles.captionTopRow}>
            <Text style={localStyles.dateText}>{formatRiverDate(mark.createdAt)}</Text>
            <Text style={localStyles.counterText}>{index + 1} / {riverSlides.length}</Text>
          </View>

          <Text style={localStyles.markTitle} numberOfLines={2}>
            {text.title}
          </Text>

          {!!text.body && (
            <Text style={localStyles.markBody} numberOfLines={4}>
              {text.body}
            </Text>
          )}

          <View style={localStyles.metaRow}>
            <Text style={localStyles.authorText} numberOfLines={1}>
              {mark.authorName || 'bE Marks'}
            </Text>
            {item.mediaCount > 1 ? (
              <Text style={localStyles.mediaCount}>
                {item.mediaIndex + 1} of {item.mediaCount}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={localStyles.detailButton}
            onPress={() => openDetail(mark.id)}
            activeOpacity={0.86}
          >
            <Text style={localStyles.detailButtonText}>Open Mark Detail</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.bg} />
          </TouchableOpacity>
         </View>
        )}
       </Pressable>
    );
  };

  return (
    <SafeAreaView style={localStyles.safe}>
      {controlsVisible && (
        <View style={[localStyles.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={localStyles.iconButton}
            onPress={handleBack}
            activeOpacity={0.82}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={localStyles.titleBlock}>
            <Text style={localStyles.title} numberOfLines={1}>{title}</Text>
            <Text style={localStyles.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>

          <View style={localStyles.iconButton}>
            <Text style={localStyles.topCount}>{riverSlides.length}</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={localStyles.centerState}>
          <ActivityIndicator color={theme.gold} />
          <Text style={localStyles.centerText}>Opening River...</Text>
        </View>
      ) : riverSlides.length === 0 ? (
        <View style={localStyles.centerState}>
          <Text style={localStyles.emptyTitle}>No Marks found</Text>
          <Text style={localStyles.emptyHint}>This River could not find its Mark collection.</Text>
        </View>
      ) : (
        <FlatList
          key={`${width}_${riverSlides.length}`}
          data={riverSlides}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={activeIndex}
          keyExtractor={item => item.id}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          onMomentumScrollEnd={handleScrollEnd}
          renderItem={renderSlide}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  videoWrap: {
    flex: 1,
    width: '100%',
  },
  media: {
    width: '100%',
    height: '100%',
  },
});

const createStyles = (theme: typeof Colors.dark) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#050505',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  topCount: {
    color: theme.gold,
    fontSize: 13,
    fontWeight: '900',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  centerText: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '900',
  },
  emptyHint: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  slide: {
    flex: 1,
    paddingBottom: 0,
    backgroundColor: '#050505',
  },
  mediaStage: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: 0,
    marginTop: 0,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#050505',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  audioOnly: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
    backgroundColor: theme.raised,
  },
  audioTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 10,
  },
  audioHint: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
  },
  textOnly: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: theme.raised,
  },
  textOnlyKicker: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  textOnlyTitle: {
    color: theme.text,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: '900',
    textAlign: 'center',
  },
  captionPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 18,
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.64)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  captionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  dateText: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  counterText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  markTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
  },
  markBody: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: 7,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 11,
  },
  authorText: {
    flex: 1,
    minWidth: 0,
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  mediaCount: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  detailButton: {
    marginTop: 13,
    height: 42,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.gold,
  },
  detailButtonText: {
    color: theme.bg,
    fontSize: 13,
    fontWeight: '900',
  },
});
