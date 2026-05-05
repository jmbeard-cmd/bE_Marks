import AsyncStorage from '@react-native-async-storage/async-storage';

const DM_PROFILE_CACHE_KEY = 'dm_profile_cache_v1';

export type CachedDMProfile = {
  pubkey: string;
  displayName: string;
  picture?: string;
  updatedAt: number;
};

async function readProfileCache(): Promise<Record<string, CachedDMProfile>> {
  try {
    const raw = await AsyncStorage.getItem(DM_PROFILE_CACHE_KEY);

    if (!raw) return {};

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const cache: Record<string, CachedDMProfile> = {};

    Object.entries(parsed).forEach(([key, value]) => {
      const profile = value as Partial<CachedDMProfile>;

      if (
        typeof key === 'string' &&
        !!profile &&
        typeof profile.pubkey === 'string' &&
        typeof profile.displayName === 'string' &&
        typeof profile.updatedAt === 'number'
      ) {
        cache[key] = {
          pubkey: profile.pubkey,
          displayName: profile.displayName,
          picture: typeof profile.picture === 'string' ? profile.picture : undefined,
          updatedAt: profile.updatedAt,
        };
      }
    });

    return cache;
  } catch (error) {
    console.warn('[DM Profile Cache] read failed:', error);
    return {};
  }
}

async function writeProfileCache(
  cache: Record<string, CachedDMProfile>
): Promise<void> {
  try {
    await AsyncStorage.setItem(DM_PROFILE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('[DM Profile Cache] write failed:', error);
  }
}

export async function getCachedDMProfiles(
  pubkeys: string[]
): Promise<Record<string, CachedDMProfile>> {
  const cache = await readProfileCache();
  const result: Record<string, CachedDMProfile> = {};

  for (const pubkey of pubkeys) {
    const cached = cache[pubkey];

    if (cached) {
      result[pubkey] = cached;
    }
  }

  return result;
}

export async function saveCachedDMProfile(input: {
  pubkey: string;
  displayName: string;
  picture?: string;
}): Promise<void> {
  const cache = await readProfileCache();

  cache[input.pubkey] = {
    pubkey: input.pubkey,
    displayName: input.displayName,
    picture: input.picture,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  await writeProfileCache(cache);
}
export async function clearCachedDMProfiles(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DM_PROFILE_CACHE_KEY);
  } catch (error) {
    console.warn('[DM Profile Cache] clear failed:', error);
  }
}