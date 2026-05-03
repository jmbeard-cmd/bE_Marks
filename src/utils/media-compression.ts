import * as FileSystem from 'expo-file-system/legacy';
import {
    Image as CompressorImage,
    Video,
} from 'react-native-compressor';

type CompressionStatusCallback = (status: string) => void;
type CompressionProgressCallback = (progress: number) => void;

async function getFileSizeBytes(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true } as any);

    if (info.exists && typeof (info as any).size === 'number') {
      return (info as any).size;
    }

    return null;
  } catch (error) {
    console.warn('[Media Compression] failed to read file size:', error);
    return null;
  }
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return 'unknown size';

  const mb = bytes / (1024 * 1024);

  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }

  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

export async function compressImageForUpload(input: {
  uri: string;
  onStatus?: CompressionStatusCallback;
}): Promise<{
  uri: string;
  originalBytes: number | null;
  compressedBytes: number | null;
  wasCompressed: boolean;
}> {
  const originalBytes = await getFileSizeBytes(input.uri);

  input.onStatus?.(`Optimizing photo… ${formatBytes(originalBytes)}`);

  try {
    const compressedUri = await CompressorImage.compress(input.uri, {
      compressionMethod: 'manual',
      maxWidth: 2048,
      quality: 0.82,
    });

    const compressedBytes = await getFileSizeBytes(compressedUri);

    console.log('[Image Compression] complete:', {
      original: formatBytes(originalBytes),
      compressed: formatBytes(compressedBytes),
      originalBytes,
      compressedBytes,
    });

    if (!compressedUri) {
      return {
        uri: input.uri,
        originalBytes,
        compressedBytes: null,
        wasCompressed: false,
      };
    }

    if (
      originalBytes &&
      compressedBytes &&
      compressedBytes >= originalBytes
    ) {
      console.log('[Image Compression] compressed image was not smaller; using original');
      return {
        uri: input.uri,
        originalBytes,
        compressedBytes,
        wasCompressed: false,
      };
    }

    return {
      uri: compressedUri,
      originalBytes,
      compressedBytes,
      wasCompressed: compressedUri !== input.uri,
    };
  } catch (error) {
    console.warn('[Image Compression] failed, using original image:', error);

    return {
      uri: input.uri,
      originalBytes,
      compressedBytes: null,
      wasCompressed: false,
    };
  }
}

export async function compressVideoForUpload(input: {
  uri: string;
  onStatus?: CompressionStatusCallback;
  onProgress?: CompressionProgressCallback;
}): Promise<{
  uri: string;
  originalBytes: number | null;
  compressedBytes: number | null;
  wasCompressed: boolean;
}> {
  const originalBytes = await getFileSizeBytes(input.uri);

  input.onStatus?.(`Compressing video… ${formatBytes(originalBytes)}`);

  try {
    const compressedUri = await Video.compress(
      input.uri,
      {
        compressionMethod: 'auto',
      },
      progress => {
        input.onProgress?.(progress);
      }
    );

    const compressedBytes = await getFileSizeBytes(compressedUri);

    console.log('[Video Compression] complete:', {
      original: formatBytes(originalBytes),
      compressed: formatBytes(compressedBytes),
      originalBytes,
      compressedBytes,
    });

    if (!compressedUri) {
      return {
        uri: input.uri,
        originalBytes,
        compressedBytes: null,
        wasCompressed: false,
      };
    }

    if (
      originalBytes &&
      compressedBytes &&
      compressedBytes >= originalBytes
    ) {
      console.log('[Video Compression] compressed video was not smaller; using original');
      return {
        uri: input.uri,
        originalBytes,
        compressedBytes,
        wasCompressed: false,
      };
    }

    return {
      uri: compressedUri,
      originalBytes,
      compressedBytes,
      wasCompressed: compressedUri !== input.uri,
    };
  } catch (error) {
    console.warn('[Video Compression] failed, using original video:', error);

    return {
      uri: input.uri,
      originalBytes,
      compressedBytes: null,
      wasCompressed: false,
    };
  }
}

export async function compressMediaForUpload(input: {
  uri: string;
  type: 'image' | 'video';
  onStatus?: CompressionStatusCallback;
  onProgress?: CompressionProgressCallback;
}): Promise<{
  uri: string;
  originalBytes: number | null;
  compressedBytes: number | null;
  wasCompressed: boolean;
}> {
  if (input.type === 'video') {
    return compressVideoForUpload({
      uri: input.uri,
      onStatus: input.onStatus,
      onProgress: input.onProgress,
    });
  }

  return compressImageForUpload({
    uri: input.uri,
    onStatus: input.onStatus,
  });
}