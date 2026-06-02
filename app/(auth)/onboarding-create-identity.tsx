import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { generateAndStoreKeypair } from '../../src/utils/nostr';
import {
  clearNewIdentityLocalData,
  leaveFamily,
  saveAccountSafetySettings,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

type AccountSetupType = 'self' | 'child';
type ChildAgeBand = 'under13' | 'older';

export default function OnboardingCreateIdentity() {
  const router = useRouter();
  const { npub, setIdentity, setFamily } = useIdentity();
  const [loading, setLoading] = useState(false);
  const [accountSetupType, setAccountSetupType] = useState<AccountSetupType>('self');
  const [childAgeBand, setChildAgeBand] = useState<ChildAgeBand>('under13');

  const handleCreateIdentity = async () => {
  if (npub) {
    router.replace('/onboarding-key-backup' as any);
    return;
  }

  setLoading(true);

    try {
      const { npub, nsec } = await generateAndStoreKeypair();

// A brand-new identity should NOT inherit any previous local state

// 1. Leave any existing family
await leaveFamily();
await setFamily(null);

// 2. Clear ALL local app data (DMs, Groups, etc.)
await clearNewIdentityLocalData();

// 3. Save account safety defaults for this new identity
const isChildAccount = accountSetupType === 'child';
const isUnder13Child = isChildAccount && childAgeBand === 'under13';

await saveAccountSafetySettings({
  isChildAccount,
  childUnder13: isUnder13Child,
  guardianManaged: isChildAccount,
  publicPostingAllowed: !isUnder13Child,
});

// 4. Set the new identity
setIdentity(npub, nsec);

// 5. Continue onboarding flow
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

            <View style={s.card}>
        <Text style={s.cardTitle}>Who will use this account?</Text>
        <Text style={s.cardDesc}>
          This helps bE Marks set safe defaults before the first Mark is made.
        </Text>

        <View style={s.choiceGroup}>
          <Pressable
            onPress={() => setAccountSetupType('self')}
            style={({ pressed }) => [
              s.choiceBtn,
              accountSetupType === 'self' && s.choiceBtnActive,
              pressed && s.pressed,
            ]}
          >
            <Text style={[s.choiceTitle, accountSetupType === 'self' && s.choiceTitleActive]}>
              Me
            </Text>
            <Text style={s.choiceDesc}>Adult or personal account</Text>
          </Pressable>

          <Pressable
            onPress={() => setAccountSetupType('child')}
            style={({ pressed }) => [
              s.choiceBtn,
              accountSetupType === 'child' && s.choiceBtnActive,
              pressed && s.pressed,
            ]}
          >
            <Text style={[s.choiceTitle, accountSetupType === 'child' && s.choiceTitleActive]}>
              My child / student
            </Text>
            <Text style={s.choiceDesc}>Guardian-managed Space-only defaults</Text>
          </Pressable>
        </View>

        {accountSetupType === 'child' && (
          <View style={s.choiceGroup}>
            <Text style={s.subLabel}>Child age</Text>

            <Pressable
              onPress={() => setChildAgeBand('under13')}
              style={({ pressed }) => [
                s.choiceBtn,
                childAgeBand === 'under13' && s.choiceBtnActive,
                pressed && s.pressed,
              ]}
            >
              <Text style={[s.choiceTitle, childAgeBand === 'under13' && s.choiceTitleActive]}>
                Under 13
              </Text>
              <Text style={s.choiceDesc}>Public posting off. Space posting allowed.</Text>
            </Pressable>

            <Pressable
              onPress={() => setChildAgeBand('older')}
              style={({ pressed }) => [
                s.choiceBtn,
                childAgeBand === 'older' && s.choiceBtnActive,
                pressed && s.pressed,
              ]}
            >
              <Text style={[s.choiceTitle, childAgeBand === 'older' && s.choiceTitleActive]}>
                13 or older
              </Text>
              <Text style={s.choiceDesc}>Guardian-managed, with standard Space defaults.</Text>
            </Pressable>
          </View>
        )}
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
  choiceGroup: {
    gap: 10,
    marginTop: 14,
  },
  choiceBtn: {
    borderWidth: 1,
    borderColor: '#2A2620',
    backgroundColor: '#111412',
    borderRadius: 14,
    padding: 14,
  },
  choiceBtnActive: {
    borderColor: '#C9973A',
    backgroundColor: '#1E1A10',
  },
  choiceTitle: {
    color: '#F2EDE6',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
  },
  choiceTitleActive: {
    color: '#E8B96A',
  },
  choiceDesc: {
    color: '#A89880',
    fontSize: 12,
    lineHeight: 17,
  },
  subLabel: {
    color: '#5C5248',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
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