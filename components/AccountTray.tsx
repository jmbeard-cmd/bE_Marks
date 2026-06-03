import { useRouter } from 'expo-router';
import {
    Alert,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useIdentity } from '../app/_layout';
import {
    AccentPalettes,
    type AccentPaletteKey,
} from '../src/constants/theme';
import { clearIdentity as clearStoredIdentity } from '../src/utils/nostr';
import AccountTraySocialGraphCard from './AccountTraySocialGraphCard';

type AccountTrayProps = {
  visible: boolean;
  onClose: () => void;
};

function getInitial(value?: string | null): string {
  const clean = value?.trim();
  return clean ? clean[0].toUpperCase() : '?';
}

export default function AccountTray({ visible, onClose }: AccountTrayProps) {
  const router = useRouter();
  const {
    npub,
    profile,
    theme,
    themeMode,
    setThemeMode,
    accentPalette,
    setAccentPalette,
    useAmber,
    clearIdentity: clearIdentityContext,
  } = useIdentity();

  const displayName = profile?.display_name || profile?.name || 'My Profile';
  const avatarUri = profile?.picture || null;
  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : 'No public key';

  const accentPaletteOptions = Object.entries(AccentPalettes) as [
    AccentPaletteKey,
    typeof AccentPalettes[AccentPaletteKey]
  ][];

  const openRoute = (pathname: string) => {
    onClose();
    router.push(pathname as any);
  };

    const handleLogOut = () => {
    Alert.alert(
      'Log out?',
      'This removes your private key from this device. Make sure your key is backed up first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            onClose();
            await clearStoredIdentity();
            clearIdentityContext();
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />

        <View style={[s.sheet, { backgroundColor: theme.bg, borderColor: theme.border }]}>
          <View style={[s.handle, { backgroundColor: theme.border }]} />

          <ScrollView
            contentContainerStyle={s.content}
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity
              style={[s.profileCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => openRoute('/profile')}
              activeOpacity={0.86}
            >
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.avatar} />
              ) : (
                <View style={[s.avatarFallback, { backgroundColor: theme.raised }]}>
                  <Text style={[s.avatarInitial, { color: theme.gold }]}>
                    {getInitial(displayName)}
                  </Text>
                </View>
              )}

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.profileName, { color: theme.text }]} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={[s.profileSub, { color: theme.textMuted }]} numberOfLines={1}>
                  {shortNpub}
                </Text>
              </View>

              <Text style={[s.openText, { color: theme.gold }]}>Open</Text>
            </TouchableOpacity>

            <AccountTraySocialGraphCard
              theme={theme}
              onPress={() => openRoute('/social-graph')}
            />

            <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={s.cardHeader}>
                <View>
                  <Text style={[s.cardTitle, { color: theme.text }]}>Appearance</Text>
                  <Text style={[s.cardHint, { color: theme.textMuted }]}>Quick app controls</Text>
                </View>

                <TouchableOpacity
                  style={[
                    s.modePill,
                    { borderColor: theme.border },
                    themeMode === 'light' && { backgroundColor: theme.gold, borderColor: theme.gold },
                  ]}
                  onPress={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      s.modePillText,
                      { color: theme.gold },
                      themeMode === 'light' && { color: theme.bg },
                    ]}
                  >
                    {themeMode === 'dark' ? 'Dark' : 'Light'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={s.paletteRow}>
                {accentPaletteOptions.map(([key, palette]) => {
                  const selected = accentPalette === key;

                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        s.paletteDot,
                        {
                          backgroundColor: palette.gold,
                          borderColor: selected ? theme.text : 'transparent',
                        },
                      ]}
                      onPress={() => setAccentPalette(key)}
                      activeOpacity={0.82}
                    />
                  );
                })}
              </View>
            </View>

            <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <TouchableOpacity
                style={[s.row, { borderBottomColor: theme.border }]}
                onPress={() => openRoute('/relay-network')}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
<Text style={[s.rowTitle, { color: theme.text }]}>App Relay Network</Text>
<Text style={[s.rowHint, { color: theme.textMuted }]}>
  Personal feed, search, DM, inbox/outbox, and cache routing
</Text>
                </View>
                <Text style={[s.rowAction, { color: theme.gold }]}>Open</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.row, { borderBottomColor: theme.border }]}
                onPress={() => openRoute('/identity-keys')}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: theme.text }]}>Identity & Keys</Text>
                  <Text style={[s.rowHint, { color: theme.textMuted }]}>
                    {useAmber
                      ? 'External signer connected for identity/profile only'
                      : 'Local key active for full Space posting'}
                  </Text>
                </View>
                <Text style={[s.rowAction, { color: theme.gold }]}>Open</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.row, { borderBottomColor: theme.border }]}
                onPress={() => openRoute('/(tabs)/settings')}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: theme.text }]}>Full Settings</Text>
                  <Text style={[s.rowHint, { color: theme.textMuted }]}>
                    Safety, storage, version, and account controls
                  </Text>
                </View>
                <Text style={[s.rowAction, { color: theme.gold }]}>Open</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.row, s.rowLast]}
                onPress={handleLogOut}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: '#b33' }]}>Log Out</Text>
                  <Text style={[s.rowHint, { color: theme.textMuted }]}>
                    Remove this identity from this device
                  </Text>
                </View>
                <Text style={[s.rowAction, { color: '#b33' }]}>Exit</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 0.5,
    maxHeight: '78%',
    paddingTop: 10,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 10,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 28,
    gap: 12,
  },
  profileCard: {
    borderWidth: 0.5,
    borderRadius: 22,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  avatarFallback: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: '900',
  },
  profileName: {
    fontSize: 17,
    fontWeight: '900',
  },
  profileSub: {
    fontSize: 11,
    marginTop: 3,
    fontFamily: 'monospace',
  },
  openText: {
    fontSize: 13,
    fontWeight: '900',
  },
  card: {
    borderWidth: 0.5,
    borderRadius: 22,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  cardHint: {
    fontSize: 12,
    marginTop: 2,
  },
  modePill: {
    borderWidth: 0.5,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modePillText: {
    fontSize: 12,
    fontWeight: '900',
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  paletteDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  rowHint: {
    fontSize: 11,
    marginTop: 3,
    lineHeight: 15,
  },
  rowAction: {
    fontSize: 12,
    fontWeight: '900',
  },
});