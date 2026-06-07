/**
 * src/utils/group-calendar.ts
 *
 * Group calendar event storage — NIP-52 backed.
 * Mirrors the group-stickies.ts pattern: local AsyncStorage first,
 * relay publish is always fire-and-forget, never blocking UI.
 *
 * NIP-52 kinds used:
 *   kind 31923 — time-based calendar event (games, practices, meetings)
 *   kind 31922 — date-based calendar event (all-day: spirit week, holidays)
 *   kind 31925 — RSVP
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getGroupById, normalizeRelayUrls } from './group-storage';
import {
  fetchGroupCalendarDeletes,
  fetchGroupCalendarEvents,
  fetchGroupRSVPsForEvents,
  getStoredIdentity,
  publishGroupCalendarDelete,
  publishGroupCalendarEvent,
  publishGroupRSVP,
  type GroupRSVPRaw,
} from './nostr';
import { notifyGroupEvent } from './push-notifications';
const GROUP_CALENDAR_KEY = 'be_group_calendar_v1';
const GROUP_RSVP_KEY = 'be_group_rsvps_v1';
const GROUP_CALENDAR_DELETED_KEY = 'be_group_calendar_deleted_v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarEventType = 'timed' | 'allday';

export type SpaceEventType =
  | 'game'
  | 'practice'
  | 'meeting'
  | 'volunteer'
  | 'fundraiser'
  | 'banquet'
  | 'tournament'
  | 'deadline'
  | 'event'
  | 'other';

export type GameHomeAway = 'home' | 'away' | 'neutral';

export type GameResult = 'win' | 'loss' | 'tie';

export type RSVPStatus = 'accepted' | 'declined' | 'tentative';

export type GroupCalendarEvent = {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  location?: string;

  // timed = specific start/end time, allday = just a date
  eventType: CalendarEventType;

  // Optional Space story metadata.
  // These are intentionally optional so existing stored/relay events remain valid.
  spaceEventType?: SpaceEventType;
  teamName?: string;
  opponent?: string;
  homeAway?: GameHomeAway;
  ourScore?: number;
  opponentScore?: number;
  result?: GameResult;
  scoreFinal?: boolean;
  eventNotes?: string;
  legacyEligible?: boolean;
  invitedNpubs?: string[];

  // Unix timestamps (seconds)
  startTime: number;
  endTime?: number;

  // For all-day events: 'YYYY-MM-DD'
  startDate?: string;
  endDate?: string;

  authorNpub?: string;
  authorName?: string;
  relayUrl?: string;

  // NIP-52 nostr event id once published
  nostrEventId?: string;
  relayPublishedAt?: number;

  createdAt: number;
  updatedAt: number;
};

export type GroupRSVP = {
  id: string;
  eventId: string;
  groupId: string;
  npub: string;
  displayName?: string;
  status: RSVPStatus;
  note?: string;
  createdAt: number;
  updatedAt?: number;
};

// ─── Storage Helpers ──────────────────────────────────────────────────────────

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[Group Calendar] write failed:', error);
  }
}

function normalizeCalendarNpubs(npubs?: string[]): string[] | undefined {
  const unique = Array.from(
    new Set(
      (npubs ?? [])
        .map(npub => npub?.trim().toLowerCase())
        .filter((npub): npub is string => !!npub)
    )
  );

  return unique.length > 0 ? unique : undefined;
}

function getCalendarRelayUrls(input: {
  relayUrl?: string;
  relayUrls?: string[];
  backupRelayUrls?: string[];
}): string[] {
  return normalizeRelayUrls([
    input.relayUrl,
    ...(input.relayUrls ?? []),
    ...(input.backupRelayUrls ?? []),
  ]);
}

async function notifyCalendarEventChange(
  event: GroupCalendarEvent,
  eventType: 'calendar_created' | 'calendar_updated' | 'calendar_deleted'
): Promise<void> {
  if (!event.authorNpub || !event.relayUrl) {
    console.log('[Group Calendar] notification skipped; missing authorNpub/relayUrl');
    return;
  }

  const group = await getGroupById(event.groupId);

  if (!group) {
    console.log('[Group Calendar] notification skipped; missing group');
    return;
  }

  notifyGroupEvent({
    groupId: event.groupId,
    groupName: group.name,
    relayUrl: event.relayUrl,
    actorNpub: event.authorNpub,
    actorName: event.authorName,
    eventType,
    title: event.title,
    calendarEventId: event.id,
    routeTarget: 'group-detail',
    groupTab: 'calendar',
  }).catch(error => {
    console.warn('[Group Calendar] notification failed:', error);
  });
}

// ─── Calendar Events ──────────────────────────────────────────────────────────

export async function getCalendarEventsForGroup(
  groupId: string
): Promise<GroupCalendarEvent[]> {
  const all = await readJson<GroupCalendarEvent[]>(GROUP_CALENDAR_KEY, []);
  const now = Math.floor(Date.now() / 1000);

  return all
    .filter(e => e.groupId === groupId)
    .sort((a, b) => {
      // Upcoming first, then past
      const aFuture = (a.startTime || 0) >= now;
      const bFuture = (b.startTime || 0) >= now;
      if (aFuture && !bFuture) return -1;
      if (!aFuture && bFuture) return 1;
      if (aFuture && bFuture) return a.startTime - b.startTime; // nearest upcoming first
      return b.startTime - a.startTime; // most recent past first
    });
}

export async function getUpcomingEventsForGroup(
  groupId: string,
  limit = 5
): Promise<GroupCalendarEvent[]> {
  const all = await readJson<GroupCalendarEvent[]>(GROUP_CALENDAR_KEY, []);
  const now = Math.floor(Date.now() / 1000);

  const eventMap = new Map<string, GroupCalendarEvent>();

  all
    .filter(e => e.groupId === groupId && e.startTime >= now - 3600)
    .forEach(e => {
      eventMap.set(e.id, e);
    });

  return Array.from(eventMap.values())
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, limit);
}

export async function createCalendarEvent(input: {
  groupId: string;
  title: string;
  description?: string;
  location?: string;
  eventType: CalendarEventType;

  // Optional Space story metadata.
  spaceEventType?: SpaceEventType;
  teamName?: string;
  opponent?: string;
  homeAway?: GameHomeAway;
  ourScore?: number;
  opponentScore?: number;
  result?: GameResult;
  scoreFinal?: boolean;
  eventNotes?: string;
  legacyEligible?: boolean;
  invitedNpubs?: string[];

  startTime: number;
  endTime?: number;
  startDate?: string;
  endDate?: string;
  authorNpub?: string;
  authorName?: string;
  relayUrl?: string;
  relayUrls?: string[];
  backupRelayUrls?: string[];
}): Promise<GroupCalendarEvent> {
  const all = await readJson<GroupCalendarEvent[]>(GROUP_CALENDAR_KEY, []);
  const now = Math.floor(Date.now() / 1000);

  const event: GroupCalendarEvent = {
    id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId: input.groupId,
    title: input.title.trim(),
    description: input.description?.trim(),
    location: input.location?.trim(),
    eventType: input.eventType,

    spaceEventType: input.spaceEventType,
    teamName: input.teamName?.trim(),
    opponent: input.opponent?.trim(),
    homeAway: input.homeAway,
    ourScore: input.ourScore,
    opponentScore: input.opponentScore,
    result: input.result,
    scoreFinal: input.scoreFinal,
    eventNotes: input.eventNotes?.trim(),
    legacyEligible: input.legacyEligible,
    invitedNpubs: normalizeCalendarNpubs(input.invitedNpubs),

    startTime: input.startTime,
    endTime: input.endTime,
    startDate: input.startDate,
    endDate: input.endDate,
    authorNpub: input.authorNpub,
    authorName: input.authorName,
    relayUrl: input.relayUrl,
    createdAt: now,
    updatedAt: now,
  };

  all.push(event);
  await writeJson(GROUP_CALENDAR_KEY, all);

  // Publish to relay fire-and-forget — never blocks UI
  const relayUrls = getCalendarRelayUrls(input);
  const primaryRelayUrl = input.relayUrl ?? relayUrls[0];

  if (primaryRelayUrl && relayUrls.length > 0) {
    const identity = await getStoredIdentity();
    if (identity?.nsec) {
      publishCalendarEventToRelay(event, identity.nsec, primaryRelayUrl, relayUrls).catch(e =>
        console.warn('[Group Calendar] relay publish failed:', e)
      );
    }
  }

  await notifyCalendarEventChange(event, 'calendar_created');

  return event;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const all = await readJson<GroupCalendarEvent[]>(GROUP_CALENDAR_KEY, []);
  const event = all.find(e => e.id === eventId);

  const deletedIds = await readJson<string[]>(GROUP_CALENDAR_DELETED_KEY, []);

  if (!deletedIds.includes(eventId)) {
    await writeJson(GROUP_CALENDAR_DELETED_KEY, [...deletedIds, eventId]);
  }

  await writeJson(
    GROUP_CALENDAR_KEY,
    all.filter(e => e.id !== eventId)
  );

  // Also remove all RSVPs for this event
  const rsvps = await readJson<GroupRSVP[]>(GROUP_RSVP_KEY, []);
  await writeJson(GROUP_RSVP_KEY, rsvps.filter(r => r.eventId !== eventId));

  if (event?.relayUrl) {
    const group = event.groupId ? await getGroupById(event.groupId) : null;
    const relayUrls = getCalendarRelayUrls({
      relayUrl: event.relayUrl,
      backupRelayUrls: group?.backupRelayUrls,
    });

    const identity = await getStoredIdentity();

    if (identity?.nsec) {
      publishGroupCalendarDelete({
        eventId,
        groupId: event.groupId,
        nsec: identity.nsec,
        relayUrl: event.relayUrl,
        relayUrls,
      }).catch(e =>
        console.warn('[Group Calendar] relay delete publish failed:', e)
      );
    }
  }

  if (event) {
    await notifyCalendarEventChange(event, 'calendar_deleted');
  }
}

export async function updateCalendarEvent(
  eventId: string,
  updates: Partial<GroupCalendarEvent>
): Promise<void> {
  const all = await readJson<GroupCalendarEvent[]>(GROUP_CALENDAR_KEY, []);
  const existingEvent = all.find(event => event.id === eventId);
  const group = existingEvent?.groupId
    ? await getGroupById(existingEvent.groupId)
    : null;
  const recoveredRelayUrl = updates.relayUrl ?? existingEvent?.relayUrl ?? group?.relayUrl;

  const updated = all.map(e => {
    if (e.id !== eventId) return e;

    return {
      ...e,
      ...updates,
      relayUrl: recoveredRelayUrl,
      updatedAt: Math.floor(Date.now() / 1000),
    };
  });
  const updatedEvent = updated.find(event => event.id === eventId);

  await writeJson(GROUP_CALENDAR_KEY, updated);

  if (updatedEvent) {
    if (updatedEvent.relayUrl) {
      const relayUrls = getCalendarRelayUrls({
        relayUrl: updatedEvent.relayUrl,
        backupRelayUrls: group?.backupRelayUrls,
      });

      const identity = await getStoredIdentity();

      if (identity?.nsec) {
        publishCalendarEventToRelay(updatedEvent, identity.nsec, updatedEvent.relayUrl, relayUrls).catch(e =>
          console.warn('[Group Calendar] relay update publish failed:', e)
        );
      }
    }

    await notifyCalendarEventChange(updatedEvent, 'calendar_updated');
  }
}

// ─── RSVPs ────────────────────────────────────────────────────────────────────

export async function getRSVPsForEvent(eventId: string): Promise<GroupRSVP[]> {
  const all = await readJson<GroupRSVP[]>(GROUP_RSVP_KEY, []);
  return all.filter(r => r.eventId === eventId);
}

export async function getRSVPsForEvents(eventIds: string[]): Promise<GroupRSVP[]> {
  const idSet = new Set(eventIds.filter(Boolean));

  if (idSet.size === 0) return [];

  const all = await readJson<GroupRSVP[]>(GROUP_RSVP_KEY, []);
  return all.filter(r => idSet.has(r.eventId));
}

export async function getMyRSVP(
  eventId: string,
  npub: string
): Promise<GroupRSVP | null> {
  const all = await readJson<GroupRSVP[]>(GROUP_RSVP_KEY, []);
  return all.find(r => r.eventId === eventId && r.npub === npub) ?? null;
}

export async function submitRSVP(input: {
  eventId: string;
  groupId: string;
  npub: string;
  displayName?: string;
  status: RSVPStatus;
  note?: string;
  relayUrl?: string;
  relayUrls?: string[];
  backupRelayUrls?: string[];
}): Promise<GroupRSVP> {
  const all = await readJson<GroupRSVP[]>(GROUP_RSVP_KEY, []);
  const now = Math.floor(Date.now() / 1000);

  // Upsert — one RSVP per person per event
  const existingIndex = all.findIndex(
    r => r.eventId === input.eventId && r.npub === input.npub
  );

  const rsvp: GroupRSVP = {
    id: existingIndex >= 0
      ? all[existingIndex].id
      : `rsvp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    eventId: input.eventId,
    groupId: input.groupId,
    npub: input.npub,
    displayName: input.displayName,
    status: input.status,
    note: input.note?.trim(),
    createdAt: existingIndex >= 0 ? all[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    all[existingIndex] = rsvp;
  } else {
    all.push(rsvp);
  }

  await writeJson(GROUP_RSVP_KEY, all);

  const relayUrls = getCalendarRelayUrls(input);
  const primaryRelayUrl = input.relayUrl ?? relayUrls[0];

  if (primaryRelayUrl && relayUrls.length > 0) {
    const identity = await getStoredIdentity();
    if (identity?.nsec) {
      publishGroupRSVP({
        rsvpId:     rsvp.id,
        eventId:    input.eventId,
        groupId:    input.groupId,
        status:     input.status,
        note:       input.note?.trim(),
        authorNpub: input.npub,
        displayName: input.displayName,
        nsec:       identity.nsec,
        relayUrl:   primaryRelayUrl,
        relayUrls,
      }).catch(e => console.warn('[Group Calendar] RSVP relay publish failed:', e));
    }
  }

  return rsvp;

}

function normalizeRSVPNpub(npub?: string): string {
  return (npub || '').trim().toLowerCase();
}

function getRSVPFreshness(rsvp: Pick<GroupRSVP, 'createdAt' | 'updatedAt'>): number {
  return rsvp.updatedAt ?? rsvp.createdAt ?? 0;
}

function getCalendarEventFreshness(
  event: Pick<GroupCalendarEvent, 'updatedAt' | 'relayPublishedAt'>
): number {
  return Math.max(event.updatedAt ?? 0, event.relayPublishedAt ?? 0);
}

function rsvpRawToLocal(raw: GroupRSVPRaw): GroupRSVP | null {
  const npub = normalizeRSVPNpub(raw.authorNpub);

  if (!npub) return null;

  return {
    id: raw.id,
    eventId: raw.eventId,
    groupId: raw.groupId,
    npub,
    displayName: raw.displayName,
    status: raw.status,
    note: raw.note?.trim(),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? raw.createdAt,
  };
}

export async function syncRSVPsFromRelay(
  groupId: string,
  eventIds: string[],
  relayUrl: string
): Promise<GroupRSVP[]> {
  const uniqueEventIds = Array.from(new Set(eventIds.filter(Boolean)));

  if (!groupId || uniqueEventIds.length === 0 || !relayUrl) return [];

  try {
    const remoteRsvps = (await fetchGroupRSVPsForEvents({
      groupId,
      eventIds: uniqueEventIds,
      relayUrl,
    }))
      .map(rsvpRawToLocal)
      .filter((rsvp): rsvp is GroupRSVP => !!rsvp);

    if (remoteRsvps.length === 0) {
      return getRSVPsForEvents(uniqueEventIds);
    }

    const eventIdSet = new Set(uniqueEventIds);
    const all = await readJson<GroupRSVP[]>(GROUP_RSVP_KEY, []);
    const rsvpMap = new Map<string, GroupRSVP>();

    all.forEach(rsvp => {
      const key = `${rsvp.eventId}:${normalizeRSVPNpub(rsvp.npub)}`;
      if (!eventIdSet.has(rsvp.eventId) || rsvp.groupId !== groupId) {
        rsvpMap.set(key, rsvp);
        return;
      }

      const existing = rsvpMap.get(key);
      if (!existing || getRSVPFreshness(rsvp) >= getRSVPFreshness(existing)) {
        rsvpMap.set(key, {
          ...rsvp,
          npub: normalizeRSVPNpub(rsvp.npub),
        });
      }
    });

    remoteRsvps.forEach(remoteRsvp => {
      const key = `${remoteRsvp.eventId}:${remoteRsvp.npub}`;
      const existing = rsvpMap.get(key);

      if (!existing || getRSVPFreshness(remoteRsvp) >= getRSVPFreshness(existing)) {
        rsvpMap.set(key, {
          ...existing,
          ...remoteRsvp,
          displayName: remoteRsvp.displayName || existing?.displayName,
          note: remoteRsvp.note || existing?.note,
        });
      }
    });

    const merged = Array.from(rsvpMap.values());
    await writeJson(GROUP_RSVP_KEY, merged);

    return merged.filter(rsvp => eventIdSet.has(rsvp.eventId) && rsvp.groupId === groupId);
  } catch (error) {
    console.warn('[Group Calendar] RSVP relay sync failed:', error);
    return getRSVPsForEvents(uniqueEventIds);
  }
}

export async function getRSVPCounts(
  eventId: string
): Promise<{ accepted: number; declined: number; tentative: number }> {
  const rsvps = await getRSVPsForEvent(eventId);
  return {
    accepted: rsvps.filter(r => r.status === 'accepted').length,
    declined: rsvps.filter(r => r.status === 'declined').length,
    tentative: rsvps.filter(r => r.status === 'tentative').length,
  };
}

// ─── Relay sync ───────────────────────────────────────────────────────────────

/**
 * Publishes a NIP-52 calendar event to the relay.
 * kind 31923 = time-based, kind 31922 = date-based.
 *
 * Wired into your existing nostr.ts publish pattern —
 * replace the body with your actual publishEvent() call once
 * you expose it from nostr.ts.
 */
async function publishCalendarEventToRelay(
  event: GroupCalendarEvent,
  nsec: string,
  relayUrl: string,
  relayUrls?: string[]
): Promise<void> {
  const result = await publishGroupCalendarEvent({
    eventId:     event.id,
    groupId:     event.groupId,
    title:       event.title,
    description: event.description,
    location:    event.location,
    eventType:   event.eventType,
    spaceEventType: event.spaceEventType,
    opponent: event.opponent,
    homeAway: event.homeAway,
    ourScore: event.ourScore,
    opponentScore: event.opponentScore,
    result: event.result,
    scoreFinal: event.scoreFinal,
    eventNotes: event.eventNotes,
    legacyEligible: event.legacyEligible,
    invitedNpubs: event.invitedNpubs,
    startTime:   event.startTime,
    endTime:     event.endTime,
    startDate:   event.startDate,
    endDate:     event.endDate,
    authorNpub:  event.authorNpub,
    authorName:  event.authorName,
    createdAt:   event.createdAt,
    updatedAt:   event.updatedAt,
    nsec,
    relayUrl,
    relayUrls,
  });

  if (!result.success) {
    throw new Error(result.error || 'Calendar relay publish failed');
  }
}

/**
 * Syncs calendar events from relay for a group.
 * Call this on load() in group-detail.tsx, same as syncGroupStickiesFromRelay.
 */
export async function syncCalendarEventsFromRelay(
  groupId: string,
  relayUrl: string
): Promise<GroupCalendarEvent[]> {
  try {
    const remoteEvents = await fetchGroupCalendarEvents(groupId, relayUrl);
    const remoteDeletedIds = await fetchGroupCalendarDeletes(groupId, relayUrl);
    const localDeletedIds = await readJson<string[]>(GROUP_CALENDAR_DELETED_KEY, []);

    const deletedIds = Array.from(new Set([...localDeletedIds, ...remoteDeletedIds]));
    const deletedSet = new Set(deletedIds);

    await writeJson(GROUP_CALENDAR_DELETED_KEY, deletedIds);

    const all   = await readJson<GroupCalendarEvent[]>(GROUP_CALENDAR_KEY, []);
    const local = all.filter(e => e.groupId === groupId && !deletedSet.has(e.id));
    const other = all.filter(e => e.groupId !== groupId);

    const eventMap = new Map<string, GroupCalendarEvent>();
    for (const e of local) eventMap.set(e.id, e);

    for (const raw of remoteEvents) {
      if (deletedSet.has(raw.id)) continue;

      const existing = eventMap.get(raw.id);
      const incomingFreshness = getCalendarEventFreshness(raw);
      const existingFreshness = existing ? getCalendarEventFreshness(existing) : 0;
      const accepted = !existing || incomingFreshness >= existingFreshness;

      if (accepted) {
        eventMap.set(raw.id, {
          ...raw,
          relayUrl: raw.relayUrl ?? existing?.relayUrl ?? relayUrl,
        } as GroupCalendarEvent);
      } else if (existing && !existing.relayUrl) {
        eventMap.set(raw.id, {
          ...existing,
          relayUrl,
        });
      }
    }

    const merged = Array.from(eventMap.values());
    await writeJson(GROUP_CALENDAR_KEY, [...other, ...merged]);
    return getCalendarEventsForGroup(groupId);
  } catch {
    return getCalendarEventsForGroup(groupId);
  }
}

// ─── Formatting helpers (used by UI) ─────────────────────────────────────────

export function formatEventDate(event: GroupCalendarEvent): string {
  if (event.eventType === 'allday' && event.startDate) {
    const start = parseDateKey(event.startDate);
    const end =
      event.endDate && event.endDate !== event.startDate
        ? parseDateKey(event.endDate)
        : null;

    if (!start) return event.startDate;
    if (end) {
      return `${formatShortCalendarDate(start)} - ${formatShortCalendarDate(end)}`;
    }

    return formatShortCalendarDate(start);
  }

  const date = new Date(event.startTime * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  if (isToday) return 'Today';
  if (isTomorrow) return 'Tomorrow';

  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatEventTime(event: GroupCalendarEvent): string {
  if (event.eventType === 'allday') {
    if (event.startDate && event.endDate && event.endDate !== event.startDate) {
      const end = parseDateKey(event.endDate);
      if (end) {
        return `All day through ${end.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      }
    }

    return 'All day';
  }

  const start = new Date(event.startTime * 1000);
  const startStr = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (!event.endTime) return startStr;

  const end = new Date(event.endTime * 1000);
  const endTimeStr = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endStr =
    start.toDateString() === end.toDateString()
      ? endTimeStr
      : `${end.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${endTimeStr}`;

  return `${startStr} – ${endStr}`;
}

export function isEventPast(event: GroupCalendarEvent): boolean {
  const now = Math.floor(Date.now() / 1000);

  if (event.eventType === 'allday' && event.startDate) {
    const boundaryDate = event.endDate || event.startDate;
    const [year, month, day] = boundaryDate.split('-').map(Number);

    if (!year || !month || !day) return false;

    const endBoundary = new Date(year, month - 1, day + 1).getTime() / 1000;

    return endBoundary <= now;
  }

  const end = event.endTime ?? event.startTime;
  return end < now - 1800; // 30min grace period
}

export function getEventDayKey(event: GroupCalendarEvent): string {
  if (event.eventType === 'allday' && event.startDate) return event.startDate;
  const d = new Date(event.startTime * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateKey(dateKey: string): Date | null {
  const [year, month, day] = dateKey.split('-').map(Number);

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatShortCalendarDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
export function getSpaceEventTypeLabel(type?: SpaceEventType): string {
  switch (type) {
    case 'game':
      return 'Game';
    case 'practice':
      return '🏃';
    case 'meeting':
      return 'Meeting';
    case 'volunteer':
      return 'Volunteer';
    case 'fundraiser':
      return 'Fundraiser';
    case 'banquet':
      return 'Banquet';
    case 'tournament':
      return 'Tournament';
    case 'deadline':
      return 'Deadline';
    case 'event':
      return 'Event';
    case 'other':
      return 'Other';
    default:
      return 'Event';
  }
}

export function getSpaceEventTypeIcon(type?: SpaceEventType): string {
  switch (type) {
    case 'game':
      return '🏟️';
    case 'practice':
      return ' whistle ';
    case 'meeting':
      return '🗓️';
    case 'volunteer':
      return '🤝';
    case 'fundraiser':
      return '💵';
    case 'banquet':
      return '🏆';
    case 'tournament':
      return '🏅';
    case 'deadline':
      return '⏰';
    case 'event':
      return '📌';
    case 'other':
      return '•';
    default:
      return '📌';
  }
}

export function deriveGameResult(
  ourScore?: number,
  opponentScore?: number
): GameResult | undefined {
  if (typeof ourScore !== 'number' || typeof opponentScore !== 'number') {
    return undefined;
  }

  if (ourScore > opponentScore) return 'win';
  if (ourScore < opponentScore) return 'loss';
  return 'tie';
}

export function getGameResultLabel(result?: GameResult): string {
  switch (result) {
    case 'win':
      return 'Win';
    case 'loss':
      return 'Loss';
    case 'tie':
      return 'Tie';
    default:
      return '';
  }
}

export function formatGameScore(event: GroupCalendarEvent): string {
  if (
    typeof event.ourScore !== 'number' ||
    typeof event.opponentScore !== 'number'
  ) {
    return '';
  }

  const result = event.result ?? deriveGameResult(event.ourScore, event.opponentScore);
  const resultLabel = getGameResultLabel(result);
  const score = `${event.ourScore}–${event.opponentScore}`;

  if (!resultLabel) return score;

  return `${resultLabel} ${score}`;
}

export function formatCompactCalendarEventMarkLabel(event: GroupCalendarEvent): string {
  const title = event.title.trim();
  const teamName = event.teamName?.trim();
  const opponent = event.opponent?.trim();
  const isGameEvent = event.spaceEventType === 'game' || event.spaceEventType === 'tournament';

  const score =
    typeof event.ourScore === 'number' && typeof event.opponentScore === 'number'
      ? `${event.ourScore}–${event.opponentScore}`
      : '';

  if (isGameEvent && (teamName || opponent)) {
    const matchup =
      teamName && opponent
        ? `${teamName} vs ${opponent}`
        : opponent
          ? `vs ${opponent}`
          : teamName || title;

    return [matchup, score].filter(Boolean).join(' · ');
  }

  return [title, score].filter(Boolean).join(' · ');
}
