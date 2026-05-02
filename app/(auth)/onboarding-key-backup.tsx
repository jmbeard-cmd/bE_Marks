import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    Alert,
    BackHandler,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

export default function OnboardingKeyBackup() {
  const router = useRouter();
  const { nsec } = useLocalSearchParams<{ nsec?: string }>();

  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Private key backup required',
        'Save or copy your private key before continuing.'
      );

      return true;
    });

    return () => subscription.remove();
  }, []);

  const canContinue = confirmed || copied;

  const handleCopyKey = async () => {
    if (!nsec) {
      Alert.alert('Key unavailable', 'Your private key is not available on this screen.');
      return;
    }

    await Clipboard.setStringAsync(nsec);
    setCopied(true);
    Alert.alert('Copied', 'Your private key was copied. Store it somewhere safe.');
  };

  const handleContinue = () => {
    if (!canContinue) {
      Alert.alert(
        'Private key backup required',
        'Check the box or copy your private key before continuing.'
      );
      return;
    }

    router.replace('/onboarding-profile' as any);
  };

return (
  <KeyboardAvoidingView
    style={s.container}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={80}
  >
    <ScrollView
      contentContainerStyle={s.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View>
        <Text style={s.eyebrow}>BACK UP YOUR KEY</Text>

        <Text style={s.title}>This is the key to your Marks</Text>

        <Text style={s.subtitle}>
          Your private key is how you recover your bE Marks identity.
          {'\n\n'}
          If you lose this, your Marks cannot be recovered.
          {'\n'}
          If someone else gets it, they can access everything.
        </Text>

        <View style={s.keyBox}>
          <Text style={s.keyText}>{nsec || 'Private key unavailable'}</Text>
        </View>

        <Pressable
          onPress={handleCopyKey}
          style={({ pressed }) => [s.copyBtn, pressed && s.pressed]}
        >
          <Text style={s.copyBtnText}>
            {copied ? 'Copied ✓' : 'Copy private key'}
          </Text>
        </Pressable>
      </View>

      <View>
        <Pressable
          onPress={() => setConfirmed(!confirmed)}
          style={({ pressed }) => [s.confirmRow, pressed && s.pressed]}
        >
          <View style={[s.checkbox, confirmed && s.checkboxChecked]}>
            {confirmed && <Text style={s.checkmark}>✓</Text>}
          </View>

          <Text style={s.confirmText}>
            I saved my private key somewhere safe
          </Text>
        </Pressable>

        <Pressable
          onPress={handleContinue}
          disabled={!canContinue}
          style={({ pressed }) => [
            s.primaryBtn,
            pressed && s.pressed,
            !canContinue && { opacity: 0.45 },
          ]}
        >
          <Text style={s.primaryBtnText}>Continue</Text>
        </Pressable>
      </View>
    </ScrollView>
  </KeyboardAvoidingView>
);
}

const s = StyleSheet.create({
 container: {
  flex: 1,
  backgroundColor: '#0D0F0E',
  paddingHorizontal: 24,
},

scrollContent: {
  flexGrow: 1,
  justifyContent: 'space-between',
  paddingTop: 48,
  paddingBottom: 24,
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
    marginBottom: 26,
  },

  keyBox: {
    backgroundColor: '#161A18',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2620',
    padding: 16,
    marginBottom: 12,
  },

  keyText: {
    color: '#E8B96A',
    fontSize: 12,
    lineHeight: 18,
  },

  copyBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C9973A',
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 18,
  },

  copyBtnText: {
    color: '#C9973A',
    fontSize: 14,
    fontWeight: '800',
  },

  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
  },

  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#C9973A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  checkboxChecked: {
    backgroundColor: '#C9973A',
  },

  checkmark: {
    color: '#0D0F0E',
    fontWeight: '900',
  },

  confirmText: {
    color: '#A89880',
    fontSize: 13,
    flex: 1,
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

  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});