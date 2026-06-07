import {
  finalizeEvent,
  getPublicKey,
  nip19,
  type Event,
  type UnsignedEvent,
} from 'nostr-tools';
import {
  DEFAULT_RELAY,
  FAST_RELAYS,
  fetchNostrProfile,
  publishToSpecificRelays,
  type NostrProfile
} from './nostr';
import {
  DEFAULT_SOCIAL_RELAYS,
  getSocialGraphCache,
  getSocialRelays,
  normalizeSocialRelayUrls,
  saveFollowerPubkeys,
  saveFollowingPubkeys,
  upsertSocialGraphPeople,
  type SocialGraphPerson,
} from './social-graph-storage';

export const NOSTR_TEXT_NOTE_KIND = 1;
export const NOSTR_FOLLOW_LIST_KIND = 3;
export const NOSTR_RELAY_LIST_KIND = 10002;

type RelayFetchResult = {
  relayUrl: string;
  events: Event[];
};

type RelayListHint = {
  relayUrl: string;
  marker?: 'read' | 'write';
};

export type SocialGraphSyncResult = {
  pubkeys: string[];
  people: SocialGraphPerson[];
  relaysUsed: string[];
};

export type SocialReplyPreview = {
  id: string;
  pubkey: string;
  npub?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  content: string;
  createdAt: number;
};

export type SocialPublicPost = {
  id: string;
  pubkey: string;
  npub?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  content: string;
  createdAt: number;
  imageUrls: string[];
  videoUrls: string[];
  mediaUrls: string[];
  urlTags: string[];
  clientName?: string;
  activityType: 'post' | 'reply';
  replyEventIds: string[];
  replyRootId?: string;
  replyParentId?: string;
  replyPreview?: SocialReplyPreview;
  source: 'following';
};

export type FollowingPublicPostsResult = {
  posts: SocialPublicPost[];
  followedPubkeys: string[];
  relaysUsed: string[];
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  values.forEach(value => {
    const clean = value.trim();

    if (!clean || seen.has(clean)) return;

    seen.add(clean);
    unique.push(clean);
  });

  return unique;
}

function pubkeyToNpub(pubkey: string): string | undefined {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return undefined;
  }
}

function decodeNpubToPubkey(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);

    return decoded.type === 'npub' ? decoded.data as string : null;
  } catch {
    return null;
  }
}

function getEventPTagPubkeys(event: Event): string[] {
  return uniqueStrings(
    event.tags
      .filter(tag => tag[0] === 'p' && typeof tag[1] === 'string')
      .map(tag => tag[1])
  );
}

function getSocialReplyThreadReferences(event: Event): Pick<
  SocialPublicPost,
  'replyEventIds' | 'replyRootId' | 'replyParentId'
> {
  const eventReferences = event.tags
    .filter(tag => tag[0] === 'e' && typeof tag[1] === 'string')
    .map(tag => ({
      eventId: tag[1].trim(),
      marker: typeof tag[3] === 'string' ? tag[3].trim() : undefined,
    }))
    .filter(reference => reference.eventId.length > 0);

  const replyEventIds = uniqueStrings(eventReferences.map(reference => reference.eventId));
  const markedRootId = eventReferences.find(reference => reference.marker === 'root')?.eventId;
  const markedReplyId = eventReferences.find(reference => reference.marker === 'reply')?.eventId;

  return {
    replyEventIds,
    replyRootId: markedRootId || replyEventIds[0],
    replyParentId: markedReplyId || replyEventIds[replyEventIds.length - 1],
  };
}

function getSocialPostActivityType(event: Event): SocialPublicPost['activityType'] {
  return getSocialReplyThreadReferences(event).replyEventIds.length > 0 ? 'reply' : 'post';
}

function getEventTagValues(event: Event, tagName: string): string[] {
  return uniqueStrings(
    event.tags
      .filter(tag => tag[0] === tagName && typeof tag[1] === 'string')
      .map(tag => tag[1])
  );
}

function getContentUrls(content: string): string[] {
  const matches = content.match(/https?:\/\/[^\s<>"']+/gi) ?? [];

  return uniqueStrings(
    matches.map(url => url.replace(/[),.;!?]+$/g, ''))
  );
}

function getImetaUrls(event: Event): string[] {
  return uniqueStrings(
    event.tags
      .filter(tag => tag[0] === 'imeta')
      .flatMap(tag => {
        const joined = tag.slice(1).join(' ');
        const match = joined.match(/url\s+(https?:\/\/\S+)/i);

        return match?.[1] ? [match[1].replace(/[),.;!?]+$/g, '')] : [];
      })
  );
}

function looksLikeImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(url);
}

function looksLikeVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);
}

function buildSocialReplyPreview(
  event: Event,
  person?: SocialGraphPerson
): SocialReplyPreview {
  return {
    id: event.id,
    pubkey: event.pubkey,
    npub: person?.npub || pubkeyToNpub(event.pubkey),
    authorName: person?.displayName,
    authorAvatarUrl: person?.avatarUrl,
    content: event.content || '',
    createdAt: event.created_at,
  };
}

function buildSocialPublicPost(
  event: Event,
  person?: SocialGraphPerson,
  replyPreview?: SocialReplyPreview
): SocialPublicPost {
  const contentUrls = getContentUrls(event.content || '');
  const explicitUrlTags = getEventTagValues(event, 'url');
  const imetaUrls = getImetaUrls(event);

  const imageUrls = uniqueStrings([
    ...getEventTagValues(event, 'image'),
    ...imetaUrls.filter(looksLikeImageUrl),
    ...contentUrls.filter(looksLikeImageUrl),
  ]);

  const videoUrls = uniqueStrings([
    ...getEventTagValues(event, 'video'),
    ...imetaUrls.filter(looksLikeVideoUrl),
    ...contentUrls.filter(looksLikeVideoUrl),
  ]);

  const replyThreadReferences = getSocialReplyThreadReferences(event);

  return {
    id: event.id,
    pubkey: event.pubkey,
    npub: person?.npub || pubkeyToNpub(event.pubkey),
    authorName: person?.displayName,
    authorAvatarUrl: person?.avatarUrl,
    content: event.content || '',
    createdAt: event.created_at,
    imageUrls,
    videoUrls,
    mediaUrls: uniqueStrings([...imageUrls, ...videoUrls]),
    urlTags: uniqueStrings([...explicitUrlTags, ...contentUrls]),
    clientName: getEventTagValues(event, 'client')[0],
    activityType: getSocialPostActivityType(event),
    replyEventIds: replyThreadReferences.replyEventIds,
    replyRootId: replyThreadReferences.replyRootId,
    replyParentId: replyThreadReferences.replyParentId,
    replyPreview,
    source: 'following',
  };
}

function normalizeSocialFetchRelays(relayUrls?: string[]): string[] {
  return normalizeSocialRelayUrls([
    ...(relayUrls && relayUrls.length > 0 ? relayUrls : []),
    ...DEFAULT_SOCIAL_RELAYS,
    DEFAULT_RELAY,
    ...FAST_RELAYS,
  ]);
}

function fetchEventsFromRelay(input: {
  relayUrl: string;
  filter: Record<string, any>;
  timeoutMs?: number;
}): Promise<RelayFetchResult> {
  return new Promise(resolve => {
    const events: Event[] = [];
    const seen = new Set<string>();
    const timeoutMs = input.timeoutMs ?? 5000;

    try {
      const ws = new WebSocket(input.relayUrl);
      const subId = `social-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {}

        resolve({
          relayUrl: input.relayUrl,
          events,
        });
      }, timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ',
          subId,
          input.filter,
        ]));
      };

      ws.onmessage = msg => {
        try {
          const data = JSON.parse(String(msg.data));

          if (data[0] === 'EVENT' && data[2]?.id) {
            const event = data[2] as Event;

            if (seen.has(event.id)) return;

            seen.add(event.id);
            events.push(event);
            return;
          }

          if (data[0] === 'EOSE' || data[0] === 'CLOSED') {
            clearTimeout(timeout);

            try {
              ws.close();
            } catch {}

            resolve({
              relayUrl: input.relayUrl,
              events,
            });
          }
        } catch {
          clearTimeout(timeout);

          try {
            ws.close();
          } catch {}

          resolve({
            relayUrl: input.relayUrl,
            events,
          });
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);

        try {
          ws.close();
        } catch {}

        resolve({
          relayUrl: input.relayUrl,
          events,
        });
      };
    } catch {
      resolve({
        relayUrl: input.relayUrl,
        events,
      });
    }
  });
}

async function fetchEventsFromRelays(input: {
  relayUrls: string[];
  filter: Record<string, any>;
  timeoutMs?: number;
}): Promise<Event[]> {
  const relays = normalizeSocialRelayUrls(input.relayUrls);

  if (relays.length === 0) return [];

  const results = await Promise.all(
    relays.map(relayUrl =>
      fetchEventsFromRelay({
        relayUrl,
        filter: input.filter,
        timeoutMs: input.timeoutMs,
      })
    )
  );

  const byId = new Map<string, Event>();

  results.forEach(result => {
    result.events.forEach(event => {
      if (!event?.id) return;

      byId.set(event.id, event);
    });
  });

  return Array.from(byId.values());
}

function pickLatestEvent(events: Event[]): Event | null {
  if (events.length === 0) return null;

  return [...events].sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

function getRelayHintsFromRelayListEvent(event: Event): RelayListHint[] {
  return event.tags
    .filter(tag => tag[0] === 'r' && typeof tag[1] === 'string')
    .map(tag => {
      const marker: RelayListHint['marker'] =
        tag[2] === 'read' || tag[2] === 'write' ? tag[2] : undefined;

      return {
        relayUrl: tag[1],
        marker,
      };
    })
    .filter(hint => hint.relayUrl.startsWith('wss://') || hint.relayUrl.startsWith('ws://'));
}

export async function fetchSocialRelayHints(input: {
  npub: string;
  relayUrls?: string[];
  timeoutMs?: number;
}): Promise<string[]> {
  const pubkey = decodeNpubToPubkey(input.npub);

  if (!pubkey) return [];

  const relayUrls = normalizeSocialFetchRelays(input.relayUrls);
  const events = await fetchEventsFromRelays({
    relayUrls,
    filter: {
      kinds: [NOSTR_RELAY_LIST_KIND],
      authors: [pubkey],
      limit: 5,
    },
    timeoutMs: input.timeoutMs ?? 4500,
  });

  const latest = pickLatestEvent(events);

  if (!latest) return [];

  const hints = getRelayHintsFromRelayListEvent(latest);

  return normalizeSocialRelayUrls(hints.map(hint => hint.relayUrl));
}

export async function fetchFollowingPubkeys(input: {
  npub: string;
  relayUrls?: string[];
  timeoutMs?: number;
}): Promise<SocialGraphSyncResult> {
  const pubkey = decodeNpubToPubkey(input.npub);

  if (!pubkey) {
    return {
      pubkeys: [],
      people: [],
      relaysUsed: [],
    };
  }

  const savedRelays = input.relayUrls && input.relayUrls.length > 0
    ? input.relayUrls
    : await getSocialRelays();

  const relayHints = await fetchSocialRelayHints({
    npub: input.npub,
    relayUrls: savedRelays,
    timeoutMs: input.timeoutMs,
  });

  const relayUrls = normalizeSocialRelayUrls([
    ...savedRelays,
    ...relayHints,
  ]);

  const events = await fetchEventsFromRelays({
    relayUrls,
    filter: {
      kinds: [NOSTR_FOLLOW_LIST_KIND],
      authors: [pubkey],
      limit: 10,
    },
    timeoutMs: input.timeoutMs ?? 5000,
  });

  const latest = pickLatestEvent(events);
  const followingPubkeys = latest ? getEventPTagPubkeys(latest) : [];

  const people: SocialGraphPerson[] = followingPubkeys.map(followedPubkey => ({
    pubkey: followedPubkey,
    npub: pubkeyToNpub(followedPubkey),
    followedAt: latest?.created_at ?? nowSeconds(),
  }));

  await saveFollowingPubkeys(followingPubkeys, people);

  return {
    pubkeys: followingPubkeys,
    people,
    relaysUsed: relayUrls,
  };
}

export async function fetchFollowerPubkeys(input: {
  npub: string;
  relayUrls?: string[];
  timeoutMs?: number;
  limit?: number;
}): Promise<SocialGraphSyncResult> {
  const myPubkey = decodeNpubToPubkey(input.npub);

  if (!myPubkey) {
    return {
      pubkeys: [],
      people: [],
      relaysUsed: [],
    };
  }

  const savedRelays = input.relayUrls && input.relayUrls.length > 0
    ? input.relayUrls
    : await getSocialRelays();

  const relayHints = await fetchSocialRelayHints({
    npub: input.npub,
    relayUrls: savedRelays,
    timeoutMs: input.timeoutMs,
  });

  const relayUrls = normalizeSocialRelayUrls([
    ...savedRelays,
    ...relayHints,
  ]);

  const events = await fetchEventsFromRelays({
    relayUrls,
    filter: {
      kinds: [NOSTR_FOLLOW_LIST_KIND],
      '#p': [myPubkey],
      limit: input.limit ?? 500,
    },
    timeoutMs: input.timeoutMs ?? 6500,
  });

  const followerPubkeys = uniqueStrings(
    events
      .filter(event => getEventPTagPubkeys(event).includes(myPubkey))
      .map(event => event.pubkey)
  );

  const people: SocialGraphPerson[] = followerPubkeys.map(followerPubkey => ({
    pubkey: followerPubkey,
    npub: pubkeyToNpub(followerPubkey),
    followerSeenAt: nowSeconds(),
  }));

  await saveFollowerPubkeys(followerPubkeys, people);

  return {
    pubkeys: followerPubkeys,
    people,
    relaysUsed: relayUrls,
  };
}

export async function hydrateSocialPeopleProfiles(
  people: SocialGraphPerson[],
  limit = 24
): Promise<SocialGraphPerson[]> {
  const targetPeople = people.slice(0, limit);
  const hydrated: SocialGraphPerson[] = [];
  const batchSize = 6;

  async function hydrateOnePerson(person: SocialGraphPerson): Promise<SocialGraphPerson> {
    if (!person.npub) {
      return person;
    }

    try {
      const profile = await fetchNostrProfile(person.npub);

      if (!profile) {
        return person;
      }

      return {
        ...person,
        displayName:
          profile.display_name ||
          profile.name ||
          person.displayName,
        avatarUrl:
          profile.picture ||
          person.avatarUrl,
        about:
          profile.about ||
          person.about,
        updatedAt: nowSeconds(),
      };
    } catch {
      return person;
    }
  }

  for (let index = 0; index < targetPeople.length; index += batchSize) {
    const batch = targetPeople.slice(index, index + batchSize);
    const hydratedBatch = await Promise.all(batch.map(hydrateOnePerson));

    hydrated.push(...hydratedBatch);

    await new Promise(resolve => setTimeout(resolve, 0));
  }

  await upsertSocialGraphPeople(hydrated);

  return hydrated;
}

export async function syncFollowingGraph(input: {
  npub: string;
  relayUrls?: string[];
  hydrateProfiles?: boolean;
}): Promise<SocialGraphSyncResult> {
  const result = await fetchFollowingPubkeys({
    npub: input.npub,
    relayUrls: input.relayUrls,
  });

  if (!input.hydrateProfiles) return result;

  const people = await hydrateSocialPeopleProfiles(
    result.people,
    result.people.length
  );

  return {
    ...result,
    people,
  };
}

export async function syncFollowerGraph(input: {
  npub: string;
  relayUrls?: string[];
  hydrateProfiles?: boolean;
}): Promise<SocialGraphSyncResult> {
  const result = await fetchFollowerPubkeys({
    npub: input.npub,
    relayUrls: input.relayUrls,
  });

  if (!input.hydrateProfiles) return result;

  const people = await hydrateSocialPeopleProfiles(
    result.people,
    result.people.length
  );

  return {
    ...result,
    people,
  };
}

const SOCIAL_GRAPH_BACKGROUND_SYNC_MAX_AGE_SECONDS = 12 * 60 * 60;

function shouldRefreshSocialGraphTimestamp(
  updatedAt: number | undefined,
  maxAgeSeconds: number
): boolean {
  if (!updatedAt) return true;

  return nowSeconds() - updatedAt >= maxAgeSeconds;
}

export async function syncSocialGraphInBackground(input: {
  npub: string;
  relayUrls?: string[];
  maxAgeSeconds?: number;
}): Promise<void> {
  const maxAgeSeconds =
    input.maxAgeSeconds ?? SOCIAL_GRAPH_BACKGROUND_SYNC_MAX_AGE_SECONDS;

  const cache = await getSocialGraphCache();
  const shouldSyncFollowing = shouldRefreshSocialGraphTimestamp(
    cache.followingUpdatedAt,
    maxAgeSeconds
  );
  const shouldSyncFollowers = shouldRefreshSocialGraphTimestamp(
    cache.followersUpdatedAt,
    maxAgeSeconds
  );

  if (!shouldSyncFollowing && !shouldSyncFollowers) {
    return;
  }

  if (shouldSyncFollowing) {
    await syncFollowingGraph({
      npub: input.npub,
      relayUrls: input.relayUrls,
      hydrateProfiles: true,
    });
  }

  if (shouldSyncFollowers) {
    await syncFollowerGraph({
      npub: input.npub,
      relayUrls: input.relayUrls,
      hydrateProfiles: true,
    });
  }
}

export async function fetchFollowingPublicPosts(input: {
  npub?: string;
  relayUrls?: string[];
  timeoutMs?: number;
  limit?: number;
  since?: number;
  until?: number;
} = {}): Promise<FollowingPublicPostsResult> {
  let cache = await getSocialGraphCache();
  let followedPubkeys = cache.followingPubkeys;

  if (followedPubkeys.length === 0 && input.npub) {
    const followingResult = await fetchFollowingPubkeys({
      npub: input.npub,
      relayUrls: input.relayUrls,
      timeoutMs: input.timeoutMs,
    });

    followedPubkeys = followingResult.pubkeys;
    cache = await getSocialGraphCache();
  }

  followedPubkeys = uniqueStrings(followedPubkeys);

  if (followedPubkeys.length === 0) {
    return {
      posts: [],
      followedPubkeys: [],
      relaysUsed: [],
    };
  }

  const savedRelays = input.relayUrls && input.relayUrls.length > 0
    ? input.relayUrls
    : await getSocialRelays();

  const relayUrls = normalizeSocialFetchRelays(savedRelays);
  const filter: Record<string, any> = {
    kinds: [NOSTR_TEXT_NOTE_KIND],
    authors: followedPubkeys.slice(0, 300),
    limit: input.limit ?? 120,
  };

  if (typeof input.since === 'number') {
    filter.since = input.since;
  }

  if (typeof input.until === 'number') {
    filter.until = input.until;
  }

  const events = await fetchEventsFromRelays({
    relayUrls,
    filter,
    timeoutMs: input.timeoutMs ?? 6500,
  });

  const sortedEvents = events
    .filter(event => followedPubkeys.includes(event.pubkey))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, input.limit ?? 120);

  const visibleAuthorPubkeys = uniqueStrings(sortedEvents.map(event => event.pubkey));
  const missingVisibleAuthorProfiles = visibleAuthorPubkeys
    .map(pubkey => cache.peopleByPubkey[pubkey] || {
      pubkey,
      npub: pubkeyToNpub(pubkey),
    })
    .filter(person => !person.displayName || !person.avatarUrl)
    .slice(0, 36);

  if (missingVisibleAuthorProfiles.length > 0) {
    await hydrateSocialPeopleProfiles(
      missingVisibleAuthorProfiles,
      missingVisibleAuthorProfiles.length
    );

    cache = await getSocialGraphCache();
  }

  const initialPosts = sortedEvents.map(event => buildSocialPublicPost(
    event,
    cache.peopleByPubkey[event.pubkey]
  ));

  const currentEventIds = new Set(sortedEvents.map(event => event.id));
  const replyPreviewIds = uniqueStrings(
    initialPosts
      .filter(post => post.activityType === 'reply')
      .map(post => post.replyParentId || post.replyRootId || '')
  )
    .filter(eventId => !currentEventIds.has(eventId))
    .slice(0, 40);

  const fetchedPreviewEvents = replyPreviewIds.length > 0
    ? await fetchEventsFromRelays({
        relayUrls,
        filter: {
          ids: replyPreviewIds,
          kinds: [NOSTR_TEXT_NOTE_KIND],
          limit: replyPreviewIds.length,
        },
        timeoutMs: Math.min(input.timeoutMs ?? 6500, 3500),
      })
    : [];

  const previewEventsById = new Map<string, Event>();

  [...sortedEvents, ...fetchedPreviewEvents].forEach(event => {
    if (!event?.id) return;

    previewEventsById.set(event.id, event);
  });

  const posts = initialPosts.map(post => {
    if (post.activityType !== 'reply') return post;

    const previewEventId = post.replyParentId || post.replyRootId;

    if (!previewEventId) return post;

    const previewEvent = previewEventsById.get(previewEventId);

    if (!previewEvent) return post;

    return {
      ...post,
      replyPreview: buildSocialReplyPreview(
        previewEvent,
        cache.peopleByPubkey[previewEvent.pubkey]
      ),
    };
  });

  return {
    posts,
    followedPubkeys,
    relaysUsed: relayUrls,
  };
}

export async function publishFollowList(input: {
  nsec: string;
  followingPubkeys: string[];
  relayUrls?: string[];
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const decoded = nip19.decode(input.nsec);

    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec');
    }

    const sk = decoded.data as Uint8Array;
    const pubkey = getPublicKey(sk);
    const relayUrls = normalizeSocialFetchRelays(input.relayUrls);
    const followingPubkeys = uniqueStrings(input.followingPubkeys);

    const unsigned: UnsignedEvent = {
      kind: NOSTR_FOLLOW_LIST_KIND,
      created_at: nowSeconds(),
      tags: [
        ...followingPubkeys.map(followedPubkey => ['p', followedPubkey]),
        ['client', 'bE-Marks'],
      ],
      content: '',
      pubkey,
    };

    const signed = finalizeEvent(unsigned, sk);
    const result = await publishToSpecificRelays(signed, relayUrls);

    if (result.success) {
      await saveFollowingPubkeys(followingPubkeys);
    }

    return {
      success: result.success,
      eventId: result.eventId,
      error: result.error,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Could not publish follow list',
    };
  }
}

export function npubOrPubkeyToPubkey(value: string): string | null {
  const clean = value.trim();

  if (!clean) return null;

  if (/^[0-9a-f]{64}$/i.test(clean)) {
    return clean.toLowerCase();
  }

  return decodeNpubToPubkey(clean);
}

export function socialPersonDisplayName(person: SocialGraphPerson): string {
  return (
    person.displayName ||
    person.npub?.slice(0, 16) ||
    person.pubkey.slice(0, 12)
  );
}

export function profileToSocialPerson(
  pubkey: string,
  profile: NostrProfile | null
): SocialGraphPerson {
  return {
    pubkey,
    npub: pubkeyToNpub(pubkey),
    displayName:
      profile?.display_name ||
      profile?.name,
    avatarUrl: profile?.picture,
    about: profile?.about,
    updatedAt: nowSeconds(),
  };
}

export function getDefaultSocialRelaysForDisplay(): string[] {
  return DEFAULT_SOCIAL_RELAYS;
}