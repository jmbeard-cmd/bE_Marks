import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Alert, Linking, Platform } from 'react-native';

type OpenAttachmentOptions = {
  source?: string;
  fileName?: string;
  mimeType?: string;
};

const ATTACHMENT_CACHE_FOLDER = 'be-marks-attachments';

function isRemoteUrl(uri: string): boolean {
  return uri.startsWith('http://') || uri.startsWith('https://');
}

function getAttachmentCacheDirectory(): string {
  if (!FileSystem.cacheDirectory) {
    throw new Error('File cache directory is unavailable.');
  }

  return `${FileSystem.cacheDirectory}${ATTACHMENT_CACHE_FOLDER}/`;
}

function getExtensionFromMimeType(mimeType?: string): string {
  const normalized = mimeType?.toLowerCase();

  if (!normalized) return 'bin';
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.includes('wordprocessingml') || normalized.includes('msword')) return 'docx';
  if (normalized.includes('spreadsheetml') || normalized.includes('excel')) return 'xlsx';
  if (normalized.includes('presentationml') || normalized.includes('powerpoint')) return 'pptx';
  if (normalized.includes('plain')) return 'txt';
  if (normalized.includes('csv')) return 'csv';
  if (normalized.includes('jpeg')) return 'jpg';
  if (normalized.includes('png')) return 'png';

  return 'bin';
}

function getMimeTypeFromFileName(fileName?: string): string | undefined {
  const normalized = fileName?.toLowerCase();

  if (!normalized) return undefined;
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.doc')) return 'application/msword';
  if (normalized.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (normalized.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (normalized.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (normalized.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (normalized.endsWith('.pptx')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (normalized.endsWith('.txt')) return 'text/plain';
  if (normalized.endsWith('.csv')) return 'text/csv';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.png')) return 'image/png';

  return undefined;
}

function getSafeFileNameFromUrl(uri: string): string {
  const withoutQuery = uri.split('?')[0] || uri;
  const lastPart = withoutQuery.split('/').filter(Boolean).pop();

  if (!lastPart) return 'attachment';

  try {
    return decodeURIComponent(lastPart);
  } catch {
    return lastPart;
  }
}

function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .trim()
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ');

  return cleaned || 'attachment';
}

function ensureFileNameHasExtension(fileName: string, mimeType?: string): string {
  if (/\.[a-z0-9]{2,8}$/i.test(fileName)) {
    return fileName;
  }

  return `${fileName}.${getExtensionFromMimeType(mimeType)}`;
}

function buildLocalFileName(uri: string, options: OpenAttachmentOptions): string {
  const baseName = options.fileName || getSafeFileNameFromUrl(uri);
  const safeName = sanitizeFileName(baseName);
  const mimeType = options.mimeType || getMimeTypeFromFileName(safeName);

  return ensureFileNameHasExtension(safeName, mimeType);
}

function getAttachmentMimeType(
  localFileName: string,
  options: OpenAttachmentOptions
): string {
  return options.mimeType || getMimeTypeFromFileName(localFileName) || '*/*';
}

async function ensureAttachmentCacheDirectory() {
  const cacheDirectory = getAttachmentCacheDirectory();
  const directoryInfo = await FileSystem.getInfoAsync(cacheDirectory);

  if (!directoryInfo.exists) {
    await FileSystem.makeDirectoryAsync(cacheDirectory, { intermediates: true });
  }

  return cacheDirectory;
}

async function downloadRemoteAttachment(
  uri: string,
  options: OpenAttachmentOptions
): Promise<{ localUri: string; localFileName: string; mimeType: string }> {
  const cacheDirectory = await ensureAttachmentCacheDirectory();
  const localFileName = buildLocalFileName(uri, options);
  const mimeType = getAttachmentMimeType(localFileName, options);
  const localUri = `${cacheDirectory}${localFileName}`;

  const downloadResult = await FileSystem.downloadAsync(uri, localUri);

  if (downloadResult.status && downloadResult.status >= 400) {
    throw new Error(`Attachment download failed with status ${downloadResult.status}.`);
  }

  return {
    localUri: downloadResult.uri,
    localFileName,
    mimeType,
  };
}

async function shareLocalAttachment(localUri: string, mimeType: string) {
  const sharingAvailable = await Sharing.isAvailableAsync();

  if (!sharingAvailable) {
    await Linking.openURL(localUri);
    return;
  }

  await Sharing.shareAsync(localUri, {
    mimeType,
    dialogTitle: 'Open attachment',
  });
}

async function openLocalAttachment(localUri: string, mimeType: string) {
  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(localUri);

      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: mimeType,
      });

      return;
    } catch (error) {
      console.warn('[openAttachment] Android direct open failed, using share sheet:', error);
      await shareLocalAttachment(localUri, mimeType);
      return;
    }
  }

  await shareLocalAttachment(localUri, mimeType);
}

export async function openAttachment(
  uri?: string | null,
  options: OpenAttachmentOptions = {}
) {
  const source = options.source || 'Attachment';
  const cleanUri = uri?.trim();

  if (!cleanUri) {
    Alert.alert('Attachment unavailable', 'This attachment does not have a file link.');
    return;
  }

  try {
    if (isRemoteUrl(cleanUri)) {
      const downloadedAttachment = await downloadRemoteAttachment(cleanUri, options);
      await openLocalAttachment(downloadedAttachment.localUri, downloadedAttachment.mimeType);
      return;
    }

    const localFileName = buildLocalFileName(cleanUri, options);
    const mimeType = getAttachmentMimeType(localFileName, options);

    await openLocalAttachment(cleanUri, mimeType);
  } catch (error) {
    console.warn(`[openAttachment] failed to open ${source}:`, error);
    Alert.alert(
      'Cannot open attachment',
      'No app was able to open this attachment. You may need a PDF or document viewer installed.'
    );
  }
}