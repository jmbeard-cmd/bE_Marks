import {
  createCalendarEvent,
  deleteCalendarEvent,
  formatEventTime,
  getCalendarEventsForGroup,
  getMyRSVP,
  getRSVPCounts,
  isEventPast,
  submitRSVP,
  type GroupCalendarEvent,
  type RSVPStatus,
} from '@/src/utils/group-calendar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIdentity } from '../app/_layout';
import { Colors } from '../src/constants/theme';
import type { BEGroup } from '../src/utils/group-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  group: BEGroup;
  isAdmin: boolean;
  isMember: boolean;
  npub?: string;
  displayName?: string;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};

type RSVPEntry = {
  accepted: number;
  declined: number;
  tentative: number;
  mine: RSVPStatus | null;
};

type EventCardProps = {
  event: GroupCalendarEvent;
  isAdmin: boolean;
  isMember: boolean;
  rsvp?: RSVPEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onRSVP: (status: RSVPStatus) => void;
  onDelete: () => void;
  isPast?: boolean;
  s: ReturnType<typeof createStyles>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const RSVP_OPTIONS: { status: RSVPStatus; label: string; emoji: string }[] = [
  { status: 'accepted',  label: 'Going',    emoji: '✅' },
  { status: 'tentative', label: 'Maybe',    emoji: '🤔' },
  { status: 'declined',  label: "Can't go", emoji: '❌' },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function GroupCalendarTab({
  group,
  isAdmin,
  isMember,
  npub,
  displayName,
  refreshing,
  onRefresh,
}: Props) {
  const { theme } = useIdentity();
  const s = useMemo(() => createStyles(theme), [theme]);
  const [events, setEvents]         = useState<GroupCalendarEvent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showPast, setShowPast]     = useState(false);
  const [showModal, setShowModal]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rsvpState, setRsvpState]   = useState<Record<string, RSVPEntry>>({});

  // Form state
  const [evTitle, setEvTitle]         = useState('');
  const [evDescription, setEvDesc]    = useState('');
  const [evLocation, setEvLocation]   = useState('');
  const [evIsAllDay, setEvIsAllDay]   = useState(false);
  const [evDate, setEvDate]           = useState('');
  const [evStartTime, setEvStartTime] = useState('');
  const [evEndTime, setEvEndTime]     = useState('');

  // ── Load ──────────────────────────────────────────────────────────────────

  const hydrateRSVPState = useCallback((loadedEvents: GroupCalendarEvent[]) => {
    Promise.resolve().then(async () => {
      const stateMap: Record<string, RSVPEntry> = {};

      for (const ev of loadedEvents) {
        try {
          const [counts, myRsvp] = await Promise.all([
            getRSVPCounts(ev.id),
            npub ? getMyRSVP(ev.id, npub) : Promise.resolve(null),
          ]);

          stateMap[ev.id] = { ...counts, mine: myRsvp?.status ?? null };

          setRsvpState(current => ({
            ...current,
            [ev.id]: stateMap[ev.id],
          }));

          await new Promise(resolve => setTimeout(resolve, 0));
        } catch (error) {
          console.warn('[Group Calendar] RSVP hydrate failed:', error);
        }
      }
    });
  }, [npub]);

  const loadEvents = useCallback(async () => {
    if (!group?.id) return;

    const loaded = await getCalendarEventsForGroup(group.id);

    setEvents(loaded);
    setLoading(false);

    hydrateRSVPState(loaded);
  }, [group?.id, hydrateRSVPState]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── RSVP handler ─────────────────────────────────────────────────────────

  const handleRSVP = async (event: GroupCalendarEvent, status: RSVPStatus) => {
    if (!npub || !isMember) return;

    setRsvpState(prev => {
      const current: RSVPEntry = prev[event.id] ?? {
        accepted: 0, declined: 0, tentative: 0, mine: null,
      };

      const counts: Record<RSVPStatus, number> = {
        accepted:  current.accepted,
        declined:  current.declined,
        tentative: current.tentative,
      };

      if (current.mine !== null) {
        counts[current.mine] = Math.max(0, counts[current.mine] - 1);
      }
      counts[status] = counts[status] + 1;

      return { ...prev, [event.id]: { ...counts, mine: status } };
    });

    await submitRSVP({
      eventId:   event.id,
      groupId:   group.id,
      npub,
      displayName,
      status,
      relayUrl:  group.relayUrl,
    });
  };

  // ── Delete handler ────────────────────────────────────────────────────────

  const handleDelete = (event: GroupCalendarEvent) => {
    Alert.alert(
      'Delete event?',
      `"${event.title}" will be removed from the calendar.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCalendarEvent(event.id);

            setEvents(current =>
              current.filter(item => item.id !== event.id)
            );

            setRsvpState(current => {
              const next = { ...current };
              delete next[event.id];
              return next;
            });
          },
        },
      ]
    );
  };

  // ── Create event ──────────────────────────────────────────────────────────

  const resetForm = () => {
    setEvTitle('');
    setEvDesc('');
    setEvLocation('');
    setEvDate('');
    setEvStartTime('');
    setEvEndTime('');
    setEvIsAllDay(false);
  };

  const handleCreate = async () => {
    if (!evTitle.trim()) {
      Alert.alert('Title required', 'Give the event a name.');
      return;
    }
    if (!evDate.trim()) {
      Alert.alert('Date required', 'Enter the event date.');
      return;
    }

    setSaving(true);

    try {
      const dateParts = evDate.split('/').map(Number);
      const month = dateParts[0];
      const day   = dateParts[1];
      const year  = dateParts[2];

      if (!month || !day || !year) {
        throw new Error('Invalid date format. Use MM/DD/YYYY');
      }

      let startTime = 0;
      let endTime: number | undefined;
      let startDate: string | undefined;

      if (evIsAllDay) {
        startDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        startTime = Math.floor(new Date(year, month - 1, day).getTime() / 1000);
      } else {
        if (!evStartTime.trim()) throw new Error('Start time required for timed events.');
        startTime = parseTimeInput(evStartTime, year, month, day);
        if (evEndTime.trim()) {
          endTime = parseTimeInput(evEndTime, year, month, day);
          if (endTime <= startTime) endTime = startTime + 3600;
        }
      }

      const createdEvent = await createCalendarEvent({
        groupId:     group.id,
        title:       evTitle.trim(),
        description: evDescription.trim() || undefined,
        location:    evLocation.trim() || undefined,
        eventType:   evIsAllDay ? 'allday' : 'timed',
        startTime,
        endTime,
        startDate,
        authorNpub:  npub,
        authorName:  displayName,
        relayUrl:    group.relayUrl,
      });

      setEvents(current =>
        [createdEvent, ...current].sort((a, b) => a.startTime - b.startTime)
      );

      hydrateRSVPState([createdEvent]);

      resetForm();
      setShowModal(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not create event.';
      Alert.alert('Error', msg);
    }

    setSaving(false);
  };

  // ── Derived lists ─────────────────────────────────────────────────────────

  const upcomingEvents = events.filter(e => !isEventPast(e));
  const pastEvents     = events.filter(e =>  isEventPast(e));

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={theme.gold} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={s.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { await onRefresh(); await loadEvents(); }}
            tintColor={theme.gold}
          />
        }
      >
        {upcomingEvents.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📅</Text>
            <Text style={s.emptyText}>No upcoming events</Text>
            <Text style={s.emptyHint}>
              {isAdmin
                ? 'Tap + Event to add a game, practice, or meeting to the group calendar.'
                : "Your admin hasn't added any upcoming events yet."}
            </Text>
          </View>
        ) : (
          upcomingEvents.map(event => (
            <EventCard
              key={event.id}
              event={event}
              isAdmin={isAdmin}
              isMember={isMember}
              rsvp={rsvpState[event.id]}
              expanded={expandedId === event.id}
              onToggleExpand={() => setExpandedId(id => (id === event.id ? null : event.id))}
              onRSVP={status => handleRSVP(event, status)}
              onDelete={() => handleDelete(event)}
              s={s}
            />
          ))
        )}

        {pastEvents.length > 0 && (
          <View style={s.pastSection}>
            <TouchableOpacity
              style={s.pastToggle}
              onPress={() => setShowPast(v => !v)}
            >
              <Text style={s.pastToggleText}>
                {showPast ? '▾' : '▸'} Past events ({pastEvents.length})
              </Text>
            </TouchableOpacity>

            {showPast && pastEvents.map(event => (
              <EventCard
                key={event.id}
                event={event}
                isAdmin={isAdmin}
                isMember={isMember}
                rsvp={rsvpState[event.id]}
                expanded={expandedId === event.id}
                onToggleExpand={() => setExpandedId(id => (id === event.id ? null : event.id))}
                onRSVP={status => handleRSVP(event, status)}
                onDelete={() => handleDelete(event)}
                isPast
                s={s}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {isAdmin && group.status === 'active' && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => setShowModal(true)}
          activeOpacity={0.85}
        >
          <Text style={s.fabIcon}>＋</Text>
          <Text style={s.fabText}>Event</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => { resetForm(); setShowModal(false); }}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.modalScrollContent}
          >
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>New Event</Text>

              <Text style={s.inputLabel}>TITLE *</Text>
              <TextInput
                style={s.input}
                value={evTitle}
                onChangeText={setEvTitle}
                placeholder="Game vs. Rush Springs, Practice, Meeting…"
                placeholderTextColor={theme.textMuted}
                autoFocus
              />

              <Text style={s.inputLabel}>DATE *  (MM/DD/YYYY)</Text>
              <TextInput
                style={s.input}
                value={evDate}
                onChangeText={setEvDate}
                placeholder="05/15/2025"
                placeholderTextColor={theme.textMuted}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <View style={s.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>All-day event</Text>
                  <Text style={s.toggleHint}>Spirit week, holiday, school closure</Text>
                </View>
                <Switch
                  value={evIsAllDay}
                  onValueChange={setEvIsAllDay}
                  trackColor={{ false: theme.raised, true: theme.gold }}
                  thumbColor="#fff"
                />
              </View>

              {!evIsAllDay && (
                <>
                  <Text style={s.inputLabel}>START TIME  (e.g. 7:00 PM)</Text>
                  <TextInput
                    style={s.input}
                    value={evStartTime}
                    onChangeText={setEvStartTime}
                    placeholder="7:00 PM"
                    placeholderTextColor="#444"
                  />
                  <Text style={s.inputLabel}>END TIME  (optional)</Text>
                  <TextInput
                    style={s.input}
                    value={evEndTime}
                    onChangeText={setEvEndTime}
                    placeholder="9:00 PM"
                    placeholderTextColor="#444"
                  />
                </>
              )}

              <Text style={s.inputLabel}>LOCATION  (optional)</Text>
              <TextInput
                style={s.input}
                value={evLocation}
                onChangeText={setEvLocation}
                placeholder="Home field, Gym, Zoom link…"
                placeholderTextColor="#444"
              />

              <Text style={s.inputLabel}>DESCRIPTION  (optional)</Text>
              <TextInput
                style={[s.input, s.inputMulti]}
                value={evDescription}
                onChangeText={setEvDesc}
                placeholder="Bring your gear, wear red…"
                placeholderTextColor="#444"
                multiline
                textAlignVertical="top"
              />

              <Text style={s.modalMeta}>
                Members can RSVP Going / Maybe / Unable to go. See attendance counts after posting.
              </Text>

              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => { resetForm(); setShowModal(false); }}
                >
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.confirmBtn, saving && s.confirmBtnDisabled]}
                  onPress={handleCreate}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={theme.bg} />
                    : <Text style={s.confirmText}>Post event</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ─── EventCard ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  isAdmin,
  isMember,
  rsvp,
  expanded,
  onToggleExpand,
  onRSVP,
  onDelete,
  isPast = false,
  s,
}: EventCardProps) {
  const past = isPast || isEventPast(event);

  return (
    <TouchableOpacity
      style={[s.card, past && s.cardPast]}
      activeOpacity={0.88}
      onPress={onToggleExpand}
    >
      <View style={[s.dateStripe, past && s.dateStripePast]}>
        <Text style={[s.dateStripeDay, past && s.dateStripeTextPast]}>
          {getShortDay(event)}
        </Text>
        <Text style={[s.dateStripeNum, past && s.dateStripeTextPast]}>
          {getShortDate(event)}
        </Text>
      </View>

      <View style={s.cardContent}>
        <View style={s.cardTop}>
          <Text
            style={[s.cardTitle, past && s.cardTitlePast]}
            numberOfLines={expanded ? undefined : 1}
          >
            {event.title}
          </Text>
          {isAdmin && (
            <TouchableOpacity
              onPress={onDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.deleteBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.metaRow}>
          <Text style={s.metaText}>🕐 {formatEventTime(event)}</Text>
          {!!event.location && (
            <Text style={s.metaText} numberOfLines={1}>📍 {event.location}</Text>
          )}
        </View>

        {expanded && !!event.description && (
          <Text style={s.description}>{event.description}</Text>
        )}

        {rsvp !== undefined && (rsvp.accepted + rsvp.declined + rsvp.tentative) > 0 && (
          <View style={s.rsvpCountRow}>
            {rsvp.accepted  > 0 && <Text style={s.rsvpCount}>✅ {rsvp.accepted}</Text>}
            {rsvp.tentative > 0 && <Text style={s.rsvpCount}>🤔 {rsvp.tentative}</Text>}
            {rsvp.declined  > 0 && <Text style={s.rsvpCount}>❌ {rsvp.declined}</Text>}
          </View>
        )}

        {expanded && isMember && !past && (
          <View style={s.rsvpRow}>
            {RSVP_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.status}
                style={[s.rsvpBtn, rsvp?.mine === opt.status && s.rsvpBtnActive]}
                onPress={() => onRSVP(opt.status)}
                activeOpacity={0.8}
              >
                <Text style={s.rsvpBtnEmoji}>{opt.emoji}</Text>
                <Text style={[s.rsvpBtnText, rsvp?.mine === opt.status && s.rsvpBtnTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!expanded && (isMember || !!event.description) && (
          <Text style={s.expandHint}>
            {event.description ? 'Tap for details & RSVP' : 'Tap to RSVP'}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getShortDay(event: GroupCalendarEvent): string {
  if (event.eventType === 'allday' && event.startDate) {
    const [y, m, d] = event.startDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  }
  return new Date(event.startTime * 1000)
    .toLocaleDateString([], { weekday: 'short' })
    .toUpperCase();
}

function getShortDate(event: GroupCalendarEvent): string {
  if (event.eventType === 'allday' && event.startDate) {
    const [, m, d] = event.startDate.split('-').map(Number);
    return `${m}/${d}`;
  }
  const date = new Date(event.startTime * 1000);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function parseTimeInput(
  input: string,
  year: number,
  month: number,
  day: number
): number {
  const str     = input.trim().toUpperCase();
  const isPM    = str.includes('PM');
  const isAM    = str.includes('AM');
  const cleaned = str.replace(/[APM\s]/g, '');
  const parts   = cleaned.split(':');
  let hours     = parseInt(parts[0] ?? '0', 10);
  const minutes = parseInt(parts[1] ?? '0', 10);
  if (isPM && hours !== 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  return Math.floor(new Date(year, month - 1, day, hours, minutes, 0).getTime() / 1000);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: typeof Colors.light) => StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 100,
    backgroundColor: theme.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  emptyIcon: { fontSize: 36, marginBottom: 12, opacity: 0.75 },
  emptyText: { fontSize: 17, color: theme.text, fontWeight: '600' },
  emptyHint: {
    fontSize: 13,
    color: theme.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 19,
  },

   card: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardPast: { opacity: 0.6 },

  dateStripe: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: theme.gold,
    paddingVertical: 8,
  },
  dateStripePast: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  dateStripeDay: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.gold,
    letterSpacing: 0.5,
  },
  dateStripeNum: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.gold,
    marginTop: 2,
  },
  dateStripeTextPast: { color: theme.textMuted },

  cardContent: { flex: 1 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 5,
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  cardTitlePast: { color: theme.textMuted },
  deleteBtn:     { color: theme.textMuted, fontSize: 14, fontWeight: '700', paddingHorizontal: 2 },

  metaRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  metaText:    { fontSize: 12, color: theme.textMuted, fontWeight: '500' },
  description: { color: theme.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 8 },
  expandHint:  { fontSize: 11, color: theme.textMuted, fontStyle: 'italic', marginTop: 4 },

  rsvpCountRow: { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 4 },
  rsvpCount:    { fontSize: 12, color: theme.textMuted, fontWeight: '600' },

  rsvpRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  rsvpBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  rsvpBtnActive: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  rsvpBtnEmoji: { fontSize: 14 },
  rsvpBtnText: {
    fontSize: 11,
    color: theme.textMuted,
    fontWeight: '700',
  },
  rsvpBtnTextActive: { color: theme.gold },

  pastSection:    { marginTop: 8 },
  pastToggle:     { paddingVertical: 12, paddingHorizontal: 4 },
  pastToggleText: { color: theme.textMuted, fontSize: 13, fontWeight: '500' },

  fab: {
    position: 'absolute',
    bottom: 90,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: theme.gold,
    shadowColor: theme.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
fabIcon: {
  fontSize: 18,
  color: theme.bg,
  fontWeight: '400',
  marginRight: 2,
},
fabText: {
  fontSize: 15,
  color: theme.bg,
  fontWeight: '700',
  letterSpacing: 0.3,
},

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalScrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: theme.bg,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    padding: 20,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  modalMeta: { fontSize: 11, color: theme.textMuted, marginTop: 12, lineHeight: 17 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    marginBottom: 4,
    gap: 12,
  },
  toggleLabel: { color: theme.text, fontSize: 14, fontWeight: '700' },
  toggleHint: { color: theme.textMuted, fontSize: 11, marginTop: 2 },

  inputLabel: {
    fontSize: 11,
    color: theme.textMuted,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: theme.text,
    backgroundColor: theme.surface,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top', lineHeight: 21 },

  modalActions:       { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn:          { flex: 1, padding: 12, borderRadius: 10, borderWidth: 0.5, borderColor: theme.border, alignItems: 'center' },
  cancelText:         { color: theme.textMuted,fontSize: 14 },
  confirmBtn:         { flex: 2, padding: 12, borderRadius: 10, backgroundColor: theme.gold, alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.65 },
  confirmText:        { color: theme.bg, fontWeight: '700', fontSize: 14 },
});