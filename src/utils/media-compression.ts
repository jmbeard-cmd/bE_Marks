import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

type CompressionStatusCallback = (status: string) => void;
type CompressionProgressCallback = (progress: number) => void;

type CompressorModule = {
  Image?: {
    compress: (
      uri: string,
      options: {
        compressionMethod?: 'auto' | 'manual';
        maxWidth?: number;
        quality?: number;
      }
    ) => Promise<string>;
  };
  Video?: {
    compress: (
      uri: string,
      options: {
        compressionMethod?: 'auto' | 'manual';
      },
      onProgress?: (progress: number) => void
    ) => Promise<string>;
  };
};

let cachedCompressorModule: CompressorModule | null | undefined;

function isRunningInExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

function getCompressorModule(): CompressorModule | null {
  if (isRunningInExpoGo()) {
    cachedCompressorModule = null;
    return null;
  }

  if (cachedCompressorModule !== undefined) {
    return cachedCompressorModule;
  }

  try {
    // IMPORTANT:
    // This must stay inside the function.
    // Expo Go cannot use react-native-compressor because it is a native module.
    // In an EAS/native APK build, this require should succeed and real compression will run.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedCompressorModule = require('react-native-compressor') as CompressorModule;
    return cachedCompressorModule;
  } catch (error) {
    console.warn(
      '[Media Compression] react-native-compressor unavailable; using original media URI.'
    );

    cachedCompressorModule = null;
    return null;
  }
}

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

  const compressor = getCompressorModule();

  if (!compressor?.Image?.compress) {
    if (isRunningInExpoGo()) {
      console.log('[Image Compression] skipped in Expo Go; using original image');
    }

    return {
      uri: input.uri,
      originalBytes,
      compressedBytes: null,
      wasCompressed: false,
    };
  }

  try {
    const compressedUri = await compressor.Image.compress(input.uri, {
      compressionMethod: 'manual',
      maxWidth: 2048,
      quality: 0.82,
    });

    if (!compressedUri) {
      return {
        uri: input.uri,
        originalBytes,
        compressedBytes: null,
        wasCompressed: false,
      };
    }

    const compressedBytes = await getFileSizeBytes(compressedUri);

    console.log('[Image Compression] complete:', {
      original: formatBytes(originalBytes),
      compressed: formatBytes(compressedBytes),
      originalBytes,
      compressedBytes,
    });

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

  const compressor = getCompressorModule();

  if (!compressor?.Video?.compress) {
    if (isRunningInExpoGo()) {
      console.log('[Video Compression] skipped in Expo Go; using original video');
    }

    input.onProgress?.(1);

    return {
      uri: input.uri,
      originalBytes,
      compressedBytes: null,
      wasCompressed: false,
    };
  }

  try {
    const compressedUri = await compressor.Video.compress(
      input.uri,
      {
        compressionMethod: 'auto',
      },
      progress => {
        input.onProgress?.(progress);
      }
    );

    if (!compressedUri) {
      return {
        uri: input.uri,
        originalBytes,
        compressedBytes: null,
        wasCompressed: false,
      };
    }

    const compressedBytes = await getFileSizeBytes(compressedUri);

    console.log('[Video Compression] complete:', {
      original: formatBytes(originalBytes),
      compressed: formatBytes(compressedBytes),
      originalBytes,
      compressedBytes,
    });

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