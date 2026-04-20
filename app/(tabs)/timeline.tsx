import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    Dimensions,
    FlatList, Image,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BEHeader from '../../components/BEHeader';
import { formatDate, getMilestones, type Milestone } from '../../src/utils/storage';
import { useIdentity } from '../_layout';

const { width } = Dimensions.get('window');

export default function TimelineScreen() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'mine' | 'family'>('mine');
  const router = useRouter();
  const { npub, family } = useIdentity();

  const load = useCallback(async () => {
    const all = await getMilestones();
    setMilestones(all);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const myMilestones = milestones.filter(m => !m.familyId || m.authorNpub === npub);
  const familyMilestones = family
    ? milestones.filter(m => m.familyId === family.id)
    : [];

  const source = tab === 'mine' ? myMilestones : familyMilestones;
  const allTags = Array.from(new Set(source.flatMap(m => m.tags)));
  const filtered = activeFilter ? source.filter(m => m.tags.includes(activeFilter)) : source;

  const renderItem = ({ item, index }: { item: Milestone; index: number }) => {
    const hasTitle = item.note?.includes('\n\n');
    const title = hasTitle ? item.note.split('\n\n')[0] : null;
    const body = hasTitle ? item.note.split('\n\n').slice(1).join('\n\n') : item.note;

    return (
      <TouchableOpacity
        style={s.item}
        onPress={() => router.push({ pathname: '/milestone-detail', params: { id: item.id } } as any)}
        activeOpacity={0.85}
      >
        <View style={s.timelineCol}>
          <View style={s.dot} />
          {index < filtered.length - 1 && <View style={s.line} />}
        </View>
        <View style={s.card}>
          {item.photoUri && (
            <View>
              <Image source={{ uri: item.photoUri }} style={s.photo} resizeMode="cover" />
              {item.videoUri && (
                <View style={s.videoBadge}>
                  <Text style={s.videoBadgeText}>🎥 Video</Text>
                </View>
              )}
            </View>
          )}
          {!item.photoUri && item.videoUri && (
            <View style={s.videoThumb}>
              <View style={s.videoPlayCircle}>
                <Text style={s.videoPlayIcon}>▶</Text>
              </View>
              <Text style={s.videoThumbLabel}>Video clip</Text>
            </View>
          )}
          {!item.photoUri && !item.videoUri && item.audioUri && (
            <View style={s.audioThumb}>
              <Text style={s.audioThumbIcon}>🎙</Text>
              <Text style={s.audioThumbLabel}>Voice note</Text>
            </View>
          )}
          <View style={s.cardBody}>
            <Text style={s.date}>{formatDate(item.createdAt)}</Text>
            {title && <Text style={s.cardTitle}>{title}</Text>}
            {body ? <Text style={s.note} numberOfLines={3}>{body}</Text> : null}
            {item.tags.length > 0 && (
              <View style={s.tags}>
                {item.tags.map(t => (
                  <Text key={t} style={s.tag}>{t}</Text>
                ))}
              </View>
            )}
            {item.publishedToRelay && (
              <Text style={s.relayBadge}>↑ published</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <BEHeader title="Timeline" />

      {/* My / Family tab toggle */}
      <View style={s.tabRow}>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'mine' && s.tabBtnActive]}
          onPress={() => { setTab('mine'); setActiveFilter(null); }}
        >
          <Text style={[s.tabText, tab === 'mine' && s.tabTextActive]}>My Timeline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'family' && s.tabBtnActive]}
          onPress={() => { setTab('family'); setActiveFilter(null); }}
        >
          <Text style={[s.tabText, tab === 'family' && s.tabTextActive]}>
            {family ? `${family.name}` : 'Family'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tag filters */}
      {allTags.length > 0 && (
        <View style={s.filterWrap}>
          <FlatList
            horizontal
            data={['All', ...allTags]}
            keyExtractor={t => t}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filters}
            renderItem={({ item: tag }) => {
              const isActive = tag === 'All' ? !activeFilter : activeFilter === tag;
              return (
                <TouchableOpacity
                  style={[s.chip, isActive && s.chipActive]}
                  onPress={() => setActiveFilter(tag === 'All' ? null : tag)}
                >
                  <Text style={[s.chipText, isActive && s.chipTextActive]}>{tag}</Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* No family joined state */}
      {tab === 'family' && !family ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>👨‍👩‍👧‍👦</Text>
          <Text style={s.emptyText}>No family group yet</Text>
          <Text style={s.emptyHint}>Go to Settings to create or join a family.</Text>
          <TouchableOpacity style={s.goSettingsBtn} onPress={() => router.push('/(tabs)/settings' as any)}>
            <Text style={s.goSettingsText}>Go to Settings</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>◎</Text>
          <Text style={s.emptyText}>
            {tab === 'family' ? 'No family milestones yet' : 'No milestones yet'}
          </Text>
          <Text style={s.emptyHint}>
            {tab === 'family'
              ? 'Save a milestone and tag it to your family to see it here.'
              : 'Tap Log to capture your first moment.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c9973a" />
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#c9973a' },
  tabText: { fontSize: 13, color: '#444', fontWeight: '500' },
  tabTextActive: { color: '#c9973a', fontWeight: '700' },
  filterWrap: { borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },
  filters: { paddingHorizontal: 16, paddingVertical: 10, gap: 7 },
  chip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  chipActive: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  chipText: { fontSize: 12, color: '#555' },
  chipTextActive: { color: '#111', fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },
  item: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  timelineCol: { alignItems: 'center', width: 12, paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#c9973a' },
  line: { flex: 1, width: 1, backgroundColor: '#222', marginTop: 4 },
  card: { flex: 1, borderRadius: 12, borderWidth: 0.5, borderColor: '#222', backgroundColor: '#1a1a1a', overflow: 'hidden' },
  photo: { width: '100%', height: 160 },
  videoBadge: { position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  videoBadgeText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  videoThumb: { width: '100%', height: 120, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  videoPlayCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(201,151,58,0.85)', alignItems: 'center', justifyContent: 'center' },
  videoPlayIcon: { fontSize: 16, color: '#111', marginLeft: 3 },
  videoThumbLabel: { fontSize: 12, color: '#555' },
  audioThumb: { width: '100%', height: 60, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  audioThumbIcon: { fontSize: 18 },
  audioThumbLabel: { fontSize: 12, color: '#555' },
  cardBody: { padding: 14 },
  date: { fontSize: 11, color: '#444', marginBottom: 4, fontWeight: '500' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  note: { fontSize: 14, color: '#888', lineHeight: 21 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  tag: { fontSize: 11, color: '#c9973a', backgroundColor: '#1e1600', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 0.5, borderColor: '#3a2800' },
  relayBadge: { fontSize: 10, color: '#444', marginTop: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, color: '#333', marginBottom: 12 },
  emptyText: { fontSize: 17, color: '#555', fontWeight: '500' },
  emptyHint: { fontSize: 13, color: '#333', marginTop: 6, textAlign: 'center' },
  goSettingsBtn: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 0.5, borderColor: '#c9973a' },
  goSettingsText: { fontSize: 14, color: '#c9973a', fontWeight: '500' },
});