import * as FileSystem from 'expo-file-system/legacy';

const WORKER_URL = 'https://be-milestones-upload.jmbeard.workers.dev';
type R2UploadMediaType = 'photo' | 'video' | 'audio' | 'file';

// Determines content type by mediaType param first, then falls back to extension.
// This handles content:// URIs from Android which have no file extension.
function getContentType(uri: string, mediaType: R2UploadMediaType): string {
  // Use mediaType as the primary signal — most reliable.
  // Extension fallback helps for normal file:// URIs.
  const ext = uri.split('.').pop()?.toLowerCase();

  if (mediaType === 'photo') {
    return ext === 'png' ? 'image/png' : 'image/jpeg';
  }

  if (mediaType === 'video') {
    return ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  }

  if (mediaType === 'audio') {
    return ext === 'aac' ? 'audio/aac' : 'audio/m4a';
  }

  if (mediaType === 'file') {
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'txt') return 'text/plain';
    if (ext === 'csv') return 'text/csv';
    if (ext === 'json') return 'application/json';
    if (ext === 'doc') return 'application/msword';
    if (ext === 'docx') {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (ext === 'xls') return 'application/vnd.ms-excel';
    if (ext === 'xlsx') {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (ext === 'ppt') return 'application/vnd.ms-powerpoint';
    if (ext === 'pptx') {
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    }

    return 'application/octet-stream';
  }

  return 'application/octet-stream';
}

export async function uploadToR2(
  localUri: string,
  mediaType: R2UploadMediaType
): Promise<string | null> {
  try {
    const contentType = getContentType(localUri, mediaType);
    console.log(`[R2] Uploading ${mediaType}: ${localUri.slice(0, 60)}... (${contentType})`);

    const result = await FileSystem.uploadAsync(WORKER_URL, localUri, {
      httpMethod: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-media-type': mediaType,
      },
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      mimeType: contentType,
    });

    if (result.status === 200 || result.status === 201) {
      const data = JSON.parse(result.body);
      if (data.success && data.url) {
        console.log('[R2] Upload success:', data.url);
        return data.url;
      }
    }

    console.warn('[R2] Upload failed:', result.status, result.body);
    return null;
  } catch (error) {
    console.error('[R2] Upload error:', error);
    return null;
  }
}

export async function uploadMilestoneMedia(params: {
  photoUri?: string;
  videoUri?: string;
  audioUri?: string;
}): Promise<{
  photoUri?: string;
  videoUri?: string;
  audioUri?: string;
  uploadErrors: string[];
}> {
  const results: { photoUri?: string; videoUri?: string; audioUri?: string; uploadErrors: string[] } = {
    uploadErrors: [],
  };

  if (params.photoUri) {
    if (params.photoUri.startsWith('http')) {
      results.photoUri = params.photoUri;
    } else {
      const url = await uploadToR2(params.photoUri, 'photo');
      if (url) results.photoUri = url;
      else results.uploadErrors.push('photo');
    }
  }

  if (params.videoUri) {
    if (params.videoUri.startsWith('http')) {
      results.videoUri = params.videoUri;
    } else {
      const url = await uploadToR2(params.videoUri, 'video');
      if (url) results.videoUri = url;
      else results.uploadErrors.push('video');
    }
  }

  if (params.audioUri) {
    if (params.audioUri.startsWith('http')) {
      results.audioUri = params.audioUri;
    } else {
      const url = await uploadToR2(params.audioUri, 'audio');
      if (url) results.audioUri = url;
      else results.uploadErrors.push('audio');
    }
  }

  return results;
}