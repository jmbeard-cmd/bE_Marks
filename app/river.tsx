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
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

  const markIds = useMemo(() => parseIds(params.ids), [params.ids]);
  const requestedStart = Number.parseInt(getParamValue(params.start) ?? '0', 10);
  const [loading, setLoading] = useState(true);
  const [marks, setMarks] = useState<Milestone[]>([]);
  const [activeIndex, setActiveIndex] = useState(Number.isFinite(requestedStart) ? requestedStart : 0);

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
        setMarks(ordered);
        setActiveIndex(Math.min(Math.max(requestedStart || 0, 0), Math.max(ordered.length - 1, 0)));
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
    if (nextIndex >= 0 && nextIndex < marks.length) {
      setActiveIndex(nextIndex);
    }
  };

  const renderMark = ({ item, index }: { item: Milestone; index: number }) => {
    const text = getMilestoneText(item);
    const visualMedia = getVisualMedia(item);
    const primaryMedia = visualMedia[0] ?? null;
    const isActive = index === activeIndex;

    return (
      <View style={[localStyles.slide, { width }]}>
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
          ) : item.audioUri ? (
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

        <View style={localStyles.captionPanel}>
          <View style={localStyles.captionTopRow}>
            <Text style={localStyles.dateText}>{formatRiverDate(item.createdAt)}</Text>
            <Text style={localStyles.counterText}>{index + 1} / {marks.length}</Text>
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
              {item.authorName || 'bE Marks'}
            </Text>
            {visualMedia.length > 1 ? (
              <Text style={localStyles.mediaCount}>{visualMedia.length} media</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={localStyles.detailButton}
            onPress={() => openDetail(item.id)}
            activeOpacity={0.86}
          >
            <Text style={localStyles.detailButtonText}>Open Mark Detail</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.bg} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={localStyles.safe}>
      <View style={localStyles.topBar}>
        <TouchableOpacity
          style={localStyles.iconButton}
          onPress={handleBack}
          activeOpacity={0.82}
        >
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </TouchableOpacity>

        <View style={localStyles.titleBlock}>
          <Text style={localStyles.title} numberOfLines={1}>{title}</Text>
          <Text style={localStyles.subtitle} numberOfLines={1}>{subtitle}</Text>
        </View>

        <View style={localStyles.iconButton}>
          <Text style={localStyles.topCount}>{marks.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={localStyles.centerState}>
          <ActivityIndicator color={theme.gold} />
          <Text style={localStyles.centerText}>Opening River...</Text>
        </View>
      ) : marks.length === 0 ? (
        <View style={localStyles.centerState}>
          <Text style={localStyles.emptyTitle}>No Marks found</Text>
          <Text style={localStyles.emptyHint}>This River could not find its Mark collection.</Text>
        </View>
      ) : (
        <FlatList
          key={`${width}_${marks.length}`}
          data={marks}
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
          renderItem={renderMark}
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
    backgroundColor: theme.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    backgroundColor: theme.bg,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.textMuted,
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
    paddingBottom: 18,
  },
  mediaStage: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#050505',
    borderWidth: 0.5,
    borderColor: theme.border,
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
    marginHorizontal: 12,
    marginTop: 12,
    padding: 16,
    borderRadius: 22,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
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
    color: theme.text,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
  },
  markBody: {
    color: theme.textSecondary,
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
