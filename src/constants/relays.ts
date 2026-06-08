export type RelayDirectoryItem = {
  url: string;
  label: string;
  category: 'recommended' | 'public' | 'search' | 'specialized' | 'paid';
  description?: string;
};

export const STARTER_RELAY_DIRECTORY: RelayDirectoryItem[] = [
  {
    url: 'wss://relay.beginningend.com',
    label: 'bE Relay',
    category: 'recommended',
    description: 'bE Marks home relay.',
  },
  {
    url: 'wss://relay.damus.io',
    label: 'Damus',
    category: 'public',
    description: 'Popular public Nostr relay.',
  },
  {
    url: 'wss://nos.lol',
    label: 'nos.lol',
    category: 'public',
    description: 'Popular public Nostr relay.',
  },
  {
    url: 'wss://relay.snort.social',
    label: 'Snort',
    category: 'public',
    description: 'Public Nostr relay used by Snort/Iris-style clients.',
  },
  {
    url: 'wss://relay.nostr.band',
    label: 'Nostr.band',
    category: 'search',
    description: 'Search-focused relay.',
  },
];

export const DEFAULT_RELAYS = STARTER_RELAY_DIRECTORY.map(relay => relay.url);

export const RELAY_LABELS: Record<string, string> = STARTER_RELAY_DIRECTORY.reduce(
  (labels, relay) => ({
    ...labels,
    [relay.url]: relay.label,
  }),
  {} as Record<string, string>
);