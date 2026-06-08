import { DEFAULT_RELAYS, RELAY_LABELS, type RelayDirectoryItem } from '@/src/constants/relays';

export type RelayDirectorySource = 'starter' | 'nostr-watch-online' | 'nostr-watch-public' | 'custom';

export type RelayDirectoryResult = RelayDirectoryItem & {
  source: RelayDirectorySource;
  online?: boolean;
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

const NOSTR_WATCH_ONLINE_RELAYS_URL = 'https://api.nostr.watch/v1/online';
const NOSTR_WATCH_PUBLIC_RELAYS_URL = 'https://api.nostr.watch/v1/public';

function isValidRelayUrl(value: string): boolean {
  const trimmed = value.trim();

  return trimmed.startsWith('wss://') || trimmed.startsWith('ws://');
}

function normalizeRelayUrl(value: string): string | null {
  const trimmed = value.trim();

  if (!isValidRelayUrl(trimmed)) return null;

  return trimmed;
}

function relayLabelFromUrl(relayUrl: string): string {
  const knownLabel = RELAY_LABELS[relayUrl];

  if (knownLabel) return knownLabel;

  return relayUrl
    .replace(/^wss?:\/\//i, '')
    .replace(/\/$/, '');
}

function relayDirectoryItemFromUrl(
  relayUrl: string,
  source: RelayDirectorySource,
  online?: boolean
): RelayDirectoryResult | null {
  const normalized = normalizeRelayUrl(relayUrl);

  if (!normalized) return null;

  return {
    url: normalized,
    label: relayLabelFromUrl(normalized),
    category: source === 'starter' ? 'recommended' : 'public',
    source,
    online,
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
      online: existing?.online ?? item.online,
    });
  });

  return Array.from(byUrl.values()).sort((a, b) => {
    const aStarter = DEFAULT_RELAYS.includes(a.url) ? 0 : 1;
    const bStarter = DEFAULT_RELAYS.includes(b.url) ? 0 : 1;

    if (aStarter !== bStarter) return aStarter - bStarter;

    return a.label.localeCompare(b.label);
  });
}

async function fetchRelayUrlsFromJsonEndpoint(
  url: string,
  source: RelayDirectorySource
): Promise<RelayDirectoryResult[]> {
  try {
    const response = await fetch(url);

    if (!response.ok) return [];

    const parsed = await response.json();

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map(relayUrl => relayDirectoryItemFromUrl(relayUrl, source, true))
      .filter((item): item is RelayDirectoryResult => item !== null);
  } catch (error) {
    console.warn('[Relay Directory] fetch failed:', source, error);
    return [];
  }
}

export async function fetchRelayDirectory(): Promise<RelayDirectoryResult[]> {
  const starterRelays = DEFAULT_RELAYS
    .map(relayUrl => relayDirectoryItemFromUrl(relayUrl, 'starter', undefined))
    .filter((item): item is RelayDirectoryResult => item !== null);

  const [onlineRelays, publicRelays] = await Promise.all([
    fetchRelayUrlsFromJsonEndpoint(NOSTR_WATCH_ONLINE_RELAYS_URL, 'nostr-watch-online'),
    fetchRelayUrlsFromJsonEndpoint(NOSTR_WATCH_PUBLIC_RELAYS_URL, 'nostr-watch-public'),
  ]);

  return mergeRelayDirectoryItems([
    ...starterRelays,
    ...onlineRelays,
    ...publicRelays,
  ]);
}

export function searchRelayDirectory(
  relays: RelayDirectoryResult[],
  searchText: string
): RelayDirectoryResult[] {
  const query = searchText.trim().toLowerCase();

  if (!query) return relays;

  return relays
    .filter(relay => {
      const searchableText = [
        relay.url,
        relay.label,
        relay.category,
        relay.description,
        relay.source,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableText.includes(query);
    })
    .sort((a, b) => {
      const aUrl = a.url.toLowerCase();
      const bUrl = b.url.toLowerCase();
      const aLabel = a.label.toLowerCase();
      const bLabel = b.label.toLowerCase();

      const aStartsWithQuery = aUrl.startsWith(query) || aLabel.startsWith(query);
      const bStartsWithQuery = bUrl.startsWith(query) || bLabel.startsWith(query);

      if (aStartsWithQuery !== bStartsWithQuery) {
        return aStartsWithQuery ? -1 : 1;
      }

      return a.label.localeCompare(b.label);
    });
}

export function relayInformationUrlFromRelayUrl(relayUrl: string): string | null {
  const normalized = normalizeRelayUrl(relayUrl);

  if (!normalized) return null;

  return normalized
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
    .replace(/\/$/, '');
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
  } catch (error) {
    console.warn('[Relay Directory] relay info fetch failed:', relayUrl, error);
    return null;
  }
}