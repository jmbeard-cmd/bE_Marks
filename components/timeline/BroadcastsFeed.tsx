import { StyleSheet, Text, View } from 'react-native';

type BroadcastsFeedProps = {
  theme: any;
};

export default function BroadcastsFeed({ theme }: BroadcastsFeedProps) {
  return (
    <View style={s.empty}>
      <Text style={[s.emptyIcon, { color: theme.textMuted }]}>Broadcasts</Text>
      <Text style={[s.emptyText, { color: theme.text }]}>
        No broadcasts yet
      </Text>
      <Text style={[s.emptyHint, { color: theme.textMuted }]}>
        Community, school, church, town, and public feeds will appear here.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
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