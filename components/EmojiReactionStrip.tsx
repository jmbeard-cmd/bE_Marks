import {
    Dimensions,
    Pressable,
    StyleProp,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewStyle,
} from 'react-native';

export type EmojiReactionChoice<TValue = string> = {
  id: string;
  emoji: string;
  label?: string;
  value?: TValue;
};

type EmojiReactionTheme = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  gold: string;
};

type EmojiReactionAnchor = {
  x: number;
  y: number;
};

type EmojiReactionStripProps<TValue = string> = {
  visible?: boolean;
  choices: EmojiReactionChoice<TValue>[];
  onSelect: (choice: EmojiReactionChoice<TValue>) => void;
  onClose?: () => void;
  disabled?: boolean;
  theme: EmojiReactionTheme;
  mode?: 'floating' | 'inline';
  bottomOffset?: number;
  anchor?: EmojiReactionAnchor | null;
  showBackdrop?: boolean;
  backdropColor?: string;
  style?: StyleProp<ViewStyle>;
  trayStyle?: StyleProp<ViewStyle>;
};

export default function EmojiReactionStrip<TValue = string>({
  visible = true,
  choices,
  onSelect,
  onClose,
  disabled = false,
  theme,
  mode = 'floating',
  bottomOffset = 96,
  anchor = null,
  showBackdrop = true,
  backdropColor = 'transparent',
  style,
  trayStyle,
}: EmojiReactionStripProps<TValue>) {
  if (!visible) return null;

  const windowSize = Dimensions.get('window');
  const trayWidth = Math.min(choices.length * 42 + 28, windowSize.width - 24);
  const anchorLeft = anchor
    ? Math.max(12, Math.min(anchor.x - trayWidth / 2, windowSize.width - trayWidth - 12))
    : 0;
  const anchorTop = anchor
    ? Math.max(72, Math.min(anchor.y - 58, windowSize.height - 86))
    : undefined;

  const tray = (
    <View
      style={[
        s.reactionTray,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.gold,
        },
        trayStyle,
      ]}
    >
      {choices.map(choice => (
        <TouchableOpacity
          key={choice.id}
          style={[
            s.reactionBtn,
            {
              backgroundColor: theme.raised,
            },
            disabled && s.reactionBtnDisabled,
          ]}
          activeOpacity={0.8}
          onPress={() => onSelect(choice)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={choice.label || choice.emoji}
        >
          <Text style={s.reactionEmoji}>{choice.emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (mode === 'inline') {
    return tray;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {showBackdrop && onClose && (
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]}
          onPress={onClose}
        />
      )}

      <View
        pointerEvents="box-none"
        style={[
          anchor
            ? [
                s.anchorWrap,
                {
                  left: anchorLeft,
                  top: anchorTop,
                  width: trayWidth,
                },
              ]
            : [
                s.floatingWrap,
                {
                  bottom: bottomOffset,
                },
              ],
          style,
        ]}
      >
        {tray}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  floatingWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  anchorWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  reactionTray: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 0.5,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  reactionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionBtnDisabled: {
    opacity: 0.55,
  },
  reactionEmoji: {
    fontSize: 24,
  },
});