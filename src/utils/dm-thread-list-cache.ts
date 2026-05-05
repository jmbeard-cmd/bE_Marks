import AsyncStorage from '@react-native-async-storage/async-storage';

const DM_THREAD_LIST_CACHE_KEY = 'dm_thread_list_cache_v1';

export type CachedDMThreadCard = {
  id: string;
  title: string;
  displayTitle: string;
  participantPubkey?: string;
  participantNpub?: string;
  profilePicture?: string;
  updatedAt: number;
  unread: number;
  lastMessage: string;
};

export async function getCachedDMThreadCards(): Promise<CachedDMThreadCard[]> {
  try {
    const raw = await AsyncStorage.getItem(DM_THREAD_LIST_CACHE_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    const cards = parsed.filter((card): card is CachedDMThreadCard => (
      !!card &&
      typeof card.id === 'string' &&
      typeof card.title === 'string' &&
      typeof card.displayTitle === 'string' &&
      typeof card.updatedAt === 'number' &&
      typeof card.unread === 'number' &&
      typeof card.lastMessage === 'string'
    ));

    return cards.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.warn('[DM Thread List Cache] read failed:', error);
    return [];
  }
}

export async function saveCachedDMThreadCards(
  cards: CachedDMThreadCard[]
): Promise<void> {
  try {
    const sortedCards = [...cards].sort((a, b) => b.updatedAt - a.updatedAt);

    await AsyncStorage.setItem(
      DM_THREAD_LIST_CACHE_KEY,
      JSON.stringify(sortedCards)
    );
  } catch (error) {
    console.warn('[DM Thread List Cache] write failed:', error);
  }
}

export async function clearCachedDMThreadCards(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DM_THREAD_LIST_CACHE_KEY);
  } catch (error) {
    console.warn('[DM Thread List Cache] clear failed:', error);
  }
}