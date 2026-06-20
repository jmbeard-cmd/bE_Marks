import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { saveMilestone } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

export default function OnboardingFirstMark() {
  const router = useRouter();
  const { npub } = useIdentity();
  const [text, setText] = useState('');

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
        <Text style={s.eyebrow}>FIRST MARK</Text>

        <Text style={s.title}>
          Capture something that matters
        </Text>

        <Text style={s.subtitle}>
          This is your first Mark.
          {'\n'}
          It could be something small.
          {'\n\n'}
          One day, youâ€™ll be glad you saved it.
        </Text>

        <TextInput
          style={s.input}
          placeholder="Write your first Mark..."
          placeholderTextColor="#5C5248"
          value={text}
          onChangeText={setText}
          multiline
        />
      </View>

      <View>
        <Pressable
          onPress={async () => {
            if (!text.trim()) return;

            await saveMilestone({
              note: text.trim(),
              tags: [],
              publishedToRelay: false,
              authorNpub: npub || undefined,
            });

            router.replace('/(tabs)/groups')
          }}
          style={({ pressed }) => [
            s.primaryBtn,
            pressed && s.pressed,
            !text && { opacity: 0.5 },
          ]}
          disabled={!text}
        >
          <Text style={s.primaryBtnText}>Save Mark</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)/groups')}
          style={({ pressed }) => [s.skip, pressed && s.pressed]}
        >
          <Text style={s.skipText}>Skip for now</Text>
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
    marginBottom: 12,
  },

  title: {
    color: '#F2EDE6',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 36,
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
    padding: 18,
    minHeight: 120,
    color: '#F2EDE6',
    fontSize: 15,
    textAlignVertical: 'top',
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

  skip: {
    marginTop: 14,
    alignItems: 'center',
  },

  skipText: {
    color: '#5C5248',
    fontSize: 13,
  },

  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});

