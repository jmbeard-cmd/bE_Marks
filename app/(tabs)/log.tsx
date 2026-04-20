import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AudioRecorder from '../../components/AudioRecorder';
import BEHeader from '../../components/BEHeader';
import VideoRecorder from '../../components/VideoRecorder';
import { signAndPublish } from '../../src/utils/nostr';
import { saveMilestone } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

const PRESET_TAGS = ['Family', 'Faith', 'Career', 'School', 'Travel', 'Health', 'Achievement', 'Personal'];

export default function LogScreen() {
  const { nsec, npub, family } = useIdentity();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [publishToNostr, setPublishToNostr] = useState(true);
  const [shareWithFamily, setShareWithFamily] = useState(false);
  const [audioUri, setAudioUri] = useState<string | undefined>();
  const [videoUri, setVideoUri] = useState<string | undefined>();
  const videoUriRef = useRef<string | undefined>(undefined);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo access in settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow camera access in settings.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: false,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const addTag = (t: string) => {
    const clean = t.trim();
    if (!clean || tags.includes(clean)) return;
    setTags(prev => [...prev, clean]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));

  const handleSave = async () => {
    if (!title.trim() && !note.trim() && !photoUri) {
      Alert.alert('Nothing to save', 'Add a title, note or photo first.');
      return;
    }
    setSaving(true);
    try {
      const fullNote = title.trim() ? `${title.trim()}\n\n${note.trim()}` : note.trim();
      let nostrEventId: string | undefined;
      let published = false;

      if (publishToNostr && nsec) {
        const result = await signAndPublish({ note: fullNote, tags }, nsec);
        if (result.success) {
          nostrEventId = result.eventId;
          published = true;
        } else {
          Alert.alert('Relay warning', `Saved locally. Relay: ${result.error}`);
        }
      }

      await saveMilestone({
        note: fullNote,
        tags,
        photoUri,
        audioUri,
        videoUri: videoUriRef.current,
        nostrEventId,
        publishedToRelay: published,
        familyId: shareWithFamily && family ? family.id : undefined,
        authorNpub: npub ?? undefined,
      });

      setTitle('');
      setNote('');
      setTags([]);
      setPhotoUri(undefined);
      setAudioUri(undefined);
      setVideoUri(undefined);
      videoUriRef.current = undefined;
      setTagInput('');
      Alert.alert('✓ Saved', published ? 'Published to your relay.' : 'Saved locally.', [
  { text: 'OK', onPress: () => router.replace('/(tabs)/timeline') }
]);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        <BEHeader title="New milestone" />

        {/* Photo */}
        {photoUri ? (
          <View style={s.photoPreview}>
            <Image source={{ uri: photoUri }} style={s.photo} resizeMode="cover" />
            <View style={s.photoActions}>
              <TouchableOpacity style={s.photoActionBtn} onPress={takePhoto}>
                <Text style={s.photoActionText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.photoActionBtn} onPress={pickPhoto}>
                <Text style={s.photoActionText}>Change</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.photoActionBtn} onPress={() => setPhotoUri(undefined)}>
                <Text style={[s.photoActionText, { color: '#c00' }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={s.photoRow}>
            <TouchableOpacity style={s.photoBtn} onPress={takePhoto}>
              <Text style={s.photoBtnIcon}>📷</Text>
              <Text style={s.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.photoBtn} onPress={pickPhoto}>
              <Text style={s.photoBtnIcon}>🖼️</Text>
              <Text style={s.photoBtnText}>Library</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Title */}
        <View style={s.field}>
          <Text style={s.label}>TITLE</Text>
          <TextInput
            style={s.titleInput}
            placeholder="Name this milestone..."
            placeholderTextColor="#444"
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />
        </View>

        {/* Note */}
        <View style={s.field}>
          <Text style={s.label}>NOTE</Text>
          <TextInput
            style={s.textarea}
            placeholder="What happened? How did it feel?"
            placeholderTextColor="#444"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Voice note */}
        <View style={s.field}>
          <Text style={s.label}>VOICE NOTE</Text>
          <AudioRecorder
            onRecordingComplete={(uri) => setAudioUri(uri || undefined)}
            existingUri={audioUri}
          />
        </View>

        {/* Video */}
        <View style={s.field}>
          <Text style={s.label}>VIDEO CLIP</Text>
          <VideoRecorder
            onVideoComplete={(uri) => {
              const value = uri || undefined;
              setVideoUri(value);
              videoUriRef.current = value;
            }}
            existingUri={videoUri}
          />
        </View>

        {/* Tags */}
        <View style={s.field}>
          <Text style={s.label}>TAGS</Text>
          <View style={s.presets}>
            {PRESET_TAGS.map(t => (
              <TouchableOpacity
                key={t}
                style={[s.presetChip, tags.includes(t) && s.presetChipActive]}
                onPress={() => tags.includes(t) ? removeTag(t) : addTag(t)}
              >
                <Text style={[s.presetText, tags.includes(t) && s.presetTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={s.tagInput}
            placeholder="Custom tag..."
            placeholderTextColor="#444"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={() => addTag(tagInput)}
            returnKeyType="done"
            autoCapitalize="words"
          />
          {tags.length > 0 && (
            <View style={s.selectedTags}>
              {tags.map(t => (
                <TouchableOpacity key={t} style={s.tagChip} onPress={() => removeTag(t)}>
                  <Text style={s.tagChipText}>{t} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Relay toggle */}
        <View style={s.relayRow}>
          <View>
            <Text style={s.relayLabel}>Publish to relay</Text>
            <Text style={s.relayHint}>relay.beginningend.com</Text>
          </View>
          <TouchableOpacity
            style={[s.toggle, publishToNostr && s.toggleOn]}
            onPress={() => setPublishToNostr(v => !v)}
          >
            <View style={[s.toggleThumb, publishToNostr && s.toggleThumbOn]} />
          </TouchableOpacity>
        </View>
        
        {family && (
          <View style={s.relayRow}>
            <View>
              <Text style={s.relayLabel}>Share with family</Text>
              <Text style={s.relayHint}>{family.name}</Text>
            </View>
            <TouchableOpacity
              style={[s.toggle, shareWithFamily && s.toggleOn]}
              onPress={() => setShareWithFamily(v => !v)}
            >
              <View style={[s.toggleThumb, shareWithFamily && s.toggleThumbOn]} />
            </TouchableOpacity>
          </View>
        )}

        {/* Save */}
        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
          {saving
            ? <ActivityIndicator color="#111" />
            : <Text style={s.saveBtnText}>Save milestone</Text>}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  container: { padding: 20, paddingBottom: 48 },
  screenTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 20, letterSpacing: -0.4 },
  photoRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  photoBtn: { flex: 1, height: 90, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoBtnIcon: { fontSize: 24 },
  photoBtnText: { fontSize: 13, color: '#888', fontWeight: '500' },
  photoPreview: { marginBottom: 22, borderRadius: 10, overflow: 'hidden', borderWidth: 0.5, borderColor: '#2a2a2a' },
  photo: { width: '100%', height: 220 },
  photoActions: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingVertical: 10, backgroundColor: '#1a1a1a' },
  photoActionBtn: { padding: 4 },
  photoActionText: { fontSize: 13, color: '#888' },
  field: { marginBottom: 22 },
  label: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.6, marginBottom: 8 },
  titleInput: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 12, fontSize: 16, color: '#fff', backgroundColor: '#1a1a1a', fontWeight: '500' },
  textarea: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 12, fontSize: 15, color: '#fff', backgroundColor: '#1a1a1a', minHeight: 100, lineHeight: 22 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  presetChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  presetChipActive: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  presetText: { fontSize: 13, color: '#666' },
  presetTextActive: { color: '#111', fontWeight: '600' },
  tagInput: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 10, fontSize: 14, color: '#fff', backgroundColor: '#1a1a1a', marginTop: 4 },
  selectedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#c9973a' },
  tagChipText: { fontSize: 12, color: '#c9973a' },
  relayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, paddingVertical: 12, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#1e1e1e' },
  relayLabel: { fontSize: 14, color: '#aaa', fontWeight: '500' },
  relayHint: { fontSize: 11, color: '#444', marginTop: 2 },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: '#2a2a2a', justifyContent: 'center', padding: 2 },
  toggleOn: { backgroundColor: '#c9973a' },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  saveBtn: { backgroundColor: '#c9973a', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
  saveBtnText: { color: '#111', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});