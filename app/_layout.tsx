import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-get-random-values';
import {
  ACCENT_PALETTE_STORAGE_KEY,
  Colors,
  getColors,
  type AccentPaletteKey,
} from '../src/constants/theme';
import { startDMService, stopDMService } from '../src/utils/dm-service';
import { clearDMStorage } from '../src/utils/dm-storage';
import { fetchNostrProfile, getStoredIdentity, type NostrProfile } from '../src/utils/nostr';
import { syncSocialGraphInBackground } from '../src/utils/nostr-social';
import {
  installNotificationResponseHandler,
  registerForPushNotifications,
} from '../src/utils/push-notifications';
import {
  clearSocialGraphCache,
  getSocialRelaysForNpub,
  saveSocialRelaysForNpub,
} from '../src/utils/social-graph-storage';
import { clearStartupJobs, enqueueStartupJob, startStartupScheduler } from '../src/utils/startup-scheduler';
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
  accentPalette: AccentPaletteKey;
  setAccentPalette: (palette: AccentPaletteKey) => void;
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
  accentPalette: 'classic',
  setAccentPalette: () => {},
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
  const [relays, setRelaysState] = useState<string[]>(['wss://relay.beginningend.com']);
  const router = useRouter() as any;
  const segments = useSegments() as any;
  const [themeMode, setThemeModeState] = useState<'dark' | 'light'>('dark');
  const [accentPalette, setAccentPaletteState] = useState<AccentPaletteKey>('classic');
  const theme = getColors(themeMode, accentPalette);

  useEffect(() => {
  if (!ready) return;

  const removeNotificationHandler = installNotificationResponseHandler(router);

  return () => {
    removeNotificationHandler();
  };
}, [ready, router]);

useEffect(() => {
  if (!ready || !npub) return;

  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRegisterAttempt = 0;

  const registerPush = async (reason: string) => {
    if (cancelled || !npub) return;

    const now = Date.now();

    if (now - lastRegisterAttempt < 10000) {
      console.log('[LAYOUT] skipped push registration; recently attempted:', reason);
      return;
    }

    lastRegisterAttempt = now;

    console.log('[LAYOUT] registering push notifications:', reason);

    const token = await registerForPushNotifications(npub);

    if (!token && !cancelled) {
      if (retryTimer) {
        clearTimeout(retryTimer);
      }

      retryTimer = setTimeout(() => {
        registerPush('retry');
      }, 8000);
    }
  };

  const appStateSub = AppState.addEventListener('change', state => {
    if (state === 'active') {
      registerPush('app-active');
    }
  });

  return () => {
    cancelled = true;

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    appStateSub.remove();
  };
}, [ready, npub]);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('be_theme_mode'),
      AsyncStorage.getItem(ACCENT_PALETTE_STORAGE_KEY),
    ]).then(([savedThemeMode, savedAccentPalette]) => {
      if (savedThemeMode === 'light' || savedThemeMode === 'dark') {
        setThemeModeState(savedThemeMode);
      }

      if (
        savedAccentPalette === 'classic' ||
        savedAccentPalette === 'blue' ||
        savedAccentPalette === 'green' ||
        savedAccentPalette === 'crimson' ||
        savedAccentPalette === 'purple'
      ) {
        setAccentPaletteState(savedAccentPalette);
      }
    });
  }, []);
  
  useEffect(() => {
    let cancelled = false;

    Promise.all([getStoredIdentity(), getFamily()]).then(async ([id, fam]) => {
      console.log('[LAYOUT] checking identity + family');

      if (cancelled) return;

      if (id) {
        console.log('[LAYOUT] identity found, deferring heavy DM restore');
        setNpub(id.npub);
        setNsec(id.nsec);

        const savedRelays = await getSocialRelaysForNpub(id.npub);

        if (!cancelled) {
          setRelaysState(savedRelays);
        }

        if (fam) {
          await upsertFamilyMember({
            familyId: fam.id,
            npub: id.npub,
            displayName: 'You',
            role: fam.role === 'admin' ? 'admin' : 'member',
            status: 'active',
          });
        }
      }

      if (fam) setFamilyState(fam);

      // Mark the app ready before heavy relay/DM work starts.
      setReady(true);

      if (id) {
        startStartupScheduler();

enqueueStartupJob({
  id: 'dm-service-start',
  label: 'Start DM service',
  priority: 'idle',
  run: async () => {
    await startDMService();
  },
});

        enqueueStartupJob({
          id: 'dm-restore-from-relay',
          label: 'Restore DMs from relay',
          priority: 'idle',
          run: async () => {
            const mod = await import('../src/utils/dm-service');
            await mod.restoreDMsFromRelay();
          },
        });

enqueueStartupJob({
  id: 'push-register',
  label: 'Register push notifications',
  priority: 'idle',
  run: async () => {
    await registerForPushNotifications(id.npub);
  },
});

enqueueStartupJob({
  id: 'social-graph-background-sync',
  label: 'Refresh social graph in background',
  priority: 'idle',
  run: async () => {
    await syncSocialGraphInBackground({
      npub: id.npub,
    });
  },
});
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!npub) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      fetchNostrProfile(npub).then(p => {
        if (!cancelled && p) {
          setProfile(p);
        }
      });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [npub]);

  useEffect(() => {
  if (!ready) return;

  const inAuth = (segments[0] as string) === '(auth)';
  const currentScreen = segments[1] as string | undefined;
  const hasIdentity = !!npub;

  const allowSignedInAuthScreen =
  currentScreen === 'onboarding-intro' ||
  currentScreen === 'onboarding-purpose' ||
  currentScreen === 'onboarding-create-identity' ||
  currentScreen === 'onboarding-key-backup' ||
  currentScreen === 'onboarding-profile' ||
  currentScreen === 'onboarding-first-mark';

  if (!hasIdentity && !inAuth) {
    router.replace('/(auth)/identity' as any);
    return;
  }

  if (hasIdentity && inAuth && !allowSignedInAuthScreen) {
    router.replace('/(tabs)/messages' as any);
  }
}, [ready, npub, segments]);

  const setThemeMode = async (mode: 'dark' | 'light') => {
    setThemeModeState(mode);
    await AsyncStorage.setItem('be_theme_mode', mode);
  };

  const setAccentPalette = async (palette: AccentPaletteKey) => {
    setAccentPaletteState(palette);
    await AsyncStorage.setItem(ACCENT_PALETTE_STORAGE_KEY, palette);
  };

  const setRelays = (nextRelays: string[]) => {
    setRelaysState(nextRelays);

    if (!npub) {
      console.warn('[LAYOUT] skipped relay persistence; no active npub');
      return;
    }

    saveSocialRelaysForNpub(npub, nextRelays)
      .then(savedRelays => {
        setRelaysState(savedRelays);
      })
      .catch(error => {
        console.warn('[LAYOUT] failed to persist relays:', error);
      });
  };
  
 const setIdentity = (p: string, s: string) => {
  stopDMService();
  clearStartupJobs();

  setNpub(p);
  setNsec(s);

  // 🔥 CLEAR PROFILE (prevents cross-identity bleed)
  setProfile(null);
  setRelaysState(['wss://relay.beginningend.com']);

  // 🔥 CLEAR IDENTITY-SCOPED CACHES (prevents cross-identity bleed)
  Promise.all([
    clearDMStorage(),
    clearSocialGraphCache(),
    getSocialRelaysForNpub(p),
  ]).then(([, , savedRelays]) => {
    setRelaysState(savedRelays);

    startStartupScheduler();

enqueueStartupJob({
  id: 'push-register-after-identity',
  label: 'Register push notifications after identity change',
  priority: 'idle',
  run: async () => {
    await registerForPushNotifications(p);
  },
});

enqueueStartupJob({
  id: 'social-graph-sync-after-identity',
  label: 'Refresh social graph after identity change',
  priority: 'idle',
  run: async () => {
    await syncSocialGraphInBackground({
      npub: p,
      maxAgeSeconds: 0,
    });
  },
});

enqueueStartupJob({
  id: 'dm-service-start-after-identity',
  label: 'Start DM service after identity change',
  priority: 'idle',
  run: async () => {
    await startDMService();
  },
});

    enqueueStartupJob({
      id: 'dm-restore-after-identity',
      label: 'Restore DMs after identity change',
      priority: 'idle',
      run: async () => {
        const mod = await import('../src/utils/dm-service');
        await mod.restoreDMsFromRelay();
      },
    });
  });
};
  const clear = () => {
    setNpub(null);
    setNsec(null);
    setUseAmber(false);
    setProfile(null);
    setRelaysState(['wss://relay.beginningend.com']);
    clearStartupJobs();
    clearSocialGraphCache();
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
  <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
    <IdentityContext.Provider value={{
  npub, nsec, setIdentity, clearIdentity: clear,
  useAmber, setUseAmber,
  family, setFamily,
  profile, setProfile,
  relays, setRelays,
  themeMode,
  setThemeMode,
  accentPalette,
  setAccentPalette,
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

  {/* PUSH SCREENS */}
  <Stack.Screen name="mark-detail" options={{ headerShown: false, animation: 'slide_from_right' }} />
  <Stack.Screen name="group-thread" options={{ headerShown: false, animation: 'slide_from_right' }} />
  <Stack.Screen name="group-detail" options={{ headerShown: false, animation: 'slide_from_right' }} />
    </Stack>
    </IdentityContext.Provider>
  </GestureHandlerRootView>
);
}
