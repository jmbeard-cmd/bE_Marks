import { Ionicons } from '@expo/vector-icons';
import {
    StyleProp,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewStyle,
    type GestureResponderEvent,
} from 'react-native';

type MarkActionTheme = {
  bg: string;
  text: string;
  gold: string;
};

type MarkActionRowProps = {
  variant: 'overlay' | 'gold';
  theme: MarkActionTheme;
  commentCount?: number;
  liftUpCount?: number;
  onComment: () => void;
  onLiftUp: (event: GestureResponderEvent) => void;
  onShare: () => void;
  showTag?: boolean;
  style?: StyleProp<ViewStyle>;
};

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export default function MarkActionRow({
  variant,
  theme,
  commentCount = 0,
  liftUpCount = 0,
  onComment,
  onLiftUp,
  onShare,
  showTag = true,
  style,
}: MarkActionRowProps) {
  const isOverlay = variant === 'overlay';
  const iconColor = isOverlay ? '#fff' : theme.gold;
  const badgeBg = isOverlay ? '#2f6eea' : theme.gold;
  const badgeText = isOverlay ? '#fff' : theme.bg;

  const buttonStyle = [
    s.actionButton,
    isOverlay
      ? s.overlayActionButton
      : {
          backgroundColor: `${theme.gold}14`,
          borderColor: `${theme.gold}30`,
        },
  ];

  const mutedButtonStyle = [
    s.actionButton,
    isOverlay
      ? [s.overlayActionButton, s.mutedAction]
      : [
          s.mutedAction,
          {
            backgroundColor: `${theme.gold}10`,
            borderColor: `${theme.gold}22`,
          },
        ],
  ];

  return (
    <View style={[s.actionRow, style]}>
      <TouchableOpacity
        style={buttonStyle}
        onPress={onComment}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Comment on this Mark"
      >
        <Ionicons name="chatbubble-outline" size={isOverlay ? 20 : 21} color={iconColor} />

        {commentCount > 0 && (
          <View style={[s.countBadge, { backgroundColor: badgeBg }]}>
            <Text style={[s.countText, { color: badgeText }]}>
              {formatCount(commentCount)}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={buttonStyle}
        onPress={onLiftUp}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Lift up this Mark"
      >
        <Ionicons name="sparkles-outline" size={isOverlay ? 21 : 22} color={iconColor} />

        {liftUpCount > 0 && (
          <View style={[s.countBadge, { backgroundColor: badgeBg }]}>
            <Text style={[s.countText, { color: badgeText }]}>
              {formatCount(liftUpCount)}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {showTag && (
        <TouchableOpacity
          style={mutedButtonStyle}
          disabled
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Tag this Mark"
        >
          <Ionicons name="pricetag-outline" size={isOverlay ? 20 : 21} color={iconColor} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={buttonStyle}
        onPress={onShare}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Share this Mark"
      >
        <Ionicons name="share-social-outline" size={isOverlay ? 21 : 22} color={iconColor} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayActionButton: {
    backgroundColor: 'rgba(5,16,24,0.52)',
    borderColor: 'rgba(255,255,255,0.16)',
  },
  mutedAction: {
    opacity: 0.45,
  },
  countBadge: {
    position: 'absolute',
    top: -7,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: '900',
  },
});