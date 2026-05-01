import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function OnboardingPurpose() {
  const router = useRouter();
  const { purpose } = useLocalSearchParams<{ purpose?: string }>();

  const isFamily = purpose === 'family';

  return (
    <View style={s.container}>
      <Text style={s.eyebrow}>SETUP STEP 2</Text>

      <Text style={s.title}>
        {isFamily ? 'Who are you preserving this for?' : 'What do you want to remember?'}
      </Text>

      <Text style={s.subtitle}>
        {isFamily
          ? 'bE Marks helps you capture the moments your family will want to look back on someday.'
          : 'bE Marks gives you a quiet place to record growth, reflection, and meaningful moments.'}
      </Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>
          {isFamily ? 'Family memories' : 'Personal journey'}
        </Text>

        <Text style={s.cardDesc}>
          {isFamily
            ? 'First steps, birthdays, school moments, conversations, wins, lessons, and the small things that become big later.'
            : 'Milestones, thoughts, progress, lessons, goals, and moments you do not want to lose.'}
        </Text>
      </View>

      <Pressable
  onPress={() => router.push('/onboarding-create-identity' as any)}
  style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
>
  <Text style={s.primaryBtnText}>Continue</Text>
</Pressable>

      <Pressable
        onPress={() => router.back()}
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
    paddingVertical: 15,
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