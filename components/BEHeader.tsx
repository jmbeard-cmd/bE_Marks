import { Image, StyleSheet, Text, View } from 'react-native';

export default function BEHeader({ title }: { title: string }) {
  return (
    <View style={s.header}>
      <Image
        source={require('../assets/images/bE_logo_transparent.png')}
        style={s.logo}
        resizeMode="contain"
      />
      <Text style={s.title}>{title}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  logo: { width: 28, height: 28 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.4 },
});