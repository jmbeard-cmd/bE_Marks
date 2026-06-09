import { DEFAULT_RELAYS, RELAY_LABELS, type RelayDirectoryItem } from '@/src/constants/relays';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type RelayDirectorySource =
  | 'starter'
  | 'be-relay-directory'
  | 'nostr-watch-online'
  | 'nostr-watch-public'
  | 'nostr-watch-paid'
  | 'nostr-watch-nip11'
  | 'nostr-watch-nip42'
  | 'custom';

export type RelayDirectoryResult = RelayDirectoryItem & {
  source: RelayDirectorySource;
  online?: boolean;
  paid?: boolean;
};

export type RelayInformationDocument = {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  limitation?: Record<string, unknown>;
  retention?: unknown[];
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  payments_url?: string;
  fees?: unknown;
  icon?: string;
};

const BE_RELAY_DIRECTORY_ENDPOINT =
  'https://relay-directory.beginningend.com/.well-known/be-marks-relays.json';

const RELAY_DIRECTORY_CACHE_KEY = 'be_relay_directory_cache_v1';
const RELAY_DIRECTORY_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

const BLOCKED_RELAY_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

function isPrivateRelayHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (!normalized) return true;
  if (BLOCKED_RELAY_HOSTS.has(normalized)) return true;

  if (
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('172.16.') ||
    normalized.startsWith('172.17.') ||
    normalized.startsWith('172.18.') ||
    normalized.startsWith('172.19.') ||
    normalized.startsWith('172.20.') ||
    normalized.startsWith('172.21.') ||
    normalized.startsWith('172.22.') ||
    normalized.startsWith('172.23.') ||
    normalized.startsWith('172.24.') ||
    normalized.startsWith('172.25.') ||
    normalized.startsWith('172.26.') ||
    normalized.startsWith('172.27.') ||
    normalized.startsWith('172.28.') ||
    normalized.startsWith('172.29.') ||
    normalized.startsWith('172.30.') ||
    normalized.startsWith('172.31.') ||
    normalized.startsWith('100.64.') ||
    normalized.startsWith('100.65.') ||
    normalized.startsWith('100.66.') ||
    normalized.startsWith('100.67.') ||
    normalized.startsWith('100.68.') ||
    normalized.startsWith('100.69.') ||
    normalized.startsWith('100.70.') ||
    normalized.startsWith('100.71.') ||
    normalized.startsWith('100.72.') ||
    normalized.startsWith('100.73.') ||
    normalized.startsWith('100.74.') ||
    normalized.startsWith('100.75.') ||
    normalized.startsWith('100.76.') ||
    normalized.startsWith('100.77.') ||
    normalized.startsWith('100.78.') ||
    normalized.startsWith('100.79.') ||
    normalized.startsWith('100.80.') ||
    normalized.startsWith('100.81.') ||
    normalized.startsWith('100.82.') ||
    normalized.startsWith('100.83.') ||
    normalized.startsWith('100.84.') ||
    normalized.startsWith('100.85.') ||
    normalized.startsWith('100.86.') ||
    normalized.startsWith('100.87.') ||
    normalized.startsWith('100.88.') ||
    normalized.startsWith('100.89.') ||
    normalized.startsWith('100.90.') ||
    normalized.startsWith('100.91.') ||
    normalized.startsWith('100.92.') ||
    normalized.startsWith('100.93.') ||
    normalized.startsWith('100.94.') ||
    normalized.startsWith('100.95.') ||
    normalized.startsWith('100.96.') ||
    normalized.startsWith('100.97.') ||
    normalized.startsWith('100.98.') ||
    normalized.startsWith('100.99.') ||
    normalized.startsWith('100.100.') ||
    normalized.startsWith('100.101.') ||
    normalized.startsWith('100.102.') ||
    normalized.startsWith('100.103.') ||
    normalized.startsWith('100.104.') ||
    normalized.startsWith('100.105.') ||
    normalized.startsWith('100.106.') ||
    normalized.startsWith('100.107.') ||
    normalized.startsWith('100.108.') ||
    normalized.startsWith('100.109.') ||
    normalized.startsWith('100.110.') ||
    normalized.startsWith('100.111.') ||
    normalized.startsWith('100.112.') ||
    normalized.startsWith('100.113.') ||
    normalized.startsWith('100.114.') ||
    normalized.startsWith('100.115.') ||
    normalized.startsWith('100.116.') ||
    normalized.startsWith('100.117.') ||
    normalized.startsWith('100.118.') ||
    normalized.startsWith('100.119.') ||
    normalized.startsWith('100.120.') ||
    normalized.startsWith('100.121.') ||
    normalized.startsWith('100.122.') ||
    normalized.startsWith('100.123.') ||
    normalized.startsWith('100.124.') ||
    normalized.startsWith('100.125.') ||
    normalized.startsWith('100.126.') ||
    normalized.startsWith('100.127.') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan')
  ) {
    return true;
  }

  return false;
}

function isValidRelayUrl(value: string): boolean {
  const trimmed = value.trim();

  return trimmed.startsWith('wss://') || trimmed.startsWith('ws://');
}

function normalizeRelayUrl(value: string): string | null {
  const trimmed = value.trim();

  if (!isValidRelayUrl(trimmed)) return null;

  const withoutTrailingSlash = trimmed.replace(/\/$/, '');

  try {
    const parsed = new URL(withoutTrailingSlash);

    if (parsed.protocol !== 'wss:') return null;
    if (isPrivateRelayHostname(parsed.hostname)) return null;

    parsed.hash = '';
    parsed.search = '';

    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';

    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

function relayLabelFromUrl(relayUrl: string): string {
  const knownLabel = RELAY_LABELS[relayUrl];

  if (knownLabel) return knownLabel;

  return relayUrl
    .replace(/^wss?:\/\//i, '')
    .replace(/\/$/, '');
}

function relayCategoryFromSource(
  source: RelayDirectorySource,
  paid?: boolean
): RelayDirectoryItem['category'] {
  if (source === 'starter') return 'recommended';
  if (paid || source === 'nostr-watch-paid') return 'paid';
  if (source === 'nostr-watch-nip11' || source === 'nostr-watch-nip42') return 'specialized';

  return 'public';
}

function relayDirectoryItemFromUrl(
  relayUrl: string,
  source: RelayDirectorySource,
  options: {
    online?: boolean;
    paid?: boolean;
  } = {}
): RelayDirectoryResult | null {
  const normalized = normalizeRelayUrl(relayUrl);

  if (!normalized) return null;

  return {
    url: normalized,
    label: relayLabelFromUrl(normalized),
    category: relayCategoryFromSource(source, options.paid),
    source,
    online: options.online,
    paid: options.paid,
  };
}

function mergeRelayDirectoryItems(items: RelayDirectoryResult[]): RelayDirectoryResult[] {
  const byUrl = new Map<string, RelayDirectoryResult>();

  items.forEach(item => {
    const normalized = normalizeRelayUrl(item.url);

    if (!normalized) return;

    const existing = byUrl.get(normalized);

    byUrl.set(normalized, {
      ...existing,
      ...item,
      url: normalized,
      label: existing?.label || item.label || relayLabelFromUrl(normalized),
      description: existing?.description || item.description,
      source: existing?.source === 'starter' ? existing.source : item.source,
      category: existing?.category === 'recommended' ? existing.category : item.category,
      online: existing?.online === true || item.online === true ? true : existing?.online ?? item.online,
      paid: existing?.paid === true || item.paid === true ? true : existing?.paid ?? item.paid,
    });
  });

  return Array.from(byUrl.values()).sort((a, b) => {
    const aStarter = DEFAULT_RELAYS.includes(a.url) ? 0 : 1;
    const bStarter = DEFAULT_RELAYS.includes(b.url) ? 0 : 1;

    if (aStarter !== bStarter) return aStarter - bStarter;

    const aOnline = a.online === true ? 0 : 1;
    const bOnline = b.online === true ? 0 : 1;

    if (aOnline !== bOnline) return aOnline - bOnline;

    return a.label.localeCompare(b.label);
  });
}

function relayUrlsFromDirectoryJson(value: unknown): string[] {
  if (typeof value === 'string') {
    return isValidRelayUrl(value) ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => relayUrlsFromDirectoryJson(item));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const urls: string[] = [];

    Object.entries(record).forEach(([key, entry]) => {
      if (isValidRelayUrl(key)) {
        urls.push(key);
      }

      if (
        key === 'url' ||
        key === 'relay' ||
        key === 'relayUrl' ||
        key === 'uri' ||
        key === 'address'
      ) {
        if (typeof entry === 'string' && isValidRelayUrl(entry)) {
          urls.push(entry);
        }

        return;
      }

      urls.push(...relayUrlsFromDirectoryJson(entry));
    });

    return Array.from(new Set(urls));
  }

  return [];
}

function relayCategoryFromValue(value: unknown): RelayDirectoryItem['category'] | null {
  if (
    value === 'recommended' ||
    value === 'public' ||
    value === 'search' ||
    value === 'specialized' ||
    value === 'paid'
  ) {
    return value;
  }

  return null;
}

function relayDirectoryResultFromWorkerItem(value: unknown): RelayDirectoryResult | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const relayUrl = typeof record.url === 'string' ? record.url : '';
  const normalized = normalizeRelayUrl(relayUrl);

  if (!normalized) return null;

  const category =
    relayCategoryFromValue(record.category) ||
    relayCategoryFromSource('be-relay-directory');

  return {
    url: normalized,
    label: typeof record.label === 'string' ? record.label : relayLabelFromUrl(normalized),
    category,
    description: typeof record.description === 'string' ? record.description : undefined,
    source: 'be-relay-directory',
    online: true,
    paid: category === 'paid',
  };
}

async function fetchRelayDirectoryFromBeWorker(): Promise<RelayDirectoryResult[]> {
  try {
    const response = await fetch(BE_RELAY_DIRECTORY_ENDPOINT);

    if (!response.ok) return [];

    const parsed = await response.json();
    const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;

    if (record && Array.isArray(record.relays)) {
      const workerRelays = record.relays
        .map(relayDirectoryResultFromWorkerItem)
        .filter((item): item is RelayDirectoryResult => item !== null);

      if (workerRelays.length > 0) {
        return workerRelays;
      }
    }

    const relayUrls = relayUrlsFromDirectoryJson(parsed);

    return relayUrls
      .map(relayUrl =>
        relayDirectoryItemFromUrl(relayUrl, 'be-relay-directory', {
          online: true,
        })
      )
      .filter((item): item is RelayDirectoryResult => item !== null);
  } catch (error) {
    console.warn('[Relay Directory] bE Worker fetch failed:', error);
    return [];
  }
}

async function readCachedRelayDirectory(): Promise<RelayDirectoryResult[]> {
  try {
    const raw = await AsyncStorage.getItem(RELAY_DIRECTORY_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== 'object') return [];

    const record = parsed as Record<string, unknown>;
    const cachedAt = typeof record.cachedAt === 'number' ? record.cachedAt : 0;

    if (Date.now() - cachedAt > RELAY_DIRECTORY_CACHE_MAX_AGE_MS) {
      return [];
    }

    if (!Array.isArray(record.relays)) return [];

    return record.relays
      .map(item => {
        if (!item || typeof item !== 'object') return null;

        const relay = item as Partial<RelayDirectoryResult>;
        const normalized = typeof relay.url === 'string' ? normalizeRelayUrl(relay.url) : null;

        if (!normalized) return null;

        return {
          url: normalized,
          label: typeof relay.label === 'string' ? relay.label : relayLabelFromUrl(normalized),
          category: relay.category || 'public',
          description: typeof relay.description === 'string' ? relay.description : undefined,
          source: relay.source || 'custom',
          online: relay.online,
          paid: relay.paid,
        } as RelayDirectoryResult;
      })
      .filter((item): item is RelayDirectoryResult => item !== null);
  } catch {
    return [];
  }
}

async function writeCachedRelayDirectory(relays: RelayDirectoryResult[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      RELAY_DIRECTORY_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        relays,
      })
    );
  } catch (error) {
    console.warn('[Relay Directory] cache write failed:', error);
  }
}

export async function fetchRelayDirectory(): Promise<RelayDirectoryResult[]> {
  const starterRelays = DEFAULT_RELAYS
    .map(relayUrl => relayDirectoryItemFromUrl(relayUrl, 'starter', { online: true }))
    .filter((item): item is RelayDirectoryResult => item !== null);

  const cachedRelays = await readCachedRelayDirectory();
  const beDirectoryRelays = await fetchRelayDirectoryFromBeWorker();

  const fetchedRelays = beDirectoryRelays;

  console.log('[Relay Directory] loaded relays:', {
    starter: starterRelays.length,
    cached: cachedRelays.length,
    beDirectory: beDirectoryRelays.length,
    fetched: fetchedRelays.length,
    totalBeforeMerge: starterRelays.length + cachedRelays.length + fetchedRelays.length,
  });

  const mergedRelays = mergeRelayDirectoryItems([
    ...starterRelays,
    ...cachedRelays,
    ...fetchedRelays,
  ]);

  if (fetchedRelays.length > 0) {
    await writeCachedRelayDirectory(mergedRelays);
  }

  return mergedRelays;
}

export function searchRelayDirectory(
  relays: RelayDirectoryResult[],
  searchText: string
): RelayDirectoryResult[] {
  const query = searchText
    .trim()
    .toLowerCase()
    .replace(/^wss?:\/\//i, '');

  const featuredLimit = 10;
  const minimumSearchLength = 3;
  const searchLimit = 30;

  const featuredRelays = relays.filter(relay => (
    relay.source === 'starter' ||
    relay.category === 'recommended' ||
    relay.category === 'search'
  ));

  const featuredUrls = new Set(featuredRelays.map(relay => relay.url));
  const fillRelays = relays.filter(relay => !featuredUrls.has(relay.url));

  if (!query || query.length < minimumSearchLength) {
    return [
      ...featuredRelays,
      ...fillRelays,
    ].slice(0, featuredLimit);
  }

  return relays
    .filter(relay => {
      const relayUrl = relay.url.toLowerCase();
      const relayHost = relayUrl.replace(/^wss?:\/\//i, '');

      return relayUrl.includes(query) || relayHost.includes(query);
    })
    .sort((a, b) => {
      const aUrl = a.url.toLowerCase();
      const bUrl = b.url.toLowerCase();
      const aHost = aUrl.replace(/^wss?:\/\//i, '');
      const bHost = bUrl.replace(/^wss?:\/\//i, '');

      const aHostStartsWithQuery = aHost.startsWith(query);
      const bHostStartsWithQuery = bHost.startsWith(query);

      if (aHostStartsWithQuery !== bHostStartsWithQuery) {
        return aHostStartsWithQuery ? -1 : 1;
      }

      const aUrlStartsWithQuery = aUrl.startsWith(query);
      const bUrlStartsWithQuery = bUrl.startsWith(query);

      if (aUrlStartsWithQuery !== bUrlStartsWithQuery) {
        return aUrlStartsWithQuery ? -1 : 1;
      }

      const aOnline = a.online === true ? 0 : 1;
      const bOnline = b.online === true ? 0 : 1;

      if (aOnline !== bOnline) return aOnline - bOnline;

      return aHost.localeCompare(bHost);
    })
    .slice(0, searchLimit);
}

export function relayInformationUrlFromRelayUrl(relayUrl: string): string | null {
  const normalized = normalizeRelayUrl(relayUrl);

  if (!normalized) return null;

  return normalized
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://');
}

function stringArrayFromValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function numberArrayFromValue(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const values = value
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item));

  return values.length > 0 ? values : undefined;
}

function relayInformationFromJson(value: unknown): RelayInformationDocument | null {
  if (!value || typeof value !== 'object') return null;

  const parsed = value as Record<string, unknown>;

  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    pubkey: typeof parsed.pubkey === 'string' ? parsed.pubkey : undefined,
    contact: typeof parsed.contact === 'string' ? parsed.contact : undefined,
    supported_nips: numberArrayFromValue(parsed.supported_nips),
    software: typeof parsed.software === 'string' ? parsed.software : undefined,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    limitation:
      parsed.limitation && typeof parsed.limitation === 'object'
        ? parsed.limitation as Record<string, unknown>
        : undefined,
    retention: Array.isArray(parsed.retention) ? parsed.retention : undefined,
    relay_countries: stringArrayFromValue(parsed.relay_countries),
    language_tags: stringArrayFromValue(parsed.language_tags),
    tags: stringArrayFromValue(parsed.tags),
    posting_policy: typeof parsed.posting_policy === 'string' ? parsed.posting_policy : undefined,
    payments_url: typeof parsed.payments_url === 'string' ? parsed.payments_url : undefined,
    fees: parsed.fees,
    icon: typeof parsed.icon === 'string' ? parsed.icon : undefined,
  };
}

export async function fetchRelayInformation(
  relayUrl: string,
  timeoutMs = 5000
): Promise<RelayInformationDocument | null> {
  const infoUrl = relayInformationUrlFromRelayUrl(relayUrl);

  if (!infoUrl) return null;

  try {
    const response = await Promise.race([
      fetch(infoUrl, {
        headers: {
          Accept: 'application/nostr+json',
        },
      }),
      new Promise<null>(resolve => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (!response || !response.ok) {
      return null;
    }

    const parsed = await response.json();

    return relayInformationFromJson(parsed);
  } catch {
    return null;
  }
}