import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type AccountTraySocialGraphCardProps = {
  theme: any;
  onPress: () => void;
};

export default function AccountTraySocialGraphCard({
  theme,
  onPress,
}: AccountTraySocialGraphCardProps) {
  const s = createStyles(theme);

  return (
    <TouchableOpacity
      style={s.card}
      onPress={onPress}
      activeOpacity={0.86}
    >
      <View style={s.headerRow}>
        <View style={s.iconWrap}>
          <Ionicons name="people-outline" size={18} color={theme.gold} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.kicker}>Social graph</Text>
          <Text style={s.title}>Following feed</Text>
        </View>

        <Text style={s.openText}>Open</Text>
      </View>

      <Text style={s.bodyText}>
        Follow people with your Account identity. Their public Nostr posts will only feed Timeline Following.
      </Text>

      <View style={s.ruleList}>
        <Text style={s.ruleText}>• Following: people you follow</Text>
        <Text style={s.ruleText}>• Broadcasts: official relays/channels later</Text>
        <Text style={s.ruleText}>• Spaces: group relay routing stays separate</Text>
      </View>
    </TouchableOpacity>
  );
}

function createStyles(theme: any) {
  const surface = theme?.surface ?? theme?.raised ?? '#151515';
  const border = theme?.border ?? 'rgba(255,255,255,0.10)';
  const text = theme?.text ?? '#FFFFFF';
  const textMuted = theme?.textMuted ?? theme?.textSecondary ?? '#A3A3A3';
  const gold = theme?.gold ?? '#D6A84F';
  const goldDim = theme?.goldDim ?? 'rgba(214,168,79,0.16)';

  return StyleSheet.create({
    card: {
      borderWidth: 0.5,
      borderColor: border,
      borderRadius: 22,
      padding: 14,
      backgroundColor: surface,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 10,
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
    kicker: {
      color: gold,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    title: {
      marginTop: 2,
      color: text,
      fontSize: 17,
      fontWeight: '900',
    },
    openText: {
      color: gold,
      fontSize: 13,
      fontWeight: '900',
    },
    bodyText: {
      color: textMuted,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
      marginBottom: 10,
    },
    ruleList: {
      gap: 4,
    },
    ruleText: {
      color: text,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '800',
    },
  });
}