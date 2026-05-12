import { useMemo, useRef, useState } from 'react';
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

type Props = {
  media: CollageMediaItem[];
  audioUri?: string;
  onPressMedia?: (index: number) => void;
};

const CARD_MEDIA_HEIGHT = 260;

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

  // Prefer thumbnails for BOTH images and videos in feed/card views.
  // Full media still opens in ImageViewerModal through onPressMedia.
  return item.thumbnailUri || item.thumbnailUrl || getMediaUrl(item);
}

function MediaPreviewImage({
  uri,
  type,
  s,
}: {
  uri: string | null;
  type: 'image' | 'video';
  s: ReturnType<typeof createStyles>;
}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View style={s.fallback}>
        <Text style={s.fallbackIcon}>{type === 'video' ? '▶' : '🖼️'}</Text>
        <Text style={s.fallbackText}>{type === 'video' ? 'Video' : 'Image'}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={s.image}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export default function MediaCollage({
  media,
  audioUri,
  onPressMedia,
}: Props) {
  const { theme } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);
  const listRef = useRef<FlatList<CollageMediaItem>>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselWidth, setCarouselWidth] = useState(0);

  const mediaItems = Array.isArray(media) ? media : [];

  const visualItems = mediaItems.filter(item => {
    const type = getMediaType(item);
    return type === 'image' || type === 'video';
  });

  const hasAudio =
    !!audioUri || mediaItems.some(item => getMediaType(item) === 'audio');

  if (visualItems.length === 0 && hasAudio) {
    return (
      <View style={s.audioThumb}>
        <Text style={s.audioThumbIcon}>🎙</Text>
        <Text style={s.audioThumbLabel}>Voice note</Text>
      </View>
    );
  }

  if (visualItems.length === 0) return null;

  const totalMedia = visualItems.length;
  const hasVideo = visualItems.some(item => getMediaType(item) === 'video');

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
      style={s.wrap}
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
        keyExtractor={(item, index) => `${item.id || getMediaUrl(item) || 'media'}_${index}`}
        getItemLayout={(_, index) => ({
          length: carouselWidth,
          offset: carouselWidth * index,
          index,
        })}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        onMomentumScrollEnd={handleScrollEnd}
        renderItem={({ item, index }) => {
          const type = getMediaType(item);
          const previewUri = getPreviewUri(item);

          return (
            <TouchableOpacity
              activeOpacity={0.92}
              style={[s.slide, { width: carouselWidth }]}
              onPress={() => onPressMedia?.(index)}
            >
              <MediaPreviewImage
                uri={previewUri}
                type={type === 'video' ? 'video' : 'image'}
                s={s}
              />

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

      {(totalMedia > 1 || hasVideo || hasAudio) && (
        <View style={s.badgeRow}>
          {hasVideo && (
            <View style={s.badge}>
              <Text style={s.badgeText}>🎥</Text>
            </View>
          )}

          {hasAudio && (
            <View style={s.badge}>
              <Text style={s.badgeText}>🎙</Text>
            </View>
          )}
        </View>
      )}

      {totalMedia > 1 && (
        <View style={s.dots}>
          {visualItems.map((item, index) => (
            <View
              key={`${item.id || getMediaUrl(item) || 'media'}_dot_${index}`}
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
    height: CARD_MEDIA_HEIGHT,
    backgroundColor: '#0d0d0d',
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
    overflow: 'hidden',
    position: 'relative',
  },
slide: {
  height: CARD_MEDIA_HEIGHT,
  backgroundColor: '#0d0d0d',
},
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  fallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111',
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
    color: '#666',
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
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  counterText: {
    color: '#fff',
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
  audioThumb: {
    width: '100%',
    height: 56,
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
  },
  audioThumbIcon: {
    fontSize: 18,
  },
  audioThumbLabel: {
    fontSize: 12,
    color: '#555',
  },
});