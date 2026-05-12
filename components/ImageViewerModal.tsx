import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import ImageZoom from 'react-native-image-pan-zoom';
import { setAppActivity } from '../src/utils/app-activity';

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
  width,
  height,
  goNext,
  goPrev,
  onClose,
}: {
  uri: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  goNext: () => void;
  goPrev: () => void;
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [uri]);

  const player = useVideoPlayer({ uri }, p => {
    p.loop = false;
    p.play();
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, gesture) => {
        const absX = Math.abs(gesture.dx);
        const absY = Math.abs(gesture.dy);

        if (gesture.dy > 70 && absY > absX) {
          onClose();
          return;
        }

        if (gesture.dx < -55 && absX > absY) {
          goNext();
          return;
        }

        if (gesture.dx > 55 && absX > absY) {
          goPrev();
        }
      },
    })
  ).current;

  return (
    <View style={[s.videoScreen, { width, height }]}>
      {!!thumbnailUrl && !ready && (
        <Image
          source={{ uri: thumbnailUrl }}
          style={[s.videoThumbnail, { width, height }]}
          resizeMode="contain"
        />
      )}

      {!thumbnailUrl && !ready && (
        <View style={[s.videoFallback, { width, height }]}>
          <Text style={s.videoFallbackText}>Loading video...</Text>
        </View>
      )}

      <VideoView
        player={player}
        style={[s.video, { width, height }, !ready && { opacity: 0 }]}
        contentFit="contain"
        nativeControls={false}
        onFirstFrameRender={() => setReady(true)}
      />

      <View style={s.videoGestureLayer} {...panResponder.panHandlers} />
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
  const { width, height } = useWindowDimensions();

  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomKey, setZoomKey] = useState(0);
  const [modalSeedUri, setModalSeedUri] = useState<string | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const swipeLockedRef = useRef(false);
  const activeIndexRef = useRef(0);
  const isZoomedRef = useRef(false);
  const lastZoomScaleRef = useRef(1);

  const activeMedia = images[activeIndex];

useEffect(() => {
  if (!selectedUri) {
    setAppActivity('media-viewer', false);
    StatusBar.setHidden(false, 'fade');
    return;
  }

  setAppActivity('media-viewer', true);
  StatusBar.setHidden(true, 'fade');

  return () => {
    setAppActivity('media-viewer', false);
    StatusBar.setHidden(false, 'fade');
  };
}, [selectedUri]);

  useEffect(() => {
    let cancelled = false;

    async function updateOrientationLock() {
      try {
        if (selectedUri) {
          const supportsFlexibleViewer =
            await ScreenOrientation.supportsOrientationLockAsync(
              ScreenOrientation.OrientationLock.ALL
            );

          if (cancelled) return;

          if (supportsFlexibleViewer) {
            await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.ALL
            );
          } else {
            await ScreenOrientation.unlockAsync();
          }

          return;
        }

        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP
        );
      } catch (error) {
        console.warn('[ImageViewerModal] Orientation lock failed:', error);
      }
    }

    updateOrientationLock();

    return () => {
      cancelled = true;

      if (selectedUri) {
        ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP
        ).catch(error => {
          console.warn('[ImageViewerModal] Portrait relock failed:', error);
        });
      }
    };
  }, [selectedUri]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (!selectedUri) {
      setModalSeedUri(null);
      setIsZoomed(false);
      isZoomedRef.current = false;
      lastZoomScaleRef.current = 1;
      swipeLockedRef.current = false;
      activeIndexRef.current = 0;
      return;
    }

    const startIndex = images.findIndex(img => img.uri === selectedUri);
    const safeIndex = startIndex >= 0 ? startIndex : 0;

    swipeLockedRef.current = false;
    activeIndexRef.current = safeIndex;
    isZoomedRef.current = false;
    lastZoomScaleRef.current = 1;

    setActiveIndex(safeIndex);
    setIsZoomed(false);
    setZoomKey(k => k + 1);
    setModalSeedUri(selectedUri);
  }, [selectedUri, images]);

  useEffect(() => {
    setZoomKey(k => k + 1);
  }, [width, height]);

    function setZoomedSafely(nextZoomed: boolean) {
    if (isZoomedRef.current === nextZoomed) return;

    isZoomedRef.current = nextZoomed;
    setIsZoomed(nextZoomed);
  }

  function unlockSwipeSoon() {
    setTimeout(() => {
      swipeLockedRef.current = false;
    }, 180);
  }

  function goNext() {
    if (swipeLockedRef.current) return;

    const currentIndex = activeIndexRef.current;
    if (currentIndex >= images.length - 1) return;

    const nextIndex = currentIndex + 1;

    swipeLockedRef.current = true;
    activeIndexRef.current = nextIndex;

    isZoomedRef.current = false;
    lastZoomScaleRef.current = 1;

    setActiveIndex(nextIndex);
    setIsZoomed(false);
    setZoomKey(k => k + 1);

    unlockSwipeSoon();
  }

  function goPrev() {
    if (swipeLockedRef.current) return;

    const currentIndex = activeIndexRef.current;
    if (currentIndex <= 0) return;

    const nextIndex = currentIndex - 1;

    swipeLockedRef.current = true;
    activeIndexRef.current = nextIndex;

    isZoomedRef.current = false;
    lastZoomScaleRef.current = 1;

    setActiveIndex(nextIndex);
    setIsZoomed(false);
    setZoomKey(k => k + 1);

    unlockSwipeSoon();
  }

  function handleClose() {
    swipeLockedRef.current = false;
    activeIndexRef.current = 0;
    isZoomedRef.current = false;
    lastZoomScaleRef.current = 1;
    setIsZoomed(false);
    setModalSeedUri(null);
    onClose();
  }

  const contentReady =
    !!selectedUri &&
    modalSeedUri === selectedUri &&
    !!activeMedia;

      useEffect(() => {
    if (!contentReady || !activeMedia) return;

    const adjacentImages = [
      images[activeIndex - 1],
      images[activeIndex + 1],
    ].filter(item => item?.type !== 'video' && !!item?.uri);

    adjacentImages.forEach(item => {
      Image.prefetch(item.uri).catch(() => {});
    });
  }, [contentReady, activeIndex, activeMedia, images]);

  return (
<Modal
  visible={!!selectedUri}
  transparent={false}
  animationType="fade"
  onRequestClose={handleClose}
  statusBarTranslucent
  navigationBarTranslucent
  hardwareAccelerated
  supportedOrientations={[
    'portrait',
    'portrait-upside-down',
    'landscape',
    'landscape-left',
    'landscape-right',
  ]}
>
      <View style={s.overlay}>
        <TouchableOpacity style={s.closeBtn} onPress={handleClose}>
          <Text style={s.closeText}>✕</Text>
        </TouchableOpacity>

        {contentReady && images.length > 1 && (
          <View style={s.counter}>
            <Text style={s.counterText}>
              {activeIndex + 1} / {images.length}
            </Text>
          </View>
        )}

        {contentReady && activeMedia?.type === 'video' ? (
          <ViewerVideo
            key={activeMedia.uri}
            uri={activeMedia.uri}
            thumbnailUrl={activeMedia.thumbnailUrl}
            width={width}
            height={height}
            goNext={goNext}
            goPrev={goPrev}
            onClose={handleClose}
          />
        ) : contentReady && activeMedia ? (
          <ZoomableImage
            key={`${activeMedia.id}-${zoomKey}-${width}-${height}`}
            cropWidth={width}
            cropHeight={height}
            imageWidth={width}
            imageHeight={height}
            minScale={1}
            maxScale={4}
            enableCenterFocus
            panToMove
            pinchToZoom
            enableSwipeDown={!isZoomed}
            onSwipeDown={handleClose}
            swipeDownThreshold={80}
            onMove={(position: any) => {
              const scale = position?.scale || 1;

              if (Math.abs(scale - lastZoomScaleRef.current) < 0.03) {
                return;
              }

              lastZoomScaleRef.current = scale;
              setZoomedSafely(scale > 1.02);
            }}
            horizontalOuterRangeOffset={(offsetX: number) => {
              if (isZoomed) return;

              if (offsetX < -45) goNext();
              if (offsetX > 45) goPrev();
            }}
          >
            <Image
              source={{ uri: activeMedia.uri }}
              style={{ width, height }}
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
closeBtn: {
  position: 'absolute',
  top: 18,
  right: 18,
  zIndex: 30,
  width: 46,
  height: 46,
  borderRadius: 23,
  backgroundColor: 'rgba(0,0,0,0.72)',
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
  top: 24,
  alignSelf: 'center',
  zIndex: 30,
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: 'rgba(0,0,0,0.72)',
},
  counterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  videoGestureLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 25,
  },
  videoScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  videoThumbnail: {
    position: 'absolute',
    zIndex: 1,
  },
  videoFallback: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoFallbackText: {
    color: '#777',
    fontSize: 13,
  },
  video: {
    zIndex: 2,
  },
});