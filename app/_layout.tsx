import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { createContext, useContext, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-get-random-values';
import { Colors } from '../src/constants/theme';
import { startDMService, stopDMService } from '../src/utils/dm-service';
import { fetchNostrProfile, getStoredIdentity, type NostrProfile } from '../src/utils/nostr';
import {
  getFamily,
  leaveFamily,
  saveFamily,
  upsertFamilyMember,
  type Family,
} from '../src/utils/storage';

interface IdentityContextType {
  npub: string | null;
  nsec: string | null;
  setIdentity: (npub: string, nsec: string) => void;
  clearIdentity: () => void;
  useAmber: boolean;
  setUseAmber: (v: boolean) => void;
  family: Family | null;
  setFamily: (f: Family | null) => void;
  profile: NostrProfile | null;
  setProfile: (p: NostrProfile | null) => void;
  relays: string[];
  setRelays: (r: string[]) => void;
  themeMode: 'dark' | 'light';
setThemeMode: (mode: 'dark' | 'light') => void;
theme: typeof Colors.dark;
}

export const IdentityContext = createContext<IdentityContextType>({
  npub: null,
  nsec: null,
  setIdentity: () => {},
  clearIdentity: () => {},
  useAmber: false,
  setUseAmber: () => {},
  family: null,
  setFamily: () => {},
  profile: null,
  setProfile: () => {},
  relays: ['wss://relay.beginningend.com'],
  setRelays: () => {},
  themeMode: 'dark',
setThemeMode: () => {},
theme: Colors.dark,
});

export function useIdentity() {
  return useContext(IdentityContext);
}

export default function RootLayout() {
  const [npub, setNpub] = useState<string | null>(null);
  const [nsec, setNsec] = useState<string | null>(null);
  const [useAmber, setUseAmber] = useState(false);
  const [ready, setReady] = useState(false);
  const [family, setFamilyState] = useState<Family | null>(null);
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [relays, setRelays] = useState<string[]>(['wss://relay.beginningend.com']);
  const router = useRouter() as any;
  const segments = useSegments() as any;
  const [themeMode, setThemeModeState] = useState<'dark' | 'light'>('dark');
  const theme = Colors[themeMode];

    useEffect(() => {
  AsyncStorage.getItem('be_theme_mode').then(saved => {
    if (saved === 'light' || saved === 'dark') {
      setThemeModeState(saved);
    }
  });
}, []);
  
  useEffect(() => {
    Promise.all([getStoredIdentity(), getFamily()]).then(async ([id, fam]) => {
      console.log('[LAYOUT] checking identity + starting DM service');
      if (id) {
        console.log('[LAYOUT] identity found, starting DM service');
        setNpub(id.npub);
        setNsec(id.nsec);

        if (fam) {
          await upsertFamilyMember({
            familyId: fam.id,
            npub: id.npub,
            displayName: 'You',
            role: fam.role === 'admin' ? 'admin' : 'member',
            status: 'active',
          });
        }

        // Start background DM listener on app launch if already signed in
        console.log('[LAYOUT] calling startDMService');
startDMService();
      }

      if (fam) setFamilyState(fam);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!npub) { setProfile(null); return; }
    fetchNostrProfile(npub).then(p => { if (p) setProfile(p); });
  }, [npub]);

  useEffect(() => {
    if (!ready) return;
    const inAuth = (segments[0] as string) === '(auth)';
    const hasIdentity = !!npub;
    if (!hasIdentity && !inAuth) router.replace('/(auth)/identity' as any);
    if (hasIdentity && inAuth) router.replace('/(tabs)/timeline' as any);
  }, [ready, npub]);

  const setThemeMode = async (mode: 'dark' | 'light') => {
  setThemeModeState(mode);
  await AsyncStorage.setItem('be_theme_mode', mode);
};
  
  const setIdentity = (p: string, s: string) => {
    setNpub(p);
    setNsec(s);
    // Start background DM listener when identity is established
    startDMService();
  };
  const clear = () => {
    setNpub(null);
    setNsec(null);
    setUseAmber(false);
    setProfile(null);
    // Stop background listener on sign out
    stopDMService();
  };

      const setFamily = async (f: Family | null) => {
    if (f) {
      await saveFamily(f);
      setFamilyState(f);

      if (npub) {
        await upsertFamilyMember({
          familyId: f.id,
          npub,
          displayName: profile?.name || 'You',
          role: f.role === 'admin' ? 'admin' : 'member',
          status: 'active',
        });
      }

      return;
    }

    await leaveFamily();
    setFamilyState(null);
  };

  return (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <IdentityContext.Provider value={{
  npub, nsec, setIdentity, clearIdentity: clear,
  useAmber, setUseAmber,
  family, setFamily,
  profile, setProfile,
  relays, setRelays,
  themeMode,
  setThemeMode,
  theme,
}}>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <Stack
  screenOptions={{
    headerShown: false,
    contentStyle: { backgroundColor: theme.bg },
  } as any}
>
  {/* DEFAULT APP FLOW */}
  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

  {/* AUTH */}
  <Stack.Screen name="(auth)" options={{ headerShown: false }} />

  {/* PUSH SCREENS */}
  <Stack.Screen name="dm-thread" options={{ headerShown: false, animation: 'slide_from_right' }} />
  <Stack.Screen name="mark-detail" options={{ headerShown: false, animation: 'slide_from_right' }} />
  <Stack.Screen name="group-thread" options={{ headerShown: false, animation: 'slide_from_right' }} />
  <Stack.Screen name="group-detail" options={{ headerShown: false, animation: 'slide_from_right' }} />
    </Stack>
    </IdentityContext.Provider>
  </GestureHandlerRootView>
);
}