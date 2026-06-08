import { DEFAULT_RELAYS, RELAY_LABELS, type RelayDirectoryItem } from '@/src/constants/relays';

export type RelayDirectorySource = 'starter' | 'nostr-watch-online' | 'nostr-watch-public' | 'custom';

export type RelayDirectoryResult = RelayDirectoryItem & {
  source: RelayDirectorySource;
  online?: boolean;
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

  return relays.filter(relay => {
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
  });
}