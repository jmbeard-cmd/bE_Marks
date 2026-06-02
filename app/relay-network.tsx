import { router } from 'expo-router';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_RELAY } from '../src/utils/nostr';
import { useIdentity } from './_layout';

export default function RelayNetworkScreen() {
  const {
    relays,
    theme,
  } = useIdentity();

  const primaryRelay = relays[0] || DEFAULT_RELAY;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={s.container}>
        <View style={s.topRow}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={[s.backText, { color: theme.text }]}>Back</Text>
          </TouchableOpacity>

<Text style={[s.screenTitle, { color: theme.text }]}>App Relay Network</Text>

          <View style={{ width: 44 }} />
        </View>

        <View style={[s.heroCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
<Text style={[s.heroTitle, { color: theme.text }]}>Personal relay routing</Text>
<Text style={[s.heroText, { color: theme.textMuted }]}>
  This controls the future personal feed, search, DM, inbox/outbox, and cache lanes. Space relays are managed inside each Space.
</Text>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>ROUTING LANES</Text>

          <View style={[s.laneCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={s.laneIcon}>📤</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.laneTitle, { color: theme.text }]}>Outbox</Text>
              <Text style={[s.laneHint, { color: theme.textMuted }]}>
                Where your signed profile, relay list, and public identity updates publish.
              </Text>
              <Text style={[s.relayText, { color: theme.gold }]} numberOfLines={1}>
                {primaryRelay}
              </Text>
            </View>
          </View>

          <View style={[s.laneCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={s.laneIcon}>📥</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.laneTitle, { color: theme.text }]}>Inbox</Text>
              <Text style={[s.laneHint, { color: theme.textMuted }]}>
                Where the app checks for replies, membership events, and updates meant for you.
              </Text>
              <Text style={[s.statusText, { color: theme.textMuted }]}>Uses your active relay list</Text>
            </View>
          </View>

          <View style={[s.laneCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={s.laneIcon}>🔎</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.laneTitle, { color: theme.text }]}>Search</Text>
              <Text style={[s.laneHint, { color: theme.textMuted }]}>
                Used for finding profiles, contacts, public Spaces, and relay metadata.
              </Text>
              <Text style={[s.statusText, { color: theme.textMuted }]}>Discovery routing coming next</Text>
            </View>
          </View>

          <View style={[s.laneCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={s.laneIcon}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.laneTitle, { color: theme.text }]}>DM</Text>
              <Text style={[s.laneHint, { color: theme.textMuted }]}>
                Direct messages stay separated from Space relay traffic.
              </Text>
              <Text style={[s.statusText, { color: theme.textMuted }]}>NIP-17 routing lane</Text>
            </View>
          </View>

          <View style={[s.laneCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={s.laneIcon}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.laneTitle, { color: theme.text }]}>Cache</Text>
              <Text style={[s.laneHint, { color: theme.textMuted }]}>
                Local storage keeps Spaces usable first, then syncs signed events in the background.
              </Text>
              <Text style={[s.statusText, { color: theme.textMuted }]}>Local-first active</Text>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: theme.textMuted }]}>SPACE RELAYS</Text>

          <View style={[s.infoCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[s.infoTitle, { color: theme.text }]}>Managed inside each Space</Text>
            <Text style={[s.infoText, { color: theme.textMuted }]}>
              Space relay routing, backup relays, school relays, and archive behavior belong in the Space control center.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  infoCard: {
    borderWidth: 0.5,
    borderRadius: 18,
    padding: 14,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 5,
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
  },
});