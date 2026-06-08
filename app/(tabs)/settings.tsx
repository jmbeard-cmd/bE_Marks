import * as Clipboard from 'expo-clipboard';
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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AccentPalettes,
  type AccentPaletteKey,
} from '../../src/constants/theme';
import {
  DEFAULT_RELAY,
  fetchFamilyMembers,
  publishFamilyMembership
} from '../../src/utils/nostr';
import {
  generateFamilyId,
  getAccountSafetySettings,
  saveAccountSafetySettings,
  upsertFamilyMember,
  type AccountSafetySettings,
  type FamilyRelayMode,
} from '../../src/utils/storage';
import { useIdentity } from '../_layout';

export default function SettingsScreen() {
    const {
    npub,
    nsec,
    family,
    setFamily,
    profile,
    relays,
    themeMode,
    setThemeMode,
    accentPalette,
    setAccentPalette,
    theme,
  } = useIdentity();

  const [showCreateFamily, setShowCreateFamily] = useState(false);
  const [showJoinFamily, setShowJoinFamily] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const [editingFamilyRelay, setEditingFamilyRelay] = useState(false);
  const [familyRelayMode, setFamilyRelayMode] = useState<FamilyRelayMode>('default');
  const [familyRelayUrl, setFamilyRelayUrl] = useState('');

  const [accountSafety, setAccountSafety] = useState<AccountSafetySettings | null>(null);
  const [savingAccountSafety, setSavingAccountSafety] = useState(false);
  useEffect(() => {
    getAccountSafetySettings()
      .then(setAccountSafety)
      .catch(error => {
        console.warn('[Account Safety] failed to load:', error);
      });
  }, []);

  useEffect(() => {
  const republishFamilyNameIfNeeded = async () => {
    if (!family) return;
    if (family.role !== 'admin') return;
    if (!npub || !nsec) return;
    if (!family.name?.trim()) return;

    await publishFamilyMembership(
      {
        familyId: family.id,
        familyName: family.name.trim(),
        memberNpub: npub,
        role: 'admin',
        joinedAt: family.createdAt,
      },
      nsec,
      relays
    );
  };

  republishFamilyNameIfNeeded();
}, [family?.id, family?.name, family?.role, npub, nsec]);

  const accentPaletteOptions = Object.entries(AccentPalettes) as [
    AccentPaletteKey,
    typeof AccentPalettes[AccentPaletteKey]
  ][];

  const displayName = profile?.display_name || profile?.name || null;
  const avatarUri = profile?.picture || null;
  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : 'Amber signer';

  const openFamilyRelayEditor = () => {
    if (!family) return;

    setFamilyRelayMode(family.relayMode ?? 'default');
    setFamilyRelayUrl(family.relayUrl ?? '');
    setEditingFamilyRelay(true);
  };

  const saveFamilyRelaySettings = async () => {
    if (!family) return;

    const trimmedUrl = familyRelayUrl.trim();

    if ((familyRelayMode === 'custom' || familyRelayMode === 'both') && !trimmedUrl) {
      Alert.alert('Relay required', 'Enter a custom relay URL for this Family Space.');
      return;
    }

    if (trimmedUrl && !trimmedUrl.startsWith('wss://') && !trimmedUrl.startsWith('ws://')) {
      Alert.alert('Invalid relay', 'Relay URL must start with wss:// or ws://');
      return;
    }

    await setFamily({
      ...family,
      relayMode: familyRelayMode,
      relayUrl: trimmedUrl || undefined,
    });

    setEditingFamilyRelay(false);
    Alert.alert('Saved', 'Family Space sync settings updated.');
  };

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

  const handleCreateFamily = async () => {
  if (!familyName.trim()) {
    Alert.alert('Name required', 'Enter a family name.');
    return;
  }

  if (!npub) {
    Alert.alert('No identity', 'You need a Nostr identity first.');
    return;
  }

  if (!nsec) {
    Alert.alert('No private key', 'Cannot publish family membership without a private key.');
    return;
  }

  const newFamily = {
    id: generateFamilyId(),
    name: familyName.trim(),
    createdAt: Math.floor(Date.now() / 1000),
    role: 'admin' as const,
  };

  const publishResult = await publishFamilyMembership(
    {
      familyId: newFamily.id,
      familyName: newFamily.name,
      memberNpub: npub,
      role: 'admin',
      joinedAt: newFamily.createdAt,
    },
    nsec,
    relays
  );

  if (!publishResult.success) {
    Alert.alert('Could not create family', publishResult.error || 'Membership event failed to publish.');
    return;
  }

  await setFamily(newFamily);
  setFamilyName('');
  setShowCreateFamily(false);

  Alert.alert(
    'Family created!',
    `Your family code is:\n\n${newFamily.id}\n\nShare this with family members so they can join.`
  );
};

const handleJoinFamily = async () => {
  const code = joinCode.trim().toUpperCase();

  if (code.length !== 8) {
    Alert.alert('Invalid code', 'Family codes are 8 characters.');
    return;
  }

  if (!npub) {
    Alert.alert('No identity', 'You need a Nostr identity first.');
    return;
  }

  if (!nsec) {
    Alert.alert('No private key', 'Cannot publish family membership without a private key.');
    return;
  }

  // Fetch existing members from relay
  const existingMembers = await fetchFamilyMembers(code, relays[0] || DEFAULT_RELAY);

  const existingFamilyName =
    existingMembers.find(m => m.familyName && m.familyName.trim())?.familyName?.trim() || 'Family';

  const joined = {
    id: code,
    name: existingFamilyName,
    createdAt: Math.floor(Date.now() / 1000),
    role: 'member' as const,
  };

  // Publish your membership
  const publishResult = await publishFamilyMembership(
    {
      familyId: joined.id,
      familyName: joined.name,
      memberNpub: npub,
      role: 'member',
      joinedAt: joined.createdAt,
    },
    nsec,
    relays
  );

  if (!publishResult.success) {
    Alert.alert('Could not join family', publishResult.error || 'Membership event failed to publish.');
    return;
  }

  // ✅ SAVE ALL EXISTING MEMBERS LOCALLY
  for (const member of existingMembers) {
    if (!member.memberNpub) continue;

    await upsertFamilyMember({
      familyId: joined.id,
      npub: member.memberNpub,
            displayName: member.familyName || 'Member',
      role: member.role === 'admin' ? 'admin' : 'member',
      joinedAt: member.joinedAt,
      status: 'active',
    });
  }

  // ✅ ENSURE YOU ARE INCLUDED (critical)
  await upsertFamilyMember({
    familyId: joined.id,
    npub,
    displayName: profile?.name || 'You',
    role: 'member',
    status: 'active',
  });

  await setFamily(joined);

  setJoinCode('');
  setShowJoinFamily(false);

  Alert.alert(
    'Joined!',
    `You've joined ${joined.name}. Your membership was saved and published.`
  );
};

  const handleLeaveFamily = () => {
    Alert.alert('Leave family', 'You will no longer see this family Space.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => setFamily(null) },
    ]);
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
              <Text style={[s.appName, { color: theme.text }]}>bE Marks</Text>
              <Text style={[s.tagline, { color: theme.gold }]}>Spaces, Marks, Books</Text>
            </View>
          </View>

          {/* ── ACCOUNT ── */}
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

          {/* ── RELAYS ── */}
          <View style={s.section}>
            <Text style={[s.sectionLabel, { color: theme.textMuted }]}>RELAY NETWORK</Text>

            <TouchableOpacity
              style={[
                s.spaceCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
              onPress={() => router.push('/relay-network' as any)}
              activeOpacity={0.85}
            >
              <Text style={[s.spaceCardTitle, { color: theme.text }]}>
                Personal relay setup
              </Text>

              <Text style={[s.spaceCardHint, { color: theme.textMuted }]}>
                Search, select, and save the relays used for public Marks, profile publishing, and your personal feed.
              </Text>

              <View style={[s.spaceCardRow, { borderBottomColor: theme.border }]}>
                <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Active relays</Text>
                <Text style={[s.rowValue, { color: theme.gold }]}>
                  {Array.from(new Set(relays)).length}
                </Text>
              </View>

              <Text style={[s.rowHint, { color: theme.textMuted, marginTop: 10 }]}>
                Space relays are managed inside each Space by admins.
              </Text>
            </TouchableOpacity>
          </View>

                    {/* ── FAMILY ── */}
          <View style={s.section}>
            <Text style={[s.sectionLabel, { color: theme.textMuted }]}>FAMILY SPACE</Text>

            {family ? (
              <>
                <View
  style={[
    s.familyCard,
    { backgroundColor: theme.surface, borderColor: theme.gold + '33' }
  ]}
>
                  <Text style={[s.familyName, { color: theme.text }]}>{family.name}</Text>
                  <Text style={[s.familyCode, { color: theme.gold }]}>Code: {family.id}</Text>
                  <Text style={[s.familyRole, { color: theme.textMuted }]}>{family.role === 'admin' ? 'Admin' : 'Member'}</Text>
                </View>

                <View
  style={[
    s.familyRelayCard,
    { backgroundColor: theme.surface, borderColor: theme.border }
  ]}
>
                  <View style={s.familyRelayHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.familyRelayTitle, { color: theme.text }]}>Family Space Sync</Text>
                      <Text style={[s.familyRelayHint, { color: theme.textMuted }]}>
                        Choose where this Family Space saves and syncs.
                      </Text>
                    </View>

                    {!editingFamilyRelay && (
                      <TouchableOpacity onPress={openFamilyRelayEditor}>
                        <Text style={[s.sectionAction, { color: theme.gold }]}>Manage</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {!editingFamilyRelay ? (
                    <View style={s.familyRelaySummary}>
                      <Text style={[s.familyRelaySummaryLabel, { color: theme.textMuted }]}>Current setting</Text>
                      <Text style={[s.familyRelaySummaryValue, { color: theme.gold }]}>
                        {(family.relayMode ?? 'default') === 'default'
                          ? 'bE Relay'
                          : family.relayMode === 'custom'
                            ? 'Custom Relay'
                            : 'Both'}
                      </Text>

                      <Text style={[s.familyRelayUrlText, { color: theme.textMuted }]} numberOfLines={1}>
                        {(family.relayMode ?? 'default') === 'default'
                          ? DEFAULT_RELAY
                          : family.relayUrl || DEFAULT_RELAY}
                      </Text>
                    </View>
                  ) : (
                    <View style={s.editBlock}>
                      <Text style={[s.inputLabel, { color: theme.textMuted }]}>
  WHERE SHOULD THIS FAMILY SPACE SYNC?
</Text>

<TouchableOpacity
  style={[
    s.familyRelayOption,
    { backgroundColor: theme.surface, borderColor: theme.border },
    familyRelayMode === 'default' && {
      borderColor: theme.gold,
    },
  ]}
  onPress={() => setFamilyRelayMode('default')}
                        activeOpacity={0.85}
                      >
                        <Text style={[s.familyRelayOptionTitle, { color: theme.text }]}>bE Relay</Text>
                        <Text style={[s.familyRelayOptionHint, { color: theme.textMuted }]}>
  Easiest setup. Works automatically.
</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
  style={[
    s.familyRelayOption,
    { backgroundColor: theme.surface, borderColor: theme.border },
    familyRelayMode === 'custom' && {
      borderColor: theme.gold,
    },
  ]}
                        onPress={() => setFamilyRelayMode('custom')}
                        activeOpacity={0.85}
                      >
                        <Text style={[s.familyRelayOptionTitle, { color: theme.text }]}>Custom Relay</Text>
                        <Text style={[s.familyRelayOptionHint, { color: theme.textMuted }]}>
                          Use a private relay URL for this Family Space.
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
  style={[
    s.familyRelayOption,
    { backgroundColor: theme.surface, borderColor: theme.border },
    familyRelayMode === 'both' && {
      borderColor: theme.gold,
    },
  ]}
                        onPress={() => setFamilyRelayMode('both')}
                        activeOpacity={0.85}
                      >
                        <Text style={[s.familyRelayOptionHint, { color: theme.textMuted }]}>
  Save to bE Relay and your custom relay.
</Text>
                      </TouchableOpacity>

                      {(familyRelayMode === 'custom' || familyRelayMode === 'both') && (
                        <>
                          <Text style={[s.inputLabel, { marginTop: 12, color: theme.textMuted }]}>CUSTOM RELAY URL</Text>
                          <TextInput
  style={[s.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
  value={familyRelayUrl}
                            onChangeText={setFamilyRelayUrl}
                            placeholder="wss://relay.example.com"
                            placeholderTextColor={theme.textMuted}
                            autoCapitalize="none"
                            keyboardType="url"
                          />
                        </>
                      )}

                      <View style={s.inputActions}>
                        <TouchableOpacity
                          style={s.cancelBtn}
                          onPress={() => setEditingFamilyRelay(false)}
                        >
                          <Text style={[s.cancelText, { color: theme.textMuted }]}>Cancel</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[s.confirmBtn, { backgroundColor: theme.gold }]} onPress={saveFamilyRelaySettings}>
                          <Text style={[s.confirmText, { color: theme.bg }]}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>

                {family.role === 'admin' && (
                  <TouchableOpacity style={s.shareCodeBtn} onPress={async () => {
                    await Clipboard.setStringAsync(family.id);
                    Alert.alert('Copied!', `Family code ${family.id} copied to clipboard.`);
                  }}>
                    <Text style={s.shareCodeText}>Share family code</Text>
                  </TouchableOpacity>
                )}
<TouchableOpacity
  style={[
    s.leaveBtn,
    {
      backgroundColor: theme.surface,
borderColor: '#7a1a1a',
    },
  ]}
  onPress={handleLeaveFamily}
>
                  <Text style={[s.leaveText, { color: '#b33', fontWeight: '600' }]}>
  Leave family
</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {!showCreateFamily && !showJoinFamily && (
                  <View style={s.familyOptions}>
  <TouchableOpacity
    style={[
      s.familyBtn,
      { backgroundColor: theme.surface, borderColor: theme.border }
    ]}
    onPress={() => setShowCreateFamily(true)}
  >
  <Text style={s.familyBtnIcon}>👨‍👩‍👧‍👦</Text>

<View style={{ flex: 1 }}>
  <Text style={[s.familyBtnText, { color: theme.text }]}>
    Create a family
  </Text>
  <Text style={[s.familyBtnHint, { color: theme.textMuted }]}>
    Start a family Space
  </Text>
</View>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      s.familyBtn,
      { backgroundColor: theme.surface, borderColor: theme.border }
    ]}
    onPress={() => setShowJoinFamily(true)}
  >
   <Text style={s.familyBtnIcon}>🔗</Text>

<View style={{ flex: 1 }}>
  <Text style={[s.familyBtnText, { color: theme.text }]}>
    Join a family
  </Text>
  <Text style={[s.familyBtnHint, { color: theme.textMuted }]}>
    Enter an invite code
  </Text>
</View>
  </TouchableOpacity>
</View>
                )}
                {showCreateFamily && (
                  <View style={s.editBlock}>
                    <Text style={[s.inputLabel, { color: theme.textMuted }]}>FAMILY NAME</Text>
                    <TextInput
                      style={[
                        s.input,
                        {
                          backgroundColor: theme.surface,
                          borderColor: theme.border,
                          color: theme.text,
                        },
                      ]}
                      value={familyName}
                      onChangeText={setFamilyName}
                      placeholder="e.g. The Smith Family"
                      placeholderTextColor={theme.textMuted}
                      autoFocus
                    />
                    <View style={s.inputActions}>
                      <TouchableOpacity style={[s.cancelBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => { setShowCreateFamily(false); setFamilyName(''); }}>
                        <Text style={[s.cancelText, { color: theme.textMuted }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.confirmBtn, { backgroundColor: theme.gold }]} onPress={handleCreateFamily}>
                        <Text style={[s.confirmText, { color: theme.bg }]}>Create</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                {showJoinFamily && (
                  <View style={s.editBlock}>
                    <Text style={[s.inputLabel, { color: theme.textMuted }]}>FAMILY CODE</Text>
                    <TextInput
                      style={[
                        s.input,
                        {
                          backgroundColor: theme.surface,
                          borderColor: theme.border,
                          color: theme.text,
                        },
                      ]}
                      value={joinCode}
                      onChangeText={setJoinCode}
                      placeholder="8-character code"
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="characters"
                      maxLength={8}
                      autoFocus
                    />
                    <View style={s.inputActions}>
                      <TouchableOpacity style={[s.cancelBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => { setShowJoinFamily(false); setJoinCode(''); }}>
                        <Text style={[s.cancelText, { color: theme.textMuted }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.confirmBtn, { backgroundColor: theme.gold }]} onPress={handleJoinFamily}>
                        <Text style={[s.confirmText, { color: theme.bg }]}>Join</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>

          {/* ── APP ── */}
<View style={s.section}>
  <Text style={[s.sectionLabel, { color: theme.textMuted }]}>APP</Text>

  <View style={[s.row, { borderBottomColor: theme.border }]}>
    <View>
      <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Appearance</Text>
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
        <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Accent Palette</Text>
        <Text style={[s.rowHint, { color: theme.textMuted }]}>Choose the app’s highlight color</Text>
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
    <Text style={[s.rowValue, { color: theme.textMuted }]}>1.3.0</Text>
  </View>

  <View style={[s.row, { borderBottomColor: theme.border }]}>
    <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Built on</Text>
    <Text style={[s.rowValue, { color: theme.textMuted }]}>Nostr + Bitcoin</Text>
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
spaceCard: {
  borderWidth: 0.5,
  borderRadius: 14,
  padding: 14,
  marginBottom: 10,
},
spaceCardTitle: {
  fontSize: 18,
  fontWeight: '800',
  marginBottom: 4,
},
spaceCardHint: {
  fontSize: 12,
  lineHeight: 17,
  marginBottom: 8,
},
spaceCardRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingVertical: 12,
  borderBottomWidth: 0.5,
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
  // Photo picker
  photoPicker: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 12, backgroundColor: '#1a1a1a', overflow: 'hidden', marginBottom: 4, height: 100, justifyContent: 'center', alignItems: 'center' },
  photoPickerEmpty: { alignItems: 'center', gap: 6 },
  photoPickerIcon: { fontSize: 28 },
  photoPickerText: { fontSize: 13, color: '#555' },
  photoPickerPreview: { alignItems: 'center', gap: 6 },
  photoPickerImg: { width: 72, height: 72, borderRadius: 36 },
  photoPickerChange: { fontSize: 11, color: '#555' },
  // Relay
  relayUrl: { fontSize: 13, flex: 1 },
  relayDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2a6a2a' },
  relayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  relayUrlEdit: { fontSize: 12, color: '#aaa', flex: 1, fontFamily: 'monospace' },
  relayRemove: { fontSize: 14, color: '#555', paddingLeft: 12 },
  relayAddRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  relayAddBtn: { padding: 12, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#2a2a2a', justifyContent: 'center' },
  relayAddBtnText: { fontSize: 13, color: '#c9973a', fontWeight: '600' },
  editBlock: { marginBottom: 4 },
  relayPickerRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: 12,
  borderBottomWidth: 0.5,
  borderBottomColor: '#1e1e1e',
},
relayPickerName: {
  fontSize: 14,
  color: '#fff',
  fontWeight: '600',
  marginBottom: 2,
},
relayPickerUrl: {
  fontSize: 11,
  fontFamily: 'monospace',
},
relayPickerStatus: {
  fontSize: 12,
  fontWeight: '700',
  marginLeft: 12,
},
relaySearchInput: {
  borderWidth: 0.5,
  borderRadius: 14,
  paddingHorizontal: 13,
  paddingVertical: 11,
  fontSize: 14,
  fontWeight: '700',
  marginBottom: 8,
},
relayDiscoveryEmpty: {
  fontSize: 12,
  lineHeight: 17,
  marginTop: 8,
  marginBottom: 4,
},
putLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8, marginBottom: 6 },
input: {
  borderWidth: 0.5,
  borderRadius: 12,
  padding: 14,
  fontSize: 15,
},
  inputActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
cancelBtn: {
  flex: 1,
  padding: 12,
  borderRadius: 12,
  borderWidth: 0.5,
  alignItems: 'center',
},
cancelText: {
  fontSize: 14,
  fontWeight: '700',
},
confirmBtn: {
  flex: 2,
  padding: 12,
  borderRadius: 12,
  alignItems: 'center',
},
confirmText: {
  fontSize: 14,
  fontWeight: '700',
},
  backupBlock: { marginTop: 10 },
backupBtn: { 
  padding: 12, 
  borderRadius: 12,
  borderWidth: 0.5,
  alignItems: 'center' 
},
  backupBtnText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
  nsecBlock: { padding: 14, borderRadius: 12, borderWidth: 0.5, borderColor: '#3a1a1a', backgroundColor: '#1a0a0a' },
  nsecWarning: { fontSize: 12, color: '#c00', fontWeight: '600', marginBottom: 10 },
  nsecValue: { fontSize: 11, color: '#aaa', fontFamily: 'monospace', lineHeight: 18, marginBottom: 12 },
  nsecActions: { flexDirection: 'row', gap: 8 },
  nsecCopyBtn: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: '#c9973a', alignItems: 'center' },
  nsecCopyText: { fontSize: 13, color: '#111', fontWeight: '700' },
  nsecShareBtn: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  nsecShareText: { fontSize: 13, color: '#aaa' },
  nsecHideBtn: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 0.5, borderColor: '#3a1a1a', alignItems: 'center' },
  nsecHideText: { fontSize: 13, color: '#555' },
  familyOptions: { gap: 10 },
familyBtn: { 
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 12,
  paddingHorizontal: 14,
  borderRadius: 12,
  borderWidth: 0.5,
  gap: 12,
},
  familyBtnIcon: { 
  fontSize: 20,
  width: 28,
  textAlign: 'center',
},
  familyBtnText: { fontSize: 15, color: '#fff', fontWeight: '600' },
  familyBtnHint: { fontSize: 12, color: '#444' },
familyCard: { 
  padding: 16, 
  borderRadius: 12,
  borderWidth: 0.5,
  marginBottom: 10 
},
  familyName: { fontSize: 16, color: '#fff', fontWeight: '600', marginBottom: 4 },
  familyCode: { fontSize: 13, color: '#c9973a', fontFamily: 'monospace' },
familyRole: {
  fontSize: 11,
  marginTop: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
},
  familyRelayCard: {
  padding: 14,
  borderRadius: 12,
  borderWidth: 0.5,
  marginBottom: 10,
},
  familyRelayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  familyRelayTitle: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 3,
  },
  familyRelayHint: {
    fontSize: 12,
    color: '#555',
    lineHeight: 17,
  },
  familyRelaySummary: {
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#242424',
  },
  familyRelaySummaryLabel: {
    fontSize: 11,
    color: '#444',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  familyRelaySummaryValue: {
    fontSize: 14,
    color: '#c9973a',
    fontWeight: '600',
    marginBottom: 4,
  },
  familyRelayUrlText: {
    fontSize: 11,
    color: '#555',
    fontFamily: 'monospace',
  },
familyRelayOption: {
  padding: 12,
  borderRadius: 12,
  borderWidth: 0.5,
  marginBottom: 8,
},
  familyRelayOptionActive: {
    borderColor: '#c9973a',
    backgroundColor: '#1e1600',
  },
  familyRelayOptionTitle: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 3,
  },
  familyRelayOptionHint: {
    fontSize: 12,
    color: '#555',
  },
  shareCodeBtn: { padding: 12, borderRadius: 12, borderWidth: 0.5, borderColor: '#c9973a', alignItems: 'center', marginBottom: 8 },
  shareCodeText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
  leaveBtn: { padding: 12, borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  leaveText: { fontSize: 14, color: '#555' },
  verse: { fontSize: 12, color: '#333', textAlign: 'center', marginTop: 32, letterSpacing: 1 },
});
