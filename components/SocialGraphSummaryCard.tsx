import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type SocialGraphSummaryCardProps = {
  theme: any;
  followingCount: number;
  followersCount: number;
  syncing?: boolean;
  lastUpdatedLabel?: string;
  onRefresh?: () => void;
};

export default function SocialGraphSummaryCard({
  theme,
  followingCount,
  followersCount,
  syncing = false,
  lastUpdatedLabel,
  onRefresh,
}: SocialGraphSummaryCardProps) {
  const s = createStyles(theme);

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.iconWrap}>
          <Ionicons name="people-outline" size={18} color={theme.gold} />
        </View>

        <View style={s.headerTextWrap}>
          <Text style={s.kicker}>Account social graph</Text>
          <Text style={s.title}>Social graph source</Text>
        </View>

        {!!onRefresh && (
          <TouchableOpacity
            style={[s.refreshButton, syncing && s.refreshButtonDisabled]}
            onPress={onRefresh}
            disabled={syncing}
            activeOpacity={0.82}
          >
            <Ionicons
              name={syncing ? 'sync' : 'refresh'}
              size={15}
              color={theme.bg}
            />
            <Text style={s.refreshText}>
              {syncing ? 'Syncing' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={s.description}>
        Following is people-based. It pulls public Nostr posts from people you follow and keeps them out of Spaces and Broadcasts.
      </Text>

      <View style={s.statsRow}>
        <View style={s.statBox}>
          <Text style={s.statValue}>{followingCount}</Text>
          <Text style={s.statLabel}>Following</Text>
        </View>

        <View style={s.statBox}>
          <Text style={s.statValue}>{followersCount}</Text>
          <Text style={s.statLabel}>Followers</Text>
        </View>
      </View>

      {!!lastUpdatedLabel && (
        <Text style={s.lastUpdated}>
          {lastUpdatedLabel}
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
  const bg = theme?.bg ?? '#050505';

  return StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: border,
      borderRadius: 22,
      padding: 16,
      backgroundColor: raised,
      gap: 14,
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
      fontSize: 18,
      fontWeight: '900',
    },
    refreshButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 8,
      backgroundColor: gold,
    },
    refreshButtonDisabled: {
      opacity: 0.6,
    },
    refreshText: {
      color: bg,
      fontSize: 11,
      fontWeight: '900',
    },
    description: {
      color: textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    statsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    statBox: {
      flex: 1,
      borderWidth: 1,
      borderColor: border,
      borderRadius: 16,
      padding: 12,
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    statValue: {
      color: text,
      fontSize: 24,
      fontWeight: '900',
    },
    statLabel: {
      marginTop: 2,
      color: textSecondary,
      fontSize: 12,
      fontWeight: '800',
    },
    lastUpdated: {
      color: textSecondary,
      fontSize: 11,
      fontWeight: '700',
    },
  });
}
