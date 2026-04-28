import { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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

  if (mediaType === 'video') {
    return item.thumbnailUri || item.thumbnailUrl || getMediaUrl(item);
  }

  if (mediaType === 'audio') return null;

  return getMediaUrl(item);
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
  const mediaItems = Array.isArray(media) ? media : [];
  const visualItems = mediaItems.filter(item => {
    const type = getMediaType(item);
    return type === 'image' || type === 'video';
  });

  const hasAudio = !!audioUri || mediaItems.some(item => getMediaType(item) === 'audio');

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

  const renderTile = (item: CollageMediaItem, index: number, tileStyle: any) => {
    const type = getMediaType(item);
    const previewUri = getPreviewUri(item);

    return (
      <TouchableOpacity
        key={`${item.id || getMediaUrl(item) || 'media'}_${index}`}
        style={tileStyle}
        activeOpacity={0.8}
        onPress={() => onPressMedia?.(index)}
      >
        <CollageTileImage
          uri={previewUri}
          type={type === 'video' ? 'video' : 'image'}
        />

        {index === 3 && totalMedia > 4 && (
          <View style={s.moreOverlay}>
            <Text style={s.moreText}>+{totalMedia - 4}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (totalMedia === 1) {
    return (
      <View style={s.wrap}>
        {renderTile(visualItems[0], 0, s.tileOne)}
      </View>
    );
  }

  if (totalMedia === 2) {
    return (
      <View style={s.wrap}>
        {renderTile(visualItems[0], 0, s.tileTwo)}
        {renderTile(visualItems[1], 1, s.tileTwo)}
        <BadgeRow totalMedia={totalMedia} hasVideo={visualItems.some(item => getMediaType(item) === 'video')} hasAudio={hasAudio} />
      </View>
    );
  }

  if (totalMedia === 3) {
    return (
      <View style={s.wrap}>
        <View style={s.threeLeft}>
          {renderTile(visualItems[0], 0, s.fill)}
        </View>

        <View style={s.threeRight}>
          {renderTile(visualItems[1], 1, s.threeRightTile)}
          {renderTile(visualItems[2], 2, s.threeRightTile)}
        </View>

        <BadgeRow totalMedia={totalMedia} hasVideo={visualItems.some(item => getMediaType(item) === 'video')} hasAudio={hasAudio} />
      </View>
    );
  }

    return (
    <View style={s.wrapGrid}>
      {visualItems.slice(0, 4).map((item, index) =>
        renderTile(item, index, s.tileFour)
      )}

      <BadgeRow
        totalMedia={totalMedia}
        hasVideo={visualItems.some(item => getMediaType(item) === 'video')}
        hasAudio={hasAudio}
      />
    </View>
  );
}

function BadgeRow({
  totalMedia,
  hasVideo,
  hasAudio,
}: {
  totalMedia: number;
  hasVideo: boolean;
  hasAudio: boolean;
}) {
  return (
    <View style={s.badgeRow}>
      {totalMedia > 1 && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{totalMedia}</Text>
        </View>
      )}

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
  );
}

const s = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 230,
    backgroundColor: '#0d0d0d',
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
    overflow: 'hidden',
    flexDirection: 'row',
    position: 'relative',
  },
  wrapGrid: {
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
  tileOne: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  tileTwo: {
    width: '50%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  tileFour: {
    width: '50%',
    height: '50%',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  threeLeft: {
    width: '60%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  threeRight: {
    width: '40%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  threeRightTile: {
    width: '100%',
    height: '50%',
    overflow: 'hidden',
    backgroundColor: '#0d0d0d',
  },
  fill: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
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
    color: '#c9973a',
    fontSize: 24,
    fontWeight: '900',
  },
  fallbackText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
  },
  moreOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  moreText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    minWidth: 34,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 14,
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