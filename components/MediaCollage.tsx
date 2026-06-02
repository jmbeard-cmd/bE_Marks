import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIdentity } from '../app/_layout';
import { Colors } from '../src/constants/theme';

export type CollageMediaItem = {
  id?: string;
  uri?: string;
  mediaUrl?: string;
  thumbnailUri?: string;
  thumbnailUrl?: string;
  type?: 'image' | 'video' | 'audio' | string;
  mediaType?: 'image' | 'video' | 'audio' | string;
};

type MediaFitMode = 'smart' | 'cover';

type Props = {
  media: CollageMediaItem[];
  audioUri?: string;
  fitMode?: MediaFitMode;
  fixedHeight?: number;
  autoPlayVideos?: boolean;
  playVideos?: boolean;
  videoMuted?: boolean;
  videoLoop?: boolean;
  onPressMedia?: (index: number) => void;
};

const MIN_CARD_MEDIA_HEIGHT = 220;
const FALLBACK_CARD_MEDIA_HEIGHT = 300;
const MULTI_CARD_MEDIA_FLOOR_HEIGHT = 380;
const MAX_CARD_MEDIA_HEIGHT = 520;

const MEDIA_ASPECT_RATIO_CACHE = new Map<string, number>();
const MEDIA_PREFETCH_CACHE = new Set<string>();

function getMediaUrl(item: CollageMediaItem): string | null {
  return item.uri || item.mediaUrl || null;
}

function getMediaType(item: CollageMediaItem): 'image' | 'video' | 'audio' {
  const rawType = item.type || item.mediaType;

  if (rawType === 'video') return 'video';
  if (rawType === 'audio') return 'audio';

  return 'image';
}

function getPreviewUri(item: CollageMediaItem): string | null {
  const mediaType = getMediaType(item);

  if (mediaType === 'audio') return null;

  const mediaUri = getMediaUrl(item);

  if (mediaType === 'video') {
    return item.thumbnailUri || item.thumbnailUrl || mediaUri;
  }

  return mediaUri || item.thumbnailUri || item.thumbnailUrl || null;
}

function getMediaIdentity(item: CollageMediaItem, index: number): string {
  return `${item.id || getMediaUrl(item) || 'media'}_${index}`;
}

function getAdaptiveMediaHeight(carouselWidth: number, aspectRatio?: number): number {
  if (carouselWidth <= 0 || !aspectRatio || aspectRatio <= 0) {
    return FALLBACK_CARD_MEDIA_HEIGHT;
  }

  const naturalHeight = carouselWidth / aspectRatio;

  return Math.round(
    Math.min(
      MAX_CARD_MEDIA_HEIGHT,
      Math.max(MIN_CARD_MEDIA_HEIGHT, naturalHeight)
    )
  );
}

function getStableCarouselMediaHeight(
  carouselWidth: number,
  visualItems: CollageMediaItem[],
  aspectRatios: Record<string, number>
): number {
  if (visualItems.length <= 1) {
    const mediaKey = visualItems[0]
      ? getMediaIdentity(visualItems[0], 0)
      : '';

    return getAdaptiveMediaHeight(
      carouselWidth,
      mediaKey ? aspectRatios[mediaKey] : undefined
    );
  }

  const fallbackHeight =
    carouselWidth > 0
      ? Math.min(
          MAX_CARD_MEDIA_HEIGHT,
          Math.max(MULTI_CARD_MEDIA_FLOOR_HEIGHT, Math.round(carouselWidth * 1.05))
        )
      : MULTI_CARD_MEDIA_FLOOR_HEIGHT;

  const knownHeights = visualItems
    .map((item, index) => {
      const mediaKey = getMediaIdentity(item, index);
      const ratio = aspectRatios[mediaKey];

      return ratio ? getAdaptiveMediaHeight(carouselWidth, ratio) : 0;
    })
    .filter(height => height > 0);

  if (knownHeights.length === 0) {
    return fallbackHeight;
  }

  return Math.max(fallbackHeight, ...knownHeights);
}

function getSmartResizeMode(
  mediaAspectRatio?: number,
  frameAspectRatio?: number
): 'cover' | 'contain' {
  if (
    !mediaAspectRatio ||
    !frameAspectRatio ||
    mediaAspectRatio <= 0 ||
    frameAspectRatio <= 0
  ) {
    return 'contain';
  }

  const ratioDifference = Math.abs(mediaAspectRatio - frameAspectRatio) / frameAspectRatio;

  return ratioDifference <= 0.18 ? 'cover' : 'contain';
}

function MediaPreviewImage({
  uri,
  type,
  aspectRatio,
  frameAspectRatio,
  fitMode,
  s,
}: {
  uri: string | null;
  type: 'image' | 'video';
  aspectRatio?: number;
  frameAspectRatio?: number;
  fitMode: MediaFitMode;
  s: ReturnType<typeof createStyles>;
}) {
  const [failed, setFailed] = useState(false);
  const resizeMode = fitMode === 'cover'
    ? 'cover'
    : getSmartResizeMode(aspectRatio, frameAspectRatio);

  if (!uri || failed) {
    return (
      <View style={s.fallback}>
        <Text style={s.fallbackIcon}>{type === 'video' ? '▶' : '🖼️'}</Text>
        <Text style={s.fallbackText}>{type === 'video' ? 'Video' : 'Image'}</Text>
      </View>
    );
  }

  return (
    <View style={s.imageStage}>
      <Image
        source={{ uri }}
        style={s.image}
        resizeMode={resizeMode}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

function MediaPreviewVideo({
  uri,
  thumbnailUri,
  fitMode,
  shouldPlay,
  muted,
  loop,
  s,
}: {
  uri: string;
  thumbnailUri: string | null;
  fitMode: MediaFitMode;
  shouldPlay: boolean;
  muted: boolean;
  loop: boolean;
  s: ReturnType<typeof createStyles>;
}) {
  const [ready, setReady] = useState(false);
  const contentFit: 'cover' | 'contain' = fitMode === 'cover' ? 'cover' : 'contain';

  useEffect(() => {
    setReady(false);
  }, [uri]);

  const player = useVideoPlayer({ uri }, p => {
    p.loop = loop;
    (p as any).muted = muted;
  });

  useEffect(() => {
    player.loop = loop;
    (player as any).muted = muted;

    if (shouldPlay) {
      player.play();
    }
  }, [player, shouldPlay, muted, loop]);

  return (
    <View style={s.imageStage}>
      {!!thumbnailUri && !ready && (
        <Image
          source={{ uri: thumbnailUri }}
          style={s.image}
          resizeMode={contentFit}
        />
      )}

      {!thumbnailUri && !ready && (
        <View style={s.fallback}>
          <Text style={s.fallbackIcon}>▶</Text>
          <Text style={s.fallbackText}>Video</Text>
        </View>
      )}

      <VideoView
        player={player}
        style={[s.image, !ready && { opacity: 0 }]}
        contentFit={contentFit}
        nativeControls={false}
        onFirstFrameRender={() => setReady(true)}
      />

      {muted && (
        <View style={s.mutedVideoBadge}>
          <Text style={s.mutedVideoBadgeIcon}>🔇</Text>
        </View>
      )}
    </View>
  );
}

function AudioOnlyPreview({
  uri,
  s,
}: {
  uri: string | null;
  s: ReturnType<typeof createStyles>;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const player = useAudioPlayer(uri ? { uri } : null);

  useEffect(() => {
    if (!player) return;

    const subscription = player.addListener('playbackStatusUpdate', (status: any) => {
      if (status.didJustFinish) {
        setIsPlaying(false);
      }
    });

    return () => {
      subscription?.remove?.();
      try {
        player.pause();
      } catch {}
    };
  }, [player]);

  const togglePlayback = () => {
    if (!player || !uri) return;

    try {
      if (isPlaying) {
        player.pause();
        setIsPlaying(false);
        return;
      }

      player.play();
      setIsPlaying(true);
    } catch (error) {
      console.warn('[MediaCollage] audio playback failed:', error);
      setIsPlaying(false);
    }
  };

  return (
    <TouchableOpacity
      style={s.audioThumb}
      onPress={togglePlayback}
      disabled={!uri}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Stop voice note' : 'Play voice note'}
    >
      <View style={s.audioPlayCircle}>
        <Text style={s.audioThumbIcon}>{isPlaying ? '⏸' : '▶'}</Text>
      </View>

      <View style={s.audioThumbTextWrap}>
        <Text style={s.audioThumbLabel}>Voice note</Text>
        <Text style={s.audioThumbHint}>
          {!uri ? 'Audio unavailable' : isPlaying ? 'Playing… tap to pause' : 'Tap to play'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MediaCollage({
  media,
  audioUri,
  fitMode = 'smart',
  fixedHeight,
  autoPlayVideos = false,
  playVideos = true,
  videoMuted = true,
  videoLoop = true,
  onPressMedia,
}: Props) {
  const { theme } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);
  const listRef = useRef<FlatList<CollageMediaItem>>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselWidth, setCarouselWidth] = useState(0);
  const [mediaAspectRatios, setMediaAspectRatios] = useState<Record<string, number>>(() => {
    const initialRatios: Record<string, number> = {};

    media.forEach((item, index) => {
      const mediaKey = getMediaIdentity(item, index);
      const cachedRatio = MEDIA_ASPECT_RATIO_CACHE.get(mediaKey);

      if (cachedRatio) {
        initialRatios[mediaKey] = cachedRatio;
      }
    });

    return initialRatios;
  });

  const mediaItems = Array.isArray(media) ? media : [];

  const visualItems = mediaItems.filter(item => {
    const type = getMediaType(item);
    return type === 'image' || type === 'video';
  });

  const audioItems = mediaItems.filter(item => getMediaType(item) === 'audio');
  const audioPlaybackUri =
    audioUri ||
    (audioItems[0] ? getMediaUrl(audioItems[0]) || undefined : undefined);

  const hasAudio = !!audioPlaybackUri || audioItems.length > 0;

  if (visualItems.length === 0 && hasAudio) {
    return <AudioOnlyPreview uri={audioPlaybackUri ?? null} s={s} />;
  }

  if (visualItems.length === 0) return null;

  const totalMedia = visualItems.length;
  const hasVideo = visualItems.some(item => getMediaType(item) === 'video');

  useEffect(() => {
    let cancelled = false;

    visualItems.forEach((item, index) => {
      const previewUri = getPreviewUri(item);
      if (!previewUri) return;

      const mediaKey = getMediaIdentity(item, index);
      const cachedRatio = MEDIA_ASPECT_RATIO_CACHE.get(mediaKey);

      if (cachedRatio && !mediaAspectRatios[mediaKey]) {
        setMediaAspectRatios(current => (
          current[mediaKey]
            ? current
            : { ...current, [mediaKey]: cachedRatio }
        ));
      }

      if (previewUri.startsWith('http') && !MEDIA_PREFETCH_CACHE.has(previewUri)) {
        MEDIA_PREFETCH_CACHE.add(previewUri);
        Image.prefetch(previewUri).catch(() => {
          MEDIA_PREFETCH_CACHE.delete(previewUri);
        });
      }

      if (cachedRatio || mediaAspectRatios[mediaKey]) return;

      Image.getSize(
        previewUri,
        (imageWidth, imageHeight) => {
          if (cancelled || imageWidth <= 0 || imageHeight <= 0) return;

          const nextRatio = imageWidth / imageHeight;
          MEDIA_ASPECT_RATIO_CACHE.set(mediaKey, nextRatio);

          setMediaAspectRatios(current => {
            if (current[mediaKey]) return current;

            return {
              ...current,
              [mediaKey]: nextRatio,
            };
          });
        },
        () => {
          // Keep fallback height when the preview size cannot be read.
        }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [mediaAspectRatios, visualItems]);

  const mediaHeight = fixedHeight ?? getStableCarouselMediaHeight(
    carouselWidth,
    visualItems,
    mediaAspectRatios
  );

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (carouselWidth <= 0) return;

    const nextIndex = Math.round(
      event.nativeEvent.contentOffset.x / carouselWidth
    );

    if (nextIndex >= 0 && nextIndex < totalMedia) {
      setActiveIndex(nextIndex);
    }
  };

  return (
    <View
      style={[s.wrap, { height: mediaHeight }]}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (nextWidth > 0 && nextWidth !== carouselWidth) {
          setCarouselWidth(nextWidth);
        }
      }}
    >
      {carouselWidth > 0 && (
      <FlatList
        ref={listRef}
        data={visualItems}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, index) => getMediaIdentity(item, index)}
        getItemLayout={(_, index) => ({
          length: carouselWidth,
          offset: carouselWidth * index,
          index,
        })}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={false}
        onMomentumScrollEnd={handleScrollEnd}
        renderItem={({ item, index }) => {
          const type = getMediaType(item);
          const previewUri = getPreviewUri(item);
          const mediaKey = getMediaIdentity(item, index);
          const aspectRatio = mediaAspectRatios[mediaKey];
          const frameAspectRatio =
            carouselWidth > 0 && mediaHeight > 0
              ? carouselWidth / mediaHeight
              : undefined;

          const mediaUri = getMediaUrl(item);
          const shouldAutoPlayVideo =
            autoPlayVideos &&
            playVideos &&
            type === 'video' &&
            index === activeIndex &&
            !!mediaUri;

          return (
            <TouchableOpacity
              activeOpacity={0.92}
              style={[s.slide, { width: carouselWidth, height: mediaHeight }]}
              onPress={() => onPressMedia?.(index)}
            >
              {shouldAutoPlayVideo ? (
                <MediaPreviewVideo
                  uri={mediaUri}
                  thumbnailUri={previewUri}
                  fitMode={fitMode}
                  shouldPlay={shouldAutoPlayVideo}
                  muted={videoMuted}
                  loop={videoLoop}
                  s={s}
                />
              ) : (
                <MediaPreviewImage
                  uri={previewUri}
                  type={type === 'video' ? 'video' : 'image'}
                  aspectRatio={aspectRatio}
                  frameAspectRatio={frameAspectRatio}
                  fitMode={fitMode}
                  s={s}
                />
              )}
            </TouchableOpacity>
          );
        }}
      />
      )}

      {totalMedia > 1 && (
        <View style={s.counter}>
          <Text style={s.counterText}>
            {activeIndex + 1} / {totalMedia}
          </Text>
        </View>
      )}

      {hasAudio && (
        <View style={s.badgeRow}>
          <View style={s.badge}>
            <Text style={s.badgeText}>🎙</Text>
          </View>
        </View>
      )}

      {totalMedia > 1 && (
        <View style={s.dots}>
          {visualItems.map((item, index) => (
            <View
              key={`${getMediaIdentity(item, index)}_dot`}
              style={[
                s.dot,
                index === activeIndex && s.dotActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: typeof Colors.dark) => StyleSheet.create({
  wrap: {
    width: '100%',
    minHeight: MIN_CARD_MEDIA_HEIGHT,
    backgroundColor: theme.raised,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    overflow: 'hidden',
    position: 'relative',
  },
  slide: {
    backgroundColor: theme.raised,
  },
  imageStage: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.raised,
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.raised,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fallbackIcon: {
    color: theme.gold,
    fontSize: 28,
    fontWeight: '900',
  },
  fallbackText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  counter: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  counterText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    fontWeight: '800',
  },
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: theme.gold,
  },
  badgeRow: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 18,
    minWidth: 30,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 13,
  },
  mutedVideoBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  mutedVideoBadgeIcon: {
    fontSize: 15,
  },
  audioThumb: {
    width: '100%',
    minHeight: 64,
    backgroundColor: theme.raised,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 16,
  },
  audioPlayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.gold,
  },
  audioThumbIcon: {
    color: theme.gold,
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 1,
  },
  audioThumbTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  audioThumbLabel: {
    fontSize: 13,
    color: theme.text,
    fontWeight: '900',
  },
  audioThumbHint: {
    fontSize: 11,
    color: theme.textMuted,
    fontWeight: '700',
    marginTop: 2,
  },
});