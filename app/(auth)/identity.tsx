import { useRouter } from 'expo-router';
import { nip19 } from 'nostr-tools';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text, TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getPublicKeyFromAmber,
  importNsec,
} from '../../src/utils/nostr';
import { useIdentity } from '../_layout';

type Mode = 'choose' | 'import' | 'amber';

export default function IdentityScreen() {
  const { setIdentity, setUseAmber } = useIdentity();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('choose');
  const [nsecInput, setNsecInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!nsecInput.startsWith('nsec1')) {
      Alert.alert('Invalid key', 'Enter a valid nsec1… key.');
      return;
    }
    setLoading(true);
    try {
      const { npub, nsec } = await importNsec(nsecInput.trim());
      setIdentity(npub, nsec);
    } catch {
      Alert.alert('Error', 'Could not decode that nsec.');
    }
    setLoading(false);
  };

  const handleAmber = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Android only', 'Amber signer is only available on Android.');
      return;
    }

    setLoading(true);

    try {
      const amberResult = await getPublicKeyFromAmber();

      if (!amberResult?.pubkey) {
        Alert.alert(
          'Amber not connected',
          'Amber opened, but did not return a public key. Approve the request in Amber and try again.'
        );
        return;
      }

      const npub = amberResult.pubkey.startsWith('npub1')
        ? amberResult.pubkey
        : nip19.npubEncode(amberResult.pubkey);

      setUseAmber(true);
      setIdentity(npub, '');

      Alert.alert(
        'Amber connected',
        'Amber is connected for identity and profile actions. For full Space posting without repeated approvals, use a local key or imported nsec.'
      );
    } catch (error) {
      console.warn('[Amber] request failed:', error);
      Alert.alert('Amber failed', 'Could not connect Amber to bE Marks.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
  contentContainerStyle={s.container}
  keyboardShouldPersistTaps="handled"
>
  <View style={s.inner}>

        {/* Hero header */}
        <View style={s.hero}>
          <Image
  source={require('../../assets/images/bE_logo_light.png')}
  style={s.logo}
  resizeMode="contain"
/>
          <Text style={s.appName}>Marks</Text>
          <Text style={s.tagline}>by beginning End</Text>
        </View>

        {mode === 'choose' && (
          <View style={s.options}>
            <Text style={s.sectionLabel}>SET UP YOUR IDENTITY</Text>
<OptionCard
  icon="🔑"
  title="Import saved test key"
  description="Use one of your saved test nsecs. Best for onboarding and reinstall testing."
  onPress={() => setMode('import')}
  accent
/>
<OptionCard
  icon="＋"
  title="Create new identity"
  description="Start a guided setup for your first real bE Marks identity."
  onPress={() => router.push('/onboarding-intro' as any)}
/>
<OptionCard
  icon="🛡️"
  title="Connect external signer"
  description="Use Amber on Android for identity and profile actions. Full Space posting uses a local key or imported nsec."
  onPress={() => setMode('amber')}
/>
          </View>
        )}

        {mode === 'import' && (
          <View style={s.form}>
            <Text style={s.sectionLabel}>YOUR NSEC PRIVATE KEY</Text>
            <TextInput
              style={s.input}
              placeholder="nsec1..."
              placeholderTextColor="#666"
              value={nsecInput}
              onChangeText={setNsecInput}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable style={s.primaryBtn} onPress={handleImport} disabled={loading}>
              {loading ? <ActivityIndicator color="#111" /> : <Text style={s.primaryBtnText}>Import</Text>}
            </Pressable>
            <Pressable style={s.back} onPress={() => setMode('choose')}>
              <Text style={s.backText}>← Back</Text>
            </Pressable>
          </View>
        )}

        {mode === 'amber' && (
          <View style={s.form}>
            <Text style={s.sectionLabel}>EXTERNAL SIGNER (AMBER)</Text>
            <Text style={s.hint}>
              Amber keeps your private key outside bE Marks. Use it to connect your Nostr identity and publish profile updates. Full Space posting works best with a local bE Marks key or imported nsec.
            </Text>
            <Pressable style={s.primaryBtn} onPress={handleAmber} disabled={loading}>
              {loading ? <ActivityIndicator color="#111" /> : <Text style={s.primaryBtnText}>Open Amber</Text>}
            </Pressable>
            <Pressable style={s.back} onPress={() => setMode('choose')}>
              <Text style={s.backText}>← Back</Text>
            </Pressable>
          </View>
        )}

        </View>
</ScrollView>
    </SafeAreaView>
  );
}

function OptionCard({
  icon,
  title,
  description,
  onPress,
  loading,
  accent,
}: {
  icon?: string;
  title: string;
  description: string;
  onPress: () => void;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
<Pressable
  onPress={onPress}
  style={({ pressed }) => [
    s.card,
    accent && s.cardAccent,
    pressed && s.cardPressed,
  ]}
>
  {loading ? (
    <ActivityIndicator />
  ) : (
    <View style={s.cardRow}>
      
      {/* LEFT ICON */}
      {icon && (
        <View style={s.iconCircle}>
          <Text style={s.iconText}>{icon}</Text>
        </View>
      )}

      {/* TEXT CONTENT */}
      <View style={s.cardTextWrap}>
        <Text style={[s.cardTitle, accent && s.cardTitleAccent]}>{title}</Text>
        <Text style={[s.cardDesc, accent && s.cardDescAccent]}>{description}</Text>
      </View>

      {/* RIGHT ARROW */}
      <Text style={s.cardArrow}>›</Text>

    </View>
  )}
</Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  container: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  hero: { alignItems: 'center', marginBottom: 44 },
  logo: { width: 90, height: 90, marginBottom: 16 },
  appName: { fontSize: 46, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: '#c9973a', marginTop: 4, letterSpacing: 1, textTransform: 'uppercase' },
  sectionLabel: { fontSize: 11, color: '#555', fontWeight: '600', letterSpacing: 1, marginBottom: 12 },
  options: { gap: 16 },
card: {
  backgroundColor: '#161A18', // surface
  borderRadius: 18,

  paddingVertical: 18,
  paddingHorizontal: 18,
  marginBottom: 18,

  borderWidth: 1,
  borderColor: '#2A2620',

  shadowColor: '#000',
  shadowOpacity: 0.25,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
},
  cardAccent: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
cardTitle: {
  color: '#F2EDE6',
  fontSize: 17,
  fontWeight: '600',
  letterSpacing: 0.3,
},
  cardTitleAccent: { color: '#111' },
cardDesc: {
  color: '#A89880',
  fontSize: 13,
  marginTop: 6,
  lineHeight: 18,
},
  cardDescAccent: { color: '#333' },
  form: { gap: 16 },
  hint: { fontSize: 13, color: '#666', lineHeight: 20 },
  input: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 12, fontSize: 14, color: '#fff', backgroundColor: '#1a1a1a' },
  primaryBtn: { backgroundColor: '#c9973a', borderRadius: 8, padding: 14, alignItems: 'center' },
  primaryBtnText: { color: '#111', fontWeight: '700', fontSize: 15 },
  back: { alignItems: 'center', padding: 8 },
  backText: { color: '#555', fontSize: 14 },
  footer: { fontSize: 12, color: '#333', textAlign: 'center', marginTop: 32, letterSpacing: 1 },
  inner: {
  width: '100%',
  maxWidth: 520,
  alignSelf: 'center',
},
cardRow: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 4,
},

iconCircle: {
  width: 46,
  height: 46,
  borderRadius: 23,

  backgroundColor: 'rgba(201,151,58,0.12)', // soft gold tint
  borderWidth: 1,
  borderColor: 'rgba(201,151,58,0.35)',

  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 14,

  // subtle glow depth
  shadowColor: '#C9973A',
  shadowOpacity: 0.25,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
},

iconText: {
  fontSize: 20,
  color: '#E8B96A', // gold light
},

cardTextWrap: {
  flex: 1,
  justifyContent: 'center',
},

cardArrow: {
  fontSize: 22,
  color: '#999',
  marginLeft: 10,
},
cardPressed: {
  transform: [{ scale: 0.98 }],
  opacity: 0.9,
},
});