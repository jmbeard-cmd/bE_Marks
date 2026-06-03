import {
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import type { BEGroup } from '../src/utils/group-storage';

type SpaceCardTheme = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  gold: string;
};

type SpaceCardProps = {
  group: BEGroup;
  theme: SpaceCardTheme;
  preview?: string;
  updatedAt?: number;
  unreadCount?: number;
  categoryIcon?: string | null;
  archived?: boolean;
  onPress: () => void;
  onEdit?: () => void;
};

function isRemoteImageUri(uri?: string | null): uri is string {
  return typeof uri === 'string' && /^https?:\/\//i.test(uri.trim());
}

function getGroupInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'SP';
  return clean.slice(0, 2).toUpperCase();
}

function getSpaceAvatarText(group: BEGroup): string {
  const customIcon = group.icon?.trim();
  return customIcon || getGroupInitials(group.name);
}

function formatSpaceTime(unixSecs?: number): string {
  if (!unixSecs) return '';

  const date = new Date(unixSecs * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getRelayLabel(group: BEGroup): {
  text: string;
  icon: string;
  type: 'default' | 'custom' | 'both';
} {
  const mode = group.relayMode ?? 'default';

  if (mode === 'custom') return { text: 'Private', icon: '◆', type: 'custom' };
  if (mode === 'both') return { text: 'Both', icon: '↔', type: 'both' };

  return { text: 'bE', icon: '●', type: 'default' };
}

export default function SpaceCard({
  group,
  theme,
  preview,
  updatedAt,
  unreadCount = 0,
  categoryIcon,
  archived = group.status === 'archived',
  onPress,
  onEdit,
}: SpaceCardProps) {
  const relay = getRelayLabel(group);
  const displayPreview =
    preview ||
    group.lastPostPreview ||
    `${group.memberCount ?? 0} member${(group.memberCount ?? 0) !== 1 ? 's' : ''}`;
  const timeLabel = formatSpaceTime(updatedAt ?? group.lastPostAt ?? group.updatedAt);
  const coverImage = group.coverImage?.trim();

  return (
    <TouchableOpacity
      style={[
        s.card,
        {
          backgroundColor: theme.raised,
          borderColor: theme.border,
          shadowColor: theme.gold,
        },
        archived && s.cardArchived,
      ]}
      activeOpacity={0.88}
      onPress={onPress}
    >
      <View
        style={[
          s.avatar,
          {
            backgroundColor: theme.surface,
            borderColor: `${theme.gold}35`,
          },
          archived && s.avatarArchived,
        ]}
      >
        {isRemoteImageUri(coverImage) ? (
          <Image source={{ uri: coverImage }} style={s.avatarImage} />
        ) : (
          <Text style={[s.avatarText, { color: theme.gold }]}>
            {getSpaceAvatarText(group)}
          </Text>
        )}
      </View>

      <View style={s.body}>
        <View style={s.topRow}>
          <Text
            style={[
              s.name,
              { color: theme.text },
              archived && { color: theme.textMuted },
            ]}
            numberOfLines={1}
          >
            {group.name}
          </Text>

          {!!timeLabel && (
            <Text style={[s.time, { color: theme.textMuted }]} numberOfLines={1}>
              {timeLabel}
            </Text>
          )}
        </View>

        <Text style={[s.preview, { color: theme.textMuted }]} numberOfLines={1}>
          {displayPreview}
        </Text>

        <View style={s.metaRow}>
          {categoryIcon && (
            <Text style={[s.categoryBadge, { backgroundColor: theme.surface }]}>
              {categoryIcon}
            </Text>
          )}

          {group.season && (
            <Text
              style={[
                s.badge,
                {
                  color: theme.textMuted,
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
              numberOfLines={1}
            >
              {group.season}
            </Text>
          )}

          <Text
            style={[
              s.badge,
              {
                color: theme.textMuted,
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            {group.memberCount ?? 0} member{(group.memberCount ?? 0) !== 1 ? 's' : ''}
          </Text>

          <View
            style={[
              s.relayBadge,
              {
                backgroundColor: theme.surface,
                borderColor:
                  relay.type === 'custom'
                    ? `${theme.gold}88`
                    : relay.type === 'both'
                      ? `${theme.gold}66`
                      : theme.border,
              },
            ]}
          >
            <Text style={[s.relayIcon, { color: theme.gold }]}>{relay.icon}</Text>
            <Text style={[s.relayText, { color: theme.textMuted }]}>{relay.text}</Text>
          </View>

          {unreadCount > 0 && (
            <View style={[s.unreadBadge, { backgroundColor: theme.gold }]}>
              <Text style={[s.unreadText, { color: theme.bg }]}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}

          {archived && (
            <Text
              style={[
                s.badge,
                {
                  color: theme.textMuted,
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              Archived
            </Text>
          )}
        </View>
      </View>

      {onEdit && (
        <TouchableOpacity
          style={[
            s.editBtn,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
          onPress={onEdit}
          activeOpacity={0.78}
        >
          <Text style={[s.editText, { color: theme.gold }]}>Edit</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    minHeight: 94,
    borderRadius: 18,
    borderWidth: 0.6,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 9,
    elevation: 3,
  },
  cardArchived: {
    opacity: 0.72,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 18,
    borderWidth: 0.7,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarArchived: {
    opacity: 0.78,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '900',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 3,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  time: {
    fontSize: 11,
    fontWeight: '700',
  },
  preview: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginBottom: 9,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryBadge: {
    minWidth: 26,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
    fontSize: 14,
    lineHeight: 24,
  },
  badge: {
    maxWidth: 110,
    borderRadius: 999,
    borderWidth: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: '800',
  },
  relayBadge: {
    minHeight: 24,
    borderRadius: 999,
    borderWidth: 0.5,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  relayIcon: {
    fontSize: 9,
    fontWeight: '900',
  },
  relayText: {
    fontSize: 10,
    fontWeight: '900',
  },
  unreadBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontSize: 10,
    fontWeight: '900',
  },
  editBtn: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 0.5,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editText: {
    fontSize: 11,
    fontWeight: '900',
  },
});