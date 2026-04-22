import * as SecureStore from 'expo-secure-store';

const CONTACTS_KEY = 'be_contacts_v1';

export type BEContact = {
  id: string;
  name: string;
  npub?: string;         // Nostr public key (npub format)
  pubkeyHex?: string;    // Hex pubkey derived from npub
  phone?: string;        // Optional — pulled from device contact
  email?: string;        // Optional — pulled from device contact
  avatarLetter: string;  // First letter of name, precomputed
  nostrName?: string;    // Fetched from Nostr profile (kind 0)
  nostrAvatar?: string;  // Fetched from Nostr profile picture URL
  createdAt: number;
};

async function readContacts(): Promise<BEContact[]> {
  try {
    const raw = await SecureStore.getItemAsync(CONTACTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeContacts(contacts: BEContact[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(CONTACTS_KEY, JSON.stringify(contacts));
  } catch {}
}

export async function getContacts(): Promise<BEContact[]> {
  const contacts = await readContacts();
  return contacts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveContact(input: Omit<BEContact, 'id' | 'avatarLetter' | 'createdAt'>): Promise<BEContact> {
  const contacts = await readContacts();
  const contact: BEContact = {
    ...input,
    id: `contact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    avatarLetter: input.name.trim()[0]?.toUpperCase() || '?',
    createdAt: Math.floor(Date.now() / 1000),
  };
  contacts.push(contact);
  await writeContacts(contacts);
  return contact;
}

export async function updateContact(id: string, updates: Partial<BEContact>): Promise<void> {
  const contacts = await readContacts();
  const updated = contacts.map(c =>
    c.id === id
      ? { ...c, ...updates, avatarLetter: (updates.name ?? c.name).trim()[0]?.toUpperCase() || '?' }
      : c
  );
  await writeContacts(updated);
}

export async function deleteContact(id: string): Promise<void> {
  const contacts = await readContacts();
  await writeContacts(contacts.filter(c => c.id !== id));
}

export async function getContactByNpub(npub: string): Promise<BEContact | null> {
  const contacts = await readContacts();
  return contacts.find(c => c.npub === npub) ?? null;
}