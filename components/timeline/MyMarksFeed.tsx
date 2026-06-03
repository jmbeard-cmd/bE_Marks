import {
    FlatList,
    Platform,
    RefreshControl,
    StyleSheet,
    Text,
    View,
    type ListRenderItem,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    type ViewabilityConfig,
    type ViewToken,
} from 'react-native';
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
  renderItem: ListRenderItem<MyMarksFeedItem>;
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

export function buildMyMarksFeedItems({
  milestones,
  currentNpub,
  currentProfile,
  familyName,
}: BuildMyMarksFeedItemsInput): MyMarksFeedItem[] {
  return milestones.map(milestone => {
    const hasTitle = milestone.note?.includes('\n\n');
    const title = hasTitle ? milestone.note.split('\n\n')[0] : null;
    const body = hasTitle
      ? milestone.note.split('\n\n').slice(1).join('\n\n')
      : milestone.note;
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
  renderItem,
  onRefresh,
  onScroll,
  viewabilityConfig,
  onViewableItemsChanged,
}: MyMarksFeedProps) {
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
});