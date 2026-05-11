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
import { getGroupById } from './group-storage';
import {
  fetchGroupCalendarDeletes,
  fetchGroupCalendarEvents,
  getStoredIdentity,
  publishGroupCalendarDelete,
  publishGroupCalendarEvent,
  publishGroupRSVP,
} from './nostr';
import { notifyGroupEvent } from './push-notifications';
const GROUP_CALENDAR_KEY = 'be_group_calendar_v1';
const GROUP_RSVP_KEY = 'be_group_rsvps_v1';
const GROUP_CALENDAR_DELETED_KEY = 'be_group_calendar_deleted_v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarEventType = 'timed' | 'allday';

export type RSVPStatus = 'accepted' | 'declined' | 'tentative';

export type GroupCalendarEvent = {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  location?: string;

  // timed = specific start/end time, allday = just a date
  eventType: CalendarEventType;

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
  startTime: number;
  endTime?: number;
  startDate?: string;
  endDate?: string;
  authorNpub?: string;
  authorName?: string;
  relayUrl?: string;
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
  if (input.relayUrl) {
    const identity = await getStoredIdentity();
    if (identity?.nsec) {
      publishCalendarEventToRelay(event, identity.nsec, input.relayUrl).catch(e =>
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
    const identity = await getStoredIdentity();

    if (identity?.nsec) {
      publishGroupCalendarDelete({
        eventId,
        groupId: event.groupId,
        nsec: identity.nsec,
        relayUrl: event.relayUrl,
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
  let updatedEvent: GroupCalendarEvent | null = null;

  const updated = all.map(e => {
    if (e.id !== eventId) return e;

    updatedEvent = {
      ...e,
      ...updates,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    return updatedEvent;
  });

  await writeJson(GROUP_CALENDAR_KEY, updated);

  if (updatedEvent) {
    await notifyCalendarEventChange(updatedEvent, 'calendar_updated');
  }
}

// ─── RSVPs ────────────────────────────────────────────────────────────────────

export async function getRSVPsForEvent(eventId: string): Promise<GroupRSVP[]> {
  const all = await readJson<GroupRSVP[]>(GROUP_RSVP_KEY, []);
  return all.filter(r => r.eventId === eventId);
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
    note: input.note,
    createdAt: existingIndex >= 0 ? all[existingIndex].createdAt : now,
  };

  if (existingIndex >= 0) {
    all[existingIndex] = rsvp;
  } else {
    all.push(rsvp);
  }

  await writeJson(GROUP_RSVP_KEY, all);

  await writeJson(GROUP_RSVP_KEY, all);

  if (input.relayUrl) {
    const identity = await getStoredIdentity();
    if (identity?.nsec) {
      publishGroupRSVP({
        rsvpId:     rsvp.id,
        eventId:    input.eventId,
        groupId:    input.groupId,
        status:     input.status,
        note:       input.note,
        authorNpub: input.npub,
        nsec:       identity.nsec,
        relayUrl:   input.relayUrl,
      }).catch(e => console.warn('[Group Calendar] RSVP relay publish failed:', e));
    }
  }

  return rsvp;

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
  relayUrl: string
): Promise<void> {
  await publishGroupCalendarEvent({
    eventId:     event.id,
    groupId:     event.groupId,
    title:       event.title,
    description: event.description,
    location:    event.location,
    eventType:   event.eventType,
    startTime:   event.startTime,
    endTime:     event.endTime,
    startDate:   event.startDate,
    endDate:     event.endDate,
    authorNpub:  event.authorNpub,
    authorName:  event.authorName,
    nsec,
    relayUrl,
  });
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
      if (!existing || raw.updatedAt >= existing.updatedAt) {
        eventMap.set(raw.id, raw as GroupCalendarEvent);
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
    const [year, month, day] = event.startDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
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
  if (event.eventType === 'allday') return 'All day';

  const start = new Date(event.startTime * 1000);
  const startStr = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (!event.endTime) return startStr;

  const end = new Date(event.endTime * 1000);
  const endStr = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return `${startStr} – ${endStr}`;
}

export function isEventPast(event: GroupCalendarEvent): boolean {
  const now = Math.floor(Date.now() / 1000);
  const end = event.endTime ?? event.startTime;
  return end < now - 1800; // 30min grace period
}

export function getEventDayKey(event: GroupCalendarEvent): string {
  if (event.eventType === 'allday' && event.startDate) return event.startDate;
  const d = new Date(event.startTime * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}