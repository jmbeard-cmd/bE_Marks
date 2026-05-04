import { memo } from 'react';
import { ActivityIndicator, Image, Linking, Text, TouchableOpacity, View } from 'react-native';
import { useIdentity } from '../app/_layout';
import { Colors } from '../src/constants/theme';

type MessageMediaType = 'image' | 'video' | 'file';

type MessageMediaItem = {
  id?: string;
  uri: string;
  type: MessageMediaType;
  thumbnailUrl?: string;
  fileName?: string;
  mimeType?: string;
};

type Props = {
  item: any;
  showName?: boolean;
  avatarUrl?: string;
  onPressMedia?: (uri: string) => void;
  onLongPress?: (item: any) => void;
  onPollVote?: (item: any, optionId: string) => void;
  s: any;
};


function getMessageMediaItems(item: any): MessageMediaItem[] {
  const media = Array.isArray(item?.media) ? item.media : [];

  if (media.length > 0) {
    return media
      .filter((entry: any) => !!entry?.uri)
      .map((entry: any, index: number) => ({
        id: entry.id || `media_${index}_${entry.uri}`,
        uri: entry.uri,
        type: entry.type === 'video' || entry.type === 'file' ? entry.type : 'image',
        thumbnailUrl: entry.thumbnailUrl,
        fileName: entry.fileName || entry.name,
        mimeType: entry.mimeType,
      }));
  }

  const legacyUri = item?.mediaUrl || item?.imageUrl;

  if (!legacyUri) return [];

  return [
    {
      id: `legacy_${legacyUri}`,
      uri: legacyUri,
      type: item?.mediaType === 'video' ? 'video' : 'image',
      thumbnailUrl: item?.thumbnailUrl,
    },
  ];
}

function getVisualMediaItems(media: MessageMediaItem[]) {
  return media.filter(entry => entry.type === 'image' || entry.type === 'video');
}

function getFileMediaItems(media: MessageMediaItem[]) {
  return media.filter(entry => entry.type === 'file');
}

function getInitials(name?: string): string {
  const fallback = 'M';
  const cleaned = name?.trim();

  if (!cleaned) return fallback;

  const parts = cleaned
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase() || fallback;
}

function formatTime(createdAt?: number): string {
  if (!createdAt) return '';

  return new Date(createdAt * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function hasReplyPreview(item: any): boolean {
  return !!item?.replyToClientMessageId || !!item?.replyPreviewText;
}

function getReplyPreviewSender(item: any): string {
  return item?.replyPreviewSenderName || 'Message';
}

function getReplyPreviewText(item: any): string {
  const preview = item?.replyPreviewText?.trim();

  if (preview) return preview;

  return 'Original message';
}

function getReplyPreviewIcon(item: any): string {
  const preview = getReplyPreviewText(item).toLowerCase();

  if (preview.includes('video')) return '🎥';
  if (preview.includes('photo') || preview.includes('image')) return '📷';
  if (preview.includes('file') || preview.includes('attachment')) return '📎';

  return '↩';
}

function getReplyPreviewLabel(item: any): string {
  const preview = getReplyPreviewText(item);

  if (preview.toLowerCase() === 'photo') return 'Photo';
  if (preview.toLowerCase() === 'video') return 'Video';
  if (preview.toLowerCase() === 'file') return 'File';

  return preview;
}

function getReactionSummary(item: any): { reaction: string; count: number }[] {
  const reactions = Array.isArray(item?.reactions) ? item.reactions : [];

  const counts = new Map<string, number>();

  reactions.forEach((entry: any) => {
    const reaction = entry?.reaction;

    if (!reaction) return;

    counts.set(reaction, (counts.get(reaction) || 0) + 1);
  });

  return Array.from(counts.entries()).map(([reaction, count]) => ({
    reaction,
    count,
  }));
}

function getPollVotes(item: any): any[] {
  return Array.isArray(item?.poll?.votes) ? item.poll.votes : [];
}

function getPollVoteCounts(item: any): Record<string, number> {
  const counts: Record<string, number> = {};

  getPollVotes(item).forEach(vote => {
    const optionId = vote?.optionId;

    if (!optionId) return;

    counts[optionId] = (counts[optionId] || 0) + 1;
  });

  return counts;
}

function getMyPollVoteOptionId(item: any, myNpub?: string | null): string | undefined {
  if (!myNpub) return undefined;

  const vote = getPollVotes(item).find(entry => entry?.voterNpub === myNpub);

  return vote?.optionId;
}

function getPollVoteTotal(item: any): number {
  return getPollVotes(item).length;
}

function hasPoll(item: any): boolean {
  return !!item?.poll?.question && Array.isArray(item?.poll?.options) && item.poll.options.length >= 2;
}


async function openFile(uri: string) {
  try {
    const supported = await Linking.canOpenURL(uri);

    if (supported) {
      await Linking.openURL(uri);
    }
  } catch (error) {
    console.warn('[MessageBubble] failed to open file:', error);
  }
}

function getMediaSignature(item: any): string {
  return getMessageMediaItems(item)
    .map(media => [
      media.id || '',
      media.uri,
      media.type,
      media.thumbnailUrl || '',
      media.fileName || '',
      media.mimeType || '',
    ].join(':'))
    .join('|');
}

function getReactionSignature(item: any): string {
  const reactions = Array.isArray(item?.reactions) ? item.reactions : [];

  return reactions
    .map((reaction: any) => [
      reaction.id || '',
      reaction.reaction || '',
      reaction.reactorNpub || '',
      reaction.createdAt || '',
    ].join(':'))
    .join('|');
}

function getPollSignature(item: any): string {
  const poll = item?.poll;

  if (!poll) return '';

  const options = Array.isArray(poll.options)
    ? poll.options.map((option: any) => `${option.id || ''}:${option.text || ''}`).join('|')
    : '';

  const votes = Array.isArray(poll.votes)
    ? poll.votes.map((vote: any) => `${vote.id || ''}:${vote.optionId || ''}:${vote.voterNpub || ''}:${vote.createdAt || ''}`).join('|')
    : '';

  return [
    poll.id || '',
    poll.question || '',
    options,
    votes,
  ].join('::');
}


function getMessageBubbleSignature(item: any): string {
  return [
    item?.id || '',
    item?.clientMessageId || '',
    item?.text || '',
    item?.pending ? 'pending' : '',
    item?.pendingLabel || '',
    item?.isDeleted ? 'deleted' : '',
    item?.editedAt || '',
    item?.createdAt || '',
    item?.mine ? 'mine' : 'other',
    item?.senderName || '',
    item?.replyToClientMessageId || '',
    item?.replyPreviewText || '',
    item?.replyPreviewSenderName || '',
    getMediaSignature(item),
    getReactionSignature(item),
    getPollSignature(item),
  ].join('::');
}


function areMessageBubblePropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.showName === next.showName &&
    prev.avatarUrl === next.avatarUrl &&
    prev.s === next.s &&
    prev.onPressMedia === next.onPressMedia &&
    prev.onLongPress === next.onLongPress &&
    prev.onPollVote === next.onPollVote &&
    getMessageBubbleSignature(prev.item) === getMessageBubbleSignature(next.item)
  );
}

function MessageBubble({
  item,
  showName,
  avatarUrl,
  onPressMedia,
  onLongPress,
  onPollVote,
  s,
}: Props) {
  const { themeMode, npub } = useIdentity();
  const theme = Colors[themeMode];

  const isPending = item?.pending;
  const isDeleted = !!item?.isDeleted;
  const mediaItems = isDeleted ? [] : getMessageMediaItems(item);
  const visualMediaItems = getVisualMediaItems(mediaItems);
  const fileMediaItems = getFileMediaItems(mediaItems);
  const isEdited = !isPending && !isDeleted && !!item?.editedAt;
  const pollVoteCounts = getPollVoteCounts(item);
  const pollVoteTotal = getPollVoteTotal(item);
  const myPollVoteOptionId = getMyPollVoteOptionId(item, npub);

  const visualCount = visualMediaItems.length;
  const senderName = item?.mine ? 'You' : item?.senderName || 'Member';
  const avatarText = getInitials(senderName);
  const timeText = formatTime(item?.createdAt);
  const shouldShowIdentity = showName || item?.mine;

  return (
    <View
      style={{
        position: 'relative',
        marginBottom: 10,
        paddingLeft: 40,
        paddingRight: 10,
      }}
    >
      {shouldShowIdentity && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 20,
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: theme.surface,
            borderWidth: 0.5,
            borderColor: theme.border,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            zIndex: 2,
          }}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
              }}
              resizeMode="cover"
            />
          ) : (
            <Text
              style={{
                color: theme.gold,
                fontSize: 12,
                fontWeight: '900',
              }}
            >
              {avatarText}
            </Text>
          )}
        </View>
      )}

      {shouldShowIdentity && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 6,
            marginBottom: 4,
            marginLeft: 2,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: item?.mine ? theme.gold : theme.text,
              fontSize: 13,
              fontWeight: '900',
              maxWidth: 190,
            }}
          >
            {senderName}
          </Text>

          {!!timeText && (
            <Text
              style={{
                color: theme.textMuted,
                fontSize: 11,
                fontWeight: '600',
              }}
            >
              {timeText}
            </Text>
          )}
        </View>
      )}

      <TouchableOpacity
        activeOpacity={0.92}
        delayLongPress={260}
        onLongPress={() => onLongPress?.(item)}
        style={[
          s.bubble,
          {
            alignSelf: 'flex-start',
            maxWidth: '100%',
            backgroundColor: item?.mine ? theme.raised : theme.surface,
            borderWidth: 0,
            borderColor: item?.mine ? theme.raised : theme.surface,
            borderRadius: 18,
            borderTopLeftRadius: shouldShowIdentity ? 6 : 18,
            paddingHorizontal: 12,
            paddingVertical: 10,
          },
        ]}
      >
        {isPending && (
          <View style={s.pendingMediaBox}>
            <ActivityIndicator size="small" color={theme.gold} />
            <Text style={s.pendingMediaText}>
              {item.pendingLabel}
            </Text>
          </View>
        )}

        {!isPending && !isDeleted && hasReplyPreview(item) && (
          <View
            style={{
              width: 220,
              marginBottom: item.text || visualCount > 0 || fileMediaItems.length > 0 ? 8 : 0,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: theme.bg,
              borderLeftWidth: 3,
              borderLeftColor: theme.gold,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: theme.gold,
                fontSize: 11,
                fontWeight: '900',
                marginBottom: 6,
              }}
            >
              Replying to {getReplyPreviewSender(item)}
            </Text>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  backgroundColor: theme.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 14 }}>
                  {getReplyPreviewIcon(item)}
                </Text>
              </View>

              <Text
                numberOfLines={2}
                style={{
                  flex: 1,
                  color: theme.textMuted,
                  fontSize: 12,
                  fontWeight: '700',
                  lineHeight: 16,
                }}
              >
                {getReplyPreviewLabel(item)}
              </Text>
            </View>
          </View>
        )}

        {!isPending && !isDeleted && hasPoll(item) && (
          <View
            style={{
              width: 240,
              gap: 10,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <Text
                style={{
                  color: theme.gold,
                  fontSize: 12,
                  fontWeight: '900',
                  letterSpacing: 0.3,
                }}
              >
                Poll
              </Text>

              {myPollVoteOptionId && (
                <Text
                  style={{
                    color: theme.textMuted,
                    fontSize: 11,
                    fontWeight: '800',
                  }}
                >
                  You voted
                </Text>
              )}
            </View>

            <Text
              style={{
                color: theme.text,
                fontSize: 15,
                fontWeight: '900',
                lineHeight: 20,
              }}
            >
              {item.poll.question}
            </Text>

            <View style={{ gap: 8 }}>
              {item.poll.options.map((option: any) => {
                const count = pollVoteCounts[option.id] || 0;
                const percent = pollVoteTotal > 0
                  ? Math.round((count / pollVoteTotal) * 100)
                  : 0;
                const selected = myPollVoteOptionId === option.id;

                return (
                  <TouchableOpacity
                    key={option.id}
                    activeOpacity={0.82}
                    delayLongPress={260}
                    onLongPress={() => onLongPress?.(item)}
                    onPress={() => onPollVote?.(item, option.id)}
                    style={{
                      borderRadius: 14,
                      borderWidth: selected ? 1 : 0.5,
                      borderColor: selected ? theme.gold : theme.border,
                      backgroundColor: theme.bg,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${percent}%`,
                        backgroundColor: theme.raised,
                      }}
                    />

                    <View
                      style={{
                        minHeight: 44,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 9,
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: selected ? 0 : 1,
                          borderColor: theme.border,
                          backgroundColor: selected ? theme.gold : 'transparent',
                        }}
                      >
                        {selected && (
                          <Text
                            style={{
                              color: theme.bg,
                              fontSize: 12,
                              fontWeight: '900',
                              lineHeight: 14,
                            }}
                          >
                            ✓
                          </Text>
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={2}
                          style={{
                            color: theme.text,
                            fontSize: 13,
                            fontWeight: selected ? '900' : '700',
                            lineHeight: 17,
                          }}
                        >
                          {option.text}
                        </Text>

                        {selected && (
                          <Text
                            style={{
                              color: theme.gold,
                              fontSize: 10,
                              fontWeight: '900',
                              marginTop: 2,
                            }}
                          >
                            Your choice
                          </Text>
                        )}
                      </View>

                      <View style={{ alignItems: 'flex-end' }}>
                        <Text
                          style={{
                            color: selected ? theme.gold : theme.textMuted,
                            fontSize: 12,
                            fontWeight: '900',
                          }}
                        >
                          {percent}%
                        </Text>

                        <Text
                          style={{
                            color: theme.textMuted,
                            fontSize: 10,
                            fontWeight: '700',
                            marginTop: 1,
                          }}
                        >
                          {count === 1 ? '1 vote' : `${count} votes`}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text
              style={{
                color: theme.textMuted,
                fontSize: 11,
                fontWeight: '700',
              }}
            >
              {pollVoteTotal === 1 ? '1 total vote' : `${pollVoteTotal} total votes`}
            </Text>
          </View>
        )}

        {!isPending && !isDeleted && !!item.text && (
          <View style={{ marginTop: hasPoll(item) ? 10 : 0 }}>
            <Text
              style={[
                s.messageText,
                {
                  color: theme.text,
                },
              ]}
            >
              {item.text}
            </Text>

            {isEdited && (
              <Text
                style={{
                  color: theme.textMuted,
                  fontSize: 10,
                  fontWeight: '700',
                  marginTop: 4,
                }}
              >
                edited
              </Text>
            )}
          </View>
        )}

        {!isPending && !isDeleted && visualCount > 0 && (
          <View
            style={{
              marginTop: item.text ? 8 : 0,
              width: 220,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            {visualMediaItems.slice(0, 4).map((media, index) => {
              const isSingle = visualCount === 1;
              const tileSize = isSingle ? 220 : 108;
              const extraCount = visualCount - 4;
              const showMoreOverlay = index === 3 && extraCount > 0;

              return (
                <TouchableOpacity
                  key={media.id || `${media.uri}_${index}`}
                  activeOpacity={0.85}
                  delayLongPress={260}
                  onLongPress={() => onLongPress?.(item)}
                  onPress={() => onPressMedia?.(media.uri)}
                  style={{
                    width: tileSize,
                    height: isSingle ? 220 : 108,
                    borderRadius: 12,
                    overflow: 'hidden',
                    backgroundColor: '#000',
                  }}
                >
                  {media.type === 'video' ? (
                    <View style={s.messageVideo}>
                      {media.thumbnailUrl ? (
                        <Image
                          source={{ uri: media.thumbnailUrl }}
                          style={s.messageVideoThumb}
                          resizeMode="cover"
                        />
                      ) : null}

                      <View style={s.messageVideoOverlay}>
                        <Text style={s.messageVideoIcon}>▶</Text>
                      </View>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: media.uri }}
                      style={{
                        width: '100%',
                        height: '100%',
                      }}
                      resizeMode="cover"
                    />
                  )}

                  {showMoreOverlay && (
                    <View
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.55)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        style={{
                          color: '#fff',
                          fontSize: 22,
                          fontWeight: '900',
                        }}
                      >
                        +{extraCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {!isPending && !isDeleted && fileMediaItems.length > 0 && (
          <View style={{ gap: 8, marginTop: item.text || visualCount > 0 ? 8 : 0 }}>
            {fileMediaItems.map((file, index) => (
              <TouchableOpacity
                key={file.id || `${file.uri}_${index}`}
                activeOpacity={0.85}
                delayLongPress={260}
                onLongPress={() => onLongPress?.(item)}
                onPress={() => openFile(file.uri)}
                style={{
                  width: 220,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 11,
                  borderRadius: 12,
                  borderWidth: 0.5,
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
                }}
              >
                <Text style={{ fontSize: 18 }}>📎</Text>

                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.text,
                      fontSize: 13,
                      fontWeight: '800',
                    }}
                  >
                    {file.fileName || 'Attached file'}
                  </Text>

                  {!!file.mimeType && (
                    <Text
                      numberOfLines={1}
                      style={{
                        color: theme.textMuted,
                        fontSize: 10,
                        marginTop: 2,
                      }}
                    >
                      {file.mimeType}
                    </Text>
                  )}
                </View>

                <Text
                  style={{
                    color: theme.gold,
                    fontSize: 11,
                    fontWeight: '900',
                  }}
                >
                  Open
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </TouchableOpacity>

      {!isPending && !isDeleted && getReactionSummary(item).length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 5,
            marginLeft: 8,
            minHeight: 18,
          }}
        >
          {getReactionSummary(item).map(entry => (
            <View
              key={entry.reaction}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: theme.surface,
                borderWidth: 0.5,
                borderColor: theme.border,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                }}
              >
                {entry.reaction}
              </Text>

              {entry.count > 1 && (
                <Text
                  style={{
                    color: theme.textMuted,
                    fontSize: 11,
                    fontWeight: '800',
                  }}
                >
                  {entry.count}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default memo(MessageBubble, areMessageBubblePropsEqual);