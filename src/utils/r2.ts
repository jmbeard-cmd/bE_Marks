import * as FileSystem from 'expo-file-system';

const WORKER_URL = 'https://be-milestones-upload.jmbeard.workers.dev';

function getContentType(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'm4a': return 'audio/m4a';
    case 'aac': return 'audio/aac';
    default: return 'application/octet-stream';
  }
}

export async function uploadToR2(
  localUri: string,
  mediaType: 'photo' | 'video' | 'audio'
): Promise<string | null> {
  try {
    const contentType = getContentType(localUri);

    const result = await FileSystem.uploadAsync(WORKER_URL, localUri, {
      httpMethod: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-media-type': mediaType,
      },
      uploadType: 1,
    });

    if (result.status === 200 || result.status === 201) {
      const data = JSON.parse(result.body);
      if (data.success && data.url) {
        console.log('[R2] Uploaded:', data.url);
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
}> {
  const results: { photoUri?: string; videoUri?: string; audioUri?: string } = {};

  // Skip upload if already a remote URL
  if (params.photoUri) {
    if (params.photoUri.startsWith('http')) {
      results.photoUri = params.photoUri;
    } else {
      const url = await uploadToR2(params.photoUri, 'photo');
      results.photoUri = url ?? params.photoUri;
    }
  }

  if (params.videoUri) {
    if (params.videoUri.startsWith('http')) {
      results.videoUri = params.videoUri;
    } else {
      const url = await uploadToR2(params.videoUri, 'video');
      results.videoUri = url ?? params.videoUri;
    }
  }

  if (params.audioUri) {
    if (params.audioUri.startsWith('http')) {
      results.audioUri = params.audioUri;
    } else {
      const url = await uploadToR2(params.audioUri, 'audio');
      results.audioUri = url ?? params.audioUri;
    }
  }

  return results;
}