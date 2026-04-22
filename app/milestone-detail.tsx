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


// Handles load states and broken URIs gracefully
function MilestonePhoto({ uri }: { uri: string }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  if (error) {
    return (
      <View style={{ width: '100%', height: 80, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Text style={{ fontSize: 16 }}>🖼️</Text>
        <Text style={{ fontSize: 12, color: '#444' }}>Image unavailable</Text>
      </View>
    );
  }
  return (
    <View style={{ width: '100%', backgroundColor: '#0d0d0d', marginBottom: 16 }}>
      <Image
        source={{ uri }}
        style={{ width: '100%', height: 280 }}
        resizeMode="contain"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
      />
      {loading && (
        <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d0d0d' }}>
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

  const removeEditTag = (tag: string) => {
    setEditTags(prev => prev.filter(t => t !== tag));
  };

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

  if (!milestone) return null;

  const hasTitle = milestone.note?.includes('\n\n');
  const title = hasTitle ? milestone.note.split('\n\n')[0] : null;
  const body = hasTitle ? milestone.note.split('\n\n').slice(1).join('\n\n') : milestone.note;

  return (
    <SafeAreaView style={s.safe}>
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
        <Text style={s.date}>{formatDate(milestone.createdAt)}</Text>
        <TouchableOpacity onPress={startEditing} style={s.editBtn}>
          <Text style={s.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        {milestone.photoUri && (
          <MilestonePhoto uri={milestone.photoUri} />
        )}

        <View style={s.content}>

          {isEditing ? (
            <View style={s.editBlock}>

              {/* Title */}
              <Text style={s.sectionLabel}>TITLE</Text>
              <TextInput
                style={s.editInput}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Title..."
                placeholderTextColor="#444"
              />

              {/* Note */}
              <Text style={[s.sectionLabel, { marginTop: 14 }]}>NOTE</Text>
              <TextInput
                style={[s.editInput, s.editTextarea]}
                value={editNote}
                onChangeText={setEditNote}
                placeholder="Note..."
                placeholderTextColor="#444"
                multiline
                textAlignVertical="top"
              />

              {/* Tags */}
              <Text style={[s.sectionLabel, { marginTop: 14 }]}>TAGS</Text>
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
              <TextInput
                style={[s.editInput, { marginTop: 8 }]}
                value={editTagInput}
                onChangeText={setEditTagInput}
                placeholder="Custom tag..."
                placeholderTextColor="#444"
                returnKeyType="done"
                autoCapitalize="words"
                onSubmitEditing={() => addEditTag(editTagInput)}
              />
              {editTags.length > 0 && (
                <View style={s.selectedTagsRow}>
                  {editTags.map(t => (
                    <TouchableOpacity key={t} style={s.selectedTag} onPress={() => removeEditTag(t)}>
                      <Text style={s.selectedTagText}>{t} ✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Actions */}
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

          {milestone.audioUri && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>VOICE NOTE</Text>
              <TouchableOpacity style={s.playBtn} onPress={isAudioPlaying ? stopAudio : playAudio}>
                <Text style={s.playIcon}>{isAudioPlaying ? '⏹' : '▶'}</Text>
                <Text style={s.playText}>{isAudioPlaying ? 'Stop' : 'Play voice note'}</Text>
              </TouchableOpacity>
            </View>
          )}

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
              <Text style={s.reflectionEmpty}>No reflections yet. Come back later and add one.</Text>
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
                  <TouchableOpacity style={s.cancelEditBtn} onPress={() => { setIsAddingReflection(false); setReflectionText(''); }}>
                    <Text style={s.cancelEditText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.saveEditBtn} onPress={saveReflection}>
                    <Text style={s.saveEditText}>Save reflection</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>RELAY</Text>
            <Text style={s.relayStatus}>
              {milestone.publishedToRelay
                ? `↑ Published — ${milestone.nostrEventId?.slice(0, 16)}...`
                : 'Saved locally only'}
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
  date: { fontSize: 12, color: '#444' },
  editBtn: { padding: 4, minWidth: 60, alignItems: 'flex-end' },
  editBtnText: { fontSize: 15, color: '#c9973a', fontWeight: '500' },
  container: { paddingBottom: 48 },
  photo: { width: width, height: width * 1.2, backgroundColor: '#0a0a0a' },
  content: { padding: 20 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: -0.4, marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 },
  note: { fontSize: 16, color: '#aaa', lineHeight: 26 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: { fontSize: 13, color: '#c9973a', backgroundColor: '#1e1600', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 0.5, borderColor: '#3a2800' },
  relayStatus: { fontSize: 13, color: '#444' },
  playBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  playIcon: { fontSize: 16, color: '#c9973a' },
  playText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
  videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 10, overflow: 'hidden', borderWidth: 0.5, borderColor: '#2a2a2a' },
  video: { width: '100%', height: '100%' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(201,151,58,0.85)', alignItems: 'center', justifyContent: 'center' },
  playCircleIcon: { fontSize: 20, color: '#111', marginLeft: 3 },
  editBlock: { marginBottom: 24 },
  editInput: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 8, padding: 12, fontSize: 15, color: '#fff', backgroundColor: '#1a1a1a' },
  editTextarea: { minHeight: 120, lineHeight: 22 },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelEditBtn: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  cancelEditText: { fontSize: 14, color: '#555' },
  saveEditBtn: { flex: 2, padding: 12, borderRadius: 8, backgroundColor: '#c9973a', alignItems: 'center' },
  saveEditText: { fontSize: 14, color: '#111', fontWeight: '700' },
  // Tag editing
  presetTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  presetTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  presetTagActive: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  presetTagText: { fontSize: 12, color: '#666' },
  presetTagTextActive: { color: '#111', fontWeight: '600' },
  selectedTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  selectedTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#c9973a' },
  selectedTagText: { fontSize: 12, color: '#c9973a' },
  // Reflections
  reflectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addReflectionBtn: { fontSize: 13, color: '#c9973a', fontWeight: '600' },
  reflectionEmpty: { fontSize: 14, color: '#333', fontStyle: 'italic', lineHeight: 22 },
  reflectionCard: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#2a2a2a' },
  reflectionDate: { fontSize: 10, color: '#444', marginBottom: 6, fontWeight: '600', letterSpacing: 0.6 },
  reflectionText: { fontSize: 15, color: '#aaa', lineHeight: 24 },
  reflectionDelete: { marginTop: 10, alignSelf: 'flex-end' },
  reflectionDeleteText: { fontSize: 12, color: '#333' },
  reflectionInputBlock: { marginTop: 4 },
});