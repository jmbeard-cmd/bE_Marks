import { useAudioPlayer } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDate, getMilestones, updateMilestone, type Milestone } from '../src/utils/storage';

const { width } = Dimensions.get('window');
const PRESET_TAGS = ['Family', 'Faith', 'Career', 'School', 'Travel', 'Health', 'Achievement', 'Personal'];

// Photo with loading state and broken-URI fallback
function MilestonePhoto({ uri }: { uri: string }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  if (error) {
    return (
      <View style={s.photoFallback}>
        <Text style={s.photoFallbackIcon}>🖼️</Text>
        <Text style={s.photoFallbackText}>Image unavailable</Text>
      </View>
    );
  }
  return (
    <View style={s.photoContainer}>
      <Image
        source={{ uri }}
        style={s.photo}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
      />
      {loading && (
        <View style={s.photoLoadingOverlay}>
          <ActivityIndicator size="small" color="#c9973a" />
        </View>
      )}
    </View>
  );
}

export default function MilestoneDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [isAddingReflection, setIsAddingReflection] = useState(false);
  const [reflectionText, setReflectionText] = useState('');

  const audioPlayer = useAudioPlayer(
    milestone?.audioUri ? { uri: milestone.audioUri } : null
  );
  const videoViewRef = useRef<VideoView>(null);
  const videoPlayer = useVideoPlayer(
    milestone?.videoUri ? { uri: milestone.videoUri } : null,
    player => { player.loop = false; }
  );

  useEffect(() => {
    getMilestones().then(all => {
      const found = all.find(m => m.id === id);
      if (found) setMilestone(found);
    });
  }, [id]);

  useEffect(() => {
    if (!audioPlayer) return;
    const sub = audioPlayer.addListener('playbackStatusUpdate', (status: any) => {
      if (status.didJustFinish) setIsAudioPlaying(false);
    });
    return () => sub.remove();
  }, [audioPlayer]);

  const playAudio = () => { if (!audioPlayer) return; audioPlayer.play(); setIsAudioPlaying(true); };
  const stopAudio = () => { if (!audioPlayer) return; audioPlayer.pause(); setIsAudioPlaying(false); };

  const startEditing = () => {
    if (!milestone) return;
    const hasTitle = milestone.note?.includes('\n\n');
    setEditTitle(hasTitle ? milestone.note.split('\n\n')[0] : '');
    setEditNote(hasTitle ? milestone.note.split('\n\n').slice(1).join('\n\n') : milestone.note);
    setEditTags(milestone.tags ?? []);
    setIsEditing(true);
  };

  const addEditTag = (tag: string) => {
    const clean = tag.trim();
    if (!clean || editTags.includes(clean)) { setEditTagInput(''); return; }
    setEditTags(prev => [...prev, clean]);
    setEditTagInput('');
  };

  const removeEditTag = (tag: string) => setEditTags(prev => prev.filter(t => t !== tag));

  const saveEdit = async () => {
    if (!milestone) return;
    const newNote = editTitle.trim()
      ? `${editTitle.trim()}\n\n${editNote.trim()}`
      : editNote.trim();
    await updateMilestone(milestone.id, { note: newNote, tags: editTags });
    setMilestone(prev => prev ? { ...prev, note: newNote, tags: editTags } : prev);
    setIsEditing(false);
  };

  const saveReflection = async () => {
    if (!milestone || !reflectionText.trim()) return;
    const reflection = { text: reflectionText.trim(), createdAt: Math.floor(Date.now() / 1000) };
    const updatedReflections = [...(milestone.reflections ?? []), reflection];
    await updateMilestone(milestone.id, { reflections: updatedReflections });
    setMilestone(prev => prev ? { ...prev, reflections: updatedReflections } : prev);
    setReflectionText('');
    setIsAddingReflection(false);
  };

  const deleteReflection = async (index: number) => {
    if (!milestone) return;
    Alert.alert('Delete reflection', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const updated = (milestone.reflections ?? []).filter((_, i) => i !== index);
          await updateMilestone(milestone.id, { reflections: updated });
          setMilestone(prev => prev ? { ...prev, reflections: updated } : prev);
        }
      }
    ]);
  };

  if (!milestone) return (
    <SafeAreaView style={s.safe}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#c9973a" />
      </View>
    </SafeAreaView>
  );

  const hasTitle = milestone.note?.includes('\n\n');
  const title = hasTitle ? milestone.note.split('\n\n')[0] : null;
  const body = hasTitle ? milestone.note.split('\n\n').slice(1).join('\n\n') : milestone.note;

  return (
    <SafeAreaView style={s.safe}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/timeline' as any);
          }}
          style={s.backBtn}
        >
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerDate}>{formatDate(milestone.createdAt)}</Text>
        {!isEditing && (
          <TouchableOpacity onPress={startEditing} style={s.editBtn}>
            <Text style={s.editBtnText}>Edit</Text>
          </TouchableOpacity>
        )}
        {isEditing && (
          <TouchableOpacity onPress={() => setIsEditing(false)} style={s.editBtn}>
            <Text style={[s.editBtnText, { color: '#555' }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {/* Photo */}
        {milestone.photoUri && <MilestonePhoto uri={milestone.photoUri} />}

        <View style={s.content}>

          {/* ── Edit mode ── */}
          {isEditing ? (
            <View style={s.editBlock}>
              <Text style={s.sectionLabel}>TITLE</Text>
              <TextInput
                style={s.editInput}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Title..."
                placeholderTextColor="#444"
              />

              <Text style={[s.sectionLabel, { marginTop: 16 }]}>NOTE</Text>
              <TextInput
                style={[s.editInput, s.editTextarea]}
                value={editNote}
                onChangeText={setEditNote}
                placeholder="Note..."
                placeholderTextColor="#444"
                multiline
                textAlignVertical="top"
              />

              <Text style={[s.sectionLabel, { marginTop: 16 }]}>TAGS</Text>
              <View style={s.presetTagsRow}>
                {PRESET_TAGS.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[s.presetTag, editTags.includes(t) && s.presetTagActive]}
                    onPress={() => editTags.includes(t) ? removeEditTag(t) : addEditTag(t)}
                  >
                    <Text style={[s.presetTagText, editTags.includes(t) && s.presetTagTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.tagInputRow}>
                <TextInput
                  style={[s.editInput, { flex: 1 }]}
                  value={editTagInput}
                  onChangeText={setEditTagInput}
                  placeholder="Custom tag..."
                  placeholderTextColor="#444"
                  returnKeyType="done"
                  autoCapitalize="words"
                  onSubmitEditing={() => addEditTag(editTagInput)}
                />
                <TouchableOpacity
                  style={[s.tagAddBtn, !editTagInput.trim() && s.tagAddBtnDim]}
                  onPress={() => addEditTag(editTagInput)}
                  disabled={!editTagInput.trim()}
                >
                  <Text style={s.tagAddBtnText}>+ Add</Text>
                </TouchableOpacity>
              </View>
              {editTags.length > 0 && (
                <View style={s.selectedTagsRow}>
                  {editTags.map(t => (
                    <TouchableOpacity key={t} style={s.selectedTag} onPress={() => removeEditTag(t)}>
                      <Text style={s.selectedTagText}>{t} ✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={s.editActions}>
                <TouchableOpacity style={s.cancelEditBtn} onPress={() => setIsEditing(false)}>
                  <Text style={s.cancelEditText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.saveEditBtn} onPress={saveEdit}>
                  <Text style={s.saveEditText}>Save changes</Text>
                </TouchableOpacity>
              </View>
            </View>

          ) : (
            /* ── View mode ── */
            <>
              {title && <Text style={s.title}>{title}</Text>}
              {body ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>NOTE</Text>
                  <Text style={s.note}>{body}</Text>
                </View>
              ) : null}
            </>
          )}

          {/* Audio */}
          {milestone.audioUri && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>VOICE NOTE</Text>
              <TouchableOpacity style={s.mediaBtn} onPress={isAudioPlaying ? stopAudio : playAudio}>
                <Text style={s.mediaBtnIcon}>{isAudioPlaying ? '⏹' : '▶'}</Text>
                <Text style={s.mediaBtnText}>{isAudioPlaying ? 'Stop playback' : 'Play voice note'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Video */}
          {milestone.videoUri && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>VIDEO CLIP</Text>
              <View style={s.videoContainer}>
                <VideoView
                  ref={videoViewRef}
                  player={videoPlayer}
                  style={s.video}
                  contentFit="contain"
                  nativeControls={false}
                />
                <TouchableOpacity
                  style={s.videoOverlay}
                  onPress={() => {
                    if (isVideoPlaying) {
                      videoPlayer.pause();
                      setIsVideoPlaying(false);
                    } else {
                      videoPlayer.play();
                      setIsVideoPlaying(true);
                      videoViewRef.current?.enterFullscreen();
                    }
                  }}
                >
                  {!isVideoPlaying && (
                    <View style={s.playCircle}>
                      <Text style={s.playCircleIcon}>▶</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Tags */}
          {milestone.tags.length > 0 && !isEditing && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>TAGS</Text>
              <View style={s.tags}>
                {milestone.tags.map(t => (
                  <Text key={t} style={s.tag}>{t}</Text>
                ))}
              </View>
            </View>
          )}

          {/* Reflections */}
          <View style={s.section}>
            <View style={s.reflectionHeader}>
              <Text style={s.sectionLabel}>REFLECTIONS</Text>
              {!isAddingReflection && (
                <TouchableOpacity onPress={() => setIsAddingReflection(true)}>
                  <Text style={s.addReflectionBtn}>+ Add</Text>
                </TouchableOpacity>
              )}
            </View>

            {(milestone.reflections ?? []).length === 0 && !isAddingReflection && (
              <Text style={s.reflectionEmpty}>
                No reflections yet. Come back later and add one.
              </Text>
            )}

            {(milestone.reflections ?? []).map((r, i) => (
              <View key={i} style={s.reflectionCard}>
                <Text style={s.reflectionDate}>{formatDate(r.createdAt)}</Text>
                <Text style={s.reflectionText}>{r.text}</Text>
                <TouchableOpacity onPress={() => deleteReflection(i)} style={s.reflectionDelete}>
                  <Text style={s.reflectionDeleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}

            {isAddingReflection && (
              <View style={s.reflectionInputBlock}>
                <TextInput
                  style={[s.editInput, s.editTextarea]}
                  value={reflectionText}
                  onChangeText={setReflectionText}
                  placeholder="Looking back, what do you notice? How have you grown?"
                  placeholderTextColor="#444"
                  multiline
                  textAlignVertical="top"
                  autoFocus
                />
                <View style={s.editActions}>
                  <TouchableOpacity
                    style={s.cancelEditBtn}
                    onPress={() => { setIsAddingReflection(false); setReflectionText(''); }}
                  >
                    <Text style={s.cancelEditText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.saveEditBtn} onPress={saveReflection}>
                    <Text style={s.saveEditText}>Save reflection</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Relay status */}
          <View style={[s.section, s.relaySection]}>
            <Text style={s.relayStatus}>
              {milestone.publishedToRelay
                ? `↑ Published to relay · ${milestone.nostrEventId?.slice(0, 12)}…`
                : '· Saved locally only'}
            </Text>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e',
  },
  backBtn: { padding: 4, minWidth: 60 },
  backText: { fontSize: 15, color: '#c9973a', fontWeight: '500' },
  headerDate: { fontSize: 12, color: '#444' },
  editBtn: { padding: 4, minWidth: 60, alignItems: 'flex-end' },
  editBtnText: { fontSize: 15, color: '#c9973a', fontWeight: '500' },

  container: { paddingBottom: 60 },
  content: { padding: 20 },

  // Photo
  photoContainer: { width: '100%', backgroundColor: '#0a0a0a' },
  photo: { width: '100%', height: width * 0.75 },
  photoLoadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  photoFallback: { width: '100%', height: 80, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  photoFallbackIcon: { fontSize: 16 },
  photoFallbackText: { fontSize: 12, color: '#444' },

  title: { fontSize: 26, fontWeight: '700', color: '#fff', letterSpacing: -0.5, marginBottom: 20, lineHeight: 32 },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 },
  note: { fontSize: 16, color: '#aaa', lineHeight: 27 },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: { fontSize: 13, color: '#c9973a', backgroundColor: '#1e1600', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 0.5, borderColor: '#3a2800' },

  // Audio / media buttons
  mediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  mediaBtnIcon: { fontSize: 18, color: '#c9973a' },
  mediaBtnText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },

  // Video
  videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', borderWidth: 0.5, borderColor: '#2a2a2a' },
  video: { width: '100%', height: '100%' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(201,151,58,0.9)', alignItems: 'center', justifyContent: 'center' },
  playCircleIcon: { fontSize: 22, color: '#111', marginLeft: 4 },

  // Relay
  relaySection: { borderTopWidth: 0.5, borderTopColor: '#1e1e1e', paddingTop: 16 },
  relayStatus: { fontSize: 12, color: '#333' },

  // Edit
  editBlock: { marginBottom: 24 },
  editInput: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 10, padding: 12, fontSize: 15, color: '#fff', backgroundColor: '#1a1a1a' },
  editTextarea: { minHeight: 120, lineHeight: 22, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelEditBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  cancelEditText: { fontSize: 14, color: '#555' },
  saveEditBtn: { flex: 2, padding: 13, borderRadius: 10, backgroundColor: '#c9973a', alignItems: 'center' },
  saveEditText: { fontSize: 14, color: '#111', fontWeight: '700' },

  // Tag editing
  tagInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  tagAddBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, backgroundColor: '#c9973a' },
  tagAddBtnDim: { opacity: 0.35 },
  tagAddBtnText: { fontSize: 13, color: '#111', fontWeight: '700' },
  presetTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  presetTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  presetTagActive: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  presetTagText: { fontSize: 12, color: '#666' },
  presetTagTextActive: { color: '#111', fontWeight: '600' },
  selectedTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  selectedTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#c9973a' },
  selectedTagText: { fontSize: 12, color: '#c9973a' },

  // Reflections
  reflectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  addReflectionBtn: { fontSize: 13, color: '#c9973a', fontWeight: '600' },
  reflectionEmpty: { fontSize: 14, color: '#333', fontStyle: 'italic', lineHeight: 22 },
  reflectionCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 0.5, borderColor: '#2a2a2a' },
  reflectionDate: { fontSize: 10, color: '#555', marginBottom: 8, fontWeight: '600', letterSpacing: 0.6 },
  reflectionText: { fontSize: 15, color: '#aaa', lineHeight: 24 },
  reflectionDelete: { marginTop: 12, alignSelf: 'flex-end' },
  reflectionDeleteText: { fontSize: 12, color: '#2a2a2a' },
  reflectionInputBlock: { marginTop: 4 },
});