import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../src/constants/theme';

type SpaceBoardEmptyStateProps = {
  theme: typeof Colors.light;
};

export default function SpaceBoardEmptyState({ theme }: SpaceBoardEmptyStateProps) {
  const s = createStyles(theme);

  return (
    <View style={s.empty}>
      <Text style={s.emptyIcon}>📣</Text>
      <Text style={s.emptyText}>No Board items yet</Text>
      <Text style={s.emptyHint}>
        Pins, announcements, and alerts for this Space will live here.
      </Text>
    </View>
  );
}

const createStyles = (theme: typeof Colors.light) => StyleSheet.create({
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  emptyText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyHint: {
    color: theme.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
});