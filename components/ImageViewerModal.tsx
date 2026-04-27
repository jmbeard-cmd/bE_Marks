import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import ImageZoom from 'react-native-image-pan-zoom';

const { width, height } = Dimensions.get('window');
const ZoomableImage = ImageZoom as any;

export type ViewerImage = {
  id: string;
  uri: string;
  type?: 'image' | 'video';
  thumbnailUrl?: string;
};

function ViewerVideo({
  uri,
  thumbnailUrl,
  goNext,
  goPrev,
  onClose,
}: {
  uri: string;
  thumbnailUrl?: string;
  goNext: () => void;
  goPrev: () => void;
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);

  const player = useVideoPlayer({ uri }, p => {
    p.loop = false;
    p.play();
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => {
        const horizontal = Math.abs(gesture.dx) > 25 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
        const vertical = Math.abs(gesture.dy) > 35 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
        return horizontal || vertical;
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 80) {
          onClose();
          return;
        }

        if (gesture.dx < -50) goNext();
        if (gesture.dx > 50) goPrev();
      },
    })
  ).current;

  return (
    <View style={s.videoScreen} {...panResponder.panHandlers}>
      
      {!!thumbnailUrl && !ready && (
        <Image
          source={{ uri: thumbnailUrl }}
          style={s.videoThumbnail}
          resizeMode="contain"
        />
      )}

      {!thumbnailUrl && !ready && (
        <View style={s.videoFallback}>
          <Text style={{ color: '#777' }}>Loading video...</Text>
        </View>
      )}

      <VideoView
        key={uri}
        player={player}
        style={[
          s.video,
          !ready && { opacity: 0 },
        ]}
        contentFit="contain"
        nativeControls
        surfaceType="textureView"
        onFirstFrameRender={() => {
          setReady(true);
        }}
      />

      <TouchableOpacity style={s.videoLeftTapZone} onPress={goPrev} />
      <TouchableOpacity style={s.videoRightTapZone} onPress={goNext} />
    </View>
  );
}

export default function ImageViewerModal({
  images,
  selectedUri,
  onClose,
}: {
  images: ViewerImage[];
  selectedUri: string | null;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomKey, setZoomKey] = useState(0);
  const swipeLockedRef = useRef(false);

  const activeMedia = images[activeIndex];

  useEffect(() => {
    if (!selectedUri) return;

    const startIndex = images.findIndex(img => img.uri === selectedUri);
    swipeLockedRef.current = false;
    setActiveIndex(startIndex >= 0 ? startIndex : 0);
    setZoomKey(k => k + 1);
  }, [selectedUri, images]);

  function unlockSwipeSoon() {
    setTimeout(() => {
      swipeLockedRef.current = false;
    }, 200);
  }

  function goNext() {
    if (swipeLockedRef.current) return;
    if (activeIndex >= images.length - 1) return;

    swipeLockedRef.current = true;
    setActiveIndex(activeIndex + 1);
    setZoomKey(k => k + 1);
    unlockSwipeSoon();
  }

  function goPrev() {
    if (swipeLockedRef.current) return;
    if (activeIndex <= 0) return;

    swipeLockedRef.current = true;
    setActiveIndex(activeIndex - 1);
    setZoomKey(k => k + 1);
    unlockSwipeSoon();
  }

  return (
    <Modal
      visible={!!selectedUri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <TouchableOpacity style={s.closeBtn} onPress={onClose}>
          <Text style={s.closeText}>✕</Text>
        </TouchableOpacity>

        {images.length > 1 && (
          <View style={s.counter}>
            <Text style={s.counterText}>
              {activeIndex + 1} / {images.length}
            </Text>
          </View>
        )}

        {activeMedia?.type === 'video' ? (
          <ViewerVideo
            key={activeMedia.uri}
            uri={activeMedia.uri}
            thumbnailUrl={activeMedia.thumbnailUrl}
            goNext={goNext}
            goPrev={goPrev}
            onClose={onClose}
          />
        ) : activeMedia ? (
          <ZoomableImage
            key={`${activeMedia.id}-${zoomKey}`}
            cropWidth={width}
            cropHeight={height}
            imageWidth={width}
            imageHeight={height}
            minScale={1}
            maxScale={4}
            enableCenterFocus
            panToMove
            pinchToZoom
            enableSwipeDown
            onSwipeDown={onClose}
            swipeDownThreshold={80}
            horizontalOuterRangeOffset={(offsetX: number) => {
              if (offsetX < -45) goNext();
              if (offsetX > 45) goPrev();
            }}
          >
            <Image
              source={{ uri: activeMedia.uri }}
              style={s.image}
              resizeMode="contain"
            />
          </ZoomableImage>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoThumbnail: {
  position: 'absolute',
  width,
  height,
  zIndex: 1,
},
videoFallback: {
  position: 'absolute',
  width,
  height,
  alignItems: 'center',
  justifyContent: 'center',
},
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 24,
    zIndex: 30,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(26,26,26,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  counter: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    zIndex: 30,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(26,26,26,0.75)',
  },
  counterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  image: {
    width,
    height,
  },
  videoScreen: {
    width,
    height,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  videoLoadingFallback: {
    position: 'absolute',
    width,
    height,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoLoadingText: {
    color: '#777',
    fontSize: 13,
    marginTop: 10,
    fontWeight: '600',
  },
  video: {
    width,
    height,
    zIndex: 2,
  },
  videoHidden: {
    opacity: 0,
  },
  videoLoadingBadge: {
    position: 'absolute',
    bottom: 64,
    alignSelf: 'center',
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#c9973a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  videoLoadingBadgeText: {
    color: '#111',
    fontSize: 12,
    fontWeight: '800',
  },
  videoLeftTapZone: {
    position: 'absolute',
    left: 0,
    top: 120,
    bottom: 120,
    width: 70,
    zIndex: 25,
  },
  videoRightTapZone: {
    position: 'absolute',
    right: 0,
    top: 120,
    bottom: 120,
    width: 70,
    zIndex: 25,
  },
});