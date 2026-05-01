import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { generateAndStoreKeypair } from '../../src/utils/nostr';
import { leaveFamily } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

export default function OnboardingCreateIdentity() {
  const router = useRouter();
  const { setIdentity, setFamily } = useIdentity();
  const [loading, setLoading] = useState(false);

  const handleCreateIdentity = async () => {
    setLoading(true);

    try {
      const { npub, nsec } = await generateAndStoreKeypair();

// A brand-new identity should NOT inherit a previously saved family on this device.
await leaveFamily();
await setFamily(null);

setIdentity(npub, nsec);

router.replace({
  pathname: '/onboarding-key-backup',
  params: { nsec },
} as any);
    } catch {
      Alert.alert('Error', 'Failed to create your bE Marks identity.');
    }

    setLoading(false);
  };

  return (
    <View style={s.container}>
      <Text style={s.eyebrow}>CREATE IDENTITY</Text>

      <Text style={s.title}>Your private key is your identity</Text>

      <Text style={s.subtitle}>
        bE Marks uses a secure Nostr identity so your Marks can belong to you.
        {'\n\n'}
        We’ll create it now and store it safely on this device.
      </Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>What happens next?</Text>
        <Text style={s.cardDesc}>
  A new identity will be created for you. Next, we’ll help you back up your private key before making your first Mark.
</Text>
      </View>

      <Pressable
  onPress={loading ? undefined : handleCreateIdentity}
        disabled={loading}
        style={({ pressed }) => [
          s.primaryBtn,
          pressed && s.pressed,
          loading && { opacity: 0.7 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#0D0F0E" />
        ) : (
          <Text style={s.primaryBtnText}>Create my identity</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => router.back()}
        disabled={loading}
        style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
      >
        <Text style={s.backText}>← Back</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0F0E',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },

  eyebrow: {
    color: '#C9973A',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: 14,
  },

  title: {
    color: '#F2EDE6',
    fontSize: 31,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 38,
  },

  subtitle: {
    color: '#A89880',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 30,
  },

  card: {
    backgroundColor: '#161A18',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2A2620',
    padding: 22,
    marginBottom: 22,
  },

  cardTitle: {
    color: '#E8B96A',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },

  cardDesc: {
    color: '#A89880',
    fontSize: 14,
    lineHeight: 21,
  },

  primaryBtn: {
    backgroundColor: '#C9973A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },

  primaryBtnText: {
    color: '#0D0F0E',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  backBtn: {
    paddingVertical: 16,
    alignItems: 'center',
  },

  backText: {
    color: '#5C5248',
    fontSize: 14,
    fontWeight: '600',
  },

  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});