import { Ionicons } from '@expo/vector-icons';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import type { LivingMarkPromptCard } from '../src/types/living-spaces';

type LivingPromptNudgeTheme = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  textMuted: string;
  gold: string;
};

type LivingPromptNudgeCardProps = {
  card: LivingMarkPromptCard;
  theme: LivingPromptNudgeTheme;
  saving: boolean;
  onOpenDetail: (card: LivingMarkPromptCard) => void;
  onSnooze: () => void;
  onDone: () => void;
};

export default function LivingPromptNudgeCard({
  card,
  theme,
  saving,
  onOpenDetail,
  onSnooze,
  onDone,
}: LivingPromptNudgeCardProps) {
  const spaceName = card.prompt.suggestedSpaceIds?.[0]
    ? card.view.spaces.find(space => space.id === card.prompt.suggestedSpaceIds?.[0])?.name
    : undefined;
  const actionLabel = card.canCompleteInline ? 'Done' : 'Add details';

  return (
    <View
      style={[
        s.nudgeWrap,
        {
          backgroundColor: theme.bg,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <View
        style={[
          s.nudgeCard,
          {
            backgroundColor: theme.raised,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={s.nudgeHeader}>
          <View
            style={[
              s.nudgeIcon,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <Ionicons name="sparkles-outline" size={17} color={theme.gold} />
          </View>

          <View style={s.nudgeCopy}>
            <Text style={[s.nudgeEyebrow, { color: theme.gold }]}>
              Complete this Mark
            </Text>
            <Text style={[s.nudgeQuestion, { color: theme.text }]}>
              {card.prompt.question}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            s.nudgeMarkPreview,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
          onPress={() => onOpenDetail(card)}
          activeOpacity={0.82}
        >
          <Text style={[s.nudgeMarkTitle, { color: theme.text }]} numberOfLines={1}>
            {card.markTitle || 'Mark'}
          </Text>
          <Text style={[s.nudgeMarkText, { color: theme.textMuted }]} numberOfLines={2}>
            {card.markPreview}
          </Text>

          {spaceName && (
            <Text style={[s.nudgeSpaceHint, { color: theme.gold }]} numberOfLines={1}>
              Suggested Space: {spaceName}
            </Text>
          )}
        </TouchableOpacity>

        <View style={s.nudgeActions}>
          <TouchableOpacity
            style={[
              s.nudgeActionBtn,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
            onPress={() => onOpenDetail(card)}
            disabled={saving}
            activeOpacity={0.78}
          >
            <Text style={[s.nudgeActionText, { color: theme.text }]}>Review</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.nudgeActionBtn,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
            onPress={onSnooze}
            disabled={saving}
            activeOpacity={0.78}
          >
            <Text style={[s.nudgeActionText, { color: theme.textMuted }]}>Not now</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.nudgeDoneBtn,
              {
                backgroundColor: theme.gold,
              },
              saving && s.nudgeDisabled,
            ]}
            onPress={onDone}
            disabled={saving}
            activeOpacity={0.78}
          >
            <Text style={[s.nudgeDoneText, { color: theme.bg }]}>
              {saving ? 'Saving...' : actionLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  nudgeWrap: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
  },
  nudgeCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
  },
  nudgeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  nudgeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeCopy: {
    flex: 1,
    minWidth: 0,
  },
  nudgeEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  nudgeQuestion: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  nudgeMarkPreview: {
    borderRadius: 10,
    borderWidth: 0.5,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  nudgeMarkTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 3,
  },
  nudgeMarkText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  nudgeSpaceHint: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
  },
  nudgeActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  nudgeActionBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  nudgeActionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  nudgeDoneBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  nudgeDoneText: {
    fontSize: 12,
    fontWeight: '900',
  },
  nudgeDisabled: {
    opacity: 0.55,
  },
});