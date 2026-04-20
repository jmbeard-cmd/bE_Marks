import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    generateAndStoreKeypair,
    getPublicKeyFromAmber,
    importNsec,
} from '../../src/utils/nostr';
import { useIdentity } from '../_layout';

type Mode = 'choose' | 'import' | 'amber';

export default function IdentityScreen() {
  const { setIdentity, setUseAmber } = useIdentity();
  const [mode, setMode] = useState<Mode>('choose');
  const [nsecInput, setNsecInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { npub, nsec } = await generateAndStoreKeypair();
      setIdentity(npub, nsec);
    } catch {
      Alert.alert('Error', 'Failed to generate keypair.');
    }
    setLoading(false);
  };

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
    const pk = await getPublicKeyFromAmber();
    setUseAmber(true);
    if (!pk) Alert.alert('Amber', 'Opening Amber… Once approved, return to Milestones.');
    setLoading(false);
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {/* Hero header */}
        <View style={s.hero}>
          <Image
            source={require('../../assets/images/bE_logo_transparent.png')}
            style={s.logo}
            resizeMode="contain"
          />
          <Text style={s.appName}>Milestones</Text>
          <Text style={s.tagline}>by beginning End</Text>
        </View>

        {mode === 'choose' && (
          <View style={s.options}>
            <Text style={s.sectionLabel}>SET UP YOUR IDENTITY</Text>
            <OptionCard
              title="New identity"
              description="Generate a fresh Nostr keypair stored securely on this device."
              onPress={handleGenerate}
              loading={loading}
              accent
            />
            <OptionCard
              title="Import key"
              description="Already have a Nostr account? Enter your nsec private key."
              onPress={() => setMode('import')}
            />
            <OptionCard
              title="Amber signer"
              description="Use the Amber app on Android to sign without exposing your nsec."
              onPress={() => setMode('amber')}
            />
            <Text style={s.footer}>Revelation 22:13</Text>
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
            <TouchableOpacity style={s.primaryBtn} onPress={handleImport} disabled={loading}>
              {loading ? <ActivityIndicator color="#111" /> : <Text style={s.primaryBtnText}>Import</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.back} onPress={() => setMode('choose')}>
              <Text style={s.backText}>← Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'amber' && (
          <View style={s.form}>
            <Text style={s.sectionLabel}>AMBER SIGNER (NIP-55)</Text>
            <Text style={s.hint}>
              Amber keeps your private key off this app. Install Amber from GitHub or the Play Store, then tap below.
            </Text>
            <TouchableOpacity style={s.primaryBtn} onPress={handleAmber} disabled={loading}>
              {loading ? <ActivityIndicator color="#111" /> : <Text style={s.primaryBtnText}>Open Amber</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.back} onPress={() => setMode('choose')}>
              <Text style={s.backText}>← Back</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function OptionCard({ title, description, onPress, loading, accent }: {
  title: string; description: string; onPress: () => void; loading?: boolean; accent?: boolean;
}) {
  return (
    <TouchableOpacity style={[s.card, accent && s.cardAccent]} onPress={onPress} disabled={loading}>
      {loading
        ? <ActivityIndicator color={accent ? '#111' : '#c9973a'} />
        : <>
            <Text style={[s.cardTitle, accent && s.cardTitleAccent]}>{title}</Text>
            <Text style={[s.cardDesc, accent && s.cardDescAccent]}>{description}</Text>
          </>
      }
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  container: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  hero: { alignItems: 'center', marginBottom: 44 },
  logo: { width: 90, height: 90, marginBottom: 16 },
  appName: { fontSize: 28, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: '#c9973a', marginTop: 4, letterSpacing: 1, textTransform: 'uppercase' },
  sectionLabel: { fontSize: 11, color: '#555', fontWeight: '600', letterSpacing: 1, marginBottom: 12 },
  options: { gap: 10 },
  card: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 12, padding: 18, backgroundColor: '#1a1a1a' },
  cardAccent: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  cardTitleAccent: { color: '#111' },
  cardDesc: { fontSize: 13, color: '#666', lineHeight: 19 },
  cardDescAccent: { color: '#333' },
  form: { gap: 14 },
  hint: { fontSize: 13, color: '#666', lineHeight: 20 },
  input: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 12, fontSize: 14, color: '#fff', backgroundColor: '#1a1a1a' },
  primaryBtn: { backgroundColor: '#c9973a', borderRadius: 8, padding: 14, alignItems: 'center' },
  primaryBtnText: { color: '#111', fontWeight: '700', fontSize: 15 },
  back: { alignItems: 'center', padding: 8 },
  backText: { color: '#555', fontSize: 14 },
  footer: { fontSize: 12, color: '#333', textAlign: 'center', marginTop: 32, letterSpacing: 1 },
});