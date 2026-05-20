import {
  createCalendarEvent,
  deleteCalendarEvent,
  deriveGameResult,
  formatEventTime,
  formatGameScore,
  getCalendarEventsForGroup,
  getMyRSVP,
  getRSVPCounts,
  getSpaceEventTypeIcon,
  getSpaceEventTypeLabel,
  isEventPast,
  submitRSVP,
  updateCalendarEvent,
  type GameHomeAway,
  type GroupCalendarEvent,
  type RSVPStatus,
  type SpaceEventType,
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
  onEditScore: () => void;
  isPast?: boolean;
  s: ReturnType<typeof createStyles>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const RSVP_OPTIONS: { status: RSVPStatus; label: string; emoji: string }[] = [
  { status: 'accepted',  label: 'Going',    emoji: '✅' },
  { status: 'tentative', label: 'Maybe',    emoji: '🤔' },
  { status: 'declined',  label: "Can't go", emoji: '❌' },
];

const TIME_HOURS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const TIME_MINUTES = ['00', '15', '30', '45'];

const TIME_PERIODS = ['AM', 'PM'] as const;

type TimePeriod = typeof TIME_PERIODS[number];

const SPACE_EVENT_TYPE_OPTIONS: SpaceEventType[] = [
  'game',
  'practice',
  'tournament',
  'meeting',
  'fundraiser',
  'banquet',
  'event',
  'other',
];

const HOME_AWAY_OPTIONS: { value: GameHomeAway; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
  { value: 'neutral', label: 'Neutral' },
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
  const todayKey = formatDateInput(new Date());
  const [events, setEvents]         = useState<GroupCalendarEvent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showPast, setShowPast]     = useState(false);
  const [showModal, setShowModal]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rsvpState, setRsvpState]   = useState<Record<string, RSVPEntry>>({});

  const [scoreEvent, setScoreEvent] = useState<GroupCalendarEvent | null>(null);
  const [scoreOur, setScoreOur] = useState('');
  const [scoreOpponent, setScoreOpponent] = useState('');
  const [scoreFinal, setScoreFinal] = useState(true);
  const [scoreNotes, setScoreNotes] = useState('');
  const [scoreSaving, setScoreSaving] = useState(false);

  // Form state
  const [evTitle, setEvTitle]                 = useState('');
  const [evDescription, setEvDesc]            = useState('');
  const [evLocation, setEvLocation]           = useState('');
  const [evIsAllDay, setEvIsAllDay]           = useState(false);
  const [evDate, setEvDate]                   = useState('');
  const [evStartTime, setEvStartTime]         = useState('');
  const [evEndTime, setEvEndTime]             = useState('');
  const [evSpaceEventType, setEvSpaceEventType] = useState<SpaceEventType>('event');
  const [evOpponent, setEvOpponent]           = useState('');
  const [evHomeAway, setEvHomeAway]           = useState<GameHomeAway>('home');
  const [evLegacyEligible, setEvLegacyEligible] = useState(true);
  const [pickerMonth, setPickerMonth]         = useState(() => new Date());

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

    // ── Score handler ─────────────────────────────────────────────────────────

  const openScoreEditor = (event: GroupCalendarEvent) => {
    setScoreEvent(event);
    setScoreOur(
      typeof event.ourScore === 'number' ? String(event.ourScore) : ''
    );
    setScoreOpponent(
      typeof event.opponentScore === 'number' ? String(event.opponentScore) : ''
    );
    setScoreFinal(event.scoreFinal ?? true);
    setScoreNotes(event.eventNotes ?? '');
  };

  const closeScoreEditor = () => {
    setScoreEvent(null);
    setScoreOur('');
    setScoreOpponent('');
    setScoreFinal(true);
    setScoreNotes('');
    setScoreSaving(false);
  };

  const handleSaveScore = async () => {
    if (!scoreEvent) return;

    const ourValue = Number(scoreOur);
    const opponentValue = Number(scoreOpponent);

    if (!Number.isFinite(ourValue) || !Number.isFinite(opponentValue)) {
      Alert.alert('Score required', 'Enter both scores before saving.');
      return;
    }

    if (ourValue < 0 || opponentValue < 0) {
      Alert.alert('Invalid score', 'Scores cannot be negative.');
      return;
    }

    const ourScore = Math.floor(ourValue);
    const opponentScore = Math.floor(opponentValue);
    const result = deriveGameResult(ourScore, opponentScore);

    setScoreSaving(true);

    await updateCalendarEvent(scoreEvent.id, {
      ourScore,
      opponentScore,
      result,
      scoreFinal,
      eventNotes: scoreNotes.trim() || undefined,
    });

    setEvents(current =>
      current.map(event =>
        event.id === scoreEvent.id
          ? {
              ...event,
              ourScore,
              opponentScore,
              result,
              scoreFinal,
              eventNotes: scoreNotes.trim() || undefined,
              updatedAt: Math.floor(Date.now() / 1000),
            }
          : event
      )
    );

    closeScoreEditor();
  };

  // ── Create event ──────────────────────────────────────────────────────────

  const resetForm = () => {
    setEvTitle('');
    setEvDesc('');
    setEvLocation('');
    setEvDate('');
    setPickerMonth(new Date());
    setEvStartTime('');
    setEvEndTime('');
    setEvIsAllDay(false);
    setEvSpaceEventType('event');
    setEvOpponent('');
    setEvHomeAway('home');
    setEvLegacyEligible(true);
  };

  const selectDate = (date: Date) => {
    setEvDate(formatDateInput(date));
    setPickerMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const shiftPickerMonth = (delta: number) => {
    setPickerMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const renderTimePicker = (
    value: string,
    onSelect: (next: string) => void,
    placeholder: string
  ) => {
    const parsed = parseTimeParts(value);

    const setHour = (hour: string) => {
      onSelect(formatTimeParts(hour, parsed.minute, parsed.period));
    };

    const setMinute = (minute: string) => {
      onSelect(formatTimeParts(parsed.hour, minute, parsed.period));
    };

    const setPeriod = (period: TimePeriod) => {
      onSelect(formatTimeParts(parsed.hour, parsed.minute, period));
    };

    return (
      <View style={s.timePickerBox}>
        <View style={s.timePickerSection}>
          <Text style={s.timePickerLabel}>Hour</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {TIME_HOURS.map(hour => {
              const selected = parsed.hour === hour;

              return (
                <TouchableOpacity
                  key={hour}
                  style={[s.timeChip, selected && s.timeChipSelected]}
                  onPress={() => setHour(hour)}
                  activeOpacity={0.82}
                >
                  <Text style={[s.timeChipText, selected && s.timeChipTextSelected]}>
                    {hour}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={s.timePickerSection}>
          <Text style={s.timePickerLabel}>Minutes</Text>
          <View style={s.minuteGrid}>
            {TIME_MINUTES.map(minute => {
              const selected = parsed.minute === minute;

              return (
                <TouchableOpacity
                  key={minute}
                  style={[s.minuteChip, selected && s.timeChipSelected]}
                  onPress={() => setMinute(minute)}
                  activeOpacity={0.82}
                >
                  <Text style={[s.timeChipText, selected && s.timeChipTextSelected]}>
                    {minute}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={s.periodRow}>
          {TIME_PERIODS.map(period => {
            const selected = parsed.period === period;

            return (
              <TouchableOpacity
                key={period}
                style={[s.periodChip, selected && s.timeChipSelected]}
                onPress={() => setPeriod(period)}
                activeOpacity={0.82}
              >
                <Text style={[s.timeChipText, selected && s.timeChipTextSelected]}>
                  {period}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TextInput
          style={[s.input, s.timeManualInput]}
          value={value}
          onChangeText={onSelect}
          onBlur={() => {
            const normalized = normalizeTimeInput(value);
            if (normalized) onSelect(normalized);
          }}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          keyboardType="numbers-and-punctuation"
        />

        <Text style={s.timePickerHint}>
          You can type 7:30 PM, 730pm, 7pm, or 19:30.
        </Text>
      </View>
    );
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
        groupId:       group.id,
        title:         evTitle.trim(),
        description:   evDescription.trim() || undefined,
        location:      evLocation.trim() || undefined,
        eventType:     evIsAllDay ? 'allday' : 'timed',
        spaceEventType: evSpaceEventType,
        opponent:      evSpaceEventType === 'game' || evSpaceEventType === 'tournament'
          ? evOpponent.trim() || undefined
          : undefined,
        homeAway:      evSpaceEventType === 'game' || evSpaceEventType === 'tournament'
          ? evHomeAway
          : undefined,
        legacyEligible: evLegacyEligible,
        startTime,
        endTime,
        startDate,
        authorNpub:    npub,
        authorName:    displayName,
        relayUrl:      group.relayUrl,
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

  const thisWeekEvents = upcomingEvents.filter(isEventThisWeek);
  const laterUpcomingEvents = upcomingEvents.filter(e => !isEventThisWeek(e));

  const seasonResultEvents = pastEvents.filter(
    e => e.spaceEventType === 'game' || e.spaceEventType === 'tournament'
  );

  const otherPastEvents = pastEvents.filter(
    e => e.spaceEventType !== 'game' && e.spaceEventType !== 'tournament'
  );

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
        <View style={s.calendarHero}>
          <View style={s.calendarHeroTop}>
            <View>
              <Text style={s.calendarHeroEyebrow}>SPACE CALENDAR</Text>
              <Text style={s.calendarHeroTitle}>Structure the season story</Text>
            </View>
            <Text style={s.calendarHeroIcon}>📅</Text>
          </View>

          <Text style={s.calendarHeroText}>
            Games, meetings, fundraisers, banquets, and key dates become the structure for Marks, Mantle, River, and Legacy.
          </Text>

          <View style={s.calendarStatsRow}>
            <View style={s.calendarStatCard}>
              <Text style={s.calendarStatValue}>{thisWeekEvents.length}</Text>
              <Text style={s.calendarStatLabel}>This Week</Text>
            </View>

            <View style={s.calendarStatCard}>
              <Text style={s.calendarStatValue}>{laterUpcomingEvents.length}</Text>
              <Text style={s.calendarStatLabel}>Upcoming</Text>
            </View>

            <View style={s.calendarStatCard}>
              <Text style={s.calendarStatValue}>{seasonResultEvents.length}</Text>
              <Text style={s.calendarStatLabel}>Results</Text>
            </View>
          </View>
        </View>

        {upcomingEvents.length === 0 && pastEvents.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📅</Text>
            <Text style={s.emptyText}>No calendar events yet</Text>
            <Text style={s.emptyHint}>
              {isAdmin
                ? 'Tap + Event to add a game, practice, meeting, fundraiser, or banquet.'
                : "Your admin hasn't added any calendar events yet."}
            </Text>
          </View>
        ) : (
          <>
            {thisWeekEvents.length > 0 && (
              <View style={s.calendarSection}>
                <View style={s.sectionHeader}>
                  <View>
                    <Text style={s.sectionEyebrow}>NOW</Text>
                    <Text style={s.sectionTitle}>This Week</Text>
                  </View>
                  <Text style={s.sectionCount}>{thisWeekEvents.length}</Text>
                </View>

                {thisWeekEvents.map(event => (
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
  onEditScore={() => openScoreEditor(event)}
  s={s}
/>
                ))}
              </View>
            )}

            {laterUpcomingEvents.length > 0 && (
              <View style={s.calendarSection}>
                <View style={s.sectionHeader}>
                  <View>
                    <Text style={s.sectionEyebrow}>NEXT</Text>
                    <Text style={s.sectionTitle}>Upcoming</Text>
                  </View>
                  <Text style={s.sectionCount}>{laterUpcomingEvents.length}</Text>
                </View>

                {laterUpcomingEvents.map(event => (
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
                    onEditScore={() => openScoreEditor(event)}
                    s={s}
                  />
                ))}
              </View>
            )}

            {seasonResultEvents.length > 0 && (
              <View style={s.calendarSection}>
                <View style={s.sectionHeader}>
                  <View>
                    <Text style={s.sectionEyebrow}>STORY</Text>
                    <Text style={s.sectionTitle}>Season Results</Text>
                  </View>
                  <Text style={s.sectionCount}>{seasonResultEvents.length}</Text>
                </View>

                {seasonResultEvents.map(event => (
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
                    onEditScore={() => openScoreEditor(event)}
                    isPast
                    s={s}
                  />
                ))}
              </View>
            )}

            {otherPastEvents.length > 0 && (
              <View style={s.pastSection}>
                <TouchableOpacity
                  style={s.pastToggle}
                  onPress={() => setShowPast(v => !v)}
                >
                  <Text style={s.pastToggleText}>
                    {showPast ? '▾' : '▸'} Past Events ({otherPastEvents.length})
                  </Text>
                </TouchableOpacity>

                {showPast && otherPastEvents.map(event => (
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
                    onEditScore={() => openScoreEditor(event)}
                    isPast
                    s={s}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {isAdmin && group.status === 'active' && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => setShowModal(true)}
          activeOpacity={0.85}
        >
          <Text style={s.fabIcon}>+</Text>
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

                            <Text style={s.inputLabel}>EVENT TYPE</Text>
              <View style={s.eventTypeGrid}>
                {SPACE_EVENT_TYPE_OPTIONS.map(type => {
                  const selected = evSpaceEventType === type;

                  return (
                    <TouchableOpacity
                      key={type}
                      style={[s.eventTypeChip, selected && s.eventTypeChipSelected]}
                      onPress={() => setEvSpaceEventType(type)}
                      activeOpacity={0.82}
                    >
                      <Text style={s.eventTypeEmoji}>{getSpaceEventTypeIcon(type)}</Text>
                      <Text
                        style={[
                          s.eventTypeText,
                          selected && s.eventTypeTextSelected,
                        ]}
                      >
                        {getSpaceEventTypeLabel(type)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {(evSpaceEventType === 'game' || evSpaceEventType === 'tournament') && (
                <>
                  <Text style={s.inputLabel}>OPPONENT  (optional)</Text>
                  <TextInput
                    style={s.input}
                    value={evOpponent}
                    onChangeText={setEvOpponent}
                    placeholder="Rush Springs, Lindsay, Tuttle…"
                    placeholderTextColor={theme.textMuted}
                  />

                  <Text style={s.inputLabel}>HOME / AWAY</Text>
                  <View style={s.homeAwayRow}>
                    {HOME_AWAY_OPTIONS.map(option => {
                      const selected = evHomeAway === option.value;

                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[s.homeAwayChip, selected && s.homeAwayChipSelected]}
                          onPress={() => setEvHomeAway(option.value)}
                          activeOpacity={0.82}
                        >
                          <Text
                            style={[
                              s.homeAwayText,
                              selected && s.homeAwayTextSelected,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <View style={s.legacyToggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>Legacy-ready</Text>
                  <Text style={s.toggleHint}>
                    Use this event later when building season memories.
                  </Text>
                </View>
                <Switch
                  value={evLegacyEligible}
                  onValueChange={setEvLegacyEligible}
                  trackColor={{ false: theme.raised, true: theme.gold }}
                  thumbColor="#fff"
                />
              </View>

              <Text style={s.inputLabel}>DATE *  (MM/DD/YYYY)</Text>
              <View style={s.datePickerBox}>
                <View style={s.datePickerHeader}>
                  <TouchableOpacity style={s.monthNavBtn} onPress={() => shiftPickerMonth(-1)}>
                    <Text style={s.monthNavText}>‹</Text>
                  </TouchableOpacity>

                  <Text style={s.monthTitle}>
                    {pickerMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}
                  </Text>

                  <TouchableOpacity style={s.monthNavBtn} onPress={() => shiftPickerMonth(1)}>
                    <Text style={s.monthNavText}>›</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.weekdayRow}>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                    <Text key={`${day}_${index}`} style={s.weekdayText}>{day}</Text>
                  ))}
                </View>

                <View style={s.dateGrid}>
                  {buildCalendarDays(pickerMonth).map((day, index) => {
                    const dayKey = day ? formatDateInput(day) : '';
                    const isToday = !!day && dayKey === todayKey;
                    const selected = !!day && evDate === dayKey;

                    return (
                      <TouchableOpacity
                        key={`${day?.toISOString() ?? 'empty'}_${index}`}
                        style={s.dateCell}
                        onPress={() => day && selectDate(day)}
                        disabled={!day}
                        activeOpacity={0.82}
                      >
                        <View
                          style={[
                            s.dateCellMarker,
                            isToday && s.dateCellToday,
                            selected && s.dateCellSelected,
                          ]}
                        >
                          <Text
                            style={[
                              s.dateCellText,
                              isToday && s.dateCellTextToday,
                              selected && s.dateCellTextSelected,
                            ]}
                          >
                            {day ? day.getDate() : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput
                  style={[s.input, s.dateManualInput]}
                  value={evDate}
                  onChangeText={setEvDate}
                  placeholder="MM/DD/YYYY"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
              </View>

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
                  {renderTimePicker(evStartTime, setEvStartTime, '7:00 PM')}
                  <Text style={s.inputLabel}>END TIME  (optional)</Text>
                  {renderTimePicker(evEndTime, setEvEndTime, '9:00 PM')}
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

      <Modal
        visible={!!scoreEvent}
        transparent
        animationType="slide"
        onRequestClose={closeScoreEditor}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={s.scoreModalWrap}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Game Result</Text>

              {!!scoreEvent && (
                <>
                  <Text style={s.scoreEventTitle}>{scoreEvent.title}</Text>

                  {!!scoreEvent.opponent && (
                    <Text style={s.scoreEventSub}>
                      vs. {scoreEvent.opponent}
                    </Text>
                  )}

                  <View style={s.scoreInputsRow}>
                    <View style={s.scoreInputBox}>
                      <Text style={s.inputLabel}>US</Text>
                      <TextInput
                        style={[s.input, s.scoreInput]}
                        value={scoreOur}
                        onChangeText={setScoreOur}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>

                    <View style={s.scoreInputBox}>
                      <Text style={s.inputLabel}>THEM</Text>
                      <TextInput
                        style={[s.input, s.scoreInput]}
                        value={scoreOpponent}
                        onChangeText={setScoreOpponent}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                  </View>

                  <View style={s.toggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.toggleLabel}>Final score</Text>
                      <Text style={s.toggleHint}>
                        Turn off if the score is still in progress.
                      </Text>
                    </View>
                    <Switch
                      value={scoreFinal}
                      onValueChange={setScoreFinal}
                      trackColor={{ false: theme.raised, true: theme.gold }}
                      thumbColor="#fff"
                    />
                  </View>

                  <Text style={s.inputLabel}>RECAP NOTE  (optional)</Text>
                  <TextInput
                    style={[s.input, s.inputMulti]}
                    value={scoreNotes}
                    onChangeText={setScoreNotes}
                    placeholder="Big win, close finish, tournament opener…"
                    placeholderTextColor={theme.textMuted}
                    multiline
                    textAlignVertical="top"
                  />

                  <View style={s.modalActions}>
                    <TouchableOpacity
                      style={s.cancelBtn}
                      onPress={closeScoreEditor}
                    >
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[s.confirmBtn, scoreSaving && s.confirmBtnDisabled]}
                      onPress={handleSaveScore}
                      disabled={scoreSaving}
                    >
                      {scoreSaving
                        ? <ActivityIndicator size="small" color={theme.bg} />
                        : <Text style={s.confirmText}>Save result</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
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
  onEditScore,
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

        <View style={s.eventBadgeRow}>
          <View style={s.eventTypeBadge}>
            <Text style={s.eventTypeBadgeIcon}>
              {getSpaceEventTypeIcon(event.spaceEventType)}
            </Text>
            <Text style={s.eventTypeBadgeText}>
              {getSpaceEventTypeLabel(event.spaceEventType)}
            </Text>
          </View>

          {!!event.legacyEligible && (
            <View style={s.legacyBadge}>
              <Text style={s.legacyBadgeText}>Legacy-ready</Text>
            </View>
          )}
        </View>

        <View style={s.metaRow}>
          <Text style={s.metaText}>🕐 {formatEventTime(event)}</Text>
          {!!event.location && (
            <Text style={s.metaText} numberOfLines={1}>📍 {event.location}</Text>
          )}
        </View>

        {(event.spaceEventType === 'game' || event.spaceEventType === 'tournament') && (
          <View style={s.gameMetaBox}>
            <View style={s.gameMetaTopRow}>
              <View style={{ flex: 1 }}>
                {!!event.opponent && (
                  <Text style={s.gameMetaText} numberOfLines={1}>
                    vs. {event.opponent}
                  </Text>
                )}

                {!!event.homeAway && (
                  <Text style={s.gameMetaSubText}>
                    {formatHomeAway(event.homeAway)}
                  </Text>
                )}
              </View>

              {!!formatGameScore(event) && (
                <View style={s.scoreCluster}>
                  <View style={s.resultPill}>
                    <Text style={s.resultPillText}>
                      {formatResultBadge(event)}
                    </Text>
                  </View>

                  <View style={s.scorePill}>
                    <Text style={s.scorePillText}>
                      {formatGameScore(event)}
                    </Text>
                    <Text style={s.scoreStatusText}>
                      {event.scoreFinal === false ? 'Live' : 'Final'}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {expanded && isAdmin && past && (
              <TouchableOpacity
                style={s.scoreEditBtn}
                onPress={onEditScore}
                activeOpacity={0.82}
              >
                <Text style={s.scoreEditText}>
                  {formatGameScore(event) ? 'Edit result' : 'Add result'}
                </Text>
              </TouchableOpacity>
            )}

            {expanded && !!event.eventNotes && (
              <View style={s.scoreStoryBox}>
                <Text style={s.scoreStoryLabel}>Game story</Text>
                <Text style={s.scoreNote}>{event.eventNotes}</Text>
              </View>
            )}
          </View>
        )}

        {expanded && !!event.description && (
          <Text style={s.description}>{event.description}</Text>
        )}

        {expanded && !!event.legacyEligible && (
          <Text style={s.legacyHint}>
            This event can help organize Marks into a future Legacy collection.
          </Text>
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

function formatHomeAway(value: GroupCalendarEvent['homeAway']): string {
  switch (value) {
    case 'home':
      return 'Home';
    case 'away':
      return 'Away';
    case 'neutral':
      return 'Neutral site';
    default:
      return '';
  }
}

function formatResultBadge(event: GroupCalendarEvent): string {
  switch (event.result) {
    case 'win':
      return 'W';
    case 'loss':
      return 'L';
    case 'tie':
      return 'T';
    default:
      return '–';
  }
}

function formatDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function isEventThisWeek(event: GroupCalendarEvent): boolean {
  const now = new Date();
  const eventDate = new Date(event.startTime * 1000);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(startOfToday.getDate() + 7);

  return eventDate >= startOfToday && eventDate < endOfWeek;
}

function buildCalendarDays(monthDate: Date): (Date | null)[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);

  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function parseTimeInput(
  input: string,
  year: number,
  month: number,
  day: number
): number {
  const normalized = normalizeTimeInput(input);

  if (!normalized) {
    throw new Error('Invalid time. Use 7:30 PM, 730pm, 7pm, or 19:30.');
  }

  const parsed = parseTimeParts(normalized);
  let hours = Number(parsed.hour);
  const minutes = Number(parsed.minute);

  if (parsed.period === 'PM' && hours !== 12) hours += 12;
  if (parsed.period === 'AM' && hours === 12) hours = 0;

  return Math.floor(new Date(year, month - 1, day, hours, minutes, 0).getTime() / 1000);
}

function parseTimeParts(input: string): {
  hour: string;
  minute: string;
  period: TimePeriod;
} {
  const normalized = normalizeTimeInput(input);

  if (!normalized) {
    return {
      hour: '7',
      minute: '00',
      period: 'PM',
    };
  }

  const match = normalized.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);

  if (!match) {
    return {
      hour: '7',
      minute: '00',
      period: 'PM',
    };
  }

  return {
    hour: String(Number(match[1])),
    minute: match[2],
    period: match[3] as TimePeriod,
  };
}

function formatTimeParts(
  hour: string,
  minute: string,
  period: TimePeriod
): string {
  return `${hour}:${minute} ${period}`;
}

function normalizeTimeInput(input: string): string {
  const raw = input.trim().toUpperCase();

  if (!raw) return '';

  const compact = raw.replace(/\s+/g, '');

  const twelveHourMatch = compact.match(/^(\d{1,2})(?::?(\d{2}))?(AM|PM)$/);
  if (twelveHourMatch) {
    const hour = Number(twelveHourMatch[1]);
    const minute = twelveHourMatch[2] ?? '00';
    const period = twelveHourMatch[3] as TimePeriod;

    if (hour < 1 || hour > 12) return '';
    if (!isValidMinute(minute)) return '';

    return `${hour}:${minute} ${period}`;
  }

  const militaryMatch = compact.match(/^(\d{1,2}):?(\d{2})$/);
  if (militaryMatch) {
    const first = militaryMatch[1];
    const minute = militaryMatch[2];
    const hour24 = Number(first);

    if (hour24 < 0 || hour24 > 23) return '';
    if (!isValidMinute(minute)) return '';

    const period: TimePeriod = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;

    return `${hour12}:${minute} ${period}`;
  }

  const plainHourMatch = compact.match(/^(\d{1,2})$/);
  if (plainHourMatch) {
    const hour = Number(plainHourMatch[1]);

    if (hour < 1 || hour > 12) return '';

    return `${hour}:00 PM`;
  }

  return '';
}

function isValidMinute(minute: string): boolean {
  const value = Number(minute);
  return /^\d{2}$/.test(minute) && value >= 0 && value <= 59;
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

  calendarHero: {
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 22,
    padding: 16,
    marginBottom: 18,
  },
  calendarHeroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  calendarHeroEyebrow: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  calendarHeroTitle: {
    color: theme.text,
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  calendarHeroIcon: {
    fontSize: 28,
    opacity: 0.85,
  },
  calendarHeroText: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  calendarStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  calendarStatCard: {
    flex: 1,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  calendarStatValue: {
    color: theme.gold,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
  },
  calendarStatLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 3,
    textAlign: 'center',
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

  eventBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 7,
  },
  eventTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 999,
    backgroundColor: theme.raised,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  eventTypeBadgeIcon: {
    fontSize: 11,
  },
  eventTypeBadgeText: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  legacyBadge: {
    alignSelf: 'flex-start',
    borderWidth: 0.5,
    borderColor: theme.gold,
    borderRadius: 999,
    backgroundColor: theme.bg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  legacyBadgeText: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '800',
  },
  metaRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  metaText:    { fontSize: 12, color: theme.textMuted, fontWeight: '500' },
  gameMetaBox: {
    borderLeftWidth: 2,
    borderLeftColor: theme.gold,
    paddingLeft: 9,
    marginTop: 2,
    marginBottom: 7,
  },
  gameMetaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gameMetaText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '800',
  },
  gameMetaSubText: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  scoreCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resultPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.gold,
  },
  resultPillText: {
    color: theme.bg,
    fontSize: 13,
    fontWeight: '900',
  },
  scorePill: {
    borderWidth: 0.5,
    borderColor: theme.gold,
    borderRadius: 12,
    backgroundColor: theme.raised,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignItems: 'center',
  },
  scorePillText: {
    color: theme.gold,
    fontSize: 11,
    fontWeight: '900',
  },
  scoreStatusText: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scoreEditBtn: {
    alignSelf: 'flex-start',
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 999,
    backgroundColor: theme.bg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 9,
  },
  scoreEditText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '800',
  },
  scoreStoryBox: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.bg,
    padding: 10,
    marginTop: 9,
  },
  scoreStoryLabel: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  scoreNote: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  description: { color: theme.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 8 },
  legacyHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
    marginBottom: 6,
  },
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

  calendarSection: {
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionEyebrow: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 2,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  sectionCount: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },

  pastSection:    { marginTop: 2 },
  pastToggle:     { paddingVertical: 12, paddingHorizontal: 4 },
  pastToggleText: { color: theme.textMuted, fontSize: 13, fontWeight: '700' },

  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.gold,
    shadowColor: theme.gold,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
fabIcon: {
  color: theme.bg,
  fontSize: 34,
  fontWeight: '300',
  lineHeight: 36,
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
  datePickerBox: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 14,
    backgroundColor: theme.surface,
    padding: 10,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
  },
  monthNavText: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '700',
    marginTop: -2,
  },
  monthTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekdayText: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  dateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dateCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1.35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCellMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCellSelected: {
    backgroundColor: theme.gold,
  },
  dateCellToday: {
    borderWidth: 1,
    borderColor: theme.gold,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(211, 158, 45, 0.12)'
      : 'rgba(211, 158, 45, 0.20)',
  },
  dateCellText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  dateCellTextToday: {
    color: theme.gold,
    fontWeight: '900',
  },
  dateCellTextSelected: {
    color: theme.bg,
    fontWeight: '900',
  },
  dateManualInput: {
    marginTop: 8,
  },
  timePickerBox: {
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 14,
    backgroundColor: theme.surface,
    padding: 10,
    gap: 10,
  },
  timePickerSection: {
    gap: 6,
  },
  timePickerLabel: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  timeChip: {
    minHeight: 34,
    minWidth: 42,
    borderRadius: 17,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
    marginRight: 8,
  },
  minuteGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  minuteChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
  },
  periodChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  timeChipSelected: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  timeChipText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '800',
  },
  timeChipTextSelected: {
    color: theme.bg,
  },
  timeManualInput: {
    marginTop: 0,
  },
  timePickerHint: {
    color: theme.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontStyle: 'italic',
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top', lineHeight: 21 },
    eventTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  eventTypeChip: {
    width: '48%',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  eventTypeChipSelected: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  eventTypeEmoji: {
    fontSize: 15,
  },
  eventTypeText: {
    flex: 1,
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  eventTypeTextSelected: {
    color: theme.gold,
  },
  homeAwayRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  homeAwayChip: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
  },
  homeAwayChipSelected: {
    borderColor: theme.gold,
    backgroundColor: theme.raised,
  },
  homeAwayText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  homeAwayTextSelected: {
    color: theme.gold,
  },
  legacyToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    marginBottom: 4,
    gap: 12,
  },

    scoreModalWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scoreEventTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 3,
  },
  scoreEventSub: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
  },
  scoreInputsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  scoreInputBox: {
    flex: 1,
  },
  scoreInput: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '900',
  },

  modalActions:       { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn:          { flex: 1, padding: 12, borderRadius: 10, borderWidth: 0.5, borderColor: theme.border, alignItems: 'center' },
  cancelText:         { color: theme.textMuted,fontSize: 14 },
  confirmBtn:         { flex: 2, padding: 12, borderRadius: 10, backgroundColor: theme.gold, alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.65 },
  confirmText:        { color: theme.bg, fontWeight: '700', fontSize: 14 },
});
