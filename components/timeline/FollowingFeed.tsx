import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  fetchFollowingPublicPosts,
  type SocialPublicPost,
} from '../../src/utils/nostr-social';
import { formatDate } from '../../src/utils/storage';

type FollowingFeedProps = {
  theme: any;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

type CopyFeedbackState = {
  postId: string;
  action: 'text' | 'author';
} | null;

let FOLLOWING_FEED_SESSION_CACHE: SocialPublicPost[] = [];
let FOLLOWING_FEED_CACHE_UPDATED_AT = 0;

const FOLLOWING_FEED_CACHE_MAX_AGE_MS = 90 * 1000;

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

function sortPostsNewestFirst(posts: SocialPublicPost[]): SocialPublicPost[] {
  return [...posts].sort((a, b) => b.createdAt - a.createdAt);
}

function dedupePosts(posts: SocialPublicPost[]): SocialPublicPost[] {
  const seen = new Set<string>();
  const unique: SocialPublicPost[] = [];

  posts.forEach(post => {
    if (!post.id || seen.has(post.id)) return;

    seen.add(post.id);
    unique.push(post);
  });

  return sortPostsNewestFirst(unique);
}

function buildFollowingShareMessage(post: SocialPublicPost): string {
  const authorName = getAuthorName(post);
  const firstUrl = post.mediaUrls[0] || post.urlTags[0];

  return [
    authorName,
    post.content,
    firstUrl,
    post.npub,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildFollowingCopyText(post: SocialPublicPost): string {
  const firstUrl = post.mediaUrls[0] || post.urlTags[0];

  return [
    post.content,
    firstUrl,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function getFollowingAuthorIdentifier(post: SocialPublicPost): string {
  return post.npub || post.pubkey || '';
}

function getFollowingAuthorFilterKey(post: SocialPublicPost): string {
  return (post.pubkey || post.npub || '').trim().toLowerCase();
}

function buildFollowingAuthorShareMessage(post: SocialPublicPost): string {
  const authorIdentifier = getFollowingAuthorIdentifier(post);

  return [
    getAuthorName(post),
    authorIdentifier,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatFollowingFeedUpdatedAt(updatedAt: number): string {
  if (!updatedAt) return 'Not refreshed yet';

  const secondsAgo = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));

  if (secondsAgo < 10) return 'Updated just now';
  if (secondsAgo < 60) return `Updated ${secondsAgo}s ago`;

  const minutesAgo = Math.floor(secondsAgo / 60);

  if (minutesAgo < 60) {
    return minutesAgo === 1 ? 'Updated 1 min ago' : `Updated ${minutesAgo} min ago`;
  }

  const hoursAgo = Math.floor(minutesAgo / 60);

  return hoursAgo === 1 ? 'Updated 1 hour ago' : `Updated ${hoursAgo} hours ago`;
}

function getFollowingActivityLabel(post: SocialPublicPost): string {
  return post.activityType === 'reply' ? 'Reply' : 'Following';
}

function getFollowingReplyPreviewAuthorName(post: SocialPublicPost): string {
  const preview = post.replyPreview;

  if (!preview) return 'a thread';

  return preview.authorName || shortenIdentifier(preview.npub) || shortenIdentifier(preview.pubkey);
}

function getFollowingReplyContextLabel(post: SocialPublicPost): string | null {
  if (post.activityType !== 'reply') return null;

  if (post.replyPreview) {
    return `In reply to ${getFollowingReplyPreviewAuthorName(post)}`;
  }

  const threadId = post.replyParentId || post.replyRootId;

  if (!threadId) return 'In reply to a thread';

  return `In reply to thread ${shortenIdentifier(threadId)}`;
}

function getFollowingReplyPreviewText(post: SocialPublicPost): string | null {
  const content = post.replyPreview?.content?.trim();

  return content || null;
}

export default function FollowingFeed({ theme, onScroll }: FollowingFeedProps) {
  const bePatientLogo =
    theme.bg === '#0D0F0E' || theme.bg === '#0d0f0e'
      ? require('../../assets/images/bE_logo_light.png')
      : require('../../assets/images/bE_logo_dark.png');

  const [posts, setPosts] = useState<SocialPublicPost[]>(() => FOLLOWING_FEED_SESSION_CACHE);
  const [pendingPosts, setPendingPosts] = useState<SocialPublicPost[]>([]);
  const [loading, setLoading] = useState(() => FOLLOWING_FEED_SESSION_CACHE.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(FOLLOWING_FEED_CACHE_UPDATED_AT);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedbackState>(null);
  const [selectedAuthorPost, setSelectedAuthorPost] = useState<SocialPublicPost | null>(null);
  const [selectedDetailPost, setSelectedDetailPost] = useState<SocialPublicPost | null>(null);
  const [authorFilterPost, setAuthorFilterPost] = useState<SocialPublicPost | null>(null);
  const postsRef = useRef<SocialPublicPost[]>(FOLLOWING_FEED_SESSION_CACHE);
  const listRef = useRef<FlatList<SocialPublicPost> | null>(null);
  const checkingForNewPostsRef = useRef(false);
  const applyingPendingPostsRef = useRef(false);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authorFilterKey = authorFilterPost ? getFollowingAuthorFilterKey(authorFilterPost) : '';
  const visiblePosts = authorFilterKey
    ? posts.filter(post => getFollowingAuthorFilterKey(post) === authorFilterKey)
    : posts;
  const visiblePendingPosts = authorFilterKey
    ? pendingPosts.filter(post => getFollowingAuthorFilterKey(post) === authorFilterKey)
    : pendingPosts;

  const loadFollowingPosts = useCallback(async (options?: {
    refreshing?: boolean;
    allowFreshCache?: boolean;
  }) => {
    const isRefreshing = options?.refreshing === true;
    const allowFreshCache = options?.allowFreshCache === true;
    const hasCachedPosts = postsRef.current.length > 0;
    const cacheIsFresh =
      Date.now() - FOLLOWING_FEED_CACHE_UPDATED_AT < FOLLOWING_FEED_CACHE_MAX_AGE_MS;

    if (!isRefreshing && allowFreshCache && hasCachedPosts && cacheIsFresh) {
      setLoading(false);
      return;
    }

    if (isRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(!hasCachedPosts);
    }

    setErrorText(null);

    try {
      const result = await fetchFollowingPublicPosts({
        limit: 80,
        timeoutMs: 6500,
      });

      const nextPosts = dedupePosts(result.posts);

      FOLLOWING_FEED_SESSION_CACHE = nextPosts;
      FOLLOWING_FEED_CACHE_UPDATED_AT = Date.now();
      postsRef.current = nextPosts;

      setLastUpdatedAt(FOLLOWING_FEED_CACHE_UPDATED_AT);
      setPosts(nextPosts);
      setPendingPosts([]);
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
    postsRef.current = posts;

    if (posts.length > 0) {
      FOLLOWING_FEED_SESSION_CACHE = posts;
      FOLLOWING_FEED_CACHE_UPDATED_AT = Date.now();
    }
  }, [posts]);

  useEffect(() => {
    loadFollowingPosts({ allowFreshCache: true });
  }, [loadFollowingPosts]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    };
  }, []);

  const showCopyFeedback = useCallback((postId: string, action: 'text' | 'author') => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }

    setCopyFeedback({ postId, action });

    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 1300);
  }, []);

  const checkForNewPosts = useCallback(async () => {
    if (checkingForNewPostsRef.current || applyingPendingPostsRef.current) return;

    const currentPosts = postsRef.current;

    if (currentPosts.length === 0) return;

    const newestCreatedAt = Math.max(...currentPosts.map(post => post.createdAt || 0));

    if (!Number.isFinite(newestCreatedAt) || newestCreatedAt <= 0) return;

    checkingForNewPostsRef.current = true;

    try {
      const result = await fetchFollowingPublicPosts({
        since: newestCreatedAt + 1,
        limit: 30,
        timeoutMs: 5000,
      });

      const existingIds = new Set(postsRef.current.map(post => post.id));
      const unseenPosts = result.posts.filter(post => !existingIds.has(post.id));

      if (unseenPosts.length === 0) return;

      setPendingPosts(currentPending =>
        dedupePosts([
          ...unseenPosts,
          ...currentPending,
        ])
      );
    } catch (error) {
      console.warn('[FollowingFeed] new post check failed:', error);
    } finally {
      checkingForNewPostsRef.current = false;
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(checkForNewPosts, 60000);

    return () => {
      clearInterval(interval);
    };
  }, [checkForNewPosts]);

  const handleShowPendingPosts = useCallback(() => {
    const postsToApply = authorFilterKey
      ? pendingPosts.filter(post => getFollowingAuthorFilterKey(post) === authorFilterKey)
      : pendingPosts;

    if (postsToApply.length === 0 || applyingPendingPostsRef.current) return;

    applyingPendingPostsRef.current = true;

    setPendingPosts(currentPendingPosts =>
      authorFilterKey
        ? currentPendingPosts.filter(post => getFollowingAuthorFilterKey(post) !== authorFilterKey)
        : []
    );

    setPosts(currentPosts => {
      const nextPosts = dedupePosts([
        ...postsToApply,
        ...currentPosts,
      ]);

      FOLLOWING_FEED_SESSION_CACHE = nextPosts;
      FOLLOWING_FEED_CACHE_UPDATED_AT = Date.now();
      postsRef.current = nextPosts;

      return nextPosts;
    });

    setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: 0,
        animated: true,
      });

      applyingPendingPostsRef.current = false;
    }, 80);
  }, [authorFilterKey, pendingPosts]);

  const handleSharePost = useCallback(async (post: SocialPublicPost) => {
    const message = buildFollowingShareMessage(post);

    if (!message.trim()) return;

    try {
      await Share.share({
        title: getAuthorName(post),
        message,
      });
    } catch (error) {
      console.warn('[FollowingFeed] share failed:', error);
    }
  }, []);

  const handleCopyPostText = useCallback(async (post: SocialPublicPost) => {
    const text = buildFollowingCopyText(post);

    if (!text.trim()) return;

    try {
      await Clipboard.setStringAsync(text);
      showCopyFeedback(post.id, 'text');
    } catch (error) {
      console.warn('[FollowingFeed] copy text failed:', error);
    }
  }, [showCopyFeedback]);

  const handleCopyAuthorId = useCallback(async (post: SocialPublicPost) => {
    const authorIdentifier = getFollowingAuthorIdentifier(post);

    if (!authorIdentifier.trim()) return;

    try {
      await Clipboard.setStringAsync(authorIdentifier);
      showCopyFeedback(post.id, 'author');
    } catch (error) {
      console.warn('[FollowingFeed] copy author id failed:', error);
    }
  }, [showCopyFeedback]);

  const handleOpenAuthorProfile = useCallback((post: SocialPublicPost) => {
    setSelectedAuthorPost(post);
  }, []);

  const handleCloseAuthorProfile = useCallback(() => {
    setSelectedAuthorPost(null);
  }, []);

  const handleOpenPostDetail = useCallback((post: SocialPublicPost) => {
    setSelectedDetailPost(post);
  }, []);

  const handleClosePostDetail = useCallback(() => {
    setSelectedDetailPost(null);
  }, []);

  const handleShowAuthorPosts = useCallback((post: SocialPublicPost) => {
    setAuthorFilterPost(post);
    setSelectedAuthorPost(null);
    setSelectedDetailPost(null);

    setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: 0,
        animated: true,
      });
    }, 80);
  }, []);

  const handleClearAuthorFilter = useCallback(() => {
    setAuthorFilterPost(null);

    setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: 0,
        animated: true,
      });
    }, 80);
  }, []);

  const handleShareAuthorProfile = useCallback(async (post: SocialPublicPost) => {
    const message = buildFollowingAuthorShareMessage(post);

    if (!message.trim()) return;

    try {
      await Share.share({
        title: getAuthorName(post),
        message,
      });
    } catch (error) {
      console.warn('[FollowingFeed] share author failed:', error);
    }
  }, []);

  const renderPost = useCallback(({ item }: { item: SocialPublicPost }) => {
    const authorName = getAuthorName(item);
    const authorInitials = getAuthorInitials(item);
    const firstImageUrl = item.imageUrls[0];
    const hasMedia = !!firstImageUrl;
    const textCopied = copyFeedback?.postId === item.id && copyFeedback.action === 'text';

    return (
      <View style={[s.postCard, { backgroundColor: theme.raised, borderColor: theme.border }]}>
        <TouchableOpacity
          style={s.postHeader}
          activeOpacity={0.82}
          onPress={() => handleOpenAuthorProfile(item)}
          accessibilityRole="button"
          accessibilityLabel="Open Following author profile"
        >
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
              {getFollowingActivityLabel(item)} · {formatDate(item.createdAt)}
            </Text>
          </View>

          <View style={[s.sourcePill, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Text style={[s.sourcePillText, { color: theme.textMuted }]}>
              Profile
            </Text>
          </View>
        </TouchableOpacity>

        {!!getFollowingReplyContextLabel(item) && (
          <TouchableOpacity
            style={[s.replyContextCard, { borderColor: theme.border, backgroundColor: theme.surface }]}
            activeOpacity={0.82}
            onPress={() => handleOpenPostDetail(item)}
            accessibilityRole="button"
            accessibilityLabel="Open reply context"
          >
            <View style={s.replyContextTitleRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.textMuted} />
              <Text style={[s.replyContextText, { color: theme.textMuted }]} numberOfLines={1}>
                {getFollowingReplyContextLabel(item)}
              </Text>
            </View>

            {!!getFollowingReplyPreviewText(item) && (
              <Text style={[s.replyPreviewText, { color: theme.textSecondary }]} numberOfLines={2}>
                {getFollowingReplyPreviewText(item)}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {hasMedia && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => handleOpenPostDetail(item)}
            accessibilityRole="button"
            accessibilityLabel="Open Following post"
          >
            <Image
              source={{ uri: firstImageUrl }}
              style={s.postImage}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}

        {!!item.content && (
          <TouchableOpacity
            activeOpacity={0.86}
            onPress={() => handleOpenPostDetail(item)}
            accessibilityRole="button"
            accessibilityLabel="Open Following post"
          >
            <Text style={[s.postContent, { color: theme.textSecondary }]} numberOfLines={8}>
              {item.content}
            </Text>
          </TouchableOpacity>
        )}

        <View style={[s.postFooter, { borderTopColor: theme.border }]}>
          <TouchableOpacity
            style={s.footerAction}
            activeOpacity={0.75}
            onPress={() => handleOpenPostDetail(item)}
            accessibilityRole="button"
            accessibilityLabel="Open Following post detail"
          >
            <Ionicons name="open-outline" size={18} color={theme.textMuted} />
            <Text style={[s.footerActionText, { color: theme.textMuted }]}>
              Open
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.footerAction}
            activeOpacity={0.75}
            onPress={() => handleSharePost(item)}
            accessibilityRole="button"
            accessibilityLabel="Share this Following post"
          >
            <Ionicons name="share-social-outline" size={18} color={theme.textMuted} />
            <Text style={[s.footerActionText, { color: theme.textMuted }]}>
              Share
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.footerAction}
            activeOpacity={0.75}
            onPress={() => handleCopyPostText(item)}
            accessibilityRole="button"
            accessibilityLabel="Copy this Following post text"
          >
            <Ionicons
              name={textCopied ? 'checkmark-circle-outline' : 'copy-outline'}
              size={18}
              color={textCopied ? theme.gold : theme.textMuted}
            />
            <Text style={[s.footerActionText, { color: textCopied ? theme.gold : theme.textMuted }]}>
              {textCopied ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [
    copyFeedback,
    handleCopyAuthorId,
    handleCopyPostText,
    handleOpenAuthorProfile,
    handleOpenPostDetail,
    handleSharePost,
    theme,
  ]);

  if (loading && posts.length === 0) {
    return (
      <View style={s.fetchWrap}>
        <View
          style={[
            s.fetchCard,
            {
              backgroundColor: theme.raised,
              borderColor: theme.border,
              shadowColor: theme.gold,
            },
          ]}
        >
          <Image source={bePatientLogo} style={s.fetchLogo} resizeMode="contain" />

          <Text style={[s.fetchTitle, { color: theme.text }]}>
            bE Patient
          </Text>

          <View style={s.fetchStatusRow}>
            <ActivityIndicator size="small" color={theme.gold} />
            <Text style={[s.fetchStatusText, { color: theme.text }]}>
              Fetching relay posts…
            </Text>
          </View>

          <Text style={[s.fetchHint, { color: theme.textMuted }]}>
            Pulling recent public Marks from people you follow. Relays can take a moment.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.feedWrap}>
      {visiblePendingPosts.length > 0 && (
        <TouchableOpacity
          style={[
            s.newPostBanner,
            {
              backgroundColor: theme.gold,
              shadowColor: theme.gold,
            },
          ]}
          activeOpacity={0.88}
          onPress={handleShowPendingPosts}
          accessibilityRole="button"
          accessibilityLabel="Show new Following posts"
        >
          <Ionicons name="arrow-down" size={15} color={theme.bg} />
          <Text style={[s.newPostBannerText, { color: theme.bg }]}>
            {visiblePendingPosts.length === 1
              ? '1 new update'
              : `${visiblePendingPosts.length} new updates`}
          </Text>
        </TouchableOpacity>
      )}

      {selectedAuthorPost && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={handleCloseAuthorProfile}
        >
          <TouchableOpacity
            style={s.profileModalBackdrop}
            activeOpacity={1}
            onPress={handleCloseAuthorProfile}
          >
            <TouchableOpacity
              style={[
                s.profileCard,
                {
                  backgroundColor: theme.raised,
                  borderColor: theme.border,
                },
              ]}
              activeOpacity={1}
            >
              <View style={s.profileHeader}>
                <View style={[s.profileAvatar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  {selectedAuthorPost.authorAvatarUrl ? (
                    <Image source={{ uri: selectedAuthorPost.authorAvatarUrl }} style={s.profileAvatarImage} />
                  ) : (
                    <Text style={[s.profileAvatarText, { color: theme.gold }]}>
                      {getAuthorInitials(selectedAuthorPost)}
                    </Text>
                  )}
                </View>

                <View style={s.profileHeaderCopy}>
                  <Text style={[s.profileName, { color: theme.text }]} numberOfLines={1}>
                    {getAuthorName(selectedAuthorPost)}
                  </Text>
                  <Text style={[s.profileId, { color: theme.textMuted }]} numberOfLines={1}>
                    {shortenIdentifier(getFollowingAuthorIdentifier(selectedAuthorPost))}
                  </Text>
                </View>
              </View>

              <Text style={[s.profileHint, { color: theme.textSecondary }]}>
                Public Nostr profile from your Following feed.
              </Text>

              <View style={s.profileActions}>
                <TouchableOpacity
                  style={[s.profileActionButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  activeOpacity={0.78}
                  onPress={() => handleCopyAuthorId(selectedAuthorPost)}
                  accessibilityRole="button"
                  accessibilityLabel="Copy author id"
                >
                  <Ionicons
                    name={
                      copyFeedback?.postId === selectedAuthorPost.id && copyFeedback.action === 'author'
                        ? 'checkmark-circle-outline'
                        : 'person-circle-outline'
                    }
                    size={18}
                    color={
                      copyFeedback?.postId === selectedAuthorPost.id && copyFeedback.action === 'author'
                        ? theme.gold
                        : theme.textMuted
                    }
                  />
                  <Text
                    style={[
                      s.profileActionText,
                      {
                        color:
                          copyFeedback?.postId === selectedAuthorPost.id && copyFeedback.action === 'author'
                            ? theme.gold
                            : theme.text,
                      },
                    ]}
                  >
                    {copyFeedback?.postId === selectedAuthorPost.id && copyFeedback.action === 'author'
                      ? 'Copied'
                      : 'Copy ID'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.profileActionButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  activeOpacity={0.78}
                  onPress={() => handleShareAuthorProfile(selectedAuthorPost)}
                  accessibilityRole="button"
                  accessibilityLabel="Share author profile"
                >
                  <Ionicons name="share-social-outline" size={18} color={theme.textMuted} />
                  <Text style={[s.profileActionText, { color: theme.text }]}>
                    Share
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.profileActionButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  activeOpacity={0.78}
                  onPress={() => handleShowAuthorPosts(selectedAuthorPost)}
                  accessibilityRole="button"
                  accessibilityLabel="Show updates from this author"
                >
                  <Ionicons name="filter-outline" size={18} color={theme.textMuted} />
                  <Text style={[s.profileActionText, { color: theme.text }]}>
                    Updates
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[s.profileCloseButton, { backgroundColor: theme.gold }]}
                activeOpacity={0.82}
                onPress={handleCloseAuthorProfile}
                accessibilityRole="button"
                accessibilityLabel="Close author profile"
              >
                <Text style={[s.profileCloseText, { color: theme.bg }]}>
                  Close
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {selectedDetailPost && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={handleClosePostDetail}
        >
          <TouchableOpacity
            style={s.profileModalBackdrop}
            activeOpacity={1}
            onPress={handleClosePostDetail}
          >
            <TouchableOpacity
              style={[
                s.postDetailCard,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
              activeOpacity={1}
            >
              <TouchableOpacity
                style={s.postDetailAuthorRow}
                activeOpacity={0.82}
                onPress={() => {
                  handleClosePostDetail();
                  handleOpenAuthorProfile(selectedDetailPost);
                }}
              >
                <View style={[s.profileAvatar, { backgroundColor: theme.raised, borderColor: theme.border }]}>
                  {selectedDetailPost.authorAvatarUrl ? (
                    <Image source={{ uri: selectedDetailPost.authorAvatarUrl }} style={s.profileAvatarImage} />
                  ) : (
                    <Text style={[s.profileAvatarText, { color: theme.gold }]}>
                      {getAuthorInitials(selectedDetailPost)}
                    </Text>
                  )}
                </View>

                <View style={s.profileHeaderCopy}>
                  <Text style={[s.profileName, { color: theme.text }]} numberOfLines={1}>
                    {getAuthorName(selectedDetailPost)}
                  </Text>
                  <Text style={[s.profileId, { color: theme.textMuted }]} numberOfLines={1}>
                    {getFollowingActivityLabel(selectedDetailPost)} · {formatDate(selectedDetailPost.createdAt)}
                  </Text>
                </View>
              </TouchableOpacity>

              {!!getFollowingReplyContextLabel(selectedDetailPost) && (
                <TouchableOpacity
                  style={[s.postDetailReplyContextCard, { borderColor: theme.border, backgroundColor: theme.raised }]}
                  activeOpacity={0.82}
                  onPress={() => {
                    handleClosePostDetail();
                    handleOpenAuthorProfile(selectedDetailPost);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open reply author profile"
                >
                  <View style={s.replyContextTitleRow}>
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.textMuted} />
                    <Text style={[s.replyContextText, { color: theme.textMuted }]} numberOfLines={1}>
                      {getFollowingReplyContextLabel(selectedDetailPost)}
                    </Text>
                  </View>

                  {!!getFollowingReplyPreviewText(selectedDetailPost) && (
                    <Text style={[s.replyPreviewText, { color: theme.textSecondary }]} numberOfLines={3}>
                      {getFollowingReplyPreviewText(selectedDetailPost)}
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              {!!selectedDetailPost.imageUrls[0] && (
                <Image
                  source={{ uri: selectedDetailPost.imageUrls[0] }}
                  style={s.postDetailImage}
                  resizeMode="cover"
                />
              )}

              {!!selectedDetailPost.content && (
                <Text style={[s.postDetailText, { color: theme.textSecondary }]}>
                  {selectedDetailPost.content}
                </Text>
              )}

              <View style={s.profileActions}>
                <TouchableOpacity
                  style={[s.profileActionButton, { borderColor: theme.border, backgroundColor: theme.raised }]}
                  activeOpacity={0.78}
                  onPress={() => handleCopyPostText(selectedDetailPost)}
                >
                  <Ionicons
                    name={
                      copyFeedback?.postId === selectedDetailPost.id && copyFeedback.action === 'text'
                        ? 'checkmark-circle-outline'
                        : 'copy-outline'
                    }
                    size={18}
                    color={
                      copyFeedback?.postId === selectedDetailPost.id && copyFeedback.action === 'text'
                        ? theme.gold
                        : theme.textMuted
                    }
                  />
                  <Text
                    style={[
                      s.profileActionText,
                      {
                        color:
                          copyFeedback?.postId === selectedDetailPost.id && copyFeedback.action === 'text'
                            ? theme.gold
                            : theme.text,
                      },
                    ]}
                  >
                    {copyFeedback?.postId === selectedDetailPost.id && copyFeedback.action === 'text'
                      ? 'Copied'
                      : 'Copy'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.profileActionButton, { borderColor: theme.border, backgroundColor: theme.raised }]}
                  activeOpacity={0.78}
                  onPress={() => handleSharePost(selectedDetailPost)}
                >
                  <Ionicons name="share-social-outline" size={18} color={theme.textMuted} />
                  <Text style={[s.profileActionText, { color: theme.text }]}>
                    Share
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.profileActionButton, { borderColor: theme.border, backgroundColor: theme.raised }]}
                  activeOpacity={0.78}
                  onPress={() => handleShowAuthorPosts(selectedDetailPost)}
                  accessibilityRole="button"
                  accessibilityLabel="Show updates from this author"
                >
                  <Ionicons name="filter-outline" size={18} color={theme.textMuted} />
                  <Text style={[s.profileActionText, { color: theme.text }]}>
                    Updates
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[s.profileCloseButton, { backgroundColor: theme.gold }]}
                activeOpacity={0.82}
                onPress={handleClosePostDetail}
              >
                <Text style={[s.profileCloseText, { color: theme.bg }]}>
                  Done
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      <FlatList
        ref={listRef}
        style={s.feedList}
        data={visiblePosts}
        keyExtractor={item => item.id}
        renderItem={renderPost}
        contentContainerStyle={visiblePosts.length === 0 ? s.emptyList : s.list}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={32}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadFollowingPosts({ refreshing: true })}
            tintColor={theme.gold}
          />
        }
        ListHeaderComponent={
          posts.length > 0 ? (
            <View style={[s.feedStatusCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.feedStatusTitle, { color: theme.text }]} numberOfLines={1}>
                  {authorFilterPost ? getAuthorName(authorFilterPost) : 'Following'}
                </Text>
                <Text style={[s.feedStatusMeta, { color: theme.textMuted }]} numberOfLines={1}>
                  {authorFilterPost
                    ? `${visiblePosts.length} ${visiblePosts.length === 1 ? 'update' : 'updates'} from this author`
                    : `${posts.length} ${posts.length === 1 ? 'update' : 'updates'} · ${formatFollowingFeedUpdatedAt(lastUpdatedAt)}`}
                </Text>
              </View>

              {authorFilterPost ? (
                <TouchableOpacity
                  style={[s.feedStatusRefreshBtn, { borderColor: theme.border, backgroundColor: theme.raised }]}
                  activeOpacity={0.78}
                  onPress={handleClearAuthorFilter}
                  accessibilityRole="button"
                  accessibilityLabel="Clear author filter"
                >
                  <Ionicons name="close" size={16} color={theme.gold} />
                  <Text style={[s.feedStatusRefreshText, { color: theme.gold }]}>
                    Clear
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[s.feedStatusRefreshBtn, { borderColor: theme.border, backgroundColor: theme.raised }]}
                  activeOpacity={0.78}
                  onPress={() => loadFollowingPosts({ refreshing: true })}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh Following feed"
                >
                  <Ionicons name="refresh" size={16} color={theme.gold} />
                  <Text style={[s.feedStatusRefreshText, { color: theme.gold }]}>
                    Refresh
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={[s.emptyIcon, { color: theme.textMuted }]}>Following</Text>
            <Text style={[s.emptyText, { color: theme.text }]}>
              {errorText
                ? 'Following unavailable'
                : authorFilterPost
                  ? 'No updates from this author'
                  : 'No updates yet'}
            </Text>
            <Text style={[s.emptyHint, { color: theme.textMuted }]}>
              {errorText ||
                (authorFilterPost
                  ? 'Clear the filter to return to the full Following feed.'
                  : 'Refresh Network first, then pull to refresh this feed.')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  feedWrap: {
    flex: 1,
  },
  feedList: {
    flex: 1,
  },
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
  fetchWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 80,
  },
  fetchCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 0.5,
    paddingHorizontal: 22,
    paddingVertical: 26,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  fetchLogo: {
    width: 62,
    height: 44,
    marginBottom: 12,
  },
  fetchTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  fetchStatusRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginBottom: 10,
  },
  fetchStatusText: {
    fontSize: 14,
    fontWeight: '800',
  },
  fetchHint: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  newPostBanner: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    zIndex: 20,
    elevation: 20,
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  newPostBannerText: {
    fontSize: 13,
    fontWeight: '900',
  },
  feedStatusCard: {
    minHeight: 62,
    borderRadius: 18,
    borderWidth: 0.5,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  feedStatusTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  feedStatusMeta: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  feedStatusRefreshBtn: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 0.5,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedStatusRefreshText: {
    fontSize: 12,
    fontWeight: '900',
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
  replyContextCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderWidth: 0.5,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 5,
  },
  replyContextTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  replyContextText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: '800',
  },
  replyPreviewText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
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
  profileModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  profileCard: {
    marginHorizontal: 12,
    marginBottom: 18,
    borderRadius: 22,
    borderWidth: 0.5,
    padding: 18,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImage: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  profileAvatarText: {
    fontSize: 18,
    fontWeight: '900',
  },
  profileHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 19,
    fontWeight: '900',
  },
  profileId: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  profileHint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 14,
  },
  profileActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  profileActionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  profileActionText: {
    fontSize: 13,
    fontWeight: '900',
  },
  profileCloseButton: {
    minHeight: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  profileCloseText: {
    fontSize: 14,
    fontWeight: '900',
  },
  postDetailCard: {
    marginHorizontal: 12,
    marginBottom: 18,
    maxHeight: '86%',
    borderRadius: 22,
    borderWidth: 0.5,
    padding: 16,
  },
  postDetailAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  postDetailReplyContextCard: {
    marginBottom: 14,
    borderWidth: 0.5,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  postDetailImage: {
    width: '100%',
    height: 330,
    borderRadius: 18,
    backgroundColor: '#000000',
    marginBottom: 14,
  },
  postDetailText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  postImage: {
    width: '100%',
    height: 320,
    backgroundColor: '#000000',
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
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  footerAction: {
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