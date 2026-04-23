import * as ExpoContacts from 'expo-contacts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BEHeader from '../../components/BEHeader';
import { BEContact, getContacts, saveContact } from '../../src/utils/contacts-storage';
import { createThread, deleteThread, getDMThreads, type DMThread } from '../../src/utils/dm-storage';
import { fetchNostrProfile } from '../../src/utils/nostr';
import { normalizeNostrIdentity } from '../../src/utils/nostr-identity';

// expo-contacts types all fields as optional — alias them here so
// TypeScript is satisfied everywhere we use device contact data.
type DeviceContact = {
  id?: string;
  name?: string;
  phoneNumbers?: Array<{ number?: string; label?: string }>;
  emails?: Array<{ email?: string; label?: string }>;
};

type Sheet = 'none' | 'new' | 'contacts' | 'addContact' | 'deviceContacts';

function formatThreadTime(unixSecs: number): string {
  const date = new Date(unixSecs * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MessagesScreen() {
  const router = useRouter();
  const [threads, setThreads] = useState<DMThread[]>([]);
  const [contacts, setContacts] = useState<BEContact[]>([]);
  const [sheet, setSheet] = useState<Sheet>('none');

  // Swipe-to-close for modal sheet
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) sheetTranslateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(sheetTranslateY, {
            toValue: 600,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            sheetTranslateY.setValue(0);
            closeSheet();
          });
        } else {
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // New thread form
  const [newTitle, setNewTitle] = useState('');
  const [newNpub, setNewNpub] = useState('');
  const [creating, setCreating] = useState(false);

  // Add contact form
  const [acName, setAcName] = useState('');
  const [acNpub, setAcNpub] = useState('');
  const [acPhone, setAcPhone] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  // Device contacts picker
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  // Note: ExpoContacts.Contact.id is string | undefined per the SDK types
  const [deviceSearch, setDeviceSearch] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<DeviceContact | null>(null);
  const [deviceNpub, setDeviceNpub] = useState('');

  const loadData = useCallback(async () => {
    const [t, c] = await Promise.all([getDMThreads(), getContacts()]);
    setThreads(t);
    setContacts(c);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const closeSheet = () => {
    setSheet('none');
    setNewTitle(''); setNewNpub('');
    setAcName(''); setAcNpub(''); setAcPhone('');
    setDeviceContacts([]); setDeviceSearch('');
    setSelectedDevice(null); setDeviceNpub('');
  };

  // ── Start a new thread ──
  const handleNewThread = async (contact?: BEContact) => {
    // Warn if picking a contact with no npub — they can't receive encrypted messages
    if (contact && !contact.npub) {
      Alert.alert(
        'No Nostr address',
        `${contact.name} doesn't have an npub yet. This will create a local-only thread. Add their npub in Contacts to enable encrypted messaging.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue anyway', onPress: () => _createThread(contact) },
        ]
      );
      return;
    }
    _createThread(contact);
  };

  const _createThread = async (contact?: BEContact) => {
    setCreating(true);
    try {
      const title = contact ? contact.name : (newTitle.trim() || 'New Conversation');
      const npubInput = contact ? (contact.npub ?? '') : newNpub.trim();
      let participantPubkey: string | undefined;
      let participantNpub: string | undefined;

      if (npubInput) {
        const normalized = normalizeNostrIdentity(npubInput);
        participantPubkey = normalized.pubkey;
        participantNpub = normalized.npub;
      }

      const thread = await createThread({ title, participantPubkey, participantNpub });
      closeSheet();
      await loadData();
      router.push({
        pathname: '/(tabs)/dm-thread',
        params: { id: thread.id, title: thread.title },
      } as any);
    } catch (error: any) {
      Alert.alert('Invalid Nostr identity', error?.message || 'Please enter a valid npub or hex pubkey.');
    }
    setCreating(false);
  };

  // ── Delete thread ──
  const handleDeleteThread = (thread: DMThread) => {
    Alert.alert(
      'Delete conversation',
      `Delete "${thread.title}"? This removes all messages on this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await deleteThread(thread.id);
            await loadData();
          }
        }
      ]
    );
  };

  // ── Save bE Contact ──
  const handleSaveContact = async () => {
    if (!acName.trim()) { Alert.alert('Name required', 'Please enter a name.'); return; }
    setSavingContact(true);
    try {
      let pubkeyHex: string | undefined;
      if (acNpub.trim()) {
        const n = normalizeNostrIdentity(acNpub.trim());
        pubkeyHex = n.pubkey;
      }
      // Try to fetch their Nostr profile for avatar
      let nostrName: string | undefined;
      let nostrAvatar: string | undefined;
      if (acNpub.trim()) {
        const profile = await fetchNostrProfile(acNpub.trim());
        if (profile) {
          nostrName = profile.display_name || profile.name;
          nostrAvatar = profile.picture;
        }
      }
      await saveContact({
        name: acName.trim(),
        npub: acNpub.trim() || undefined,
        pubkeyHex,
        phone: acPhone.trim() || undefined,
        nostrName,
        nostrAvatar,
      });
      await loadData();
      closeSheet();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save contact.');
    }
    setSavingContact(false);
  };

  // ── Import from device contacts ──
  const openDeviceContacts = async () => {
    const { status } = await ExpoContacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow bE to access contacts in your device settings.');
      return;
    }
    const { data } = await ExpoContacts.getContactsAsync({
      fields: [ExpoContacts.Fields.Name, ExpoContacts.Fields.PhoneNumbers, ExpoContacts.Fields.Emails],
      sort: ExpoContacts.SortTypes.FirstName,
    });
    setDeviceContacts((data as DeviceContact[]).filter(c => c.name));
    setSheet('deviceContacts');
  };

  const handleImportDevice = async () => {
    if (!selectedDevice) return;
    setSavingContact(true);
    try {
      let pubkeyHex: string | undefined;
      let nostrName: string | undefined;
      let nostrAvatar: string | undefined;
      if (deviceNpub.trim()) {
        const n = normalizeNostrIdentity(deviceNpub.trim());
        pubkeyHex = n.pubkey;
        const profile = await fetchNostrProfile(deviceNpub.trim());
        if (profile) {
          nostrName = profile.display_name || profile.name;
          nostrAvatar = profile.picture;
        }
      }
      const phone = selectedDevice.phoneNumbers?.[0]?.number ?? undefined;
      const email = selectedDevice.emails?.[0]?.email ?? undefined;
      await saveContact({
        name: selectedDevice.name ?? 'Unknown',
        npub: deviceNpub.trim() || undefined,
        pubkeyHex,
        phone,
        email,
        nostrName,
        nostrAvatar,
      });
      await loadData();
      closeSheet();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not import contact.');
    }
    setSavingContact(false);
  };

  const filteredDeviceContacts = deviceContacts.filter(c =>
    !deviceSearch || c.name?.toLowerCase().includes(deviceSearch.toLowerCase())
  );

  // ── Render thread card ──
  const renderThread = ({ item }: { item: DMThread }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.85}
      onPress={() => router.push({
        pathname: '/(tabs)/dm-thread',
        params: { id: item.id, title: item.title },
      } as any)}
      onLongPress={() => handleDeleteThread(item)}
    >
      <View style={[s.avatar, item.unread > 0 && s.avatarUnread]}>
        <Text style={s.avatarText}>{(item.title[0] || 'C').toUpperCase()}</Text>
      </View>
      <View style={s.cardBody}>
        <View style={s.cardTop}>
          <Text style={[s.threadTitle, item.unread > 0 && s.threadTitleUnread]}>{item.title}</Text>
          <Text style={s.time}>{formatThreadTime(item.updatedAt)}</Text>
        </View>
        <View style={s.cardBottom}>
          <Text style={[s.preview, item.unread > 0 && s.previewUnread]} numberOfLines={1}>
            {item.lastMessage || 'No messages yet'}
          </Text>
          {item.unread > 0 && (
            <View style={s.badge}><Text style={s.badgeText}>{item.unread}</Text></View>
          )}
        </View>
        {item.participantNpub && (
          <Text style={s.npubHint} numberOfLines={1}>{item.participantNpub.slice(0, 16)}…</Text>
        )}
      </View>
      <TouchableOpacity style={s.deleteBtn} onPress={() => handleDeleteThread(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={s.deleteBtnText}>⋯</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe}>
      <BEHeader title="Messages" />

      <FlatList
        data={threads}
        keyExtractor={item => item.id}
        contentContainerStyle={[s.list, threads.length === 0 && s.listEmpty]}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>✉️</Text>
            <Text style={s.emptyTitle}>No messages yet</Text>
            <Text style={s.emptyHint}>Start a private encrypted conversation.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => setSheet('new')}>
              <Text style={s.emptyBtnText}>Start a conversation</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={renderThread}
      />

      {/* Hint for delete */}
      {threads.length > 0 && (
        <Text style={s.swipeHint}>Tap ⋯ or long-press to delete a conversation</Text>
      )}

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setSheet('new')} activeOpacity={0.85}>
        <Text style={s.fabIcon}>＋</Text>
      </TouchableOpacity>

      {/* ── MODAL SHEETS ── */}
      <Modal visible={sheet !== 'none'} transparent animationType="slide" onRequestClose={closeSheet}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={s.overlay}>
              <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />

              {/* ── New Conversation ── */}
              {sheet === 'new' && (
                <Animated.View style={[s.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
                  <View style={s.sheetHandle} {...panResponder.panHandlers} />
                  <Text style={s.sheetTitle}>New Conversation</Text>
                  <Text style={s.sheetHint}>🔒 End-to-end encrypted via Nostr NIP-04</Text>

                  {/* Pick from bE contacts */}
                  {contacts.length > 0 && (
                    <>
                      <Text style={s.inputLabel}>FROM YOUR CONTACTS</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.contactPillRow}>
                        {contacts.map(c => (
                          <TouchableOpacity
                            key={c.id}
                            style={s.contactPill}
                            onPress={() => handleNewThread(c)}
                          >
                            {c.nostrAvatar ? (
                              <Image source={{ uri: c.nostrAvatar }} style={s.contactPillAvatar} />
                            ) : (
                              <View style={s.contactPillAvatarFallback}>
                                <Text style={s.contactPillLetter}>{c.avatarLetter}</Text>
                              </View>
                            )}
                            <Text style={s.contactPillName} numberOfLines={1}>{c.nostrName || c.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                      <View style={s.divider}><View style={s.dividerLine} /><Text style={s.dividerText}>or enter manually</Text><View style={s.dividerLine} /></View>
                    </>
                  )}

                  <Text style={s.inputLabel}>CONVERSATION NAME</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Mom, Dad, Legacy Crew…"
                    placeholderTextColor="#444"
                    value={newTitle}
                    onChangeText={setNewTitle}
                    returnKeyType="next"
                    autoFocus={contacts.length === 0}
                  />

                  <Text style={s.inputLabel}>NOSTR ADDRESS (OPTIONAL)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="npub1… or hex pubkey"
                    placeholderTextColor="#444"
                    value={newNpub}
                    onChangeText={setNewNpub}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                  <Text style={s.inputMeta}>Leave blank to use as a local notes thread.</Text>

                  <View style={s.sheetActions}>
                    <TouchableOpacity style={s.cancelBtn} onPress={closeSheet}>
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.confirmBtn, (!newTitle.trim() && !newNpub.trim()) && s.confirmBtnDim]}
                      onPress={() => handleNewThread()}
                      disabled={creating}
                    >
                      <Text style={s.confirmText}>{creating ? 'Starting…' : 'Start conversation'}</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Manage contacts link */}
                  <TouchableOpacity style={s.manageContactsBtn} onPress={() => setSheet('contacts')}>
                    <Text style={s.manageContactsText}>Manage bE Contacts →</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* ── Contacts List ── */}
              {sheet === 'contacts' && (
                <Animated.View style={[s.sheet, s.sheetTall, { transform: [{ translateY: sheetTranslateY }] }]}>
                  <View style={s.sheetHandle} {...panResponder.panHandlers} />
                  <View style={s.sheetHeaderRow}>
                    <Text style={s.sheetTitle}>bE Contacts</Text>
                    <View style={s.sheetHeaderActions}>
                      <TouchableOpacity style={s.sheetHeaderBtn} onPress={openDeviceContacts}>
                        <Text style={s.sheetHeaderBtnText}>Import</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.sheetHeaderBtn, s.sheetHeaderBtnGold]} onPress={() => setSheet('addContact')}>
                        <Text style={[s.sheetHeaderBtnText, { color: '#111' }]}>+ Add</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {contacts.length === 0 ? (
                    <View style={s.emptyContacts}>
                      <Text style={s.emptyContactsText}>No contacts yet.</Text>
                      <Text style={s.emptyContactsHint}>Add contacts manually or import from your phone.</Text>
                    </View>
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false}>
                      {contacts.map(c => (
                        <View key={c.id} style={s.contactRow}>
                          {c.nostrAvatar ? (
                            <Image source={{ uri: c.nostrAvatar }} style={s.contactRowAvatar} />
                          ) : (
                            <View style={s.contactRowAvatarFallback}>
                              <Text style={s.contactRowLetter}>{c.avatarLetter}</Text>
                            </View>
                          )}
                          <View style={s.contactRowBody}>
                            <Text style={s.contactRowName}>{c.nostrName || c.name}</Text>
                            {c.npub && <Text style={s.contactRowNpub}>{c.npub.slice(0, 16)}…</Text>}
                            {c.phone && <Text style={s.contactRowMeta}>{c.phone}</Text>}
                          </View>
                          <TouchableOpacity
                            style={s.contactMessageBtn}
                            onPress={() => handleNewThread(c)}
                          >
                            <Text style={s.contactMessageBtnText}>Message</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  )}

                  <TouchableOpacity style={s.cancelBtn} onPress={closeSheet}>
                    <Text style={s.cancelText}>Done</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* ── Add Contact Manually ── */}
              {sheet === 'addContact' && (
                <View style={s.sheet}>
                  <View style={s.sheetHandle} />
                  <Text style={s.sheetTitle}>Add Contact</Text>

                  <Text style={s.inputLabel}>NAME *</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Full name"
                    placeholderTextColor="#444"
                    value={acName}
                    onChangeText={setAcName}
                    autoFocus
                  />

                  <Text style={s.inputLabel}>NOSTR ADDRESS (npub) <Text style={s.requiredNote}>— required to message</Text></Text>
                  <TextInput
                    style={s.input}
                    placeholder="npub1…"
                    placeholderTextColor="#444"
                    value={acNpub}
                    onChangeText={setAcNpub}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={s.inputMeta}>Their Nostr profile and avatar will be fetched automatically.</Text>

                  <Text style={s.inputLabel}>PHONE (OPTIONAL)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Phone number"
                    placeholderTextColor="#444"
                    value={acPhone}
                    onChangeText={setAcPhone}
                    keyboardType="phone-pad"
                  />

                  <View style={s.sheetActions}>
                    <TouchableOpacity style={s.cancelBtn} onPress={() => setSheet('contacts')}>
                      <Text style={s.cancelText}>← Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.confirmBtn, !acName.trim() && s.confirmBtnDim]}
                      onPress={handleSaveContact}
                      disabled={savingContact || !acName.trim()}
                    >
                      <Text style={s.confirmText}>{savingContact ? 'Saving…' : 'Save contact'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* ── Device Contact Picker ── */}
              {sheet === 'deviceContacts' && (
                <View style={[s.sheet, s.sheetTall]}>
                  <View style={s.sheetHandle} />
                  <Text style={s.sheetTitle}>
                    {selectedDevice ? `Add npub for ${selectedDevice.name ?? 'contact'}` : 'Import from Phone'}
                  </Text>

                  {!selectedDevice ? (
                    <>
                      <TextInput
                        style={[s.input, { marginBottom: 12 }]}
                        placeholder="Search contacts…"
                        placeholderTextColor="#444"
                        value={deviceSearch}
                        onChangeText={setDeviceSearch}
                        autoFocus
                      />
                      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
                        {filteredDeviceContacts.map(c => (
                          <TouchableOpacity
                            key={String(c.id || c.name || Math.random())}
                            style={s.deviceContactRow}
                            onPress={() => setSelectedDevice(c)}
                          >
                            <View style={s.contactRowAvatarFallback}>
                              <Text style={s.contactRowLetter}>{c.name?.[0]?.toUpperCase()}</Text>
                            </View>
                            <View style={s.contactRowBody}>
                              <Text style={s.contactRowName}>{c.name}</Text>
                              {c.phoneNumbers?.[0] && (
                                <Text style={s.contactRowMeta}>{c.phoneNumbers[0].number ?? ''}</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  ) : (
                    <>
                      <Text style={s.sheetHint}>
                        Add their Nostr npub to enable encrypted messaging. You can leave it blank and add it later.
                      </Text>
                      <Text style={s.inputLabel}>NOSTR ADDRESS (npub) <Text style={s.requiredNote}>— required to message</Text></Text>
                      <TextInput
                        style={s.input}
                        placeholder="npub1…"
                        placeholderTextColor="#444"
                        value={deviceNpub}
                        onChangeText={setDeviceNpub}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                      />
                      <View style={s.sheetActions}>
                        <TouchableOpacity style={s.cancelBtn} onPress={() => setSelectedDevice(null)}>
                          <Text style={s.cancelText}>← Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.confirmBtn}
                          onPress={handleImportDevice}
                          disabled={savingContact}
                        >
                          <Text style={s.confirmText}>{savingContact ? 'Importing…' : 'Import contact'}</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}

                  {!selectedDevice && (
                    <TouchableOpacity style={[s.cancelBtn, { marginTop: 12 }]} onPress={() => setSheet('contacts')}>
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  list: { padding: 20, paddingBottom: 110 },
  listEmpty: { flexGrow: 1 },
  swipeHint: { textAlign: 'center', fontSize: 11, color: '#2a2a2a', paddingBottom: 8 },

  // Empty state
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyHint: { color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: { backgroundColor: '#c9973a', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#111', fontWeight: '700', fontSize: 14 },

  // Thread card
  card: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#222',
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  avatarUnread: { backgroundColor: '#2a1e00', borderWidth: 1.5, borderColor: '#c9973a' },
  avatarText: { color: '#c9973a', fontWeight: '700', fontSize: 19 },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' },
  threadTitle: { color: '#aaa', fontSize: 15, fontWeight: '500', flex: 1, marginRight: 8 },
  threadTitleUnread: { color: '#fff', fontWeight: '700' },
  time: { color: '#555', fontSize: 11 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  preview: { color: '#555', fontSize: 13, flex: 1, marginRight: 10 },
  previewUnread: { color: '#888' },
  npubHint: { fontSize: 10, color: '#333', marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#111', fontWeight: '700', fontSize: 11 },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  deleteBtnText: { fontSize: 20, color: '#444' },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#c9973a', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#c9973a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabIcon: { fontSize: 22 },

  // Sheets
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a1a', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40,
  },
  sheetTall: { maxHeight: '85%' },
  sheetHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 6 },
  sheetHint: { fontSize: 13, color: '#555', lineHeight: 18, marginBottom: 20 },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  sheetHeaderActions: { flexDirection: 'row', gap: 8 },
  sheetHeaderBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a', backgroundColor: '#111' },
  sheetHeaderBtnGold: { backgroundColor: '#c9973a', borderColor: '#c9973a' },
  sheetHeaderBtnText: { fontSize: 13, color: '#aaa', fontWeight: '600' },

  // Contact pills (horizontal scroll in new thread sheet)
  contactPillRow: { marginBottom: 16 },
  contactPill: { alignItems: 'center', marginRight: 16, width: 64 },
  contactPillAvatar: { width: 48, height: 48, borderRadius: 24, marginBottom: 6 },
  contactPillAvatarFallback: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  contactPillLetter: { color: '#c9973a', fontWeight: '700', fontSize: 19 },
  contactPillName: { fontSize: 11, color: '#888', textAlign: 'center' },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dividerLine: { flex: 1, height: 0.5, backgroundColor: '#2a2a2a' },
  dividerText: { fontSize: 11, color: '#444' },

  // Contact rows (list)
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  contactRowAvatar: { width: 42, height: 42, borderRadius: 21 },
  contactRowAvatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  contactRowLetter: { color: '#c9973a', fontWeight: '700', fontSize: 16 },
  contactRowBody: { flex: 1 },
  contactRowName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  contactRowNpub: { fontSize: 10, color: '#444', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  contactRowMeta: { fontSize: 12, color: '#555', marginTop: 2 },
  contactMessageBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#c9973a' },
  contactMessageBtnText: { fontSize: 12, color: '#111', fontWeight: '700' },

  // Device contacts
  deviceContactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e' },

  // Empty contacts
  emptyContacts: { paddingVertical: 40, alignItems: 'center' },
  emptyContactsText: { color: '#555', fontSize: 15, fontWeight: '500', marginBottom: 6 },
  emptyContactsHint: { color: '#333', fontSize: 13, textAlign: 'center' },

  // Manage contacts link
  manageContactsBtn: { alignItems: 'center', marginTop: 16 },
  manageContactsText: { fontSize: 13, color: '#555' },

  // Inputs
  inputLabel: { fontSize: 11, color: '#555', fontWeight: '600', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#111', borderWidth: 0.5, borderColor: '#2a2a2a',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    color: '#fff', fontSize: 15, marginBottom: 6,
  },
  inputMeta: { fontSize: 11, color: '#444', marginBottom: 16 },

  // Actions
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 0.5, borderColor: '#2a2a2a', alignItems: 'center' },
  cancelText: { color: '#555', fontSize: 14, fontWeight: '500' },
  confirmBtn: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#c9973a', alignItems: 'center' },
  confirmBtnDim: { opacity: 0.5 },
  confirmText: { color: '#111', fontWeight: '700', fontSize: 14 },
  requiredNote: { fontSize: 10, color: '#c9973a', fontWeight: '500', letterSpacing: 0.3 },
});