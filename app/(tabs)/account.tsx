import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AccentPalettes,
  type AccentPaletteKey,
} from '../../src/constants/theme';
import {
  getAccountSafetySettings,
  saveAccountSafetySettings,
  type AccountSafetySettings,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

export default function AccountScreen() {
    const {
    npub,
    profile,
    relays,
    themeMode,
    setThemeMode,
    accentPalette,
    setAccentPalette,
    theme,
  } = useIdentity();

  const [accountSafety, setAccountSafety] = useState<AccountSafetySettings | null>(null);
  const [savingAccountSafety, setSavingAccountSafety] = useState(false);
  useEffect(() => {
    getAccountSafetySettings()
      .then(setAccountSafety)
      .catch(error => {
        console.warn('[Account Safety] failed to load:', error);
      });
  }, []);

  const accentPaletteOptions = Object.entries(AccentPalettes) as [
    AccentPaletteKey,
    typeof AccentPalettes[AccentPaletteKey]
  ][];

  const displayName = profile?.display_name || profile?.name || null;
  const avatarUri = profile?.picture || null;
  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : 'Amber signer';

  const toggleChildUnder13 = () => {
    const nextChildUnder13 = accountSafety?.childUnder13 !== true;

    Alert.alert(
      nextChildUnder13 ? 'Set as child account?' : 'Turn off child account?',
      nextChildUnder13
        ? 'Public posting will be turned off inside group Spaces for this account. Space posting will still work.'
        : 'This account will be allowed to choose public posting again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextChildUnder13 ? 'Set child account' : 'Turn off',
          onPress: async () => {
            setSavingAccountSafety(true);

            try {
              const saved = await saveAccountSafetySettings({
                isChildAccount: nextChildUnder13,
                childUnder13: nextChildUnder13,
                guardianManaged: nextChildUnder13,
                publicPostingAllowed: !nextChildUnder13,
              });

              setAccountSafety(saved);
            } catch (error) {
              console.warn('[Account Safety] failed to save:', error);
              Alert.alert('Could not save', 'Account safety settings were not updated.');
            } finally {
              setSavingAccountSafety(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

          <View style={[s.header, { borderBottomColor: theme.border }]}>
            <Image
              source={
                themeMode === 'light'
                  ? require('../../assets/images/bE_logo_dark.png')
                  : require('../../assets/images/bE_logo_light.png')
              }
              style={s.logo}
              resizeMode="contain"
            />

            <View>
              <Text style={[s.appName, { color: theme.text }]}>Account</Text>
              <Text style={[s.tagline, { color: theme.gold }]}>Profile, identity, relays, and app settings</Text>
            </View>
          </View>

          {/* â”€â”€ ACCOUNT â”€â”€ */}
          <View style={s.section}>
            <Text style={[s.sectionLabel, { color: theme.textMuted }]}>ACCOUNT</Text>

            <View style={[s.profileCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.avatar} />
              ) : (
                <View style={[s.avatarPlaceholder, { backgroundColor: theme.raised }]}>
                  <Text style={[s.avatarInitial, { color: theme.gold }]}>
                    {displayName ? displayName[0].toUpperCase() : '?'}
                  </Text>
                </View>
              )}

              <View style={s.profileInfo}>
                <Text style={[s.profileName, { color: theme.text }]}>
                  {displayName || 'No profile found'}
                </Text>
                <Text style={[s.profileNpub, { color: theme.textMuted }]} numberOfLines={1}>
                  {shortNpub}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => router.push('/profile' as any)}
                style={[s.editProfileBtn, { borderColor: theme.gold }]}
                activeOpacity={0.85}
              >
                <Text style={[s.editProfileBtnText, { color: theme.gold }]}>Open</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[s.row, { borderBottomColor: theme.border }]}
              onPress={() => router.push('/identity-keys' as any)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1, paddingRight: 14 }}>
                <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Identity & Keys</Text>
                <Text style={[s.rowHint, { color: theme.textMuted }]}>
                  Public key, signer status, private-key backup, and device identity.
                </Text>
              </View>

              <Text style={[s.rowValue, { color: theme.gold }]}>Open</Text>
            </TouchableOpacity>

            <View style={[s.row, { borderBottomColor: theme.border }]}>
              <View style={{ flex: 1, paddingRight: 14 }}>
                <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Child account</Text>
                <Text style={[s.rowHint, { color: theme.textMuted }]}>
                  Turns off public posting inside group Spaces for under-13 accounts.
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  s.themeToggle,
                  { borderColor: theme.border, backgroundColor: theme.surface },
                  accountSafety?.childUnder13 === true && {
                    borderColor: theme.gold,
                    backgroundColor: theme.gold,
                  },
                  savingAccountSafety && { opacity: 0.55 },
                ]}
                onPress={toggleChildUnder13}
                disabled={savingAccountSafety}
                activeOpacity={0.85}
              >
                {savingAccountSafety ? (
                  <ActivityIndicator size="small" color={theme.gold} />
                ) : (
                  <Text
                    style={[
                      s.themeToggleText,
                      { color: theme.gold },
                      accountSafety?.childUnder13 === true && { color: theme.bg },
                    ]}
                  >
                    {accountSafety?.childUnder13 === true ? 'On' : 'Off'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* â”€â”€ RELAYS â”€â”€ */}
          <View style={s.section}>
            <Text style={[s.sectionLabel, { color: theme.textMuted }]}>RELAY NETWORK</Text>

            <TouchableOpacity
              style={[s.row, { borderBottomColor: theme.border }]}
              onPress={() => router.push('/relay-network' as any)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1, paddingRight: 14 }}>
                <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Relay Network</Text>
                <Text style={[s.rowHint, { color: theme.textMuted }]}>
                  Manage personal relays for public Marks, profile publishing, and relay-list backups.
                </Text>
              </View>

              <Text style={[s.rowValue, { color: theme.gold }]}>
                {Array.from(new Set(relays)).length} active
              </Text>
            </TouchableOpacity>
          </View>

          {/* â”€â”€ APPEARANCE â”€â”€ */}
          <View style={s.section}>
            <Text style={[s.sectionLabel, { color: theme.textMuted }]}>APPEARANCE</Text>

            <View style={[s.row, { borderBottomColor: theme.border }]}>
              <View>
                <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Theme</Text>
                <Text style={[s.rowHint, { color: theme.textMuted }]}>Switch between dark and light mode</Text>
              </View>

              <TouchableOpacity
                style={[
                  s.themeToggle,
                  { borderColor: theme.border, backgroundColor: theme.surface },
                  themeMode === 'light' && { borderColor: theme.gold, backgroundColor: theme.gold },
                ]}
                onPress={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    s.themeToggleText,
                    { color: theme.gold },
                    themeMode === 'light' && { color: theme.bg },
                  ]}
                >
                  {themeMode === 'dark' ? 'Dark' : 'Light'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[s.paletteBlock, { borderBottomColor: theme.border }]}>
              <View style={s.paletteHeader}>
                <View>
                  <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Accent Color</Text>
                  <Text style={[s.rowHint, { color: theme.textMuted }]}>Choose the appâ€™s highlight color</Text>
                </View>

                <Text style={[s.paletteCurrent, { color: theme.gold }]}>
                  {AccentPalettes[accentPalette]?.label ?? 'Classic Gold'}
                </Text>
              </View>

              <View style={s.paletteGrid}>
                {accentPaletteOptions.map(([key, palette]) => {
                  const selected = accentPalette === key;

                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        s.paletteOption,
                        {
                          borderColor: selected ? palette.gold : theme.border,
                          backgroundColor: theme.surface,
                        },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => setAccentPalette(key)}
                    >
                      <View style={s.paletteSwatches}>
                        <View style={[s.paletteSwatch, { backgroundColor: palette.gold }]} />
                        <View style={[s.paletteSwatch, { backgroundColor: palette.goldLight }]} />
                        <View style={[s.paletteSwatch, { backgroundColor: palette.goldDim }]} />
                      </View>

                      <Text style={[s.paletteName, { color: selected ? palette.gold : theme.textSecondary }]}>
                        {palette.label}
                      </Text>

                      <Text style={[s.paletteStatus, { color: selected ? palette.gold : theme.textMuted }]}>
                        {selected ? 'Selected' : 'Tap to use'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={[s.row, { borderBottomColor: theme.border }]}>
              <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Version</Text>
              <Text style={[s.rowValue, { color: theme.textMuted }]}>{Constants.expoConfig?.version ?? '1.3.0'}</Text>
            </View>
          </View>

        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  container: { padding: 20, paddingBottom: 48, },
  header: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 14,
  marginBottom: 32, paddingBottom: 24, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  logo: { width: 52, height: 52 },
  appName: { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  tagline: { fontSize: 11, marginTop: 2, letterSpacing: 1, textTransform: 'uppercase' },
  section: { marginBottom: 32 },
sectionLabel: {
  fontSize: 11,
  fontWeight: '600',
  letterSpacing: 1,
  marginBottom: 10,
},
rowLabel: {
  fontSize: 14,
},
rowValue: {
  fontSize: 13,
  maxWidth: '55%',
  textAlign: 'right',
},
rowHint: {
  fontSize: 11,
  marginTop: 2,
},
themeToggle: {
  paddingHorizontal: 14,
  paddingVertical: 7,
  borderRadius: 999,
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
  backgroundColor: '#1a1a1a',
},
themeToggleOn: {},
themeToggleText: {
  fontSize: 12,
  fontWeight: '700',
},
themeToggleTextOn: {
  color: '#111',
},
paletteBlock: {
  paddingVertical: 14,
  borderBottomWidth: 0.5,
},
paletteHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  marginBottom: 12,
},
paletteCurrent: {
  fontSize: 12,
  fontWeight: '800',
  maxWidth: '42%',
  textAlign: 'right',
},
paletteGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 10,
},
paletteOption: {
  width: '48%',
  borderWidth: 0.5,
  borderRadius: 14,
  padding: 12,
},
paletteSwatches: {
  flexDirection: 'row',
  gap: 5,
  marginBottom: 9,
},
paletteSwatch: {
  width: 22,
  height: 22,
  borderRadius: 11,
},
paletteName: {
  fontSize: 13,
  fontWeight: '800',
},
paletteStatus: {
  fontSize: 11,
  marginTop: 3,
  fontWeight: '600',
},
sectionHeaderRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10,
},
sectionAction: {
  fontSize: 13,
  fontWeight: '600',
},
row: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingVertical: 14,
  borderBottomWidth: 0.5,
},
inputLabel: {
  fontSize: 11,
  fontWeight: '600',
  letterSpacing: 0.8,
  marginBottom: 6,
},
profileCard: {
  flexDirection: 'row', 
  alignItems: 'center', 
  gap: 14, 
  padding: 14, 
  borderRadius: 12,
  marginBottom: 10 
},
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2a2a2a' },
  avatarPlaceholder: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 22, color: '#c9973a', fontWeight: '700' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, color: '#fff', fontWeight: '600', marginBottom: 3 },
  profileNpub: { fontSize: 11, color: '#444', fontFamily: 'monospace' },
  editProfileBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 0.5, borderColor: '#c9973a' },
  editProfileBtnText: { fontSize: 12, color: '#c9973a', fontWeight: '600' },
});




