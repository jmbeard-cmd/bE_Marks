import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clearIdentity } from '../../src/utils/nostr';
import { generateFamilyId } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

export default function SettingsScreen() {
  const { npub, useAmber, clearIdentity: clearCtx, family, setFamily } = useIdentity();
  const [showCreateFamily, setShowCreateFamily] = useState(false);
  const [showJoinFamily, setShowJoinFamily] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const handleLogout = () => {
    Alert.alert(
      'Remove identity',
      'This removes your private key from this device. Make sure you have it backed up.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => { await clearIdentity(); clearCtx(); },
        },
      ]
    );
  };

  const handleCreateFamily = async () => {
    if (!familyName.trim()) { Alert.alert('Name required', 'Enter a family name.'); return; }
    const newFamily = {
      id: generateFamilyId(),
      name: familyName.trim(),
      createdAt: Math.floor(Date.now() / 1000),
      role: 'admin' as const,
    };
    await setFamily(newFamily);
    setFamilyName('');
    setShowCreateFamily(false);
    Alert.alert(
      'Family created!',
      `Your family code is:\n\n${newFamily.id}\n\nShare this with family members so they can join.`,
      [{ text: 'Got it' }]
    );
  };

  const handleJoinFamily = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 8) { Alert.alert('Invalid code', 'Family codes are 8 characters.'); return; }
    const joined = {
      id: code,
      name: 'Family',
      createdAt: Math.floor(Date.now() / 1000),
      role: 'member' as const,
    };
    await setFamily(joined);
    setJoinCode('');
    setShowJoinFamily(false);
    Alert.alert('Joined!', `You've joined family ${code}. Their milestones will appear on your Family Timeline.`);
  };

  const handleLeaveFamily = () => {
    Alert.alert(
      'Leave family',
      'You will no longer see shared family milestones.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => setFamily(null) },
      ]
    );
  };

  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : 'Amber signer';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {/* Logo header */}
        <View style={s.header}>
          <Image
            source={require('../../assets/images/bE_logo_transparent.png')}
            style={s.logo}
            resizeMode="contain"
          />
          <View>
            <Text style={s.appName}>Milestones</Text>
            <Text style={s.tagline}>by beginning End</Text>
          </View>
        </View>

        {/* Identity */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>IDENTITY</Text>
          <View style={s.row}>
            <Text style={s.rowLabel}>Nostr pubkey</Text>
            <Text style={s.rowValue} numberOfLines={1}>{shortNpub}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Signer</Text>
            <Text style={s.rowValue}>{useAmber ? 'Amber (NIP-55)' : 'Built-in'}</Text>
          </View>
        </View>

        {/* Family */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>FAMILY</Text>

          {family ? (
            <>
              <View style={s.familyCard}>
                <View>
                  <Text style={s.familyName}>{family.name}</Text>
                  <Text style={s.familyCode}>Code: {family.id}</Text>
                  <Text style={s.familyRole}>{family.role === 'admin' ? 'Admin' : 'Member'}</Text>
                </View>
              </View>
              {family.role === 'admin' && (
                <TouchableOpacity
                  style={s.shareCodeBtn}
   onPress={async () => {
  await Clipboard.setStringAsync(family.id);
  Alert.alert('Copied!', `Family code ${family.id} copied to clipboard. Share it with your family members.`);
}}
                >
                  <Text style={s.shareCodeText}>Share family code</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.leaveBtn} onPress={handleLeaveFamily}>
                <Text style={s.leaveText}>Leave family</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {!showCreateFamily && !showJoinFamily && (
                <View style={s.familyOptions}>
                  <TouchableOpacity style={s.familyBtn} onPress={() => setShowCreateFamily(true)}>
                    <Text style={s.familyBtnIcon}>👨‍👩‍👧‍👦</Text>
                    <Text style={s.familyBtnText}>Create a family</Text>
                    <Text style={s.familyBtnHint}>Start a shared timeline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.familyBtn} onPress={() => setShowJoinFamily(true)}>
                    <Text style={s.familyBtnIcon}>🔗</Text>
                    <Text style={s.familyBtnText}>Join a family</Text>
                    <Text style={s.familyBtnHint}>Enter an invite code</Text>
                  </TouchableOpacity>
                </View>
              )}

              {showCreateFamily && (
                <View style={s.inputBlock}>
                  <Text style={s.inputLabel}>FAMILY NAME</Text>
                  <TextInput
                    style={s.input}
                    value={familyName}
                    onChangeText={setFamilyName}
                    placeholder="e.g. The Smith Family"
                    placeholderTextColor="#444"
                    autoFocus
                  />
                  <View style={s.inputActions}>
                    <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowCreateFamily(false); setFamilyName(''); }}>
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.confirmBtn} onPress={handleCreateFamily}>
                      <Text style={s.confirmText}>Create</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {showJoinFamily && (
                <View style={s.inputBlock}>
                  <Text style={s.inputLabel}>FAMILY CODE</Text>
                  <TextInput
                    style={s.input}
                    value={joinCode}
                    onChangeText={setJoinCode}
                    placeholder="8-character code"
                    placeholderTextColor="#444"
                    autoCapitalize="characters"
                    maxLength={8}
                    autoFocus
                  />
                  <View style={s.inputActions}>
                    <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowJoinFamily(false); setJoinCode(''); }}>
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.confirmBtn} onPress={handleJoinFamily}>
                      <Text style={s.confirmText}>Join</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          )}
        </View>

        {/* Relay */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>RELAY</Text>
          <View style={s.row}>
            <Text style={s.rowLabel}>Default relay</Text>
            <Text style={s.rowValue}>relay.beginningend.com</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Protocol</Text>
            <Text style={s.rowValue}>Nostr / strfry</Text>
          </View>
        </View>

        {/* App */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>APP</Text>
          <View style={s.row}>
            <Text style={s.rowLabel}>Version</Text>
            <Text style={s.rowValue}>1.0.0</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Built on</Text>
            <Text style={s.rowValue}>Nostr + Bitcoin</Text>
          </View>
        </View>

        <TouchableOpacity style={s.dangerBtn} onPress={handleLogout}>
          <Text style={s.dangerText}>Remove identity from device</Text>
        </TouchableOpacity>

        <Text style={s.verse}>Revelation 22:13</Text>

      </ScrollView>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  container: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 36, paddingBottom: 24, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  logo: { width: 52, height: 52 },
  appName: { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  tagline: { fontSize: 11, color: '#c9973a', marginTop: 2, letterSpacing: 1, textTransform: 'uppercase' },
  section: { marginBottom: 28 },
  sectionLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 1, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  rowLabel: { fontSize: 14, color: '#aaa' },
  rowValue: { fontSize: 13, color: '#555', maxWidth: '55%', textAlign: 'right' },
  // Family
  familyOptions: { gap: 10 },
  familyBtn: { padding: 16, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a', gap: 3 },
  familyBtnIcon: { fontSize: 22, marginBottom: 4 },
  familyBtnText: { fontSize: 15, color: '#fff', fontWeight: '600' },
  familyBtnHint: { fontSize: 12, color: '#444' },
  familyCard: { padding: 16, borderRadius: 10, borderWidth: 0.5, borderColor: '#c9973a33', backgroundColor: '#1e1600', marginBottom: 10 },
  familyName: { fontSize: 16, color: '#fff', fontWeight: '600', marginBottom: 4 },
  familyCode: { fontSize: 13, color: '#c9973a', fontFamily: 'monospace' },
  familyRole: { fontSize: 11, color: '#444', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  shareCodeBtn: { padding: 12, borderRadius: 8, borderWidth: 0.5, borderColor: '#c9973a', alignItems: 'center', marginBottom: 8 },
  shareCodeText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
  leaveBtn: { padding: 12, borderRadius: 8, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  leaveText: { fontSize: 14, color: '#555' },
  inputBlock: { gap: 8 },
  inputLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8 },
  input: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 12, fontSize: 15, color: '#fff', backgroundColor: '#1a1a1a' },
  inputActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  cancelText: { fontSize: 14, color: '#555' },
  confirmBtn: { flex: 2, padding: 12, borderRadius: 8, backgroundColor: '#c9973a', alignItems: 'center' },
  confirmText: { fontSize: 14, color: '#111', fontWeight: '700' },
  dangerBtn: { borderWidth: 0.5, borderColor: '#3a1a1a', borderRadius: 8, padding: 14, alignItems: 'center', backgroundColor: '#1a0000', marginTop: 12 },
  dangerText: { fontSize: 14, color: '#c00' },
  verse: { fontSize: 12, color: '#333', textAlign: 'center', marginTop: 32, letterSpacing: 1 },
});