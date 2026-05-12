import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useState } from 'react';
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
import AudioRecorder from '../../components/AudioRecorder';
import BEHeader from '../../components/BEHeader';
import { compressMediaForUpload } from '../../src/utils/media-compression';
import { publishFamilyMilestone, signAndPublish } from '../../src/utils/nostr';
import { notifyMarkEvent } from '../../src/utils/push-notifications';
import { uploadMilestoneMedia } from '../../src/utils/r2';
import { getFamilyMembers, saveMilestone } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

const PRESET_TAGS = ['Family', 'Faith', 'Career', 'School', 'Travel', 'Health', 'Achievement', 'Personal'];

export default function LogScreen() {
  const { nsec, npub, family, relays, profile, theme } = useIdentity();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [media, setMedia] = useState<{
  id: string;
  uri: string;
  type: 'image' | 'video';
  thumbnailUri?: string;
}[]>([]);
  const [saving, setSaving] = useState(false);
const [saveStatus, setSaveStatus] = useState('');
const [progress, setProgress] = useState(0);
const [publishToNostr, setPublishToNostr] = useState(true);
  const [shareWithFamily, setShareWithFamily] = useState(false);
  const [audioUri, setAudioUri] = useState<string | undefined>();

  const myDisplayName =
  profile?.display_name ||
  profile?.name ||
  (npub ? `${npub.slice(0, 12)}…` : 'Someone');

  const pickPhoto = async () => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow photo access in settings.');
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.9,
    allowsMultipleSelection: true,
    selectionLimit: 10,
  });

  if (!result.canceled) {
    const newMedia = await Promise.all(
  result.assets.map(async a => {
    const type = (a.type === 'video' ? 'video' : 'image') as 'image' | 'video';
    let thumbnailUri: string | undefined;

    if (type === 'video') {
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(a.uri, {
          time: 1000,
        });
        thumbnailUri = thumb.uri;
      } catch (error) {
        console.warn('[Log Video Preview Thumbnail] Failed:', error);
      }
    }

    return {
      id: `media_${Date.now()}_${Math.random()}`,
      uri: a.uri,
      type,
      thumbnailUri,
    };
  })
);

setMedia(prev => [...prev, ...newMedia]);
  }
};

  const takePhoto = async () => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();

  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow camera access in settings.');
    return;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    videoMaxDuration: 60,
    quality: 0.85,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    allowsEditing: false,
  });

  if (!result.canceled) {
    const asset = result.assets[0];

    const type = (asset.type === 'video' ? 'video' : 'image') as 'image' | 'video';
let thumbnailUri: string | undefined;

if (type === 'video') {
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, {
      time: 1000,
    });
    thumbnailUri = thumb.uri;
  } catch (error) {
    console.warn('[Camera Video Preview Thumbnail] Failed:', error);
  }
}

const mediaItem = {
  id: `media_${Date.now()}_${Math.random()}`,
  uri: asset.uri,
  type,
  thumbnailUri,
};

setMedia(prev => [...prev, mediaItem]);
  }
};

const recordVideo = async () => {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();

  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow camera access in settings.');
    return;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    videoMaxDuration: 60,
    quality: 0.85,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    allowsEditing: false,
  });

  if (!result.canceled) {
    const asset = result.assets[0];

    let thumbnailUri: string | undefined;

try {
  const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, {
    time: 1000,
  });
  thumbnailUri = thumb.uri;
} catch (error) {
  console.warn('[Record Video Preview Thumbnail] Failed:', error);
}

const mediaItem = {
  id: `media_${Date.now()}_${Math.random()}`,
  uri: asset.uri,
  type: 'video' as const,
  thumbnailUri,
};

setMedia(prev => [...prev, mediaItem]);
  }
};

const addTag = (t: string) => {
    const clean = t.trim();
    if (!clean || tags.includes(clean)) return;
    setTags(prev => [...prev, clean]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));

  const handleSave = async () => {
    if (!title.trim() && !note.trim() && media.length === 0 && !audioUri) {
  Alert.alert('Nothing to save', 'Add a title, note, photo, video, or voice note first.');
  return;
}
    setSaving(true);
setProgress(0);
setSaveStatus('Preparing your Mark...');
try {
      const fullNote = title.trim() ? `${title.trim()}\n\n${note.trim()}` : note.trim();

      // ── Step 1: Upload media FIRST so the URL is ready for the Nostr event ──
      setSaveStatus('Uploading media...');
      let completed = 0;
const total = media.length || 1;

const uploadedMedia: {
  id: string;
  uri: string;
  type: 'image' | 'video';
  source: 'r2' | 'local';
  thumbnailUri?: string;
}[] = [];

for (let i = 0; i < media.length; i++) {
  const m = media[i];

  setSaveStatus(
    m.type === 'video'
      ? `Compressing video ${i + 1} of ${media.length}...`
      : `Optimizing photo ${i + 1} of ${media.length}...`
  );

  const compressed = await compressMediaForUpload({
    uri: m.uri,
    type: m.type,
    onStatus: setSaveStatus,
    onProgress: compressionProgress => {
      const baseProgress = Math.floor((i / total) * 40);
      const itemProgress = Math.floor(compressionProgress * (40 / total));
      setProgress(Math.min(40, baseProgress + itemProgress));
    },
  });

  const uploadUri = compressed.uri;

  let thumbnailUri: string | undefined;

  if (m.type === 'video') {
    try {
      setSaveStatus(`Creating video thumbnail ${i + 1} of ${media.length}...`);

      const thumb = await VideoThumbnails.getThumbnailAsync(uploadUri, {
        time: 1000,
      });

      setSaveStatus(`Uploading video thumbnail ${i + 1} of ${media.length}...`);

      const thumbUpload = await uploadMilestoneMedia({
        photoUri: thumb.uri,
      });

      thumbnailUri = thumbUpload.photoUri || thumb.uri;
    } catch (error) {
      console.warn('[Mark Video Thumbnail] Failed:', error);
    }
  }

  setSaveStatus(
    m.type === 'video'
      ? `Uploading compressed video ${i + 1} of ${media.length}...`
      : `Uploading optimized photo ${i + 1} of ${media.length}...`
  );

  const result = await uploadMilestoneMedia({
    photoUri: m.type === 'image' ? uploadUri : undefined,
    videoUri: m.type === 'video' ? uploadUri : undefined,
  });

  const uploadedUri =
    m.type === 'image'
      ? result.photoUri || m.uri
      : result.videoUri || m.uri;

  completed++;
  setProgress(Math.floor((completed / total) * 60));

  uploadedMedia.push({
    id: m.id,
    uri: uploadedUri,
    type: m.type,
    source: uploadedUri.startsWith('http') ? 'r2' as const : 'local' as const,
    thumbnailUri,
  });
}

const uploadedPhoto = uploadedMedia.find(m => m.type === 'image')?.uri;
const uploadedVideo = uploadedMedia.find(m => m.type === 'video')?.uri;

let uploadedAudio = audioUri;

if (audioUri) {
  setSaveStatus('Uploading voice note...');

  const audioUpload = await uploadMilestoneMedia({
    audioUri,
  });

  uploadedAudio = audioUpload.audioUri || audioUri;

  if (audioUpload.uploadErrors.includes('audio')) {
    console.warn('[Mark Audio Upload] Failed; saved local audio only');
  }
}

      // Warn user immediately if any media failed — don't silently drop it
      

      // ── Step 2: Publish to Nostr relay with all media URLs ──
      let nostrEventId: string | undefined;
      let published = false;

      setSaveStatus('Publishing to relay...');
      setProgress(70);
      if (publishToNostr && nsec) {
        const result = await signAndPublish({
          note: fullNote,
          tags,
          imageUrl: uploadedPhoto,
          videoUrl: uploadedVideo,
          audioUrl: uploadedAudio,
        }, nsec);
        if (result.success) {
          nostrEventId = result.eventId;
          published = true;
        } else {
          Alert.alert('Relay warning', `Saved locally. Relay: ${result.error}`);
        }
      }

      // ── Step 4: Save to local storage ──
      setSaveStatus('Saving Mark...');
      setProgress(85);
      const savedMilestone = await saveMilestone({
        note: fullNote,   // store clean note without the URL appended
        tags,
        photoUri: uploadedPhoto,
        media:  uploadedMedia,
        audioUri: uploadedAudio,
        videoUri: uploadedVideo,
        nostrEventId,
        publishedToRelay: published,
        familyId: shareWithFamily && family ? family.id : undefined,
        authorNpub: npub ?? undefined,
        authorName: myDisplayName,
      });

      // ── Step 5: Publish to family relay if sharing ──
      setSaveStatus('Sharing with family...');
      setProgress(95);
      if (shareWithFamily && family && nsec && npub) {
        publishFamilyMilestone(
          {
            id: savedMilestone.id,
            note: fullNote,
            tags,
            photoUri: uploadedPhoto,
            videoUri: uploadedVideo,
            audioUri: uploadedAudio,
            media: uploadedMedia,
            createdAt: savedMilestone.createdAt,
            familyId: family.id,
            authorNpub: npub,
            authorName: myDisplayName,
          },
          nsec,
          relays
        ).then(result => {
          if (!result.success) console.warn('[Family Sync] Failed to publish:', result.error);
          else console.log('[Family Sync] Published:', result.eventId);
        });

        getFamilyMembers(family.id)
          .then(familyMembers => {
            const recipientNpubs = familyMembers
              .map(member => member.npub)
              .filter(memberNpub => memberNpub !== npub);

            return notifyMarkEvent({
              recipientNpubs,
              authorNpub: npub,
              authorName: myDisplayName,
              markId: savedMilestone.id,
              title: title.trim() || undefined,
              preview: note.trim() || fullNote,
              eventId: nostrEventId,
              familyId: family.id,
            });
          })
          .catch(error => {
            console.warn('[Mark Notification] failed:', error);
          });
      }

      // ── Reset form ──
      setTitle('');
      setNote('');
      setTags([]);
      setMedia([]);
      setAudioUri(undefined);
      setShareWithFamily(false);
      setTagInput('');

      setProgress(100);

      Alert.alert(
        '✓ Saved',
        published ? 'Published to your relay.' : 'Saved locally.',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)/timeline') }]
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
setSaveStatus('');
setProgress(0);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
        <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        <BEHeader title="Log" />

        {/* Photo */}
        {/* Photos */}
<View style={s.field}>
  <Text style={[s.label, { color: theme.textMuted }]}>PHOTOS</Text>

  {media.length > 0 ? (
    <ScrollView horizontal style={s.photoPreviewRow}>
      {media.map(item => (
        <View key={item.id} style={s.multiPhotoWrap}>
          <Image
  source={{ uri: item.type === 'video' ? item.thumbnailUri || item.uri : item.uri }}
  style={s.multiPhoto}
  resizeMode="cover"
/>

{item.type === 'video' && (
  <View style={s.videoBadge}>
    <Text style={s.videoBadgeText}>▶</Text>
  </View>
)}

          <TouchableOpacity
            style={s.removePhotoBtn}
            onPress={() => setMedia(prev => prev.filter(m => m.id !== item.id))}
          >
            <Text style={s.removePhotoText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  ) : null}

  <View style={s.photoRow}>
  <TouchableOpacity style={[s.photoBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={takePhoto}>
    <Text style={s.photoBtnIcon}>📷</Text>
    <Text style={[s.photoBtnText, { color: theme.textSecondary }]}>Take Photo</Text>
  </TouchableOpacity>

  <TouchableOpacity style={[s.photoBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={recordVideo}>
    <Text style={s.photoBtnIcon}>🎥</Text>
    <Text style={[s.photoBtnText, { color: theme.textSecondary }]}>Record Video</Text>
  </TouchableOpacity>

  <TouchableOpacity style={[s.photoBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={pickPhoto}>
    <Text style={s.photoBtnIcon}>🖼️</Text>
    <Text style={[s.photoBtnText, { color: theme.textSecondary }]}>Library</Text>
  </TouchableOpacity>
</View>
</View>

        {/* Title */}
        <View style={s.field}>
          <Text style={[s.label, { color: theme.textMuted }]}>TITLE</Text>
          <TextInput
  style={[s.titleInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
            placeholder="Name this milestone..."
            placeholderTextColor={theme.textMuted}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />
        </View>

        {/* Note */}
        <View style={s.field}>
          <Text style={[s.label, { color: theme.textMuted }]}>NOTE</Text>
          <TextInput
  style={[s.textarea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
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
          <Text style={[s.label, { color: theme.textMuted }]}>VOICE NOTE</Text>
          <AudioRecorder
            onRecordingComplete={(uri) => setAudioUri(uri || undefined)}
            existingUri={audioUri}
          />
        </View>

        {/* Tags */}
        <View style={s.field}>
          <Text style={[s.label, { color: theme.textMuted }]}>TAGS</Text>
          <View style={s.presets}>
            {PRESET_TAGS.map(t => (
              <TouchableOpacity
                key={t}
                style={[
  s.presetChip,
  { backgroundColor: theme.surface, borderColor: theme.border },
  tags.includes(t) && { backgroundColor: theme.gold, borderColor: theme.gold },
]}
                onPress={() => tags.includes(t) ? removeTag(t) : addTag(t)}
              >
                <Text style={[
  s.presetText,
  { color: theme.textSecondary },
  tags.includes(t) && { color: theme.bg, fontWeight: '600' }
]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom tag input with visible + button */}
          <View style={s.tagInputRow}>
            <TextInput
  style={[s.tagInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
              placeholder="Custom tag..."
              placeholderTextColor="#444"
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={() => addTag(tagInput)}
              returnKeyType="done"
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[s.tagAddBtn, !tagInput.trim() && s.tagAddBtnDim]}
              onPress={() => addTag(tagInput)}
              disabled={!tagInput.trim()}
            >
              <Text style={s.tagAddBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {tags.length > 0 && (
            <View style={s.selectedTags}>
              {tags.map(t => (
                <TouchableOpacity key={t} style={[s.tagChip, { backgroundColor: theme.surface, borderColor: theme.gold }]} onPress={() => removeTag(t)}>
                  <Text style={[s.tagChipText, { color: theme.gold }]}>{t} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Relay toggle */}
        <View style={[s.relayRow, { borderColor: theme.border }]}>
          <View>
            <Text style={[s.relayLabel, { color: theme.text }]}>Publish to relay</Text>
            <Text style={[s.relayHint, { color: theme.textMuted }]}>relay.beginningend.com</Text>
          </View>
          <TouchableOpacity
            style={[s.toggle, publishToNostr && s.toggleOn]}
            onPress={() => setPublishToNostr(v => !v)}
          >
            <View style={[s.toggleThumb, publishToNostr && s.toggleThumbOn]} />
          </TouchableOpacity>
        </View>

        {family && (
          <View style={[s.relayRow, { borderColor: theme.border }]}>
            <View>
              <Text style={[s.relayLabel, { color: theme.text }]}>Share with family</Text>
              <Text style={[s.relayHint, { color: theme.textMuted }]}>{family.name}</Text>
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
<TouchableOpacity
  style={[
    s.saveBtn,
    { backgroundColor: theme.gold },
    saving && s.saveBtnSaving,
  ]}
  onPress={handleSave}
  disabled={saving}
>
          {saving ? (
            <View style={s.savingRow}>
              <ActivityIndicator color="#111" />
              <Text style={[s.saveBtnText, { color: theme.bg }]}>{saveStatus || 'Saving...'}</Text>
            </View>
          ) : (
            <Text style={[s.saveBtnText, { color: theme.bg }]}>Save Mark</Text>
          )}
        </TouchableOpacity>

      </ScrollView>

      {saving && (
        <View style={s.savingOverlay}>
          <View style={s.savingCard}>
            <ActivityIndicator color="#c9973a" />
            <Text style={s.savingTitle}>{saveStatus || 'Saving Mark...'}</Text>

            <View style={s.progressWrap}>
              <View style={[s.progressBar, { width: `${progress}%` }]} />
            </View>

            <Text style={s.progressText}>{progress}%</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  container: { padding: 20, paddingBottom: 48 },
  photoRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  photoBtn: { flex: 1, height: 90, borderRadius: 10, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoBtnIcon: { fontSize: 24 },
  photoBtnText: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  photoPreview: { marginBottom: 22, borderRadius: 10, overflow: 'hidden', borderWidth: 0.5, borderColor: '#2a2a2a' },
  photo: { width: '100%', height: 220 },
  photoActions: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingVertical: 10, backgroundColor: '#1a1a1a' },
  photoActionBtn: { padding: 4 },
  photoActionText: { fontSize: 13, color: '#888' },
  field: { marginBottom: 22 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, marginBottom: 8 },
  titleInput: { borderWidth: 0.5, borderRadius: 8, padding: 12, fontSize: 16, fontWeight: '500' },
  textarea: { borderWidth: 0.5, borderRadius: 8, padding: 12, fontSize: 15, minHeight: 100, lineHeight: 22 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  presetChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5 },
  presetChipActive: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  presetText: { fontSize: 13, color: '#666' },
  presetTextActive: { color: '#111', fontWeight: '600' },

  photoPreviewRow: {
  marginBottom: 22,
},
multiPhotoWrap: {
  marginRight: 10,
  position: 'relative',
},
multiPhoto: {
  width: 140,
  height: 140,
  borderRadius: 10,
  backgroundColor: '#000',
},
removePhotoBtn: {
  position: 'absolute',
  top: 6,
  right: 6,
  backgroundColor: 'rgba(0,0,0,0.7)',
  width: 26,
  height: 26,
  borderRadius: 13,
  alignItems: 'center',
  justifyContent: 'center',
},
removePhotoText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '700',
},
progressWrap: {
  height: 6,
  backgroundColor: '#222',
  borderRadius: 4,
  overflow: 'hidden',
  marginBottom: 10,
},
progressBar: {
  height: '100%',
  backgroundColor: '#c9973a',
},
savingOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.65)',
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 28,
},
savingCard: {
  width: '100%',
  borderRadius: 18,
  backgroundColor: '#1a1a1a',
  borderWidth: 0.5,
  borderColor: '#2a2a2a',
  padding: 20,
  alignItems: 'center',
},
savingTitle: {
  color: '#fff',
  fontSize: 15,
  fontWeight: '700',
  marginTop: 12,
  marginBottom: 14,
},
progressText: {
  color: '#888',
  fontSize: 12,
  fontWeight: '600',
},
videoBadge: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.25)',
  borderRadius: 10,
},
videoBadgeText: {
  color: '#fff',
  fontSize: 28,
  fontWeight: '800',
},
  // Custom tag row
  tagInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  tagInput: { flex: 1, borderWidth: 0.5, borderRadius: 8, padding: 10, fontSize: 14 },
  tagAddBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: '#c9973a' },
  tagAddBtnDim: { opacity: 0.35 },
  tagAddBtnText: { fontSize: 13, color: '#111', fontWeight: '700' },
  selectedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 0.5 },
  tagChipText: { fontSize: 12, color: '#c9973a' },
  relayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, paddingVertical: 12, borderTopWidth: 0.5, borderBottomWidth: 0.5 },
  relayLabel: { fontSize: 14, fontWeight: '500' },
  relayHint: { fontSize: 11, marginTop: 2 },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: '#2a2a2a', justifyContent: 'center', padding: 2 },
  toggleOn: { backgroundColor: '#c9973a' },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  saveBtn: { borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
saveBtnSaving: { opacity: 0.85 },
savingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveBtnText: { color: '#111', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});