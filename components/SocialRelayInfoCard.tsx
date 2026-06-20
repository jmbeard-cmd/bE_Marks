import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

type SocialRelayInfoCardProps = {
  theme: any;
  relays: string[];
};

export default function SocialRelayInfoCard({
  theme,
  relays,
}: SocialRelayInfoCardProps) {
  const s = createStyles(theme);

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.iconWrap}>
          <Ionicons name="git-network-outline" size={18} color={theme.gold} />
        </View>

        <View style={s.headerTextWrap}>
          <Text style={s.kicker}>Relay separation</Text>
          <Text style={s.title}>Social relays stay separate</Text>
        </View>
      </View>

      <Text style={s.bodyText}>
        Following is people-based and uses your Account social relays. Spaces use their own Space relay routing. Broadcasts will stay relay/channel-based for official community feeds.
      </Text>

      <View style={s.ruleList}>
        <Text style={s.ruleText}>â€¢ People: accounts you follow</Text>
        <Text style={s.ruleText}>â€¢ Public: official relays/channels</Text>
        <Text style={s.ruleText}>â€¢ Spaces: group-specific relays</Text>
      </View>

      <View style={s.relayList}>
        {relays.slice(0, 6).map(relayUrl => (
          <View key={relayUrl} style={s.relayPill}>
            <Text style={s.relayText} numberOfLines={1}>
              {relayUrl.replace('wss://', '')}
            </Text>
          </View>
        ))}
      </View>

      {relays.length > 6 && (
        <Text style={s.moreText}>
          +{relays.length - 6} more social relay{relays.length - 6 === 1 ? '' : 's'}
        </Text>
      )}
    </View>
  );
}

function createStyles(theme: any) {
  const raised = theme?.raised ?? theme?.card ?? '#151515';
  const border = theme?.border ?? 'rgba(255,255,255,0.10)';
  const text = theme?.text ?? '#FFFFFF';
  const textSecondary = theme?.textSecondary ?? theme?.subtext ?? '#A3A3A3';
  const gold = theme?.gold ?? '#D6A84F';
  const goldDim = theme?.goldDim ?? 'rgba(214,168,79,0.16)';

  return StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: 22,
      padding: 16,
      backgroundColor: raised,
      gap: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: goldDim,
      borderWidth: 1,
      borderColor: gold,
    },
    headerTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    kicker: {
      color: gold,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    title: {
      marginTop: 2,
      color: text,
      fontSize: 17,
      fontWeight: '900',
    },
    bodyText: {
      color: textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    ruleList: {
      gap: 5,
    },
    ruleText: {
      color: text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
    },
    relayList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    relayPill: {
      maxWidth: '100%',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 7,
      backgroundColor: goldDim,
      borderWidth: 1,
      borderColor: border,
    },
    relayText: {
      color: gold,
      fontSize: 11,
      fontWeight: '900',
    },
    moreText: {
      color: textSecondary,
      fontSize: 11,
      fontWeight: '800',
    },
  });
}
