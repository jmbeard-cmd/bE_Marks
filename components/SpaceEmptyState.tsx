import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../src/constants/theme';

type SpaceEmptyStateProps = {
  theme: typeof Colors.light;
  icon: string;
  title: string;
  hint: string;
};

export default function SpaceEmptyState({
  theme,
  icon,
  title,
  hint,
}: SpaceEmptyStateProps) {
  const s = createStyles(theme);

  return (
    <View style={s.empty}>
      <Text style={s.emptyIcon}>{icon}</Text>
      <Text style={s.emptyText}>{title}</Text>
      <Text style={s.emptyHint}>{hint}</Text>
    </View>
  );
}

const createStyles = (theme: typeof Colors.light) => StyleSheet.create({
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
    color: theme.text,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    color: theme.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
});