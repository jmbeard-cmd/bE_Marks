import { nip19 } from 'nostr-tools';

export type ParsedBEContactCard = {
  type: 'be_contact_v1';
  npub: string;
  pubkeyHex: string;
  displayName: string;
  picture?: string;
  relayUrl?: string;
  raw: string;
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNpubOrHex(value: string): {
  npub: string;
  pubkeyHex: string;
} | null {
  const clean = value.trim();

  if (!clean) return null;

  const withoutScheme = clean
    .replace(/^nostr:/i, '')
    .replace(/^web\+nostr:/i, '')
    .trim();

  if (/^npub1/i.test(withoutScheme)) {
    try {
      const decoded = nip19.decode(withoutScheme);

      if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
        return null;
      }

      return {
        npub: withoutScheme,
        pubkeyHex: decoded.data.toLowerCase(),
      };
    } catch {
      return null;
    }
  }

  if (/^[0-9a-f]{64}$/i.test(withoutScheme)) {
    const pubkeyHex = withoutScheme.toLowerCase();

    return {
      npub: nip19.npubEncode(pubkeyHex),
      pubkeyHex,
    };
  }

  return null;
}

export function parseBEContactCard(rawInput: string): ParsedBEContactCard | null {
  const raw = rawInput.trim();

  if (!raw) return null;

  const plainIdentity = parseNpubOrHex(raw);

  if (plainIdentity) {
    return {
      type: 'be_contact_v1',
      npub: plainIdentity.npub,
      pubkeyHex: plainIdentity.pubkeyHex,
      displayName: `${plainIdentity.npub.slice(0, 14)}…`,
      raw,
    };
  }

  try {
    const parsed = JSON.parse(raw);

    const cardType = cleanString(parsed?.type);

    if (cardType !== 'be_contact_v1') {
      return null;
    }

    const identity =
      parseNpubOrHex(cleanString(parsed?.npub)) ||
      parseNpubOrHex(cleanString(parsed?.pubkeyHex)) ||
      parseNpubOrHex(cleanString(parsed?.pubkey));

    if (!identity) return null;

    const displayName =
      cleanString(parsed?.displayName) ||
      cleanString(parsed?.name) ||
      cleanString(parsed?.nostrName) ||
      `${identity.npub.slice(0, 14)}…`;

    const picture =
      cleanString(parsed?.picture) ||
      cleanString(parsed?.avatarUrl) ||
      cleanString(parsed?.nostrAvatar);

    const relayUrl = cleanString(parsed?.relayUrl);

    return {
      type: 'be_contact_v1',
      npub: identity.npub,
      pubkeyHex: identity.pubkeyHex,
      displayName,
      picture: picture || undefined,
      relayUrl: relayUrl || undefined,
      raw,
    };
  } catch {
    return null;
  }
}