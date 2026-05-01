import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useIdentity } from '../_layout';

export default function OnboardingProfile() {
  const router = useRouter();
  const { setProfile } = useIdentity();
  const [displayName, setDisplayName] = useState('');

  return (
    <View style={s.container}>
      <Text style={s.eyebrow}>PROFILE</Text>

      <Text style={s.title}>What should we call you?</Text>

      <Text style={s.subtitle}>
        Add a simple display name now. You can update your full profile later in Settings.
      </Text>

      <TextInput
        style={s.input}
        placeholder="Your name"
        placeholderTextColor="#5C5248"
        value={displayName}
        onChangeText={setDisplayName}
      />

<Pressable
  onPress={() => {
    const cleanName = displayName.trim();

    if (cleanName.length > 0) {
      setProfile({ name: cleanName } as any);
    }

    router.replace('/onboarding-first-mark' as any);
  }}
  style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
>
  <Text style={s.primaryBtnText}>Continue</Text>
</Pressable>

      <Pressable
        onPress={() => router.replace('/onboarding-first-mark' as any)}
        style={({ pressed }) => [s.skipBtn, pressed && s.pressed]}
      >
        <Text style={s.skipText}>Skip for now</Text>
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
    marginBottom: 26,
  },

  input: {
    backgroundColor: '#161A18',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2620',
    padding: 16,
    color: '#F2EDE6',
    fontSize: 15,
    marginBottom: 20,
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

  skipBtn: {
    paddingVertical: 16,
    alignItems: 'center',
  },

  skipText: {
    color: '#5C5248',
    fontSize: 13,
  },

  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});