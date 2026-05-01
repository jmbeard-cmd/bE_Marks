import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function OnboardingIntro() {
  const router = useRouter();

  return (
    <View style={s.container}>
      
      {/* TITLE */}
      <Text style={s.title}>Why are you here?</Text>

      {/* SUBTEXT */}
      <Text style={s.subtitle}>
        Marks is about remembering what matters.
        {'\n\n'}
        Before we begin, take a second.
      </Text>

      {/* OPTIONS */}
      <View style={s.options}>
        
        <Pressable
          onPress={() =>
  router.push({
    pathname: '/onboarding-purpose',
    params: { purpose: 'family' },
  } as any)
}
          style={({ pressed }) => [s.option, pressed && s.optionPressed]}
        >
          <Text style={s.optionTitle}>For my family</Text>
          <Text style={s.optionDesc}>
            Capture moments, milestones, and memories that last
          </Text>
        </Pressable>

        <Pressable
onPress={() =>
  router.push({
    pathname: '/onboarding-purpose',
    params: { purpose: 'self' },
  } as any)
}
          style={({ pressed }) => [s.option, pressed && s.optionPressed]}
        >
          <Text style={s.optionTitle}>For myself</Text>
          <Text style={s.optionDesc}>
            Reflect, document, and track my journey
          </Text>
        </Pressable>

      </View>

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

  title: {
    color: '#F2EDE6',
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 40,
    letterSpacing: -0.3,
    textShadowColor: 'rgba(201,151,58,0.18)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  subtitle: {
    color: '#A89880',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 38,
    lineHeight: 23,
  },

  options: {
    gap: 18,
  },

  option: {
    backgroundColor: '#161A18',
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: '#2A2620',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },

  optionPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },

  optionTitle: {
    color: '#E8B96A',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },

  optionDesc: {
    color: '#A89880',
    fontSize: 14,
    lineHeight: 21,
  },
});