import { useMemo } from 'react';
import {
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type SpaceDetailLoadingTheme = {
  bg: string;
  textMuted: string;
};

type SpaceDetailLoadingStateProps = {
  theme: SpaceDetailLoadingTheme;
};

export default function SpaceDetailLoadingState({
  theme,
}: SpaceDetailLoadingStateProps) {
  const s = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.loading}>
        <Text style={s.loadingText}>Loading…</Text>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: SpaceDetailLoadingTheme) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg,
  },
  loadingText: {
    color: theme.textMuted,
    fontSize: 15,
  },
});