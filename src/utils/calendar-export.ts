import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { GroupCalendarEvent } from './group-calendar';
import type { BEGroup } from './group-storage';

export async function exportCalendarEventToIcs(
  event: GroupCalendarEvent,
  group: BEGroup
): Promise<void> {
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;

  if (!directory) {
    throw new Error('Calendar export storage is unavailable on this device.');
  }

  const available = await Sharing.isAvailableAsync();

  if (!available) {
    throw new Error('Calendar sharing is not available on this device.');
  }

  const filename = `${sanitizeFileName(event.title || 'space-event')}.ics`;
  const uri = `${directory}${filename}`;
  const ics = buildCalendarEventIcs(event, group);

  await FileSystem.writeAsStringAsync(uri, ics, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  await Sharing.shareAsync(uri, {
    mimeType: 'text/calendar',
    dialogTitle: `Export ${event.title}`,
  });
}

function buildCalendarEventIcs(event: GroupCalendarEvent, group: BEGroup): string {
  const now = formatUtcDateTime(Math.floor(Date.now() / 1000));
  const description = buildEventDescription(event, group);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//bE Marks//Spaces Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(`${event.id}@be-marks`)}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeIcsText(event.title || 'Space event')}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : null,
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : null,
    ...buildDateLines(event),
    ...buildReminderLines(event),
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean) as string[];

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function buildDateLines(event: GroupCalendarEvent): string[] {
  if (event.eventType === 'allday' && event.startDate) {
    const startKey = compactDateKey(event.startDate);
    const endKey = compactDateKey(addDaysToDateKey(event.endDate || event.startDate, 1));

    return [
      `DTSTART;VALUE=DATE:${startKey}`,
      `DTEND;VALUE=DATE:${endKey}`,
    ];
  }

  const startTime = event.startTime;
  const endTime =
    event.endTime && event.endTime > startTime
      ? event.endTime
      : startTime + 3600;

  return [
    `DTSTART:${formatUtcDateTime(startTime)}`,
    `DTEND:${formatUtcDateTime(endTime)}`,
  ];
}

function buildReminderLines(event: GroupCalendarEvent): string[] {
  const reminderDescription = escapeIcsText(event.title || 'Space event reminder');

  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT1H',
    `DESCRIPTION:${reminderDescription}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-P1D',
    `DESCRIPTION:${reminderDescription}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-P1W',
    `DESCRIPTION:${reminderDescription}`,
    'END:VALARM',
  ];
}

function buildEventDescription(event: GroupCalendarEvent, group: BEGroup): string {
  const parts = [
    event.description?.trim(),
    event.opponent ? `Opponent: ${event.opponent}` : null,
    event.homeAway ? `Home/Away: ${event.homeAway}` : null,
    typeof event.ourScore === 'number' && typeof event.opponentScore === 'number'
      ? `Score: ${event.ourScore}-${event.opponentScore}`
      : null,
    group.name ? `Space: ${group.name}` : null,
  ];

  return parts.filter(Boolean).join('\n\n');
}

function formatUtcDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);

  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function compactDateKey(dateKey: string): string {
  return dateKey.replace(/-/g, '');
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let remaining = line;

  while (remaining.length > 73) {
    chunks.push(remaining.slice(0, 73));
    remaining = ` ${remaining.slice(73)}`;
  }

  chunks.push(remaining);
  return chunks.join('\r\n');
}

function sanitizeFileName(value: string): string {
  const clean = value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return clean || 'space-event';
}
