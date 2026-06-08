import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clearIdentity as clearStoredIdentity } from '../src/utils/nostr';
import { useIdentity } from './_layout';

export default function IdentityKeysScreen() {
  const {
    npub,
    useAmber,
    clearIdentity: clearIdentityContext,
    theme,
  } = useIdentity();

  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : 'No public key';

  const copyNpub = async () => {
    if (!npub) return;

    await Clipboard.setStringAsync(npub);
    Alert.alert('Copied', 'Your public key has been copied. This is safe to share.');
  };

  const showPrivateKey = () => {
    if (useAmber) {
      Alert.alert(
        'External signer',
        'This identity is using Amber. Your private key is managed by your signer, not stored in bE Marks.'
      );
      return;
    }

    Alert.alert(
      'Back up private key?',
      'Your private key is the only way to recover this identity. Never share it with anyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Show key',
          onPress: async () => {
            const stored = await SecureStore.getItemAsync('nostr_nsec');

            if (!stored) {
              Alert.alert('No key found', 'No private key was found on this device.');
              return;
            }

            Alert.alert(
              'Private key',
              stored,
              [
                {
                  text: 'Copy',
                  onPress: async () => {
                    await Clipboard.setStringAsync(stored);
                    Alert.alert('Copied', 'Paste this into a password manager and keep it private.');
                  },
                },
                { text: 'Close', style: 'cancel' },
              ]
            );
          },
        },
      ]
    );
  };

  const removeIdentityFromDevice = () => {
    Alert.alert(
      'Remove identity from device?',
      'This removes the private key from this device. Make sure your key is backed up first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await clearStoredIdentity();
            clearIdentityContext();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={s.container}>
        <View style={s.topRow}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={[s.backText, { color: theme.text }]}>Back</Text>
          </TouchableOpacity>

          <Text style={[s.screenTitle, { color: theme.text }]}>Identity & Keys</Text>

          <View style={{ width: 44 }} />
        </View>

        <View style={[s.heroCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[s.heroTitle, { color: theme.text }]}>Your bE Marks identity</Text>
          <Text style={[s.heroText, { color: theme.textMuted }]}>
            {useAmber
              ? 'Amber is connected as your external signer. Your private key is managed outside bE Marks.'
              : 'Your local key signs your Marks, Space actions, messages, and profile updates on this device.'}
          </Text>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>PUBLIC IDENTITY</Text>

          <TouchableOpacity
            style={[s.rowCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={copyNpub}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.rowTitle, { color: theme.text }]}>Public key</Text>
              <Text style={[s.rowHint, { color: theme.textMuted }]}>
                Safe to share. People can use this to find and follow you.
              </Text>
            </View>

            <Text style={[s.rowValue, { color: theme.gold }]} numberOfLines={1}>
              {shortNpub}
            </Text>
          </TouchableOpacity>

          <View style={[s.rowCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowTitle, { color: theme.text }]}>Signer</Text>
              <Text style={[s.rowHint, { color: theme.textMuted }]}>
                {useAmber
                  ? 'External signer connected. Your private key stays in Amber.'
                  : 'Local key active on this device.'}
              </Text>
            </View>

            <Text style={[s.badge, { color: theme.gold, borderColor: theme.border }]}>
              {useAmber ? 'External' : 'Local'}
            </Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>PRIVATE KEY</Text>

          <TouchableOpacity
            style={[s.backupCard, { backgroundColor: theme.surface, borderColor: theme.gold }]}
            onPress={showPrivateKey}
            activeOpacity={0.85}
          >
            <Text style={[s.backupTitle, { color: theme.gold }]}>Back up private key</Text>
            <Text style={[s.backupHint, { color: theme.textMuted }]}>
              Store your key in a password manager or another safe place. Never share it with anyone.
            </Text>
          </TouchableOpacity>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>DEVICE</Text>

          <TouchableOpacity
            style={[s.dangerCard, { backgroundColor: theme.surface, borderColor: '#7a1a1a' }]}
            onPress={removeIdentityFromDevice}
            activeOpacity={0.85}
          >
            <Text style={s.dangerTitle}>Remove from this device</Text>
            <Text style={[s.dangerHint, { color: theme.textMuted }]}>
              This does not delete your Marks, profile, or relay events. It only removes this account key from this phone.
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 48,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backText: {
    fontSize: 16,
    fontWeight: '800',
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  heroCard: {
    borderWidth: 0.5,
    borderRadius: 24,
    padding: 18,
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  heroText: {
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  rowCard: {
    borderWidth: 0.5,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 3,
  },
  rowHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  rowValue: {
    maxWidth: '44%',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  badge: {
    borderWidth: 0.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 12,
    fontWeight: '900',
  },
  backupCard: {
    borderWidth: 0.5,
    borderRadius: 18,
    padding: 14,
  },
  backupTitle: {
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 5,
  },
  backupHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  dangerCard: {
    borderWidth: 0.5,
    borderRadius: 18,
    padding: 14,
  },
  dangerTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#b33',
    marginBottom: 5,
  },
  dangerHint: {
    fontSize: 12,
    lineHeight: 18,
  },
});