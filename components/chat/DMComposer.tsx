import { useCallback, useMemo, useState, type RefObject } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
  onPickGif?: () => void;
};

const DM_EMOJI_CHOICES = [
  '😀', '😂', '😊', '😍', '🥹', '😎', '😮', '😢',
  '🙏', '👏', '🙌', '👍', '👎', '💪', '🔥', '✨',
  '❤️', '💛', '💯', '🎉', '👀', '🤝', '✅', '😂',
];

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
  onPickGif,
}: DMComposerProps) {
  const [trayOpen, setTrayOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const s = useMemo(() => createStyles(theme), [theme]);

  const showComingSoon = useCallback((title: string, message: string) => {
    setTrayOpen(false);
    Alert.alert(title, message);
  }, []);

  const handlePhotos = useCallback(() => {
    setTrayOpen(false);
    setEmojiOpen(false);

    if (onPickPhotos) {
      onPickPhotos();
      return;
    }

    showComingSoon('Photos coming next', 'DM photo and video attachments will use this button.');
  }, [onPickPhotos, showComingSoon]);

  const handleCamera = useCallback(() => {
    setTrayOpen(false);
    setEmojiOpen(false);

    if (onTakePhoto) {
      onTakePhoto();
      return;
    }

    showComingSoon('Camera coming next', 'DM camera capture will use this button.');
  }, [onTakePhoto, showComingSoon]);

  const handleFiles = useCallback(() => {
    setTrayOpen(false);
    setEmojiOpen(false);

    if (onPickFiles) {
      onPickFiles();
      return;
    }

    showComingSoon('Files coming next', 'DM file attachments will use this button.');
  }, [onPickFiles, showComingSoon]);

  const handleEmoji = useCallback(() => {
    setTrayOpen(false);
    setEmojiOpen(current => !current);
  }, []);

  const handleEmojiChoice = useCallback((emoji: string) => {
    onChangeText(`${value}${emoji}`);

    requestAnimationFrame(() => {
      inputRef?.current?.focus();
    });
  }, [inputRef, onChangeText, value]);

  const handleGif = useCallback(() => {
    setTrayOpen(false);
    setEmojiOpen(false);

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
    setEmojiOpen(false);
    onSend();
  }, [onSend]);

  const handleToggleTray = useCallback(() => {
    setEmojiOpen(false);
    setTrayOpen(current => !current);
  }, []);

  return (
    <View>
      {emojiOpen && (
        <View style={s.emojiPanel}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={s.emojiScroller}
          >
            {DM_EMOJI_CHOICES.map((emoji, index) => (
              <TouchableOpacity
                key={`${emoji}_${index}`}
                style={s.emojiButton}
                onPress={() => handleEmojiChoice(emoji)}
                activeOpacity={0.78}
              >
                <Text style={s.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

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
      onToggleTray={handleToggleTray}
      onSend={handleSendPress}
      onEmojiPress={handleEmoji}
      onCameraPress={handleCamera}
    />
    </View>
  );

  function createStyles(theme: Theme) {
  return StyleSheet.create({
    emojiPanel: {
      marginHorizontal: 12,
      marginBottom: 8,
      borderRadius: 18,
      backgroundColor: theme.surface,
      borderWidth: 0.5,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    emojiScroller: {
      paddingHorizontal: 10,
      paddingVertical: 10,
      gap: 8,
      alignItems: 'center',
    },
    emojiButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.raised,
      borderWidth: 0.5,
      borderColor: theme.border,
    },
    emojiText: {
      fontSize: 24,
      lineHeight: 28,
    },
  });
}
}