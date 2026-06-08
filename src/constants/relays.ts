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
];

export const DEFAULT_RELAYS = STARTER_RELAY_DIRECTORY.map(relay => relay.url);

export const RELAY_LABELS: Record<string, string> = STARTER_RELAY_DIRECTORY.reduce(
  (labels, relay) => ({
    ...labels,
    [relay.url]: relay.label,
  }),
  {} as Record<string, string>
);