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
  spaceTypeLabel?: string;
  variant?: 'compact' | 'immersive';
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

export default function SpaceCard({
  group,
  theme,
  preview,
  updatedAt,
  unreadCount = 0,
  categoryIcon,
  spaceTypeLabel = 'Space',
  variant = 'compact',
  archived = group.status === 'archived',
  onPress,
  onEdit,
}: SpaceCardProps) {
  const memberCount = group.memberCount ?? 0;
  const displayPreview =
    preview ||
    group.lastPostPreview ||
    `${memberCount} member${memberCount !== 1 ? 's' : ''}`;
  const timeLabel = formatSpaceTime(updatedAt ?? group.lastPostAt ?? group.updatedAt);
  const coverImage = group.coverImage?.trim();

  if (variant === 'immersive') {
    return (
      <TouchableOpacity
        style={[s.immersiveCard, unreadCount > 0 && s.immersiveCardUnread]}
        activeOpacity={0.88}
        onPress={onPress}
        onLongPress={onEdit}
      >
        {coverImage ? (
          <Image source={{ uri: coverImage }} style={s.immersiveCardImage} />
        ) : (
          <View style={[s.immersiveCardFallback, { backgroundColor: theme.raised }]}>
            <Text style={[s.immersiveCardFallbackText, { color: theme.gold }]}>
              {getSpaceAvatarText(group)}
            </Text>
          </View>
        )}

        <View style={s.immersiveCardShade} />

        <View style={s.immersiveCardContent}>
          <View style={s.immersiveCardTopRow}>
            <View style={s.immersiveCardIdentity}>
              <Text style={s.immersiveCardKicker} numberOfLines={1}>
                {categoryIcon ? `${categoryIcon} ` : ''}{spaceTypeLabel}
              </Text>

              <Text style={s.immersiveCardTitle} numberOfLines={2}>
                {group.name}
              </Text>
            </View>

            <View style={s.immersiveCardActions}>
              {unreadCount > 0 && (
                <View style={[s.immersiveUnreadBadge, { backgroundColor: theme.gold }]}>
                  <Text style={[s.immersiveUnreadText, { color: theme.bg }]}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}

              {onEdit && (
                <TouchableOpacity
                  style={s.immersiveMoreBtn}
                  onPress={onEdit}
                  activeOpacity={0.78}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.immersiveMoreText}>⋯</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={s.immersiveCardPreview} numberOfLines={1}>
            {displayPreview}
          </Text>

          <View style={s.immersiveCardFooter}>
            <Text style={s.immersiveChip}>
              {memberCount} member{memberCount !== 1 ? 's' : ''}
            </Text>

            {group.season ? (
              <Text style={s.immersiveChip}>{group.season}</Text>
            ) : null}

            {!!timeLabel && (
              <Text style={s.immersiveTime}>{timeLabel}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

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
      <View pointerEvents="none" style={[s.cardWash, { backgroundColor: theme.gold }]} />
      <View pointerEvents="none" style={[s.cardGlow, { backgroundColor: theme.surface }]} />

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

          {!!timeLabel && (
            <Text
              style={[
                s.timeChip,
                {
                  color: theme.textMuted,
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
              numberOfLines={1}
            >
              {timeLabel}
            </Text>
          )}

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
            s.moreBtn,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
          onPress={onEdit}
          activeOpacity={0.78}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[s.moreText, { color: theme.gold }]}>⋯</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  immersiveCard: {
    minHeight: 176,
    borderRadius: 26,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#111',
    position: 'relative',
  },
  immersiveCardUnread: {
    borderColor: 'rgba(231,184,77,0.88)',
  },
  immersiveCardImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  immersiveCardFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  immersiveCardFallbackText: {
    fontSize: 54,
    fontWeight: '900',
  },
  immersiveCardShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  immersiveCardContent: {
    minHeight: 184,
    padding: 17,
    justifyContent: 'space-between',
  },
  immersiveCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  immersiveCardIdentity: {
    flex: 1,
    minWidth: 0,
  },
  immersiveCardKicker: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  immersiveCardTitle: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  immersiveCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  immersiveUnreadBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  immersiveUnreadText: {
    fontSize: 12,
    fontWeight: '900',
  },
  immersiveMoreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  immersiveMoreText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    marginTop: -4,
  },
  immersiveCardPreview: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 18,
  },
  immersiveCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  immersiveChip: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  immersiveTime: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '900',
    marginLeft: 'auto',
    paddingHorizontal: 2,
  },
  card: {
    minHeight: 94,
    borderRadius: 22,
    borderWidth: 0.7,
    paddingLeft: 14,
    paddingRight: 54,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 5,
  },
  cardWash: {
    position: 'absolute',
    top: -38,
    right: -44,
    width: 148,
    height: 148,
    borderRadius: 74,
    opacity: 0.13,
  },
  cardGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 42,
    opacity: 0.38,
  },
  cardArchived: {
    opacity: 0.72,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 0.8,
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
    zIndex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  timeChip: {
    maxWidth: 72,
    borderRadius: 999,
    borderWidth: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
  },
  preview: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
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
    maxWidth: 116,
    borderRadius: 999,
    borderWidth: 0.5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
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
  moreBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  moreText: {
    fontSize: 20,
    fontWeight: '900',
    marginTop: -4,
  },
});