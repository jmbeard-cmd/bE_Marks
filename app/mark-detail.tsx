import { useAudioPlayer } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageViewerModal, { ViewerImage } from '../components/ImageViewerModal';
import { setAppActivity } from '../src/utils/app-activity';
import {
  fetchFamilyMilestones,
  fetchNostrProfile,
  publishFamilyMilestone,
  type NostrProfile,
} from '../src/utils/nostr';
import {
  formatDate,
  getMilestones,
  saveRemoteMilestone,
  updateMilestone,
  type Milestone,
} from '../src/utils/storage';
import { useIdentity } from './_layout';

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
  const { npub, nsec, relays, family, theme } = useIdentity();
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
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [detailMediaIndex, setDetailMediaIndex] = useState(0);
  const [reflectionProfiles, setReflectionProfiles] = useState<Record<string, NostrProfile>>({});
  const [attemptedRemoteLookup, setAttemptedRemoteLookup] = useState(false);

  const audioPlayer = useAudioPlayer(
    milestone?.audioUri ? { uri: milestone.audioUri } : null
  );
  const videoViewRef = useRef<VideoView>(null);
  const videoPlayer = useVideoPlayer(
    milestone?.videoUri ? { uri: milestone.videoUri } : null,
    player => { player.loop = false; }
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMilestone() {
      if (!id) return;

      const all = await getMilestones();
      const found = all.find(m => m.id === id);

      if (cancelled) return;

      if (found) {
        setMilestone(found);
        return;
      }

      if (!family || attemptedRemoteLookup) {
        return;
      }

      setAttemptedRemoteLookup(true);

      try {
        const remoteEvents = await fetchFamilyMilestones(family.id);

        for (const event of remoteEvents) {
          try {
            const data = JSON.parse(event.content);

            await saveRemoteMilestone({
              id: data.id,
              note: data.note ?? '',
              tags: data.tags ?? [],
              photoUri: data.photoUri,
              videoUri: data.videoUri,
              audioUri: data.audioUri,
              media: Array.isArray(data.media) ? data.media : [],
              reflections: Array.isArray(data.reflections) ? data.reflections : [],
              createdAt: data.createdAt ?? event.created_at,
              familyId: family.id,
              authorNpub: data.authorNpub,
              authorName: data.authorName,
              publishedToRelay: true,
              nostrEventId: event.id,
            });
          } catch {}
        }

        const refreshed = await getMilestones();
        const refreshedFound = refreshed.find(m => m.id === id);

        if (!cancelled && refreshedFound) {
          setMilestone(refreshedFound);
        }
      } catch (error) {
        console.warn('[Mark Detail] remote Mark lookup failed:', error);
      }
    }

    loadMilestone();

    return () => {
      cancelled = true;
    };
  }, [id, family, attemptedRemoteLookup]);

  useEffect(() => {
  if (!milestone?.reflections?.length) return;

  const authors = Array.from(
    new Set(
      milestone.reflections
        .map(r => r.authorNpub)
        .filter(Boolean)
    )
  ) as string[];

  authors.forEach(async authorNpub => {
    if (reflectionProfiles[authorNpub]) return;

    const profile = await fetchNostrProfile(authorNpub);

    if (profile) {
      setReflectionProfiles(prev => ({
        ...prev,
        [authorNpub]: profile,
      }));
    }
  });
}, [milestone?.reflections]);

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
  if (milestone.authorNpub && milestone.authorNpub !== npub) return;

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
const getReflectionAuthorLabel = (authorNpub?: string) => {
  if (!authorNpub) return 'Family member';

  const profile = reflectionProfiles[authorNpub];
  const name = profile?.display_name || profile?.name;

  if (name) return name;

  return `${authorNpub.slice(0, 10)}…`;
};

  const saveReflection = async () => {
  if (!milestone || !reflectionText.trim()) return;

  const reflection = {
    text: reflectionText.trim(),
    createdAt: Math.floor(Date.now() / 1000),
    authorNpub: npub ?? undefined,
  };

  const updatedReflections = [...(milestone.reflections ?? []), reflection];

  const updatedMilestone = {
    ...milestone,
    reflections: updatedReflections,
  };

  await updateMilestone(milestone.id, { reflections: updatedReflections });

  setMilestone(updatedMilestone);
  setReflectionText('');
  setIsAddingReflection(false);

  if (updatedMilestone.familyId && nsec && npub) {
    publishFamilyMilestone(
      {
        id: updatedMilestone.id,
        note: updatedMilestone.note,
        tags: updatedMilestone.tags ?? [],
        photoUri: updatedMilestone.photoUri,
        videoUri: updatedMilestone.videoUri,
        audioUri: updatedMilestone.audioUri,
        media: updatedMilestone.media ?? [],
        reflections: updatedReflections,
        createdAt: updatedMilestone.createdAt,
        familyId: updatedMilestone.familyId,
        authorNpub: updatedMilestone.authorNpub ?? npub,
        authorName: updatedMilestone.authorName,
      },
      nsec,
      relays
    ).then(result => {
      if (!result.success) {
        console.warn('[Family Reflection Sync] Failed:', result.error);
      } else {
        console.log('[Family Reflection Sync] Published:', result.eventId);
      }
    });
  }
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
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.gold} />
      </View>
    </SafeAreaView>
  );

const hasTitle = milestone.note?.includes('\n\n');
const title = hasTitle ? milestone.note.split('\n\n')[0] : null;
const body = hasTitle ? milestone.note.split('\n\n').slice(1).join('\n\n') : milestone.note;

const isOwner = !milestone.authorNpub || milestone.authorNpub === npub;

const authorLabel =
  milestone.authorName?.trim() ||
  (milestone.authorNpub && milestone.authorNpub === npub
    ? 'You'
    : milestone.authorNpub
      ? `${milestone.authorNpub.slice(0, 10)}…`
      : null);

const openMediaViewer = (uri: string) => {
  setAppActivity('media-viewer', true);
  setSelectedImage(uri);
};

  const viewerImages: ViewerImage[] =
  milestone.media && milestone.media.length > 0
    ? milestone.media.map(item => ({
        id: item.id,
        uri: item.uri,
        type: item.type,
        thumbnailUrl: item.thumbnailUri,
      }))
    : milestone.photoUri
      ? [{ id: 'legacy-photo', uri: milestone.photoUri, type: 'image' }]
      : [];

  return (
    <SafeAreaView style={s.safe}>

      {/* Header */}
      <View style={[s.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/timeline' as any);
          }}
          style={s.backBtn}
        >
          <Text style={[s.backText, { color: theme.gold }]}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerMeta}>
          <Text style={[s.headerDate, { color: theme.textMuted }]}>
            {formatDate(milestone.createdAt)}
          </Text>

          {authorLabel && (
            <Text style={[s.headerAuthor, { color: theme.textMuted }]} numberOfLines={1}>
              By {authorLabel}
            </Text>
          )}
        </View>
        {!isEditing && isOwner && (
  <TouchableOpacity onPress={startEditing} style={s.editBtn}>
    <Text style={[s.editBtnText, { color: theme.gold }]}>Edit</Text>
  </TouchableOpacity>
)}
        {isEditing && (
          <TouchableOpacity onPress={() => setIsEditing(false)} style={s.editBtn}>
            <Text style={[s.editBtnText, { color: theme.textMuted }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

            <KeyboardAvoidingView
        style={s.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={s.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

        {/* Media */}
{viewerImages.length > 0 ? (
  <View style={s.heroCarousel}>
    <FlatList
      data={viewerImages}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item, index) => `${item.id || item.uri}_${index}`}
      getItemLayout={(_, index) => ({
        length: width,
        offset: width * index,
        index,
      })}
      onMomentumScrollEnd={(event) => {
        const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
        setDetailMediaIndex(nextIndex);
      }}
      renderItem={({ item, index }) => {
        const previewUri =
          item.type === 'video'
            ? item.thumbnailUrl || item.uri
            : item.thumbnailUrl || item.uri;

        return (
          <TouchableOpacity
            activeOpacity={0.92}
            style={s.heroSlide}
            onPress={() => openMediaViewer(item.uri)}
          >
            <Image
              source={{ uri: previewUri }}
              style={s.heroImage}
              resizeMode="cover"
            />

            {item.type === 'video' && (
              <View style={s.heroVideoBadge}>
                <Text style={s.heroVideoBadgeText}>▶</Text>
              </View>
            )}

            {viewerImages.length > 1 && (
              <View style={s.heroCounter}>
                <Text style={s.heroCounterText}>
                  {index + 1} / {viewerImages.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      }}
    />

    {viewerImages.length > 1 && (
      <View style={s.heroDots}>
        {viewerImages.map((item, index) => (
          <View
            key={`${item.id || item.uri}_dot_${index}`}
            style={[
              s.heroDot,
              index === detailMediaIndex && [
                s.heroDotActive,
                { backgroundColor: theme.gold },
              ],
            ]}
          />
        ))}
      </View>
    )}
  </View>
) : null}

        <View style={s.content}>

          {/* ── Edit mode ── */}
          {isEditing ? (
            <View style={s.editBlock}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>TITLE</Text>
  <TextInput
  style={[s.editInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
  value={editTitle}
  onChangeText={setEditTitle}
  placeholder="Title..."
  placeholderTextColor={theme.textMuted}
/>

              <Text style={[s.sectionLabel, { marginTop: 16 }]}>NOTE</Text>
              <TextInput
  style={[s.editInput, s.editTextarea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
  value={editNote}
  onChangeText={setEditNote}
  placeholder="Note..."
  placeholderTextColor={theme.textMuted}
  multiline
  textAlignVertical="top"
/>

              <Text style={[s.sectionLabel, { marginTop: 16 }]}>TAGS</Text>
              <View style={s.presetTagsRow}>
                {PRESET_TAGS.map(t => (
                  <TouchableOpacity
  key={t}
  style={[s.selectedTag, { backgroundColor: theme.surface, borderColor: theme.gold }]}
  onPress={() => removeEditTag(t)}
>
                    <Text style={[s.presetTagText, editTags.includes(t) && s.presetTagTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.tagInputRow}>
               <TextInput
  style={[s.editInput, { flex: 1, color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
  value={editTagInput}
  onChangeText={setEditTagInput}
  placeholder="Custom tag..."
  placeholderTextColor={theme.textMuted}
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
                    <TouchableOpacity
  key={t}
  style={[s.selectedTag, { backgroundColor: theme.surface, borderColor: theme.gold }]}
  onPress={() => removeEditTag(t)}
>
                      <Text style={[s.selectedTagText, { color: theme.gold }]}>{t} ✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={s.editActions}>
                <TouchableOpacity style={[s.cancelEditBtn, { borderColor: theme.border }]} onPress={() => setIsEditing(false)}>
                  <Text style={[s.cancelEditText, { color: theme.textMuted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveEditBtn, { backgroundColor: theme.gold }]} onPress={saveEdit}>
                  <Text style={s.saveEditText}>Save changes</Text>
                </TouchableOpacity>
              </View>
            </View>

          ) : (
            /* ── View mode ── */
            <>
              {title && <Text style={[s.title, { color: theme.text }]}>{title}</Text>}
              {body ? (
                <View style={s.section}>
                  <Text style={[s.sectionLabel, { color: theme.textMuted }]}>NOTE</Text>
                  <Text style={[s.note, { color: theme.textSecondary }]}>{body}</Text>
                </View>
              ) : null}
            </>
          )}

          {/* Audio */}
          {milestone.audioUri && (
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>VOICE NOTE</Text>
              <TouchableOpacity style={[s.mediaBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={isAudioPlaying ? stopAudio : playAudio}>
                <Text style={[s.mediaBtnIcon, { color: theme.gold }]}>{isAudioPlaying ? '⏹' : '▶'}</Text>
<Text style={[s.mediaBtnText, { color: theme.gold }]}>{isAudioPlaying ? 'Stop playback' : 'Play voice note'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Video */}
          {milestone.videoUri && !(milestone.media ?? []).some(item => item.type === 'video') && (
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>VIDEO CLIP</Text>
              <View style={[s.videoContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>TAGS</Text>
              <View style={s.tags}>
                {milestone.tags.map(t => (
                  <Text key={t} style={[s.tag, { color: theme.gold, backgroundColor: theme.surface, borderColor: theme.border }]}>{t}</Text>
                ))}
              </View>
            </View>
          )}

          {/* Reflections */}
          <View style={s.section}>
            <View style={s.reflectionHeader}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>REFLECTIONS</Text>
              {!isAddingReflection && (
                <TouchableOpacity onPress={() => setIsAddingReflection(true)}>
                  <Text style={s.addReflectionBtn}>+ Add</Text>
                </TouchableOpacity>
              )}
            </View>

            {(milestone.reflections ?? []).length === 0 && !isAddingReflection && (
              <Text style={[s.reflectionEmpty, { color: theme.textSecondary }]}>
                No reflections yet. Come back later and add one.
              </Text>
            )}

            {(milestone.reflections ?? []).map((r, i) => {
  const profile = r.authorNpub ? reflectionProfiles[r.authorNpub] : null;
  const authorName = getReflectionAuthorLabel(r.authorNpub);

  return (
    <View key={i} style={[s.reflectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={s.reflectionAuthorRow}>
        {profile?.picture ? (
          <Image source={{ uri: profile.picture }} style={s.reflectionAuthorAvatar} />
        ) : (
          <View style={[s.reflectionAuthorFallback, { backgroundColor: theme.raised }]}>
            <Text style={[s.reflectionAuthorLetter, { color: theme.gold }]}>
              {authorName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={[s.reflectionAuthorName, { color: theme.text }]}>{authorName}</Text>
          <Text style={[s.reflectionDate, { color: theme.textMuted }]}>{formatDate(r.createdAt)}</Text>
        </View>
      </View>

      <Text style={[s.reflectionText, { color: theme.textSecondary }]}>{r.text}</Text>

      <TouchableOpacity onPress={() => deleteReflection(i)} style={s.reflectionDelete}>
        <Text style={[s.reflectionDeleteText, { color: theme.textMuted }]}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
})}

            {isAddingReflection && (
              <View style={s.reflectionInputBlock}>
                <TextInput
  style={[s.editInput, s.editTextarea, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
  value={reflectionText}
  onChangeText={setReflectionText}
  placeholder="Looking back, what do you notice? How have you grown?"
  placeholderTextColor={theme.textMuted}
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
                  <TouchableOpacity style={[s.saveEditBtn, { backgroundColor: theme.gold }]} onPress={saveReflection}>
                    <Text style={s.saveEditText}>Save reflection</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Relay status */}
          <View style={[s.section, s.relaySection, { borderTopColor: theme.border }]}>
            <Text style={[s.relayStatus, { color: theme.textMuted }]}>
              {milestone.publishedToRelay
                ? `↑ Published to relay · ${milestone.nostrEventId?.slice(0, 12)}…`
                : '· Saved locally only'}
            </Text>
          </View>

        </View>
              </ScrollView>
      </KeyboardAvoidingView>

      <ImageViewerModal
  images={viewerImages}
  selectedUri={selectedImage}
  onClose={() => {
    setAppActivity('media-viewer', false);
    setSelectedImage(null);
  }}
/>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e',
  },
  backBtn: { padding: 4, minWidth: 60 },
  backText: { fontSize: 15, color: '#c9973a', fontWeight: '500' },
  headerDate: { fontSize: 12, color: '#444' },
    headerMeta: {
    flex: 1,
    alignItems: 'center',
  },
  headerAuthor: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  editBtn: { padding: 4, minWidth: 60, alignItems: 'flex-end' },
  editBtnText: { fontSize: 15, color: '#c9973a', fontWeight: '500' },

    keyboardAvoid: { flex: 1 },
  container: { paddingBottom: 140 },
  content: { padding: 20 },

  // Photo
  photoContainer: { width: '100%' },
  photo: { width: '100%', height: width * 0.75 },
  photoLoadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  photoFallback: { width: '100%', height: 80, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  photoFallbackIcon: { fontSize: 16 },
  photoFallbackText: { fontSize: 12, color: '#444' },

  title: { fontSize: 26, fontWeight: '700', color: '#fff', letterSpacing: -0.5, marginBottom: 20, lineHeight: 32 },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 11, color: '#444', fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 },
  note: { fontSize: 16, color: '#aaa', lineHeight: 27 },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag: {
  fontSize: 11,
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 20,
  borderWidth: 0.5,
  lineHeight: 15,
},

  // Audio / media buttons
  mediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 0.5 },
  mediaBtnIcon: { fontSize: 18, color: '#c9973a' },
  mediaBtnText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },

  // Video
  videoContainer: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', borderWidth: 0.5 },
  video: { width: '100%', height: '100%' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(201,151,58,0.9)', alignItems: 'center', justifyContent: 'center' },
  playCircleIcon: { fontSize: 22, color: '#111', marginLeft: 4 },

  // Relay
  relaySection: { borderTopWidth: 0.5, paddingTop: 16 },
  relayStatus: { fontSize: 12, color: '#333' },

  // Edit
  editBlock: { marginBottom: 24 },
  editInput: { borderWidth: 0.5, borderRadius: 10, padding: 12, fontSize: 15 },
  editTextarea: { minHeight: 120, lineHeight: 22, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
 cancelEditBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 0.5, alignItems: 'center' },
  cancelEditText: { fontSize: 14, color: '#555' },
  saveEditBtn: { flex: 2, padding: 13, borderRadius: 10, alignItems: 'center' },
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
  selectedTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 0.5 },
  selectedTagText: { fontSize: 12, color: '#c9973a' },

  // Reflections
  reflectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  addReflectionBtn: { fontSize: 13, color: '#c9973a', fontWeight: '600' },
  reflectionEmpty: { fontSize: 14, fontStyle: 'italic', lineHeight: 22 },
  reflectionAuthorRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  marginBottom: 8,
},
reflectionAuthorAvatar: {
  width: 34,
  height: 34,
  borderRadius: 17,
},
reflectionAuthorFallback: {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: 'center',
  justifyContent: 'center',
},
reflectionAuthorLetter: {
  color: '#c9973a',
  fontSize: 13,
  fontWeight: '700',
},
reflectionAuthorName: {
  color: '#eee',
  fontSize: 13,
  fontWeight: '700',
},
  reflectionCard: { borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 0.5 },
  reflectionDate: { fontSize: 10, color: '#555', marginBottom: 8, fontWeight: '600', letterSpacing: 0.6 },
  reflectionText: { fontSize: 15, color: '#aaa', lineHeight: 24 },
  reflectionDelete: { marginTop: 12, alignSelf: 'flex-end' },
  reflectionDeleteText: { fontSize: 12, color: '#2a2a2a' },
  reflectionInputBlock: { marginTop: 4 },

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

  imageModalOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.95)',
  alignItems: 'center',
  justifyContent: 'center',
},
imageModalClose: {
  position: 'absolute',
  top: 50,
  right: 24,
  zIndex: 10,
  width: 42,
  height: 42,
  borderRadius: 21,
  backgroundColor: '#1a1a1a',
  alignItems: 'center',
  justifyContent: 'center',
},
imageModalCloseText: {
  color: '#fff',
  fontSize: 22,
  fontWeight: '700',
},
fullscreenImage: {
  width: '100%',
  height: '100%',
},
heroCarousel: {
  width: '100%',
  backgroundColor: '#000',
  marginBottom: 16,
},
heroSlide: {
  width,
  height: width * 0.82,
  backgroundColor: '#000',
  position: 'relative',
},
heroImage: {
  width: '100%',
  height: '100%',
  backgroundColor: '#000',
},
heroCounter: {
  position: 'absolute',
  top: 14,
  right: 14,
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: 'rgba(0,0,0,0.68)',
},
heroCounterText: {
  color: '#fff',
  fontSize: 12,
  fontWeight: '800',
},
heroDots: {
  position: 'absolute',
  bottom: 12,
  left: 0,
  right: 0,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
},
heroDot: {
  width: 6,
  height: 6,
  borderRadius: 3,
  backgroundColor: 'rgba(255,255,255,0.35)',
},
heroDotActive: {
  width: 7,
  height: 7,
  borderRadius: 3.5,
},
heroVideoBadge: {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.18)',
},
heroVideoBadgeText: {
  color: '#fff',
  fontSize: 42,
  fontWeight: '900',
  textShadowColor: 'rgba(0,0,0,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
},
});