import React, { useEffect, useRef } from 'react';
import {
    Dimensions,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import ImageZoom from 'react-native-image-pan-zoom';

const { width, height } = Dimensions.get('window');
const ZoomableImage = ImageZoom as any;

export type ViewerImage = {
  id: string;
  uri: string;
};

export default function ImageViewerModal({
  images,
  selectedUri,
  onClose,
}: {
  images: ViewerImage[];
  selectedUri: string | null;
  onClose: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  const selectedIndex = Math.max(
    0,
    images.findIndex(img => img.uri === selectedUri)
  );

  useEffect(() => {
    if (!selectedUri) return;

    setTimeout(() => {
      scrollRef.current?.scrollTo({
        x: selectedIndex * width,
        y: 0,
        animated: false,
      });
    }, 50);
  }, [selectedUri, selectedIndex]);

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
              {selectedIndex + 1} / {images.length}
            </Text>
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled
          nestedScrollEnabled
        >
          {images.map(img => (
            <View key={img.id} style={s.page}>
              <ZoomableImage
                cropWidth={width}
                cropHeight={height}
                imageWidth={width}
                imageHeight={height}
                minScale={1}
                maxScale={4}
                enableCenterFocus
              >
                <Image
                  source={{ uri: img.uri }}
                  style={s.image}
                  resizeMode="contain"
                />
              </ZoomableImage>
            </View>
          ))}
        </ScrollView>
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
    top: 50,
    right: 24,
    zIndex: 20,
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
    zIndex: 20,
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
  page: {
    width,
    height,
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});