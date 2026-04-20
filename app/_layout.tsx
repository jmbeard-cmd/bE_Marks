import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { createContext, useContext, useEffect, useState } from 'react';
import 'react-native-get-random-values';
import { getStoredIdentity } from '../src/utils/nostr';
import { getFamily, leaveFamily, saveFamily, type Family } from '../src/utils/storage';

interface IdentityContextType {
  npub: string | null;
  nsec: string | null;
  setIdentity: (npub: string, nsec: string) => void;
  clearIdentity: () => void;
  useAmber: boolean;
  setUseAmber: (v: boolean) => void;
  family: Family | null;
  setFamily: (f: Family | null) => void;
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
  const router = useRouter() as any;
  const segments = useSegments() as any;

  useEffect(() => {
    Promise.all([getStoredIdentity(), getFamily()]).then(([id, fam]) => {
      if (id) { setNpub(id.npub); setNsec(id.nsec); }
      if (fam) setFamilyState(fam);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inAuth = (segments[0] as string) === '(auth)';
    const hasIdentity = !!npub;
    if (!hasIdentity && !inAuth) router.replace('/(auth)/identity' as any);
    if (hasIdentity && inAuth) router.replace('/(tabs)/log' as any);
  }, [ready, npub]);

  const setIdentity = (p: string, s: string) => { setNpub(p); setNsec(s); };
  const clear = () => { setNpub(null); setNsec(null); setUseAmber(false); };

  const setFamily = async (f: Family | null) => {
    if (f) { await saveFamily(f); setFamilyState(f); }
    else { await leaveFamily(); setFamilyState(null); }
  };

  return (
    <IdentityContext.Provider value={{
      npub, nsec, setIdentity, clearIdentity: clear,
      useAmber, setUseAmber,
      family, setFamily,
    }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false } as any} />
    </IdentityContext.Provider>
  );
}