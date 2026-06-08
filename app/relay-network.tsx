import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { DEFAULT_RELAYS, RELAY_LABELS } from '../src/constants/relays';
import {
  DEFAULT_RELAY,
  fetchRelayList,
  publishRelayList,
} from '../src/utils/nostr';
import { useIdentity } from './_layout';

type RelayLaneKey = 'personal' | 'dm' | 'space';

const RELAY_LANES: {
  key: RelayLaneKey;
  icon: string;
  title: string;
  hint: string;
}[] = [
  {
    key: 'personal',
    icon: '📡',
    title: 'Personal Relays',
    hint: 'Used for your public Marks, profile, Following feed, and relay list.',
  },
  {
    key: 'dm',
    icon: '💬',
    title: 'Messages',
    hint: 'Message routing is handled automatically by bE Marks for now.',
  },
  {
    key: 'space',
    icon: '👥',
    title: 'Space Relays',
    hint: 'Space relay settings are managed inside each Space by admins.',
  },
];

function dedupeRelayUrls(relayUrls: string[]): string[] {
  return Array.from(
    new Set(
      relayUrls
        .map(relayUrl => relayUrl.trim())
        .filter(relayUrl => relayUrl.startsWith('wss://') || relayUrl.startsWith('ws://'))
    )
  );
}

export default function RelayNetworkScreen() {
  const {
    npub,
    nsec,
    relays,
    setRelays,
    theme,
  } = useIdentity();

  const [activeLane, setActiveLane] = useState<RelayLaneKey>('personal');
  const [relaySearch, setRelaySearch] = useState('');
  const [newRelay, setNewRelay] = useState('');
  const [localRelays, setLocalRelays] = useState<string[]>(() => (
    dedupeRelayUrls(relays.length > 0 ? relays : [DEFAULT_RELAY])
  ));
  const [loadingPublishedRelays, setLoadingPublishedRelays] = useState(false);
  const [savingRelays, setSavingRelays] = useState(false);

  const activeLaneDetails = RELAY_LANES.find(lane => lane.key === activeLane) ?? RELAY_LANES[0];
  const visibleLocalRelays = useMemo(() => dedupeRelayUrls(localRelays), [localRelays]);
  const relaySearchText = relaySearch.trim().toLowerCase();

  const discoveredRelayOptions = useMemo(() => (
    DEFAULT_RELAYS.filter(relayUrl => {
      if (!relaySearchText) return true;

      const label = RELAY_LABELS[relayUrl] || '';

      return (
        relayUrl.toLowerCase().includes(relaySearchText) ||
        label.toLowerCase().includes(relaySearchText)
      );
    })
  ), [relaySearchText]);

  const toggleRelay = (relayUrl: string) => {
    setLocalRelays(current => {
      const currentRelays = dedupeRelayUrls(current);

      if (currentRelays.includes(relayUrl)) {
        if (currentRelays.length === 1) {
          Alert.alert('Cannot remove', 'You need at least one relay.');
          return currentRelays;
        }

        return currentRelays.filter(item => item !== relayUrl);
      }

      return dedupeRelayUrls([...currentRelays, relayUrl]);
    });
  };

  const addCustomRelay = () => {
    const relayUrl = newRelay.trim();

    if (!relayUrl.startsWith('wss://') && !relayUrl.startsWith('ws://')) {
      Alert.alert('Invalid relay', 'Relay URL must start with wss:// or ws://');
      return;
    }

    setLocalRelays(current => dedupeRelayUrls([...current, relayUrl]));
    setNewRelay('');
  };

  const removeRelay = (relayUrl: string) => {
    setLocalRelays(current => {
      const currentRelays = dedupeRelayUrls(current);

      if (currentRelays.length === 1) {
        Alert.alert('Cannot remove', 'You need at least one relay.');
        return currentRelays;
      }

      return currentRelays.filter(item => item !== relayUrl);
    });
  };

  const loadPublishedRelays = async () => {
    if (!npub) {
      Alert.alert('No identity', 'Connect or create an identity first.');
      return;
    }

    setLoadingPublishedRelays(true);

    try {
      const fetched = await fetchRelayList(npub);
      setLocalRelays(dedupeRelayUrls(fetched.length > 0 ? fetched : [DEFAULT_RELAY]));
    } catch (error) {
      console.warn('[Relay Network] failed to load published relay list:', error);
      Alert.alert('Relay discovery failed', 'Could not load your published relay list.');
    } finally {
      setLoadingPublishedRelays(false);
    }
  };

  const savePersonalRelays = async () => {
    if (!nsec) {
      Alert.alert('No private key', 'Cannot publish relay settings without a private key.');
      return;
    }

    const relaysToSave = dedupeRelayUrls(localRelays);

    if (relaysToSave.length === 0) {
      Alert.alert('Relay required', 'Choose at least one relay.');
      return;
    }

    setSavingRelays(true);

    try {
      const result = await publishRelayList(relaysToSave, nsec);

      if (!result.success) {
        Alert.alert('Error', result.error || 'Could not publish relay list.');
        return;
      }

      setRelays(relaysToSave);
      Alert.alert('✓ Relays updated', 'Your personal relay list has been published.');
    } finally {
      setSavingRelays(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[s.safe, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <SafeAreaView style={s.safe}>
        <ScrollView
          contentContainerStyle={s.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
        <View style={s.topRow}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={[s.backText, { color: theme.text }]}>Back</Text>
          </TouchableOpacity>

<Text style={[s.screenTitle, { color: theme.text }]}>Relay Network</Text>

          <View style={{ width: 44 }} />
        </View>

        <View style={[s.heroCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[s.heroTitle, { color: theme.text }]}>Personal relays</Text>
          <Text style={[s.heroText, { color: theme.textMuted }]}>
            Choose the relays bE Marks uses for your public profile, Following feed, and personal Marks. Space relays are managed inside each Space.
          </Text>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>ROUTING LANES</Text>

          {RELAY_LANES.map(lane => {
            const active = activeLane === lane.key;

            return (
              <TouchableOpacity
                key={lane.key}
                style={[
                  s.laneCard,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                  active && { borderColor: theme.gold },
                ]}
                onPress={() => {
                  if (lane.key === 'personal') {
                    setActiveLane('personal');
                    return;
                  }

                  Alert.alert(
                    lane.title,
                    lane.key === 'dm'
                      ? 'Message routing is handled automatically by bE Marks for now.'
                      : 'Space relays are managed by Space admins inside each Space.'
                  );
                }}
                activeOpacity={0.85}
              >
                <Text style={s.laneIcon}>{lane.icon}</Text>

                <View style={{ flex: 1 }}>
                  <Text style={[s.laneTitle, { color: active ? theme.gold : theme.text }]}>
                    {lane.title}
                  </Text>
                  <Text style={[s.laneHint, { color: theme.textMuted }]}>
                    {lane.hint}
                  </Text>
                  <Text style={[s.statusText, { color: active ? theme.gold : theme.textMuted }]}>
                    {active ? 'Editable' : lane.key === 'dm' ? 'App-managed' : 'Admin-managed'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>
            {activeLaneDetails.title.toUpperCase()} SETUP
          </Text>

          <View style={[s.editorCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={s.editorHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[s.editorTitle, { color: theme.text }]}>
                  {activeLaneDetails.icon} {activeLaneDetails.title}
                </Text>
                <Text style={[s.editorHint, { color: theme.textMuted }]}>
                  {activeLaneDetails.hint}
                </Text>
              </View>

              <TouchableOpacity
                style={[s.smallActionBtn, { borderColor: theme.border, backgroundColor: theme.raised }]}
                onPress={loadPublishedRelays}
                disabled={loadingPublishedRelays}
                activeOpacity={0.82}
              >
                {loadingPublishedRelays ? (
                  <ActivityIndicator size="small" color={theme.gold} />
                ) : (
                  <Text style={[s.smallActionText, { color: theme.gold }]}>Load Saved</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={[s.inputLabel, { color: theme.textMuted }]}>RELAY DISCOVERY</Text>

            <TextInput
              style={[
                s.relaySearchInput,
                {
                  backgroundColor: theme.raised,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={relaySearch}
              onChangeText={setRelaySearch}
              placeholder="Search relays by name or URL"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {discoveredRelayOptions.map(relayUrl => {
              const selected = visibleLocalRelays.includes(relayUrl);

              return (
                <TouchableOpacity
                  key={`${activeLane}_${relayUrl}`}
                  style={[s.relayPickerRow, { borderBottomColor: theme.border }]}
                  onPress={() => toggleRelay(relayUrl)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.relayPickerName, { color: theme.text }]}>
                      {RELAY_LABELS[relayUrl] || relayUrl}
                    </Text>
                    <Text style={[s.relayPickerUrl, { color: theme.textMuted }]} numberOfLines={1}>
                      {relayUrl}
                    </Text>
                  </View>

                  <Text
                    style={[
                      s.relayPickerStatus,
                      { color: theme.textMuted },
                      selected && { color: theme.gold },
                    ]}
                  >
                    {selected ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {discoveredRelayOptions.length === 0 && (
              <Text style={[s.relayDiscoveryEmpty, { color: theme.textMuted }]}>
                No matching relays yet. Add a custom relay below.
              </Text>
            )}

            <Text style={[s.inputLabel, { marginTop: 16, color: theme.textMuted }]}>ACTIVE RELAYS</Text>

            {visibleLocalRelays.map(relayUrl => (
              <View key={`active_${activeLane}_${relayUrl}`} style={[s.relayRow, { borderBottomColor: theme.border }]}>
                <Text style={[s.relayUrlEdit, { color: theme.textSecondary }]} numberOfLines={1}>
                  {relayUrl}
                </Text>

                <TouchableOpacity onPress={() => removeRelay(relayUrl)} activeOpacity={0.82}>
                  <Text style={[s.relayRemove, { color: theme.textMuted }]}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={s.relayAddRow}>
              <TextInput
                style={[
                  s.input,
                  {
                    flex: 1,
                    backgroundColor: theme.raised,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={newRelay}
                onChangeText={setNewRelay}
                placeholder="wss://relay.example.com"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />

              <TouchableOpacity
                style={[s.relayAddBtn, { backgroundColor: theme.raised, borderColor: theme.border }]}
                onPress={addCustomRelay}
                activeOpacity={0.82}
              >
                <Text style={[s.relayAddBtnText, { color: theme.gold }]}>Add</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                s.saveRelaysBtn,
                { backgroundColor: theme.gold },
                savingRelays && { opacity: 0.65 },
              ]}
              onPress={savePersonalRelays}
              disabled={savingRelays}
              activeOpacity={0.86}
            >
              {savingRelays ? (
                <ActivityIndicator size="small" color={theme.bg} />
              ) : (
                <Text style={[s.saveRelaysText, { color: theme.bg }]}>
                  Save relay setup
                </Text>
              )}
            </TouchableOpacity>

            <Text style={[s.editorFootnote, { color: theme.textMuted }]}>
              This saves your personal relay list. Space relay settings stay inside each Space.
            </Text>
          </View>
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
    paddingBottom: 140,
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
  heroCard: {
    borderWidth: 0.5,
    borderRadius: 24,
    padding: 18,
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  heroText: {
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  laneCard: {
    borderWidth: 0.5,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  laneIcon: {
    fontSize: 22,
    width: 30,
    textAlign: 'center',
  },
  laneTitle: {
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 3,
  },
  laneHint: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
  },
  relayText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  editorCard: {
    borderWidth: 0.5,
    borderRadius: 22,
    padding: 14,
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  editorTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  editorHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  smallActionBtn: {
    minWidth: 54,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallActionText: {
    fontSize: 12,
    fontWeight: '900',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 7,
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
  relayPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  relayPickerName: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  relayPickerUrl: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  relayPickerStatus: {
    fontSize: 12,
    fontWeight: '900',
    marginLeft: 12,
  },
  relayDiscoveryEmpty: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 4,
  },
  relayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  relayUrlEdit: {
    fontSize: 12,
    flex: 1,
    fontFamily: 'monospace',
  },
  relayRemove: {
    fontSize: 14,
    paddingLeft: 12,
  },
  relayAddRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 0.5,
    borderRadius: 12,
    padding: 13,
    fontSize: 14,
  },
  relayAddBtn: {
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 0.5,
    justifyContent: 'center',
  },
  relayAddBtnText: {
    fontSize: 13,
    fontWeight: '900',
  },
  saveRelaysBtn: {
    minHeight: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  saveRelaysText: {
    fontSize: 14,
    fontWeight: '900',
  },
  editorFootnote: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
});