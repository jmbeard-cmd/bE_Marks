import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { useIdentity } from '../app/_layout';
import { Colors } from '../src/constants/theme';

type Props = {
  item: any;
  showName?: boolean;
  onPressMedia?: (uri: string) => void;
  s: any;
};

export default function MessageBubble({ item, showName, onPressMedia, s }: Props) {
  const { themeMode } = useIdentity();
  const theme = Colors[themeMode];

  const isPending = item?.pending;
  const mediaUrl = item?.mediaUrl;
  const imageUrl = item?.imageUrl;
  const thumbnailUrl = item?.thumbnailUrl;
  const mediaType = item?.mediaType;

  return (
    <View style={[s.row, item.mine ? s.rowMine : s.rowOther]}>
      <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleOther]}>
        
        {!item.mine && showName && (
          <Text style={s.senderName}>
            {item.senderName || 'Member'}
          </Text>
        )}

        {isPending && (
          <View style={s.pendingMediaBox}>
            <ActivityIndicator size="small" color={theme.gold} />
            <Text style={s.pendingMediaText}>
              {item.pendingLabel}
            </Text>
          </View>
        )}

        {!isPending && !!item.text && (
          <Text style={[
            s.messageText,
            item.mine ? s.messageTextMine : s.messageTextOther
          ]}>
            {item.text}
          </Text>
        )}

        {!isPending && !!(mediaUrl || imageUrl) && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onPressMedia?.(mediaUrl || imageUrl)}
          >
            {mediaType === 'video' ? (
              <View style={s.messageVideo}>
                {thumbnailUrl ? (
                  <Image
                    source={{ uri: thumbnailUrl }}
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
                source={{ uri: mediaUrl || imageUrl }}
                style={s.messageImage}
                resizeMode="cover"
              />
            )}
          </TouchableOpacity>
        )}

        <Text style={[
          s.time,
          item.mine ? s.timeMine : s.timeOther
        ]}>
          {new Date(item.createdAt * 1000).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </View>
    </View>
  );
}