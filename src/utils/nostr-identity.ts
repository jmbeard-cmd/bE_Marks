import { nip19 } from 'nostr-tools';

export type NormalizedNostrIdentity = {
  input: string;
  pubkey: string;      // hex pubkey
  npub?: string;       // display-friendly
};

function isHexPubkey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export function normalizeNostrIdentity(input: string): NormalizedNostrIdentity {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error('Enter a Nostr public key');
  }

  // Case 1: raw hex pubkey
  if (isHexPubkey(trimmed)) {
    return {
      input: trimmed,
      pubkey: trimmed.toLowerCase(),
      npub: nip19.npubEncode(trimmed.toLowerCase()),
    };
  }

  // Case 2: npub
  if (trimmed.startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);

    if (decoded.type !== 'npub') {
      throw new Error('That npub is not valid');
    }

    return {
      input: trimmed,
      pubkey: decoded.data.toLowerCase(),
      npub: trimmed,
    };
  }

  // We’ll add nprofile support in the next step if you want.
  throw new Error('Use a hex pubkey or npub');
}