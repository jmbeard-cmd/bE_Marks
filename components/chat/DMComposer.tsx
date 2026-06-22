import { useCallback, useMemo, useState, type RefObject } from 'react';
import { Alert, TextInput } from 'react-native';
import { Colors } from '../../src/constants/theme';
import MessageComposerShell, { type ComposerAction } from './MessageComposerShell';

type Theme = typeof Colors.dark;

type DMComposerProps = {
  theme: Theme;
  value: string;
  placeholder: string;
  inputRef?: RefObject<TextInput | null>;
  inputHeight: number;
  sending?: boolean;
  uploading?: boolean;
  disabled?: boolean;
  onChangeText: (text: string) => void;
  onContentSizeChange: (height: number) => void;
  onFocus?: () => void;
  onSend: () => void;
  onPickPhotos?: () => void;
  onTakePhoto?: () => void;
  onPickFiles?: () => void;
  onPickEmoji?: () => void;
  onPickGif?: () => void;
};

export default function DMComposer({
  theme,
  value,
  placeholder,
  inputRef,
  inputHeight,
  sending = false,
  uploading = false,
  disabled = false,
  onChangeText,
  onContentSizeChange,
  onFocus,
  onSend,
  onPickPhotos,
  onTakePhoto,
  onPickFiles,
  onPickEmoji,
  onPickGif,
}: DMComposerProps) {
  const [trayOpen, setTrayOpen] = useState(false);

  const showComingSoon = useCallback((title: string, message: string) => {
    setTrayOpen(false);
    Alert.alert(title, message);
  }, []);

  const handlePhotos = useCallback(() => {
    setTrayOpen(false);

    if (onPickPhotos) {
      onPickPhotos();
      return;
    }

    showComingSoon('Photos coming next', 'DM photo and video attachments will use this button.');
  }, [onPickPhotos, showComingSoon]);

  const handleCamera = useCallback(() => {
    setTrayOpen(false);

    if (onTakePhoto) {
      onTakePhoto();
      return;
    }

    showComingSoon('Camera coming next', 'DM camera capture will use this button.');
  }, [onTakePhoto, showComingSoon]);

  const handleFiles = useCallback(() => {
    setTrayOpen(false);

    if (onPickFiles) {
      onPickFiles();
      return;
    }

    showComingSoon('Files coming next', 'DM file attachments will use this button.');
  }, [onPickFiles, showComingSoon]);

  const handleEmoji = useCallback(() => {
    if (onPickEmoji) {
      onPickEmoji();
      return;
    }

    showComingSoon('Emoji coming next', 'DM emoji picking will use this button.');
  }, [onPickEmoji, showComingSoon]);

  const handleGif = useCallback(() => {
    setTrayOpen(false);

    if (onPickGif) {
      onPickGif();
      return;
    }

    showComingSoon('GIFs coming next', 'DM GIF and sticker sending will use this button.');
  }, [onPickGif, showComingSoon]);

  const actions = useMemo<ComposerAction[]>(() => [
    {
      key: 'photos',
      title: 'Photos',
      hint: 'Attach photo or video',
      icon: 'images-outline',
      onPress: handlePhotos,
      disabled: uploading,
    },
    {
      key: 'camera',
      title: 'Camera',
      hint: 'Take a photo',
      icon: 'camera-outline',
      onPress: handleCamera,
      disabled: uploading,
    },
    {
      key: 'files',
      title: 'Files',
      hint: 'Attach a document',
      icon: 'folder-outline',
      onPress: handleFiles,
      disabled: uploading,
    },
    {
      key: 'emoji',
      title: 'Emoji',
      hint: 'Add expression',
      icon: 'happy-outline',
      onPress: handleEmoji,
      disabled: uploading,
    },
    {
      key: 'gif',
      title: 'GIF / Stickers',
      hint: 'Coming soon',
      icon: 'film-outline',
      onPress: handleGif,
      disabled: uploading,
      dimmed: true,
    },
  ], [handleCamera, handleEmoji, handleFiles, handleGif, handlePhotos, uploading]);

  const handleSendPress = useCallback(() => {
    setTrayOpen(false);
    onSend();
  }, [onSend]);

  return (
    <MessageComposerShell
      theme={theme}
      value={value}
      placeholder={placeholder}
      inputRef={inputRef}
      inputHeight={inputHeight}
      disabled={disabled}
      sending={sending}
      uploading={uploading}
      trayOpen={trayOpen}
      actions={actions}
      onChangeText={onChangeText}
      onContentSizeChange={onContentSizeChange}
      onFocus={onFocus}
      onToggleTray={() => setTrayOpen(current => !current)}
      onSend={handleSendPress}
      onEmojiPress={handleEmoji}
      onCameraPress={handleCamera}
    />
  );
}