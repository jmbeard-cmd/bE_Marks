import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../src/constants/theme';

type SpaceArchivedBannerProps = {
  theme: typeof Colors.light;
  message: string;
};

export default function SpaceArchivedBanner({
  theme,
  message,
}: SpaceArchivedBannerProps) {
  const s = createStyles(theme);

  return (
    <View style={s.archivedBanner}>
      <Text style={s.archivedBannerText}>
        {message}
      </Text>
    </View>
  );
}

const createStyles = (theme: typeof Colors.light) => StyleSheet.create({
  archivedBanner: {
    backgroundColor: theme.raised,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: '#3a3a00',
  },
  archivedBannerText: {
    color: theme.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});