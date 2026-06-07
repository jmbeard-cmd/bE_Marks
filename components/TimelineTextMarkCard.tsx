import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';
import MarkActionRow from './MarkActionRow';

type TimelineTextMarkTheme = {
  bg: string;
  surface: string;
  raised: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  gold: string;
};

type TimelineTextMarkItem = {
  authorName: string;
  authorInitials: string;
  authorAvatar?: string;
  contextLabel: string;
  timeLabel: string;
  title: string | null;
  body: string;
  milestone: {
    tags: string[];
  };
};

type TimelineTextMarkCardProps = {
  item: TimelineTextMarkItem;
  theme: TimelineTextMarkTheme;
  themeMode: 'light' | 'dark' | string;
  commentCount: number;
  liftUpCount: number;
  onOpenDetail: () => void;
  onComment: () => void;
  onLiftUp: (event: GestureResponderEvent) => void;
  onShare: () => void;
};

export default function TimelineTextMarkCard({
  item,
  theme,
  themeMode,
  commentCount,
  liftUpCount,
  onOpenDetail,
  onComment,
  onLiftUp,
  onShare,
}: TimelineTextMarkCardProps) {
  const visibleTags = item.milestone.tags.slice(0, 2);
  const hiddenTagCount = Math.max(0, item.milestone.tags.length - visibleTags.length);

  return (
    <View
      style={[
        s.textMarkCard,
        {
          backgroundColor: theme.surface,
          borderColor: `${theme.gold}55`,
          shadowColor: theme.gold,
        },
      ]}
    >
      <View pointerEvents="none" style={s.textMarkBackground}>
        <View style={[s.textMarkGlowOne, { backgroundColor: `${theme.gold}24` }]} />
        <View style={[s.textMarkGlowTwo, { backgroundColor: `${theme.gold}14` }]} />
        <View style={[s.textMarkHorizon, { borderColor: `${theme.gold}28` }]} />
      </View>

      <TouchableOpacity
        style={s.textMarkContent}
        onPress={onOpenDetail}
        activeOpacity={0.9}
      >
        <View style={s.textMarkAuthorRow}>
          <View
            style={[
              s.textMarkAvatar,
              {
                borderColor: `${theme.gold}44`,
                backgroundColor: `${theme.gold}14`,
              },
            ]}
          >
            {item.authorAvatar ? (
              <Image source={{ uri: item.authorAvatar }} style={s.textMarkAvatarImage} />
            ) : (
              <Text style={[s.textMarkAvatarText, { color: theme.gold }]}>
                {item.authorInitials}
              </Text>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.textMarkAuthorName, { color: theme.text }]} numberOfLines={1}>
              {item.authorName}
            </Text>
            <Text style={[s.textMarkMeta, { color: theme.textMuted }]} numberOfLines={1}>
              {item.contextLabel} - {item.timeLabel}
            </Text>
          </View>
        </View>

        <Text style={[s.textMarkQuoteMark, { color: `${theme.gold}28` }]}>“</Text>

        {item.title ? (
          <Text style={[s.textMarkTitle, { color: theme.text }]} numberOfLines={3}>
            {item.title}
          </Text>
        ) : null}

        {item.body ? (
          <Text style={[s.textMarkBody, { color: theme.textSecondary }]} numberOfLines={6}>
            {item.body}
          </Text>
        ) : null}

        {(visibleTags.length > 0 || hiddenTagCount > 0) && (
          <View style={s.textMarkTagRow}>
            {visibleTags.map(tag => (
              <Text
                key={tag}
                style={[
                  s.textMarkTag,
                  {
                    color: theme.gold,
                    borderColor: `${theme.gold}38`,
                    backgroundColor: `${theme.gold}12`,
                  },
                ]}
                numberOfLines={1}
              >
                {tag}
              </Text>
            ))}

            {hiddenTagCount > 0 && (
              <Text
                style={[
                  s.textMarkTag,
                  {
                    color: theme.gold,
                    borderColor: `${theme.gold}38`,
                    backgroundColor: `${theme.gold}12`,
                  },
                ]}
              >
                +{hiddenTagCount}
              </Text>
            )}
          </View>
        )}
      </TouchableOpacity>

      <MarkActionRow
        variant="gold"
        theme={theme}
        commentCount={commentCount}
        liftUpCount={liftUpCount}
        onComment={onComment}
        onLiftUp={onLiftUp}
        onShare={onShare}
        style={s.textMarkActions}
      />
    </View>
  );
}

const s = StyleSheet.create({
  textMarkCard: {
    minHeight: 280,
    borderRadius: 18,
    borderWidth: 0.7,
    overflow: 'hidden',
    marginBottom: 14,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 5,
    position: 'relative',
  },
  textMarkBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  textMarkGlowOne: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    top: -70,
    right: -54,
  },
  textMarkGlowTwo: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    bottom: -105,
    left: -78,
  },
  textMarkHorizon: {
    position: 'absolute',
    width: 270,
    height: 270,
    borderRadius: 135,
    borderWidth: 1,
    bottom: -190,
    alignSelf: 'center',
  },
  textMarkContent: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  textMarkAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 22,
  },
  textMarkAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 0.7,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  textMarkAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 17,
  },
  textMarkAvatarText: {
    fontSize: 12,
    fontWeight: '900',
  },
  textMarkAuthorName: {
    fontSize: 14,
    fontWeight: '900',
  },
  textMarkMeta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  textMarkQuoteMark: {
    position: 'absolute',
    top: 62,
    right: 18,
    fontSize: 86,
    lineHeight: 90,
    fontWeight: '900',
  },
  textMarkTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  textMarkBody: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  textMarkTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 16,
  },
  textMarkTag: {
    maxWidth: 130,
    borderRadius: 999,
    borderWidth: 0.6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: '900',
  },
  textMarkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 18,
    paddingBottom: 16,
    paddingTop: 8,
  },
});