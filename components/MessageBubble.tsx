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
  onPressMedia?: (uri: string) => void;
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

export default function MessageBubble({ item, showName, onPressMedia, s }: Props) {
  const { themeMode } = useIdentity();
  const theme = Colors[themeMode];

  const isPending = item?.pending;
  const mediaItems = getMessageMediaItems(item);
  const visualMediaItems = getVisualMediaItems(mediaItems);
  const fileMediaItems = getFileMediaItems(mediaItems);

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
          {item?.avatarUrl ? (
            <Image
              source={{ uri: item.avatarUrl }}
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

      <View
        style={[
          s.bubble,
          {
            alignSelf: 'flex-start',
            maxWidth: '100%',
            backgroundColor: item?.mine ? theme.raised : theme.surface,
            borderWidth: 0.5,
            borderColor: item?.mine ? theme.goldDim : theme.border,
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

        {!isPending && !!item.text && (
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
        )}

        {!isPending && visualCount > 0 && (
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

        {!isPending && fileMediaItems.length > 0 && (
          <View style={{ gap: 8, marginTop: item.text || visualCount > 0 ? 8 : 0 }}>
            {fileMediaItems.map((file, index) => (
              <TouchableOpacity
                key={file.id || `${file.uri}_${index}`}
                activeOpacity={0.85}
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
      </View>

      {!isPending && (
        <View
          style={{
            flexDirection: 'row',
            gap: 6,
            marginTop: 5,
            marginLeft: 8,
            minHeight: 18,
          }}
        >
          {/* Reaction chips will go here next. */}
        </View>
      )}
    </View>
  );
}