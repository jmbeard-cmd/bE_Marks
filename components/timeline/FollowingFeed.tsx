import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
    FlatList,
    Image,
    Platform,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    fetchFollowingPublicPosts,
    type SocialPublicPost,
} from '../../src/utils/nostr-social';
import { formatDate } from '../../src/utils/storage';

type FollowingFeedProps = {
  theme: any;
};

function shortenIdentifier(value?: string): string {
  const clean = value?.trim();

  if (!clean) return 'Nostr';
  if (clean.length <= 18) return clean;

  return `${clean.slice(0, 12)}…${clean.slice(-6)}`;
}

function getAuthorName(post: SocialPublicPost): string {
  return post.authorName || shortenIdentifier(post.npub) || shortenIdentifier(post.pubkey);
}

function getAuthorInitials(post: SocialPublicPost): string {
  const name = getAuthorName(post);
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return 'N';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export default function FollowingFeed({ theme }: FollowingFeedProps) {
  const [posts, setPosts] = useState<SocialPublicPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const loadFollowingPosts = useCallback(async (options?: { refreshing?: boolean }) => {
    const isRefreshing = options?.refreshing === true;

    if (isRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setErrorText(null);

    try {
      const result = await fetchFollowingPublicPosts({
        limit: 80,
        timeoutMs: 6500,
      });

      setPosts(result.posts);
    } catch (error) {
      console.warn('[FollowingFeed] failed to load posts:', error);
      setErrorText('Could not load Following right now.');
    } finally {
      if (isRefreshing) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadFollowingPosts();
  }, [loadFollowingPosts]);

  const renderPost = useCallback(({ item }: { item: SocialPublicPost }) => {
    const authorName = getAuthorName(item);
    const authorInitials = getAuthorInitials(item);
    const firstImageUrl = item.imageUrls[0];
    const hasMedia = !!firstImageUrl;

    return (
      <View style={[s.postCard, { backgroundColor: theme.raised, borderColor: theme.border }]}>
        <View style={s.postHeader}>
          <View style={[s.avatar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {item.authorAvatarUrl ? (
              <Image source={{ uri: item.authorAvatarUrl }} style={s.avatarImage} />
            ) : (
              <Text style={[s.avatarText, { color: theme.gold }]}>
                {authorInitials}
              </Text>
            )}
          </View>

          <View style={s.postHeaderCopy}>
            <Text style={[s.authorName, { color: theme.text }]} numberOfLines={1}>
              {authorName}
            </Text>
            <Text style={[s.postMeta, { color: theme.textMuted }]} numberOfLines={1}>
              Following · {formatDate(item.createdAt)}
            </Text>
          </View>

          <View style={[s.sourcePill, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Text style={[s.sourcePillText, { color: theme.textMuted }]}>
              Nostr
            </Text>
          </View>
        </View>

        {hasMedia && (
          <Image
            source={{ uri: firstImageUrl }}
            style={s.postImage}
            resizeMode="cover"
          />
        )}

        {!!item.content && (
          <Text style={[s.postContent, { color: theme.textSecondary }]} numberOfLines={8}>
            {item.content}
          </Text>
        )}

        <View style={[s.postFooter, { borderTopColor: theme.border }]}>
          <TouchableOpacity
            style={s.footerAction}
            activeOpacity={0.75}
          >
            <Ionicons name="eye-outline" size={18} color={theme.textMuted} />
            <Text style={[s.footerActionText, { color: theme.textMuted }]}>
              Public post
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [theme]);

  if (loading && posts.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={[s.emptyIcon, { color: theme.textMuted }]}>⟳</Text>
        <Text style={[s.emptyText, { color: theme.text }]}>
          Loading Following…
        </Text>
        <Text style={[s.emptyHint, { color: theme.textMuted }]}>
          Pulling public posts from people in your Network.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={item => item.id}
      renderItem={renderPost}
      contentContainerStyle={posts.length === 0 ? s.emptyList : s.list}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={32}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadFollowingPosts({ refreshing: true })}
          tintColor={theme.gold}
        />
      }
      ListEmptyComponent={
        <View style={s.empty}>
          <Text style={[s.emptyIcon, { color: theme.textMuted }]}>Following</Text>
          <Text style={[s.emptyText, { color: theme.text }]}>
            {errorText ? 'Following unavailable' : 'No posts yet'}
          </Text>
          <Text style={[s.emptyHint, { color: theme.textMuted }]}>
            {errorText || 'Refresh Network first, then pull to refresh this feed.'}
          </Text>
        </View>
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
  emptyList: {
    flexGrow: 1,
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
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  postCard: {
    borderRadius: 16,
    borderWidth: 0.5,
    overflow: 'hidden',
    marginBottom: 14,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '900',
  },
  postHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    fontSize: 15,
    fontWeight: '900',
  },
  postMeta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  sourcePill: {
    borderWidth: 0.5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  sourcePillText: {
    fontSize: 10,
    fontWeight: '900',
  },
  postImage: {
    width: '100%',
    height: 320,
    backgroundColor: '#000',
  },
  postContent: {
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 14,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  postFooter: {
    borderTopWidth: 0.5,
    minHeight: 42,
    justifyContent: 'center',
  },
  footerAction: {
    alignSelf: 'flex-start',
    minHeight: 42,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  footerActionText: {
    fontSize: 12,
    fontWeight: '800',
  },
});