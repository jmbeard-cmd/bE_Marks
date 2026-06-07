import { Ionicons } from '@expo/vector-icons';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';
import MarkActionRow from './MarkActionRow';
import MediaCollage from './MediaCollage';

type TimelineVoiceMarkTheme = {
  bg: string;
  surface: string;
  raised: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  gold: string;
};

type TimelineVoiceMarkItem = {
  authorName: string;
  authorInitials: string;
  authorAvatar?: string;
  contextLabel: string;
  timeLabel: string;
  title: string | null;
  body: string;
  mediaItems: any[];
  milestone: {
    audioUri?: string;
  };
};

type TimelineVoiceMarkCardProps = {
  item: TimelineVoiceMarkItem;
  theme: TimelineVoiceMarkTheme;
  themeMode: 'light' | 'dark' | string;
  commentCount: number;
  liftUpCount: number;
  onOpenDetail: () => void;
  onComment: () => void;
  onLiftUp: (event: GestureResponderEvent) => void;
  onShare: () => void;
  onPressMedia: (mediaIndex: number) => void;
};

export default function TimelineVoiceMarkCard({
  item,
  theme,
  themeMode,
  commentCount,
  liftUpCount,
  onOpenDetail,
  onComment,
  onLiftUp,
  onShare,
  onPressMedia,
}: TimelineVoiceMarkCardProps) {
  return (
    <View
      style={[
        s.voiceMarkCard,
        {
          backgroundColor: theme.surface,
          borderColor: `${theme.gold}55`,
          shadowColor: theme.gold,
        },
      ]}
    >
      <View pointerEvents="none" style={s.voiceMarkBackground}>
        <View style={[s.voiceMarkGlowOne, { backgroundColor: `${theme.gold}20` }]} />
        <View style={[s.voiceMarkGlowTwo, { backgroundColor: `${theme.gold}12` }]} />
      </View>

      <TouchableOpacity
        style={s.voiceMarkContent}
        onPress={onOpenDetail}
        activeOpacity={0.9}
      >
        <View style={s.voiceMarkAuthorRow}>
          <View style={[s.voiceMarkAvatar, { borderColor: `${theme.gold}44` }]}>
            {item.authorAvatar ? (
              <Image source={{ uri: item.authorAvatar }} style={s.voiceMarkAvatarImage} />
            ) : (
              <Text style={[s.voiceMarkAvatarText, { color: theme.gold }]}>
                {item.authorInitials}
              </Text>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.voiceMarkAuthorName, { color: theme.text }]} numberOfLines={1}>
              {item.authorName}
            </Text>
            <Text style={[s.voiceMarkMeta, { color: theme.textMuted }]} numberOfLines={1}>
              {item.contextLabel} - {item.timeLabel}
            </Text>
          </View>
        </View>

        <View style={s.voiceMarkCenter}>
          <View style={[s.voiceMarkIconWrap, { borderColor: `${theme.gold}44` }]}>
            <Ionicons name="mic-outline" size={30} color={theme.gold} />
          </View>

          <View style={s.voiceWaveRow}>
            {[18, 30, 44, 28, 52, 34, 22, 40, 26].map((height, index) => (
              <View
                key={`voice_wave_${index}`}
                style={[
                  s.voiceWaveBar,
                  {
                    height,
                    backgroundColor: `${theme.gold}${index % 2 === 0 ? '88' : '55'}`,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {item.title ? (
          <Text style={[s.voiceMarkTitle, { color: theme.text }]} numberOfLines={2}>
            {item.title}
          </Text>
        ) : null}

        {item.body ? (
          <Text style={[s.voiceMarkBody, { color: theme.textSecondary }]} numberOfLines={3}>
            {item.body}
          </Text>
        ) : null}
      </TouchableOpacity>

      <View style={s.voiceAudioPlayer}>
        <MediaCollage
          media={item.mediaItems}
          audioUri={item.milestone.audioUri}
          onPressMedia={onPressMedia}
        />
      </View>

      <MarkActionRow
        variant="gold"
        theme={theme}
        commentCount={commentCount}
        liftUpCount={liftUpCount}
        onComment={onComment}
        onLiftUp={onLiftUp}
        onShare={onShare}
        style={s.voiceMarkActions}
      />
    </View>
  );
}

const s = StyleSheet.create({
  voiceMarkCard: {
    minHeight: 300,
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
  voiceMarkBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  voiceMarkGlowOne: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    top: -84,
    right: -64,
  },
  voiceMarkGlowTwo: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    bottom: -112,
    left: -82,
  },
  voiceMarkContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  voiceMarkAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 22,
  },
  voiceMarkAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 0.7,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  voiceMarkAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 17,
  },
  voiceMarkAvatarText: {
    fontSize: 12,
    fontWeight: '900',
  },
  voiceMarkAuthorName: {
    fontSize: 14,
    fontWeight: '900',
  },
  voiceMarkMeta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  voiceMarkCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  voiceMarkIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  voiceWaveRow: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceWaveBar: {
    width: 6,
    borderRadius: 999,
  },
  voiceMarkTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: -0.45,
    marginTop: 14,
    marginBottom: 7,
  },
  voiceMarkBody: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  voiceAudioPlayer: {
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 8,
  },
  voiceMarkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 18,
    paddingBottom: 16,
    paddingTop: 8,
  },
});