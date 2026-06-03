import { StyleSheet, Text, View } from 'react-native';

type FollowingFeedProps = {
  theme: any;
};

export default function FollowingFeed({ theme }: FollowingFeedProps) {
  return (
    <View style={s.empty}>
      <Text style={[s.emptyIcon, { color: theme.textMuted }]}>Following</Text>
      <Text style={[s.emptyText, { color: theme.text }]}>
        Following feed coming online
      </Text>
      <Text style={[s.emptyHint, { color: theme.textMuted }]}>
        Public posts from people you follow will appear here.
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