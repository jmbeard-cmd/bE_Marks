import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewabilityConfig,
  type ViewToken,
} from 'react-native';
import MarkActionRow from '../../components/MarkActionRow';
import MediaCollage from '../../components/MediaCollage';
import TimelineTextMarkCard from '../../components/TimelineTextMarkCard';
import TimelineVoiceMarkCard from '../../components/TimelineVoiceMarkCard';
import {
  formatDate,
  type Milestone,
} from '../../src/utils/storage';

export type MyMarksFeedItem = {
  id: string;
  milestone: Milestone;
  authorName: string;
  authorInitials: string;
  authorAvatar?: string;
  contextLabel: string;
  timeLabel: string;
  title: string | null;
  body: string;
  mediaItems: any[];
  hasVisualMedia: boolean;
  hasAudioOnly: boolean;
};

type BuildMyMarksFeedItemsInput = {
  milestones: Milestone[];
  currentNpub: string | null;
  currentProfile?: any;
  familyName?: string;
};

type MyMarksFeedProps = {
  items: MyMarksFeedItem[];
  syncing: boolean;
  refreshing: boolean;
  theme: any;
  themeMode: string;
  currentNpub: string | null;
  activeVideoMarkId: string | null;
  onOpenDetail: (item: MyMarksFeedItem) => void;
  onComment: (item: MyMarksFeedItem) => void;
  onLiftUp: (item: MyMarksFeedItem, event: GestureResponderEvent) => void;
  onShare: (item: MyMarksFeedItem) => void;
  onPressMedia: (milestone: Milestone, mediaIndex: number) => void;
  onRefresh: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  viewabilityConfig: ViewabilityConfig;
  onViewableItemsChanged: (info: {
    viewableItems: ViewToken<MyMarksFeedItem>[];
    changed: ViewToken<MyMarksFeedItem>[];
  }) => void;
};

function getMyMarksInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function getMyMarksFeedMediaItems(item: Milestone): any[] {
  const mediaItems: any[] = Array.isArray(item.media) ? [...item.media] : [];

  if (item.photoUri && !mediaItems.some(m => m.uri === item.photoUri)) {
    mediaItems.push({
      id: `${item.id}_legacy_photo`,
      uri: item.photoUri,
      type: 'image',
    });
  }

  if (item.videoUri && !mediaItems.some(m => m.uri === item.videoUri)) {
    mediaItems.push({
      id: `${item.id}_legacy_video`,
      uri: item.videoUri,
      type: 'video',
    });
  }

  if (item.audioUri && !mediaItems.some(m => m.uri === item.audioUri)) {
    mediaItems.push({
      id: `${item.id}_legacy_audio`,
      uri: item.audioUri,
      type: 'audio',
    });
  }

  return mediaItems;
}

function getMyMarksAuthorLabel(
  item: Milestone,
  currentNpub: string | null
): string | null {
  const savedName = item.authorName?.trim();

  if (savedName) return savedName;
  if (item.authorNpub && item.authorNpub === currentNpub) return 'You';
  if (item.authorNpub) return `${item.authorNpub.slice(0, 10)}…`;

  return null;
}

export function getMyMarksCommentCount(milestone: Milestone): number {
  return Array.isArray(milestone.reflections) ? milestone.reflections.length : 0;
}

export function getMyMarksLiftUpCount(milestone: Milestone): number {
  const mark = milestone as any;

  if (Array.isArray(mark.liftUps)) return mark.liftUps.length;
  if (Array.isArray(mark.encouragements)) return mark.encouragements.length;

  if (Array.isArray(mark.reactions)) {
    return mark.reactions.filter((reaction: any) => {
      const value = String(reaction?.type || reaction?.emoji || reaction?.label || '').toLowerCase();

      return (
        value.includes('lift') ||
        value.includes('sparkle') ||
        value.includes('encourage') ||
        value === '✨' ||
        value === '🙌' ||
        value === '⭐'
      );
    }).length;
  }

  return 0;
}

export function buildMyMarksFeedItems({
  milestones,
  currentNpub,
  currentProfile,
  familyName,
}: BuildMyMarksFeedItemsInput): MyMarksFeedItem[] {
  return milestones.map(milestone => {
    const noteText = milestone.note ?? '';
    const noteParts = noteText.split('\n\n');
    const splitTitle = noteParts.length > 1 ? noteParts[0]?.trim() || null : null;
    const splitBody = noteParts.length > 1
      ? noteParts.slice(1).join('\n\n')
      : noteText;
    const savedTitle = milestone.title?.trim();
    const title = savedTitle || splitTitle;
    const body = splitBody;
    const mediaItems = getMyMarksFeedMediaItems(milestone);
    const hasVisualMedia = mediaItems.some(m => m.type === 'image' || m.type === 'video');
    const hasAudioOnly = !hasVisualMedia && mediaItems.some(m => m.type === 'audio');
    const authorName =
      getMyMarksAuthorLabel(milestone, currentNpub) ||
      currentProfile?.display_name ||
      currentProfile?.name ||
      'You';
    const isMine = !milestone.authorNpub || milestone.authorNpub === currentNpub;
    const contextLabel = milestone.familyId
      ? familyName || 'Space Mark'
      : isMine
        ? 'My Marks'
        : 'Following';

    return {
      id: milestone.id,
      milestone,
      authorName,
      authorInitials: getMyMarksInitials(authorName),
      authorAvatar: isMine ? currentProfile?.picture : undefined,
      contextLabel,
      timeLabel: formatDate(milestone.createdAt),
      title,
      body,
      mediaItems,
      hasVisualMedia,
      hasAudioOnly,
    };
  });
}

export default function MyMarksFeed({
  items,
  syncing,
  refreshing,
  theme,
  themeMode,
  currentNpub,
  activeVideoMarkId,
  onOpenDetail,
  onComment,
  onLiftUp,
  onShare,
  onPressMedia,
  onRefresh,
  onScroll,
  viewabilityConfig,
  onViewableItemsChanged,
}: MyMarksFeedProps) {
  const [expandedTextIds, setExpandedTextIds] = useState<Record<string, boolean>>({});

  const themed = {
    goldText: { color: theme.gold },
    mutedText: { color: theme.textMuted },
    secondaryText: { color: theme.textSecondary },
    primaryText: { color: theme.text },
    border: { borderColor: theme.border },
    surface: { backgroundColor: theme.surface },
    raised: { backgroundColor: theme.raised },
  };

  const toggleExpandedText = useCallback((itemId: string) => {
    setExpandedTextIds(current => ({
      ...current,
      [itemId]: !current[itemId],
    }));
  }, []);

  const renderCard = useCallback((item: MyMarksFeedItem, shouldAutoPlayVideo: boolean) => {
    const milestone = item.milestone;
    const visibleTags = milestone.tags.slice(0, 2);
    const hiddenTagCount = Math.max(0, milestone.tags.length - visibleTags.length);
    const commentCount = getMyMarksCommentCount(milestone);
    const liftUpCount = getMyMarksLiftUpCount(milestone);
    const isTextExpanded = expandedTextIds[item.id] === true;
    const bodyCanExpand = item.body.trim().length > 90 || item.body.includes('\n');

    if (item.hasVisualMedia) {
      return (
        <View
          style={[
            s.feedMarkCardImmersive,
            {
              borderColor: `${theme.gold}55`,
              shadowColor: theme.gold,
            },
          ]}
        >
          <View style={s.feedMarkMediaFrame}>
            <MediaCollage
              media={item.mediaItems}
              fitMode="cover"
              fixedHeight={500}
              autoPlayVideos
              playVideos={shouldAutoPlayVideo}
              videoMuted
              videoLoop
              onPressMedia={(mediaIndex) => onPressMedia(milestone, mediaIndex)}
            />

            <View pointerEvents="none" style={s.feedMarkOverlayTop}>
              <View style={s.feedMarkOverlayAuthor}>
                <View style={s.feedMarkOverlayAvatar}>
                  {item.authorAvatar ? (
                    <Image source={{ uri: item.authorAvatar }} style={s.feedMarkOverlayAvatarImage} />
                  ) : (
                    <Text style={s.feedMarkOverlayAvatarText}>{item.authorInitials}</Text>
                  )}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.feedMarkOverlayAuthorName} numberOfLines={1}>
                    {item.authorName}
                  </Text>
                  <Text style={s.feedMarkOverlayMeta} numberOfLines={1}>
                    {item.contextLabel} - {item.timeLabel}
                  </Text>
                </View>
              </View>
            </View>

            <View style={s.feedMarkOverlayBottom}>
              <View style={s.feedMarkCaptionShelfCap} />

              <View style={s.feedMarkCaptionShelf}>
                <View style={s.feedMarkCaptionCopy}>
                  {item.title ? (
                    <View style={[s.feedMarkTitlePlate, { borderLeftColor: theme.gold }]}>
                      <Text style={s.feedMarkOverlayTitle} numberOfLines={isTextExpanded ? 3 : 2}>
                        {item.title}
                      </Text>
                    </View>
                  ) : null}

                  {item.body ? (
                    <Text
                      style={s.feedMarkOverlayBody}
                      numberOfLines={isTextExpanded ? 6 : 2}
                    >
                      {item.body}
                    </Text>
                  ) : null}

                  <View style={s.feedMarkCaptionMetaRow}>
                    <View style={s.feedMarkCaptionButtonRow}>
                      {bodyCanExpand && (
                        <TouchableOpacity
                          activeOpacity={0.78}
                          onPress={() => toggleExpandedText(item.id)}
                          accessibilityRole="button"
                          accessibilityLabel={isTextExpanded ? 'Show less Mark text' : 'Show more Mark text'}
                        >
                          <Text style={[s.feedMarkOverlayExpandText, { color: theme.gold }]}>
                            {isTextExpanded ? 'Show less' : 'Show more'}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={[s.feedMarkReadButton, { borderColor: `${theme.gold}88` }]}
                        onPress={() => onOpenDetail(item)}
                        activeOpacity={0.82}
                        accessibilityRole="button"
                        accessibilityLabel="Read this Mark"
                      >
                        <Text style={[s.feedMarkReadButtonText, { color: theme.gold }]}>
                          Read Mark
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {(visibleTags.length > 0 || hiddenTagCount > 0) && (
                      <View style={s.feedMarkOverlayTagRow}>
                        <Text style={s.feedMarkOverlayTagText} numberOfLines={1}>
                          {visibleTags.join(' · ')}
                        </Text>

                        {hiddenTagCount > 0 && (
                          <View style={s.feedMarkOverlayTagBadge}>
                            <Text style={s.feedMarkOverlayTagBadgeText}>+{hiddenTagCount}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>

                <MarkActionRow
                  variant="overlay"
                  theme={theme}
                  commentCount={commentCount}
                  liftUpCount={liftUpCount}
                  onComment={() => onComment(item)}
                  onLiftUp={(event) => onLiftUp(item, event)}
                  onShare={() => onShare(item)}
                  style={s.feedMarkOverlayActions}
                />
              </View>
            </View>
          </View>
        </View>
      );
    }

    if (!item.hasAudioOnly) {
      return (
        <TimelineTextMarkCard
          item={item}
          theme={theme}
          themeMode={themeMode}
          commentCount={commentCount}
          liftUpCount={liftUpCount}
          onOpenDetail={() => onOpenDetail(item)}
          onComment={() => onComment(item)}
          onLiftUp={(event) => onLiftUp(item, event)}
          onShare={() => onShare(item)}
        />
      );
    }

    if (item.hasAudioOnly) {
      return (
        <TimelineVoiceMarkCard
          item={item}
          theme={theme}
          themeMode={themeMode}
          commentCount={commentCount}
          liftUpCount={liftUpCount}
          onOpenDetail={() => onOpenDetail(item)}
          onComment={() => onComment(item)}
          onLiftUp={(event) => onLiftUp(item, event)}
          onShare={() => onShare(item)}
          onPressMedia={(mediaIndex) => onPressMedia(milestone, mediaIndex)}
        />
      );
    }

    return (
      <View style={[s.socialCard, themed.raised, themed.border]}>
        <TouchableOpacity onPress={() => onOpenDetail(item)} activeOpacity={0.85}>
          <View style={s.socialHeader}>
            <View style={[s.authorAvatar, themed.surface, themed.border]}>
              {item.authorAvatar ? (
                <Image source={{ uri: item.authorAvatar }} style={s.authorAvatarImage} />
              ) : (
                <Text style={[s.authorAvatarText, themed.goldText]}>{item.authorInitials}</Text>
              )}
            </View>

            <View style={s.socialHeaderCopy}>
              <Text style={[s.authorName, themed.primaryText]} numberOfLines={1}>
                {item.authorName}
              </Text>
              <Text style={[s.feedContext, themed.mutedText]} numberOfLines={1}>
                {item.contextLabel} - {item.timeLabel}
              </Text>
            </View>

            {milestone.publishedToRelay && (
              <Text style={[s.relayBadge, themed.mutedText]}>relay</Text>
            )}
          </View>
        </TouchableOpacity>

        {item.hasAudioOnly && (
          <MediaCollage
            media={item.mediaItems}
            audioUri={milestone.audioUri}
            onPressMedia={(mediaIndex) => onPressMedia(milestone, mediaIndex)}
          />
        )}

        <TouchableOpacity onPress={() => onOpenDetail(item)} activeOpacity={0.85}>
          <View style={s.socialBody}>
            {item.title && <Text style={[s.cardTitle, themed.primaryText]}>{item.title}</Text>}
            {item.body ? (
              <Text style={[s.note, themed.secondaryText]} numberOfLines={item.title ? 4 : 5}>
                {item.body}
              </Text>
            ) : null}

            {milestone.tags.length > 0 && (
              <View style={s.tags}>
                {milestone.tags.map(t => (
                  <Text key={t} style={[s.tag, themed.surface, { color: theme.gold, borderColor: theme.border }]}>
                    {t}
                  </Text>
                ))}
              </View>
            )}

            <View style={s.cardMeta}>
              {milestone.reflections && milestone.reflections.length > 0 && (
                <Text style={[s.reflectionBadge, themed.mutedText]}>
                  {milestone.reflections.length} reflection{milestone.reflections.length > 1 ? 's' : ''}
                </Text>
              )}

              {milestone.authorNpub && milestone.authorNpub !== currentNpub && (
                <Text style={[s.authorBadge, themed.mutedText]}>{milestone.authorNpub.slice(0, 10)}...</Text>
              )}
            </View>
          </View>
        </TouchableOpacity>

        <View style={[s.socialActions, themed.border]}>
          <TouchableOpacity
            style={s.socialAction}
            onPress={() => onComment(item)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Comment on this Mark"
          >
            <Ionicons name="chatbubble-outline" size={21} color={theme.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.socialAction}
            onPress={() => onShare(item)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Share this Mark"
          >
            <Ionicons name="share-social-outline" size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [
    currentNpub,
    expandedTextIds,
    onComment,
    onLiftUp,
    onOpenDetail,
    onPressMedia,
    onShare,
    theme,
    themeMode,
    themed,
    toggleExpandedText,
  ]);

  const renderItem = useCallback(({ item }: { item: MyMarksFeedItem }) => {
    return renderCard(item, item.id === activeVideoMarkId);
  }, [activeVideoMarkId, renderCard]);

  if (items.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={[s.emptyIcon, { color: theme.textMuted }]}>
          {syncing ? '⟳' : '◎'}
        </Text>
        <Text style={[s.emptyText, { color: theme.text }]}>
          {syncing ? 'Syncing…' : 'No Marks yet'}
        </Text>
        <Text style={[s.emptyHint, { color: theme.textMuted }]}>
          {syncing ? '' : 'Tap + to capture your first Mark.'}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={item => item.id}
      renderItem={renderItem}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      contentContainerStyle={s.list}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      updateCellsBatchingPeriod={24}
      windowSize={5}
      removeClippedSubviews={Platform.OS === 'android'}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.gold}
        />
      }
    />
  );
}

const s = StyleSheet.create({
  list: {
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 116,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  feedMarkCardImmersive: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 14,
    backgroundColor: '#000',
    borderWidth: 0.7,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  feedMarkMediaFrame: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  feedMarkOverlayTop: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedMarkOverlayAuthor: {
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  feedMarkOverlayAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  feedMarkOverlayAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
  },
  feedMarkOverlayAvatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  feedMarkOverlayAuthorName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  feedMarkOverlayMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  feedMarkOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
  feedMarkCaptionShelfCap: {
    alignSelf: 'center',
    width: '62%',
    height: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  feedMarkCaptionShelf: {
    paddingHorizontal: 15,
    paddingTop: 12,
    paddingBottom: 11,
    backgroundColor: 'rgba(0,0,0,0.76)',
  },
  feedMarkCaptionCopy: {
    marginBottom: 10,
  },
  feedMarkTitlePlate: {
    borderLeftWidth: 3,
    paddingLeft: 9,
    marginBottom: 6,
  },
  feedMarkOverlayTitle: {
    color: '#fff',
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  feedMarkOverlayBody: {
    color: 'rgba(255,255,255,0.91)',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 2,
  },
  feedMarkCaptionMetaRow: {
    marginTop: 9,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  feedMarkCaptionButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  feedMarkReadButton: {
    minHeight: 30,
    borderRadius: 15,
    borderWidth: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  feedMarkReadButtonText: {
    fontSize: 11,
    fontWeight: '900',
  },
  feedMarkOverlayExpandText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  feedMarkOverlayTagRow: {
    flex: 1,
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  feedMarkOverlayTagText: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.70)',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'right',
  },
  feedMarkOverlayTagBadge: {
    minWidth: 24,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  feedMarkOverlayTagBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  feedMarkOverlayActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  socialCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
    marginBottom: 12,
  },
  socialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  authorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  authorAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  authorAvatarText: {
    fontSize: 14,
    fontWeight: '900',
  },
  socialHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    fontSize: 15,
    fontWeight: '900',
  },
  feedContext: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  socialBody: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  socialActions: {
    borderTopWidth: 0.5,
    flexDirection: 'row',
  },
  socialAction: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 5,
  },
  note: {
    fontSize: 14,
    color: '#888',
    lineHeight: 20,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 10,
  },
  tag: {
    fontSize: 11,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 0.5,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  relayBadge: {
    fontSize: 10,
    fontWeight: '800',
  },
  reflectionBadge: {
    fontSize: 10,
  },
  authorBadge: {
    fontSize: 10,
    color: '#555',
  },
});