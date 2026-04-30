import { Image, StyleSheet, Text, View } from 'react-native';
import { useIdentity } from '../app/_layout';

export default function BEHeader({ title }: { title: string }) {
  const { theme, themeMode } = useIdentity();

  return (
    <View style={[s.header, { borderBottomColor: theme.border }]}>
      <Image
  source={
    themeMode === 'light'
      ? require('../assets/images/bE_logo_dark.png')
      : require('../assets/images/bE_logo_light.png')
  }
  style={s.logo}
  resizeMode="contain"
/>
      <Text style={[s.title, { color: theme.text }]}>{title}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 0.5 },
  logo: { width: 28, height: 28 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
});