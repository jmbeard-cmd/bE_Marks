import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
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
import { compressImageForUpload } from '../src/utils/media-compression';
import { publishProfile, publishProfileWithAmber } from '../src/utils/nostr';
import { uploadToR2 } from '../src/utils/r2';
import { useIdentity } from './_layout';

export default function ProfileScreen() {
  const {
    npub,
    nsec,
    useAmber,
    profile,
    setProfile,
    relays,
    theme,
  } = useIdentity();

  const [editingProfile, setEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editAbout, setEditAbout] = useState('');
  const [editPicture, setEditPicture] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const displayName = profile?.display_name || profile?.name || null;
  const avatarUri = profile?.picture || null;
  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : 'No public key';

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
      Alert.alert('Permission needed', 'Allow photo access to update your profile.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    setUploadingPhoto(true);

    try {
      const compressionResult = await compressImageForUpload({
        uri: result.assets[0].uri,
      });

      const url = await uploadToR2(compressionResult.uri, 'photo');

      if (url) {
        setEditPicture(url);
        Alert.alert('Photo ready', 'Tap Publish to save your profile.');
      } else {
        Alert.alert('Upload failed', 'Could not upload photo. Check your connection.');
      }
    } catch (error) {
      console.warn('[Profile Photo] library upload failed:', error);
      Alert.alert('Upload failed', 'Could not upload photo. Check your connection.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const takeProfilePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to update your profile.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    setUploadingPhoto(true);

    try {
      const compressionResult = await compressImageForUpload({
        uri: result.assets[0].uri,
      });

      const url = await uploadToR2(compressionResult.uri, 'photo');

      if (url) {
        setEditPicture(url);
        Alert.alert('Photo ready', 'Tap Publish to save your profile.');
      } else {
        Alert.alert('Upload failed', 'Could not upload photo. Check your connection.');
      }
    } catch (error) {
      console.warn('[Profile Photo] camera upload failed:', error);
      Alert.alert('Upload failed', 'Could not upload photo. Check your connection.');
    } finally {
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
    if (!nsec && !useAmber) {
      Alert.alert('No key', 'Cannot publish without a private key or Amber signer.');
      return;
    }

    if (useAmber && !npub) {
      Alert.alert('No public key', 'Amber is connected, but no public key was found.');
      return;
    }

    setSavingProfile(true);

    const updated = {
      name: editName.trim(),
      display_name: editDisplayName.trim(),
      about: editAbout.trim(),
      picture: editPicture.trim(),
    };

    try {
      const result = useAmber && npub
        ? await publishProfileWithAmber(updated, npub, relays)
        : await publishProfile(updated, nsec!, relays);

      if (result.success) {
        setProfile(updated);
        setEditingProfile(false);
        Alert.alert('Profile updated', 'Published to your relays.');
      } else {
        Alert.alert('Error', result.error || 'Could not publish profile.');
      }
    } catch (error) {
      console.warn('[Profile] publish failed:', error);
      Alert.alert('Error', 'Could not publish profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const copyNpub = async () => {
    if (!npub) return;

    await Clipboard.setStringAsync(npub);
    Alert.alert('Copied', 'Your public key has been copied.');
  };

  const shareProfile = async () => {
    if (!npub) return;

    await Share.share({
      message: `My bE Marks profile:\n\n${displayName || 'Profile'}\n${npub}`,
      title: 'bE Marks Profile',
    });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <View style={s.topRow}>
            <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={[s.backText, { color: theme.text }]}>Back</Text>
            </TouchableOpacity>

            <Text style={[s.screenTitle, { color: theme.text }]}>Profile</Text>

            <TouchableOpacity onPress={shareProfile} activeOpacity={0.85}>
              <Text style={[s.actionText, { color: theme.gold }]}>Share</Text>
            </TouchableOpacity>
          </View>

          <View style={[s.profileHero, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TouchableOpacity
              onPress={editingProfile ? handlePickPhoto : startEditProfile}
              disabled={uploadingPhoto}
              activeOpacity={0.86}
            >
              {uploadingPhoto ? (
                <View style={[s.heroAvatarPlaceholder, { backgroundColor: theme.raised }]}>
                  <ActivityIndicator color={theme.gold} />
                </View>
              ) : (editingProfile ? editPicture : avatarUri) ? (
                <Image
                  source={{ uri: editingProfile ? editPicture : avatarUri! }}
                  style={s.heroAvatar}
                />
              ) : (
                <View style={[s.heroAvatarPlaceholder, { backgroundColor: theme.raised }]}>
                  <Text style={[s.heroAvatarInitial, { color: theme.gold }]}>
                    {displayName ? displayName[0].toUpperCase() : '?'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={[s.photoHint, { color: theme.textMuted }]}>
              {editingProfile ? 'Tap photo to change' : 'Tap photo or Edit to update'}
            </Text>

            {!editingProfile ? (
              <>
                <Text style={[s.heroName, { color: theme.text }]}>
                  {displayName || 'No profile name yet'}
                </Text>

                {profile?.about ? (
                  <Text style={[s.heroBio, { color: theme.textMuted }]}>
                    {profile.about}
                  </Text>
                ) : (
                  <Text style={[s.heroBio, { color: theme.textMuted }]}>
                    Add a short bio so people know who they are making Marks with.
                  </Text>
                )}

                <TouchableOpacity
                  style={[s.primaryButton, { backgroundColor: theme.gold }]}
                  onPress={startEditProfile}
                  activeOpacity={0.86}
                >
                  <Text style={[s.primaryButtonText, { color: theme.bg }]}>
                    Edit Profile
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={[s.compactInput, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }]}
                  value={editDisplayName}
                  onChangeText={setEditDisplayName}
                  placeholder="Display name"
                  placeholderTextColor={theme.textMuted}
                />

                <TextInput
                  style={[s.compactInput, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="username"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="none"
                />

                <TextInput
                  style={[
                    s.compactInput,
                    s.compactBioInput,
                    { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text },
                  ]}
                  value={editAbout}
                  onChangeText={setEditAbout}
                  placeholder="Short bio"
                  placeholderTextColor={theme.textMuted}
                  multiline
                  textAlignVertical="top"
                />

                <View style={s.inputActions}>
                  <TouchableOpacity
                    style={[s.cancelBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    onPress={() => setEditingProfile(false)}
                    disabled={savingProfile || uploadingPhoto}
                  >
                    <Text style={[s.cancelText, { color: theme.textMuted }]}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.confirmBtn, { backgroundColor: theme.gold }]}
                    onPress={saveProfileEdits}
                    disabled={savingProfile || uploadingPhoto}
                  >
                    {savingProfile ? (
                      <ActivityIndicator color={theme.bg} />
                    ) : (
                      <Text style={[s.confirmText, { color: theme.bg }]}>Publish</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          <View style={s.section}>
            <Text style={[s.sectionLabel, { color: theme.textMuted }]}>IDENTITY</Text>

            <TouchableOpacity
              style={[s.row, { borderBottomColor: theme.border }]}
              onPress={copyNpub}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1, paddingRight: 14 }}>
                <Text style={[s.rowLabel, { color: theme.textSecondary }]}>Public key</Text>
                <Text style={[s.rowHint, { color: theme.textMuted }]}>
                  Your public Nostr identity. Safe to share.
                </Text>
              </View>

              <Text style={[s.rowValue, { color: theme.gold }]} numberOfLines={1}>
                {shortNpub}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 48,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backText: {
    fontSize: 16,
    fontWeight: '800',
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '800',
  },
  profileHero: {
    borderWidth: 0.5,
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    marginBottom: 22,
  },
  heroAvatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    marginBottom: 14,
  },
  heroAvatarPlaceholder: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heroAvatarInitial: {
    fontSize: 44,
    fontWeight: '900',
  },
  heroName: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroBio: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 18,
  },
  primaryButton: {
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
    photoHint: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: -6,
    marginBottom: 12,
  },
  compactInput: {
    width: '100%',
    borderWidth: 0.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 9,
  },
  compactBioInput: {
    minHeight: 74,
  },
  editBlock: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 0.5,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
  },
  bioInput: {
    minHeight: 90,
  },
  photoPicker: {
    borderWidth: 0.5,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 4,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPickerEmpty: {
    alignItems: 'center',
    gap: 6,
  },
  photoPickerIcon: {
    fontSize: 28,
  },
  photoPickerText: {
    fontSize: 13,
  },
  photoPickerPreview: {
    alignItems: 'center',
    gap: 6,
  },
  photoPickerImg: {
    width: 82,
    height: 82,
    borderRadius: 41,
  },
  photoPickerChange: {
    fontSize: 11,
  },
  inputActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  cancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 0.5,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '800',
  },
  confirmBtn: {
    flex: 2,
    padding: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '900',
  },
  section: {
    marginBottom: 32,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowHint: {
    fontSize: 11,
    marginTop: 3,
  },
  rowValue: {
    fontSize: 12,
    maxWidth: '48%',
    textAlign: 'right',
    fontFamily: 'monospace',
  },
});