import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { RELAY_LABELS } from '../src/constants/relays';
import {
  DEFAULT_RELAY,
  fetchRelayList,
  publishRelayList,
} from '../src/utils/nostr';
import {
  fetchRelayDirectory,
  fetchRelayInformation,
  searchRelayDirectory,
  type RelayDirectoryResult,
  type RelayInformationDocument,
} from '../src/utils/relay-directory';
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
    icon: 'ðŸ“¡',
    title: 'Personal Relays',
    hint: 'Used for your public Marks, profile, and relay list.',
  },
  {
    key: 'dm',
    icon: 'ðŸ’¬',
    title: 'Messages',
    hint: 'Message routing is handled automatically by bE Marks for now.',
  },
  {
    key: 'space',
    icon: 'ðŸ‘¥',
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

function buildPersonalRelaySet(relayUrls: string[] = []): string[] {
  const activeRelays = dedupeRelayUrls(relayUrls);

  return activeRelays.length > 0 ? activeRelays : [DEFAULT_RELAY];
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
    buildPersonalRelaySet(relays)
  ));
  const [loadingPublishedRelays, setLoadingPublishedRelays] = useState(false);
  const [savingRelays, setSavingRelays] = useState(false);
  const [relayDirectory, setRelayDirectory] = useState<RelayDirectoryResult[]>([]);
  const [loadingRelayDirectory, setLoadingRelayDirectory] = useState(false);
  const [selectedRelay, setSelectedRelay] = useState<RelayDirectoryResult | null>(null);
  const [selectedRelayInfo, setSelectedRelayInfo] = useState<RelayInformationDocument | null>(null);
  const [loadingRelayInfo, setLoadingRelayInfo] = useState(false);
  const relayInfoRequestId = useRef(0);

  const activeLaneDetails = RELAY_LANES.find(lane => lane.key === activeLane) ?? RELAY_LANES[0];
  const visibleLocalRelays = useMemo(() => dedupeRelayUrls(localRelays), [localRelays]);
  const relaySearchText = relaySearch.trim().toLowerCase();
  const relayIdentityKey = useMemo(() => dedupeRelayUrls(relays).join('|'), [relays]);

  const discoveredRelayOptions = useMemo(() => (
    searchRelayDirectory(relayDirectory, relaySearchText)
  ), [relayDirectory, relaySearchText]);

  const selectedRelayUrl = selectedRelay?.url ?? null;
  const relaySearchQuery = relaySearch.trim().replace(/^wss?:\/\//i, '');
  const relaySearchIsShort = relaySearchQuery.length > 0 && relaySearchQuery.length < 3;
  const relayDiscoveryHint = relaySearchIsShort
    ? 'Type at least 3 characters from a relay URL to search the directory.'
    : relaySearchQuery
      ? 'Searching relay URLs only. Results are capped to keep this screen clean.'
      : 'Showing featured relays. Search by relay URL when you need more.';

  useEffect(() => {
    let cancelled = false;

    setLoadingRelayDirectory(true);

    fetchRelayDirectory()
      .then(directory => {
        if (cancelled) return;

        setRelayDirectory(directory);
      })
      .catch(error => {
        console.warn('[Relay Network] relay directory load failed:', error);
      })
      .finally(() => {
        if (cancelled) return;

        setLoadingRelayDirectory(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLocalRelays(buildPersonalRelaySet(relays));
  }, [npub, relayIdentityKey]);

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

  const openRelayDetails = async (relay: RelayDirectoryResult) => {
    const requestId = relayInfoRequestId.current + 1;
    relayInfoRequestId.current = requestId;

    setSelectedRelay(relay);
    setSelectedRelayInfo(null);
    setLoadingRelayInfo(true);

    try {
      const info = await fetchRelayInformation(relay.url);

      if (relayInfoRequestId.current !== requestId) return;

      setSelectedRelayInfo(info);
    } catch (error) {
      console.warn('[Relay Network] failed to load relay info:', relay.url, error);

      if (relayInfoRequestId.current !== requestId) return;

      setSelectedRelayInfo(null);
    } finally {
      if (relayInfoRequestId.current === requestId) {
        setLoadingRelayInfo(false);
      }
    }
  };

  const loadPublishedRelays = async () => {
    if (!npub) {
      Alert.alert('No identity', 'Connect or create an identity first.');
      return;
    }

    setLoadingPublishedRelays(true);

    try {
      const fetched = await fetchRelayList(npub);
      setLocalRelays(current => buildPersonalRelaySet([
        ...current,
        ...relays,
        ...fetched,
      ]));
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

    const relaysToSave = buildPersonalRelaySet(localRelays);

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
      Alert.alert('âœ“ Relays updated', 'Your personal relay list has been published.');
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
            Choose the relays bE Marks uses for your public profile, personal Marks, and relay list. Space relays are managed inside each Space.
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
              placeholder="Search relay URL, ex: damus or purple"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[s.relayDiscoveryHint, { color: theme.textMuted }]}>
              {relayDiscoveryHint}
            </Text>

            {loadingRelayDirectory && (
              <View style={s.relayDirectoryLoadingRow}>
                <ActivityIndicator size="small" color={theme.gold} />
                <Text style={[s.relayDiscoveryEmpty, { color: theme.textMuted }]}>
                  Loading relay directoryâ€¦
                </Text>
              </View>
            )}

            {discoveredRelayOptions.map(relay => {
              const selected = visibleLocalRelays.includes(relay.url);
              const expanded = selectedRelayUrl === relay.url;

              return (
                <View key={`${activeLane}_${relay.url}`}>
                  <TouchableOpacity
                    style={[
                      s.relayPickerRow,
                      { borderBottomColor: expanded ? 'transparent' : theme.border },
                    ]}
                    onPress={() => {
                      if (expanded) {
                        relayInfoRequestId.current += 1;
                        setSelectedRelay(null);
                        setSelectedRelayInfo(null);
                        setLoadingRelayInfo(false);
                        return;
                      }

                      openRelayDetails(relay);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.relayPickerName, { color: theme.text }]}>
                        {relay.label || RELAY_LABELS[relay.url] || relay.url}
                      </Text>
                      <Text style={[s.relayPickerUrl, { color: theme.textMuted }]} numberOfLines={1}>
                        {relay.url}
                      </Text>
                      <Text style={[s.relayPickerMeta, { color: theme.textMuted }]} numberOfLines={1}>
                        {relay.source} Â· {relay.category}{relay.online === true ? ' Â· online' : ''}
                      </Text>
                    </View>

                    <View style={s.relayPickerRight}>
                      <Text
                        style={[
                          s.relayPickerStatus,
                          { color: theme.textMuted },
                          selected && { color: theme.gold },
                        ]}
                      >
                        {selected ? 'ON' : 'OFF'}
                      </Text>
                      <Text style={[s.relayPickerChevron, { color: theme.textMuted }]}>
                        {expanded ? 'âŒƒ' : 'âŒ„'}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {expanded && (
                    <View style={[s.relayInfoCard, { backgroundColor: theme.raised, borderColor: theme.border }]}>
                      <View style={s.relayInfoHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.relayInfoTitle, { color: theme.text }]}>
                            {selectedRelayInfo?.name || relay.label || RELAY_LABELS[relay.url] || relay.url}
                          </Text>
                          <Text style={[s.relayInfoUrl, { color: theme.textMuted }]} numberOfLines={1}>
                            {relay.url}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => {
                            relayInfoRequestId.current += 1;
                            setSelectedRelay(null);
                            setSelectedRelayInfo(null);
                            setLoadingRelayInfo(false);
                          }}
                          activeOpacity={0.82}
                        >
                          <Text style={[s.relayInfoClose, { color: theme.textMuted }]}>âœ•</Text>
                        </TouchableOpacity>
                      </View>

                      {loadingRelayInfo ? (
                        <View style={s.relayDirectoryLoadingRow}>
                          <ActivityIndicator size="small" color={theme.gold} />
                          <Text style={[s.relayDiscoveryEmpty, { color: theme.textMuted }]}>
                            Loading relay informationâ€¦
                          </Text>
                        </View>
                      ) : (
                        <>
                          <Text style={[s.relayInfoDescription, { color: theme.textSecondary }]}>
                            {selectedRelayInfo?.description ||
                              relay.description ||
                              'No relay description was provided by this relay.'}
                          </Text>

                          <View style={s.relayInfoGrid}>
                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              Source: {relay.source}
                            </Text>

                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              Category: {relay.category}
                            </Text>

                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              Status: {relay.online === true ? 'Online' : 'Not verified'}
                            </Text>

                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              Software: {selectedRelayInfo?.software || 'Not listed'}
                              {selectedRelayInfo?.version ? ` ${selectedRelayInfo.version}` : ''}
                            </Text>

                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              NIPs: {selectedRelayInfo?.supported_nips?.join(', ') || 'Not listed'}
                            </Text>

                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              Contact: {selectedRelayInfo?.contact || 'Not listed'}
                            </Text>

                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              Countries: {selectedRelayInfo?.relay_countries?.join(', ') || 'Not listed'}
                            </Text>

                            <Text style={[s.relayInfoMeta, { color: theme.textMuted }]}>
                              Tags: {selectedRelayInfo?.tags?.join(', ') || 'Not listed'}
                            </Text>
                          </View>
                        </>
                      )}

                      <TouchableOpacity
                        style={[
                          s.relayInfoActionBtn,
                          { backgroundColor: selected ? theme.surface : theme.gold },
                        ]}
                        onPress={() => {
                          if (selected) {
                            removeRelay(relay.url);
                            return;
                          }

                          toggleRelay(relay.url);
                        }}
                        activeOpacity={0.86}
                      >
                        <Text
                          style={[
                            s.relayInfoActionText,
                            { color: selected ? theme.text : theme.bg },
                          ]}
                        >
                          {selected ? 'Remove from Active Relays' : 'Add to Active Relays'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
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
                  <Text style={[s.relayRemove, { color: theme.textMuted }]}>âœ•</Text>
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
    marginBottom: 6,
  },
  relayDiscoveryHint: {
    fontSize: 11,
    lineHeight: 16,
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
  relayPickerMeta: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
  },
  relayDirectoryLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  relayInfoCard: {
    borderWidth: 0.5,
    borderRadius: 18,
    padding: 14,
    marginTop: 14,
  },
  relayInfoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  relayInfoTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 2,
  },
  relayInfoUrl: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  relayInfoClose: {
    fontSize: 16,
    fontWeight: '900',
    paddingHorizontal: 4,
  },
  relayInfoDescription: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  relayInfoGrid: {
    gap: 5,
    marginBottom: 12,
  },
  relayInfoMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  relayInfoActionBtn: {
    minHeight: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  relayInfoActionText: {
    fontSize: 13,
    fontWeight: '900',
  },
  relayPickerRight: {
    alignItems: 'flex-end',
    marginLeft: 12,
    gap: 2,
  },
  relayPickerStatus: {
    fontSize: 12,
    fontWeight: '900',
  },
  relayPickerChevron: {
    fontSize: 14,
    fontWeight: '900',
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
