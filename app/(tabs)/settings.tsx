import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  clearIdentity,
  DEFAULT_RELAY,
  fetchFamilyMembers,
  fetchRelayList,
  publishFamilyMembership,
  publishProfile,
  publishRelayList
} from '../../src/utils/nostr';
import { uploadToR2 } from '../../src/utils/r2';
import { generateFamilyId } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

export default function SettingsScreen() {
  const { npub, nsec, useAmber, clearIdentity: clearCtx, family, setFamily, profile, setProfile, relays, setRelays } = useIdentity();

  const [showCreateFamily, setShowCreateFamily] = useState(false);
  const [showJoinFamily, setShowJoinFamily] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const [editingProfile, setEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editAbout, setEditAbout] = useState('');
  const [editPicture, setEditPicture] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [editingRelays, setEditingRelays] = useState(false);
  const [newRelay, setNewRelay] = useState('');
  const [localRelays, setLocalRelays] = useState<string[]>([]);
  const [loadingRelays, setLoadingRelays] = useState(false);
  const [savingRelays, setSavingRelays] = useState(false);

  const [showNsec, setShowNsec] = useState(false);
  const [nsecValue, setNsecValue] = useState('');
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

  const displayName = profile?.display_name || profile?.name || null;
  const avatarUri = profile?.picture || null;
  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : 'Amber signer';

  const startEditProfile = () => {
    setEditName(profile?.name || '');
    setEditDisplayName(profile?.display_name || '');
    setEditAbout(profile?.about || '');
    setEditPicture(profile?.picture || '');
    setEditingProfile(true);
  };

  const pickProfilePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access in settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled) {
      setUploadingPhoto(true);
      const url = await uploadToR2(result.assets[0].uri, 'photo');
      if (url) {
        setEditPicture(url);
        Alert.alert('✓ Photo uploaded', 'Tap Publish to save your profile.');
      } else {
        Alert.alert('Upload failed', 'Could not upload photo. Check your connection.');
      }
      setUploadingPhoto(false);
    }
  };

  const takeProfilePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access in settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled) {
      setUploadingPhoto(true);
      const url = await uploadToR2(result.assets[0].uri, 'photo');
      if (url) {
        setEditPicture(url);
        Alert.alert('✓ Photo uploaded', 'Tap Publish to save your profile.');
      } else {
        Alert.alert('Upload failed', 'Could not upload photo. Check your connection.');
      }
      setUploadingPhoto(false);
    }
  };

  const handlePickPhoto = () => {
    Alert.alert('Profile photo', 'Choose a photo', [
      { text: 'Take photo', onPress: takeProfilePhoto },
      { text: 'Choose from library', onPress: pickProfilePhoto },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const saveProfileEdits = async () => {
    if (!nsec) { Alert.alert('No key', 'Cannot publish without a private key.'); return; }
    setSavingProfile(true);
    const updated = {
      name: editName.trim(),
      display_name: editDisplayName.trim(),
      about: editAbout.trim(),
      picture: editPicture.trim(),
    };
    const result = await publishProfile(updated, nsec, relays);
    if (result.success) {
      setProfile(updated);
      setEditingProfile(false);
      Alert.alert('✓ Profile updated', 'Published to your relays.');
    } else {
      Alert.alert('Error', result.error || 'Could not publish profile.');
    }
    setSavingProfile(false);
  };

  const openRelayEditor = async () => {
    setLoadingRelays(true);
    if (npub) {
      const fetched = await fetchRelayList(npub);
      setLocalRelays(fetched);
    } else {
      setLocalRelays(relays);
    }
    setLoadingRelays(false);
    setEditingRelays(true);
  };

  const addRelay = () => {
    const url = newRelay.trim();
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      Alert.alert('Invalid relay', 'Relay URL must start with wss:// or ws://');
      return;
    }
    if (localRelays.includes(url)) { setNewRelay(''); return; }
    setLocalRelays(prev => [...prev, url]);
    setNewRelay('');
  };

  const removeRelay = (url: string) => {
    if (localRelays.length === 1) { Alert.alert('Cannot remove', 'You need at least one relay.'); return; }
    setLocalRelays(prev => prev.filter(r => r !== url));
  };

  const saveRelays = async () => {
    if (!nsec) { Alert.alert('No key', 'Cannot publish without a private key.'); return; }
    setSavingRelays(true);
    const result = await publishRelayList(localRelays, nsec);
    if (result.success) {
      setRelays(localRelays);
      setEditingRelays(false);
      Alert.alert('✓ Relays updated', 'Your relay list has been published.');
    } else {
      Alert.alert('Error', result.error || 'Could not publish relay list.');
    }
    setSavingRelays(false);
  };

  const handleBackupKey = () => {
    Alert.alert(
      'Back up your private key',
      'Your private key (nsec) is the only way to recover your identity. Never share it with anyone. Store it in a password manager or write it down and keep it safe.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Show my key', onPress: async () => {
            const stored = await SecureStore.getItemAsync('nostr_nsec');
            if (stored) { setNsecValue(stored); setShowNsec(true); }
          }
        }
      ]
    );
  };

  const handleShareKey = async () => {
    await Share.share({
      message: `My Nostr private key (nsec) — keep this secret:\n\n${nsecValue}`,
      title: 'bE Milestones — Private Key Backup',
    });
  };

  const handleLogout = () => {
    Alert.alert(
      'Remove identity',
      'This removes your private key from this device. Make sure you have it backed up.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => { await clearIdentity(); clearCtx(); } },
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

  // First, try to find an existing family name from relay
  const existingMembers = await fetchFamilyMembers(code, relays[0] || DEFAULT_RELAY);
  const existingFamilyName =
    existingMembers.find(m => m.familyName && m.familyName.trim())?.familyName?.trim() || 'Family';

  const joined = {
    id: code,
    name: existingFamilyName,
    createdAt: Math.floor(Date.now() / 1000),
    role: 'member' as const,
  };

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

  await setFamily(joined);
  setJoinCode('');
  setShowJoinFamily(false);

  Alert.alert(
    'Joined!',
    `You've joined ${joined.name}. Your membership was published to Nostr.`
  );
};

  const handleLeaveFamily = () => {
    Alert.alert('Leave family', 'You will no longer see shared family milestones.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => setFamily(null) },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

          <View style={s.header}>
            <Image source={require('../../assets/images/bE_logo_transparent.png')} style={s.logo} resizeMode="contain" />
            <View>
              <Text style={s.appName}>Milestones</Text>
              <Text style={s.tagline}>by beginning End</Text>
            </View>
          </View>

          {/* ── IDENTITY ── */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>IDENTITY</Text>

            <View style={s.profileCard}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.avatar} />
              ) : (
                <View style={s.avatarPlaceholder}>
                  <Text style={s.avatarInitial}>{displayName ? displayName[0].toUpperCase() : '?'}</Text>
                </View>
              )}
              <View style={s.profileInfo}>
                <Text style={s.profileName}>{displayName || 'No profile found'}</Text>
                <Text style={s.profileNpub} numberOfLines={1}>{shortNpub}</Text>
              </View>
              <TouchableOpacity onPress={startEditProfile} style={s.editProfileBtn}>
                <Text style={s.editProfileBtnText}>Edit</Text>
              </TouchableOpacity>
            </View>

            {editingProfile && (
              <View style={s.editBlock}>

                {/* Profile photo picker */}
                <Text style={s.inputLabel}>PROFILE PHOTO</Text>
                <TouchableOpacity style={s.photoPicker} onPress={handlePickPhoto} disabled={uploadingPhoto}>
                  {uploadingPhoto ? (
                    <ActivityIndicator color="#c9973a" />
                  ) : editPicture ? (
                    <View style={s.photoPickerPreview}>
                      <Image source={{ uri: editPicture }} style={s.photoPickerImg} />
                      <Text style={s.photoPickerChange}>Tap to change</Text>
                    </View>
                  ) : (
                    <View style={s.photoPickerEmpty}>
                      <Text style={s.photoPickerIcon}>📷</Text>
                      <Text style={s.photoPickerText}>Add profile photo</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <Text style={[s.inputLabel, { marginTop: 12 }]}>NAME</Text>
                <TextInput style={s.input} value={editName} onChangeText={setEditName} placeholder="username" placeholderTextColor="#444" autoCapitalize="none" />

                <Text style={[s.inputLabel, { marginTop: 12 }]}>DISPLAY NAME</Text>
                <TextInput style={s.input} value={editDisplayName} onChangeText={setEditDisplayName} placeholder="Your full name" placeholderTextColor="#444" />

                <Text style={[s.inputLabel, { marginTop: 12 }]}>BIO</Text>
                <TextInput style={[s.input, { minHeight: 80 }]} value={editAbout} onChangeText={setEditAbout} placeholder="Tell your story..." placeholderTextColor="#444" multiline textAlignVertical="top" />

                <View style={s.inputActions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setEditingProfile(false)}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.confirmBtn} onPress={saveProfileEdits} disabled={savingProfile || uploadingPhoto}>
                    {savingProfile ? <ActivityIndicator color="#111" /> : <Text style={s.confirmText}>Publish</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

<View style={s.row}>
  <Text style={s.rowLabel}>Public key (npub)</Text>
  <TouchableOpacity onPress={async () => {
    if (npub) {
      await Clipboard.setStringAsync(npub);
      Alert.alert('Copied', 'Your public key has been copied to clipboard. Share it freely — this is your public identity.');
    }
  }}>
    <Text style={s.rowValue} numberOfLines={1}>{shortNpub}</Text>
  </TouchableOpacity>
</View>

            <View style={s.row}>
              <Text style={s.rowLabel}>Signer</Text>
              <Text style={s.rowValue}>{useAmber ? 'Amber (NIP-55)' : 'Built-in'}</Text>
            </View>

            {!useAmber && (
              <View style={s.backupBlock}>
                {!showNsec ? (
                  <TouchableOpacity style={s.backupBtn} onPress={handleBackupKey}>
                    <Text style={s.backupBtnText}>🔑 Back up your private key</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={s.nsecBlock}>
                    <Text style={s.nsecWarning}>⚠️ Never share this with anyone</Text>
                    <Text style={s.nsecValue} selectable>{nsecValue}</Text>
                    <View style={s.nsecActions}>
                      <TouchableOpacity style={s.nsecCopyBtn} onPress={async () => {
                        await Clipboard.setStringAsync(nsecValue);
                        Alert.alert('Copied', 'Key copied to clipboard. Paste it into your password manager.');
                      }}>
                        <Text style={s.nsecCopyText}>Copy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.nsecShareBtn} onPress={handleShareKey}>
                        <Text style={s.nsecShareText}>Share</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.nsecHideBtn} onPress={() => { setShowNsec(false); setNsecValue(''); }}>
                        <Text style={s.nsecHideText}>Hide</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* ── RELAYS ── */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>RELAYS</Text>
              {!editingRelays && (
                <TouchableOpacity onPress={openRelayEditor}>
                  {loadingRelays ? <ActivityIndicator color="#c9973a" size="small" /> : <Text style={s.sectionAction}>Manage</Text>}
                </TouchableOpacity>
              )}
            </View>
            {!editingRelays ? (
              relays.map(r => (
                <View key={r} style={s.row}>
                  <Text style={s.relayUrl} numberOfLines={1}>{r.replace('wss://', '')}</Text>
                  <View style={s.relayDot} />
                </View>
              ))
            ) : (
              <View style={s.editBlock}>
                {localRelays.map(r => (
                  <View key={r} style={s.relayRow}>
                    <Text style={s.relayUrlEdit} numberOfLines={1}>{r}</Text>
                    {r !== DEFAULT_RELAY && (
                      <TouchableOpacity onPress={() => removeRelay(r)}>
                        <Text style={s.relayRemove}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <View style={s.relayAddRow}>
                  <TextInput style={[s.input, { flex: 1 }]} value={newRelay} onChangeText={setNewRelay} placeholder="wss://relay.example.com" placeholderTextColor="#444" autoCapitalize="none" keyboardType="url" />
                  <TouchableOpacity style={s.relayAddBtn} onPress={addRelay}>
                    <Text style={s.relayAddBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.inputActions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setEditingRelays(false)}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.confirmBtn} onPress={saveRelays} disabled={savingRelays}>
                    {savingRelays ? <ActivityIndicator color="#111" /> : <Text style={s.confirmText}>Save relays</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* ── FAMILY ── */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>FAMILY</Text>
            {family ? (
              <>
                <View style={s.familyCard}>
                  <Text style={s.familyName}>{family.name}</Text>
                  <Text style={s.familyCode}>Code: {family.id}</Text>
                  <Text style={s.familyRole}>{family.role === 'admin' ? 'Admin' : 'Member'}</Text>
                </View>
                {family.role === 'admin' && (
                  <TouchableOpacity style={s.shareCodeBtn} onPress={async () => {
                    await Clipboard.setStringAsync(family.id);
                    Alert.alert('Copied!', `Family code ${family.id} copied to clipboard.`);
                  }}>
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
                  <View style={s.editBlock}>
                    <Text style={s.inputLabel}>FAMILY NAME</Text>
                    <TextInput style={s.input} value={familyName} onChangeText={setFamilyName} placeholder="e.g. The Smith Family" placeholderTextColor="#444" autoFocus />
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
                  <View style={s.editBlock}>
                    <Text style={s.inputLabel}>FAMILY CODE</Text>
                    <TextInput style={s.input} value={joinCode} onChangeText={setJoinCode} placeholder="8-character code" placeholderTextColor="#444" autoCapitalize="characters" maxLength={8} autoFocus />
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

          {/* ── APP ── */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>APP</Text>
            <View style={s.row}>
              <Text style={s.rowLabel}>Version</Text>
              <Text style={s.rowValue}>1.2.0</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Built on</Text>
              <Text style={s.rowValue}>Nostr + Bitcoin</Text>
            </View>
          </View>

          <TouchableOpacity style={s.dangerBtn} onPress={handleLogout}>
            <Text style={s.dangerText}>Remove identity from device</Text>
          </TouchableOpacity>


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
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionAction: { fontSize: 13, color: '#c9973a', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  rowLabel: { fontSize: 14, color: '#aaa' },
  rowValue: { fontSize: 13, color: '#555', maxWidth: '55%', textAlign: 'right' },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#2a2a2a', marginBottom: 10 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2a2a2a' },
  avatarPlaceholder: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 22, color: '#c9973a', fontWeight: '700' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, color: '#fff', fontWeight: '600', marginBottom: 3 },
  profileNpub: { fontSize: 11, color: '#444', fontFamily: 'monospace' },
  editProfileBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 0.5, borderColor: '#c9973a' },
  editProfileBtnText: { fontSize: 12, color: '#c9973a', fontWeight: '600' },
  // Photo picker
  photoPicker: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 10, backgroundColor: '#1a1a1a', overflow: 'hidden', marginBottom: 4, height: 100, justifyContent: 'center', alignItems: 'center' },
  photoPickerEmpty: { alignItems: 'center', gap: 6 },
  photoPickerIcon: { fontSize: 28 },
  photoPickerText: { fontSize: 13, color: '#555' },
  photoPickerPreview: { alignItems: 'center', gap: 6 },
  photoPickerImg: { width: 72, height: 72, borderRadius: 36 },
  photoPickerChange: { fontSize: 11, color: '#555' },
  // Relay
  relayUrl: { fontSize: 13, color: '#555', flex: 1 },
  relayDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2a6a2a' },
  relayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  relayUrlEdit: { fontSize: 12, color: '#aaa', flex: 1, fontFamily: 'monospace' },
  relayRemove: { fontSize: 14, color: '#555', paddingLeft: 12 },
  relayAddRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  relayAddBtn: { padding: 12, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#2a2a2a', justifyContent: 'center' },
  relayAddBtnText: { fontSize: 13, color: '#c9973a', fontWeight: '600' },
  editBlock: { marginBottom: 4 },
  inputLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8, marginBottom: 6 },
  input: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 12, fontSize: 15, color: '#fff', backgroundColor: '#1a1a1a' },
  inputActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  cancelText: { fontSize: 14, color: '#555' },
  confirmBtn: { flex: 2, padding: 12, borderRadius: 8, backgroundColor: '#c9973a', alignItems: 'center' },
  confirmText: { fontSize: 14, color: '#111', fontWeight: '700' },
  backupBlock: { marginTop: 10 },
  backupBtn: { padding: 12, borderRadius: 8, borderWidth: 0.5, borderColor: '#3a3a1a', backgroundColor: '#1e1e00', alignItems: 'center' },
  backupBtnText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
  nsecBlock: { padding: 14, borderRadius: 10, borderWidth: 0.5, borderColor: '#3a1a1a', backgroundColor: '#1a0a0a' },
  nsecWarning: { fontSize: 12, color: '#c00', fontWeight: '600', marginBottom: 10 },
  nsecValue: { fontSize: 11, color: '#aaa', fontFamily: 'monospace', lineHeight: 18, marginBottom: 12 },
  nsecActions: { flexDirection: 'row', gap: 8 },
  nsecCopyBtn: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#c9973a', alignItems: 'center' },
  nsecCopyText: { fontSize: 13, color: '#111', fontWeight: '700' },
  nsecShareBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  nsecShareText: { fontSize: 13, color: '#aaa' },
  nsecHideBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 0.5, borderColor: '#3a1a1a', alignItems: 'center' },
  nsecHideText: { fontSize: 13, color: '#555' },
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
  dangerBtn: { borderWidth: 0.5, borderColor: '#3a1a1a', borderRadius: 8, padding: 14, alignItems: 'center', backgroundColor: '#1a0000', marginTop: 12 },
  dangerText: { fontSize: 14, color: '#c00' },
  verse: { fontSize: 12, color: '#333', textAlign: 'center', marginTop: 32, letterSpacing: 1 },
});