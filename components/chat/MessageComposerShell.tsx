import { Ionicons } from '@expo/vector-icons';
import {
    ActivityIndicator,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import type { Colors } from '../../src/constants/theme';

type Theme = typeof Colors.dark;

export type ComposerAction = {
  key: string;
  title: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  dimmed?: boolean;
  onPress: () => void;
};

type MessageComposerShellProps = {
  theme: Theme;
  value: string;
  placeholder: string;
  inputRef?: React.RefObject<TextInput | null>;
  inputHeight: number;
  disabled?: boolean;
  sending?: boolean;
  uploading?: boolean;
  trayOpen: boolean;
  actions: ComposerAction[];
  sendIcon?: 'arrow-up' | 'checkmark';
  onChangeText: (text: string) => void;
  onContentSizeChange: (height: number) => void;
  onFocus?: () => void;
  onToggleTray: () => void;
  onSend: () => void;
  onEmojiPress?: () => void;
  onCameraPress?: () => void;
};

export default function MessageComposerShell({
  theme,
  value,
  placeholder,
  inputRef,
  inputHeight,
  disabled = false,
  sending = false,
  uploading = false,
  trayOpen,
  actions,
  sendIcon = 'arrow-up',
  onChangeText,
  onContentSizeChange,
  onFocus,
  onToggleTray,
  onSend,
  onEmojiPress,
  onCameraPress,
}: MessageComposerShellProps) {
  const s = createStyles(theme);
  const canSend = value.trim().length > 0 && !sending && !disabled;
  const trayDisabled = disabled || uploading || sending;

  return (
    <View>
      {trayOpen && actions.length > 0 && (
        <View style={s.tray}>
          {actions.map(action => (
            <TouchableOpacity
              key={action.key}
              style={[
                s.trayItem,
                (action.disabled || action.dimmed) && s.trayItemDim,
              ]}
              onPress={action.onPress}
              disabled={action.disabled}
              activeOpacity={0.82}
            >
              <View style={s.trayIconWrap}>
                <Ionicons name={action.icon} size={24} color={theme.gold} />
              </View>

              <View style={s.trayTextBlock}>
                <Text style={s.trayTitle}>{action.title}</Text>

                {!!action.hint && (
                  <Text style={s.trayHint}>{action.hint}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.composer}>
        <TouchableOpacity
          style={[
            s.iconButton,
            trayOpen && s.iconButtonActive,
            trayDisabled && s.iconButtonDim,
          ]}
          onPress={onToggleTray}
          disabled={trayDisabled}
          activeOpacity={0.82}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={theme.gold} />
          ) : (
            <Ionicons
              name={trayOpen ? 'close' : 'add'}
              size={28}
              color={theme.gold}
            />
          )}
        </TouchableOpacity>

        <View style={s.inputWrap}>
          <TextInput
            ref={inputRef}
            editable={!disabled}
            style={[
              s.input,
              {
                height: Math.max(40, Math.min(120, inputHeight)),
              },
            ]}
            placeholder={placeholder}
            placeholderTextColor={theme.textMuted}
            value={value}
            onChangeText={onChangeText}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            onFocus={onFocus}
            onContentSizeChange={event => {
              onContentSizeChange(event.nativeEvent.contentSize.height);
            }}
          />
        </View>

        <TouchableOpacity
          style={[s.smallIconButton, disabled && s.iconButtonDim]}
          onPress={onEmojiPress}
          disabled={disabled || !onEmojiPress}
          activeOpacity={0.82}
        >
          <Ionicons name="happy-outline" size={24} color={theme.gold} />
        </TouchableOpacity>

        {!canSend && (
          <TouchableOpacity
            style={[s.smallIconButton, disabled && s.iconButtonDim]}
            onPress={onCameraPress}
            disabled={disabled || !onCameraPress}
            activeOpacity={0.82}
          >
            <Ionicons name="camera-outline" size={24} color={theme.gold} />
          </TouchableOpacity>
        )}

        {canSend && (
          <TouchableOpacity
            style={s.sendButton}
            onPress={onSend}
            activeOpacity={0.82}
          >
            {sending ? (
              <ActivityIndicator size="small" color={theme.bg} />
            ) : (
              <Ionicons name={sendIcon} size={22} color={theme.bg} />
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    tray: {
      marginHorizontal: 12,
      marginBottom: 8,
      borderRadius: 18,
      backgroundColor: theme.surface,
      borderWidth: 0.5,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    trayItem: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.border,
    },
    trayItemDim: {
      opacity: 0.62,
    },
    trayIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.raised,
      borderWidth: 0.5,
      borderColor: theme.border,
    },
    trayTextBlock: {
      flex: 1,
      minWidth: 0,
    },
    trayTitle: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '900',
    },
    trayHint: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 2,
    },
    composer: {
      borderTopWidth: 0.5,
      borderTopColor: theme.border,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? 12 : 6,
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-end',
      backgroundColor: theme.bg,
    },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 0.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconButtonActive: {
      borderColor: theme.gold,
      backgroundColor: theme.raised,
    },
    iconButtonDim: {
      opacity: 0.5,
    },
    inputWrap: {
      flex: 1,
      minWidth: 0,
      borderRadius: 22,
      backgroundColor: theme.raised,
      borderWidth: 0.5,
      borderColor: theme.border,
      paddingHorizontal: 2,
    },
    input: {
      color: theme.text,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      maxHeight: 120,
      lineHeight: 20,
    },
    smallIconButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 0.5,
      borderColor: theme.border,
    },
    sendButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: theme.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}