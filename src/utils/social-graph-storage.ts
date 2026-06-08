import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_RELAY, FAST_RELAYS, getStoredIdentity } from './nostr';

const SOCIAL_GRAPH_CACHE_KEY = 'be_social_graph_cache_v1';
const SOCIAL_RELAYS_KEY = 'be_social_relays_v1';

async function getScopedStorageKey(baseKey: string): Promise<string> {
  try {
    const identity = await getStoredIdentity();
    const npub = identity?.npub?.trim();

    if (!npub) return baseKey;

    return `${baseKey}:${npub}`;
  } catch {
    return baseKey;
  }
}

async function getScopedSocialGraphCacheKey(): Promise<string> {
  return getScopedStorageKey(SOCIAL_GRAPH_CACHE_KEY);
}

async function getScopedSocialRelaysKey(): Promise<string> {
  return getScopedStorageKey(SOCIAL_RELAYS_KEY);
}

function getSocialRelaysKeyForNpub(npub?: string | null): string {
  const cleanNpub = npub?.trim();

  if (!cleanNpub) return SOCIAL_RELAYS_KEY;

  return `${SOCIAL_RELAYS_KEY}:${cleanNpub}`;
}

export type SocialGraphPerson = {
  pubkey: string;
  npub?: string;
  displayName?: string;
  avatarUrl?: string;
  about?: string;
  relayHints?: string[];
  followedAt?: number;
  followerSeenAt?: number;
  updatedAt?: number;
};

export type SocialGraphCache = {
  followingPubkeys: string[];
  followerPubkeys: string[];
  peopleByPubkey: Record<string, SocialGraphPerson>;
  followingUpdatedAt?: number;
  followersUpdatedAt?: number;
};

export const DEFAULT_SOCIAL_RELAYS = normalizeSocialRelayUrls([
  DEFAULT_RELAY,
  ...FAST_RELAYS,
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
]);

function isValidRelayUrl(value: string): boolean {
  const trimmed = value.trim();

  return trimmed.startsWith('wss://') || trimmed.startsWith('ws://');
}

export function normalizeSocialRelayUrls(relayUrls: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  relayUrls.forEach(relayUrl => {
    const trimmed = relayUrl.trim();

    if (!trimmed || !isValidRelayUrl(trimmed)) return;
    if (seen.has(trimmed)) return;

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
}

function emptySocialGraphCache(): SocialGraphCache {
  return {
    followingPubkeys: [],
    followerPubkeys: [],
    peopleByPubkey: {},
  };
}

function mergeUniquePubkeys(pubkeys: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  pubkeys.forEach(pubkey => {
    const clean = pubkey.trim();

    if (!clean || seen.has(clean)) return;

    seen.add(clean);
    merged.push(clean);
  });

  return merged;
}

export async function getSocialRelaysForNpub(npub?: string | null): Promise<string[]> {
  try {
    const storageKey = getSocialRelaysKeyForNpub(npub);
    const raw = await AsyncStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!Array.isArray(parsed)) {
      return [DEFAULT_RELAY];
    }

    const relays = normalizeSocialRelayUrls(parsed);

    return relays.length > 0 ? relays : [DEFAULT_RELAY];
  } catch {
    return [DEFAULT_RELAY];
  }
}

export async function saveSocialRelaysForNpub(
  npub: string | null | undefined,
  relayUrls: string[]
): Promise<string[]> {
  const relays = normalizeSocialRelayUrls(relayUrls);
  const nextRelays = relays.length > 0 ? relays : [DEFAULT_RELAY];
  const storageKey = getSocialRelaysKeyForNpub(npub);

  await AsyncStorage.setItem(storageKey, JSON.stringify(nextRelays));

  return nextRelays;
}

export async function resetSocialRelaysForNpub(npub?: string | null): Promise<string[]> {
  const storageKey = getSocialRelaysKeyForNpub(npub);
  const nextRelays = [DEFAULT_RELAY];

  await AsyncStorage.setItem(storageKey, JSON.stringify(nextRelays));

  return nextRelays;
}

export async function getSocialRelays(): Promise<string[]> {
  try {
    const storageKey = await getScopedSocialRelaysKey();
    const raw = await AsyncStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!Array.isArray(parsed)) {
      return [DEFAULT_RELAY];
    }

    const relays = normalizeSocialRelayUrls(parsed);

    return relays.length > 0 ? relays : [DEFAULT_RELAY];
  } catch {
    return [DEFAULT_RELAY];
  }
}

export async function saveSocialRelays(relayUrls: string[]): Promise<string[]> {
  const relays = normalizeSocialRelayUrls(relayUrls);
  const nextRelays = relays.length > 0 ? relays : [DEFAULT_RELAY];
  const storageKey = await getScopedSocialRelaysKey();

  await AsyncStorage.setItem(storageKey, JSON.stringify(nextRelays));

  return nextRelays;
}

export async function resetSocialRelays(): Promise<string[]> {
  const storageKey = await getScopedSocialRelaysKey();
  const nextRelays = [DEFAULT_RELAY];

  await AsyncStorage.setItem(storageKey, JSON.stringify(nextRelays));

  return nextRelays;
}

export async function getSocialGraphCache(): Promise<SocialGraphCache> {
  try {
    const storageKey = await getScopedSocialGraphCacheKey();
    const raw = await AsyncStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== 'object') {
      return emptySocialGraphCache();
    }

    return {
      followingPubkeys: Array.isArray(parsed.followingPubkeys)
        ? mergeUniquePubkeys(parsed.followingPubkeys)
        : [],
      followerPubkeys: Array.isArray(parsed.followerPubkeys)
        ? mergeUniquePubkeys(parsed.followerPubkeys)
        : [],
      peopleByPubkey:
        parsed.peopleByPubkey && typeof parsed.peopleByPubkey === 'object'
          ? parsed.peopleByPubkey
          : {},
      followingUpdatedAt:
        typeof parsed.followingUpdatedAt === 'number'
          ? parsed.followingUpdatedAt
          : undefined,
      followersUpdatedAt:
        typeof parsed.followersUpdatedAt === 'number'
          ? parsed.followersUpdatedAt
          : undefined,
    };
  } catch {
    return emptySocialGraphCache();
  }
}

export async function saveSocialGraphCache(cache: SocialGraphCache): Promise<void> {
  const safeCache: SocialGraphCache = {
    followingPubkeys: mergeUniquePubkeys(cache.followingPubkeys),
    followerPubkeys: mergeUniquePubkeys(cache.followerPubkeys),
    peopleByPubkey: cache.peopleByPubkey ?? {},
    followingUpdatedAt: cache.followingUpdatedAt,
    followersUpdatedAt: cache.followersUpdatedAt,
  };

  const storageKey = await getScopedSocialGraphCacheKey();

  await AsyncStorage.setItem(storageKey, JSON.stringify(safeCache));
}

export async function saveFollowingPubkeys(
  followingPubkeys: string[],
  people: SocialGraphPerson[] = []
): Promise<SocialGraphCache> {
  const current = await getSocialGraphCache();
  const peopleByPubkey = { ...current.peopleByPubkey };
  const now = Math.floor(Date.now() / 1000);

  people.forEach(person => {
    if (!person.pubkey) return;

    peopleByPubkey[person.pubkey] = {
      ...peopleByPubkey[person.pubkey],
      ...person,
      pubkey: person.pubkey,
      followedAt: person.followedAt ?? peopleByPubkey[person.pubkey]?.followedAt ?? now,
      updatedAt: now,
    };
  });

  const nextCache: SocialGraphCache = {
    ...current,
    followingPubkeys: mergeUniquePubkeys(followingPubkeys),
    peopleByPubkey,
    followingUpdatedAt: now,
  };

  await saveSocialGraphCache(nextCache);

  return nextCache;
}

export async function saveFollowerPubkeys(
  followerPubkeys: string[],
  people: SocialGraphPerson[] = []
): Promise<SocialGraphCache> {
  const current = await getSocialGraphCache();
  const peopleByPubkey = { ...current.peopleByPubkey };
  const now = Math.floor(Date.now() / 1000);

  people.forEach(person => {
    if (!person.pubkey) return;

    peopleByPubkey[person.pubkey] = {
      ...peopleByPubkey[person.pubkey],
      ...person,
      pubkey: person.pubkey,
      followerSeenAt: person.followerSeenAt ?? peopleByPubkey[person.pubkey]?.followerSeenAt ?? now,
      updatedAt: now,
    };
  });

  const nextCache: SocialGraphCache = {
    ...current,
    followerPubkeys: mergeUniquePubkeys(followerPubkeys),
    peopleByPubkey,
    followersUpdatedAt: now,
  };

  await saveSocialGraphCache(nextCache);

  return nextCache;
}

export async function upsertSocialGraphPeople(
  people: SocialGraphPerson[]
): Promise<SocialGraphCache> {
  const current = await getSocialGraphCache();
  const peopleByPubkey = { ...current.peopleByPubkey };
  const now = Math.floor(Date.now() / 1000);

  people.forEach(person => {
    if (!person.pubkey) return;

    peopleByPubkey[person.pubkey] = {
      ...peopleByPubkey[person.pubkey],
      ...person,
      pubkey: person.pubkey,
      updatedAt: now,
    };
  });

  const nextCache: SocialGraphCache = {
    ...current,
    peopleByPubkey,
  };

  await saveSocialGraphCache(nextCache);

  return nextCache;
}

export async function addFollowingPerson(
  person: SocialGraphPerson
): Promise<SocialGraphCache> {
  const current = await getSocialGraphCache();
  const now = Math.floor(Date.now() / 1000);

  const cleanPubkey = person.pubkey.trim();

  if (!cleanPubkey) {
    return current;
  }

  const existingPerson = current.peopleByPubkey[cleanPubkey];

  const nextPerson: SocialGraphPerson = {
    ...existingPerson,
    ...person,
    pubkey: cleanPubkey,
    followedAt: existingPerson?.followedAt ?? person.followedAt ?? now,
    updatedAt: now,
  };

  const nextCache: SocialGraphCache = {
    ...current,
    followingPubkeys: mergeUniquePubkeys([
      ...current.followingPubkeys,
      cleanPubkey,
    ]),
    peopleByPubkey: {
      ...current.peopleByPubkey,
      [cleanPubkey]: nextPerson,
    },
    followingUpdatedAt: now,
  };

  await saveSocialGraphCache(nextCache);

  return nextCache;
}

export async function isFollowingPubkey(pubkey: string): Promise<boolean> {
  const cache = await getSocialGraphCache();

  return cache.followingPubkeys.includes(pubkey);
}

export async function clearSocialGraphCache(): Promise<void> {
  const storageKey = await getScopedSocialGraphCacheKey();

  await AsyncStorage.removeItem(storageKey);
}