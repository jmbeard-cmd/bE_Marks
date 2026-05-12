import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Colors } from '../src/constants/theme';
import {
    createGroupBookEntry,
    getBookSummaryForGroup,
    publishUnsyncedGroupBookEntries,
    subscribeToGroupBooks,
    syncGroupBookEntriesFromRelay,
    updateGroupBookEntryStatus,
    type GroupBookEntry,
    type GroupBookEntryStatus,
    type GroupBookEntryType,
    type GroupBookSummary,
} from '../src/utils/group-books';
import {
    canManageGroupBook,
    updateGroupBookSettings,
    type BEGroup,
} from '../src/utils/group-storage';

type Props = {
  group: BEGroup;
  npub?: string;
  nsec?: string;
  displayName?: string;
  themeMode: 'dark' | 'light';
  onGroupUpdated?: () => void;
};

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString([], {
    style: 'currency',
    currency: 'USD',
  });
}

function parseMoneyToCents(value: string): number {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const numberValue = Number(cleaned);

  if (!Number.isFinite(numberValue)) return 0;

  return Math.round(numberValue * 100);
}

function formatEntryDate(unix: number): string {
  const date = new Date(unix * 1000);

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getEntryCreatorLabel(entry: GroupBookEntry): string {
  return (
    entry.createdByName ||
    (entry.createdByNpub ? `${entry.createdByNpub.slice(0, 12)}…` : 'Unknown')
  );
}

export default function GroupBookTab({
  group,
  npub,
  nsec,
  displayName,
  themeMode,
  onGroupUpdated,
}: Props) {
  const theme = Colors[themeMode];
  const s = useMemo(() => createStyles(theme), [theme]);

  const [summary, setSummary] = useState<GroupBookSummary | null>(null);
  const [canManage, setCanManage] = useState(false);

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<GroupBookEntry | null>(null);
  const [entryType, setEntryType] = useState<GroupBookEntryType>('income');
  const [entryStatus, setEntryStatus] = useState<GroupBookEntryStatus>('confirmed');
  const [entryTitle, setEntryTitle] = useState('');
  const [entryContributor, setEntryContributor] = useState('');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDescription, setEntryDescription] = useState('');

  const loadBook = useCallback(async () => {
    const cachedSummary = await getBookSummaryForGroup(group.id);
    setSummary(cachedSummary);

    if (canManage && nsec && group.relayUrl) {
      await publishUnsyncedGroupBookEntries({
        groupId: group.id,
        nsec,
        relayUrl: group.relayUrl,
        force: true,
      });
    }

    if (group.relayUrl) {
      await syncGroupBookEntriesFromRelay(group.id, group.relayUrl);

      const syncedSummary = await getBookSummaryForGroup(group.id);
      setSummary(syncedSummary);
    }
  }, [group.id, group.relayUrl]);

  const loadPermission = useCallback(async () => {
    if (!npub) {
      setCanManage(false);
      return;
    }

    const allowed = await canManageGroupBook(group.id, npub);
    setCanManage(allowed);
  }, [group.id, npub]);

  useEffect(() => {
    loadBook();
    loadPermission();

    const unsubscribe = subscribeToGroupBooks(changedGroupId => {
      if (changedGroupId === group.id) {
        loadBook();
      }
    });

    return unsubscribe;
  }, [group.id, loadBook, loadPermission]);

  const handleEnableBook = async () => {
    if (!canManage) return;

    await updateGroupBookSettings(group.id, {
      bookEnabled: true,
      bookOfficerNpubs: group.bookOfficerNpubs ?? [],
    });

    onGroupUpdated?.();
  };

  const resetEntryModal = () => {
    setEntryType('income');
    setEntryStatus('confirmed');
    setEntryTitle('');
    setEntryContributor('');
    setEntryAmount('');
    setEntryDescription('');
    setShowEntryModal(false);
  };

  const handleCreateEntry = async () => {
    if (!npub) {
      Alert.alert('Not signed in', 'Sign in to add a Book entry.');
      return;
    }

    const title = entryTitle.trim();
    const amountCents = parseMoneyToCents(entryAmount);

    if (!title) {
      Alert.alert('Title required', 'Add a short title for this entry.');
      return;
    }

    if (amountCents <= 0) {
      Alert.alert('Amount required', 'Enter an amount greater than zero.');
      return;
    }

    await createGroupBookEntry({
      groupId: group.id,
      type: entryType,
      amountCents,
      title,
      contributorName: entryContributor,
      description: entryDescription,
      status: entryStatus,
      createdByNpub: npub,
      createdByName: displayName,
      relayUrl: group.relayUrl,
      nsec,
    });

    if (!group.bookEnabled) {
      await updateGroupBookSettings(group.id, {
        bookEnabled: true,
        bookOfficerNpubs: group.bookOfficerNpubs ?? [],
      });

      onGroupUpdated?.();
    }

    resetEntryModal();
  };

    const handleConfirmEntry = async (entry: GroupBookEntry) => {
    if (!canManage) return;

    Alert.alert(
      'Mark entry confirmed?',
      'This will count the entry toward the annual Book balance.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            await updateGroupBookEntryStatus(entry.id, 'confirmed', {
              nsec,
              relayUrl: group.relayUrl,
            });
            setSelectedEntry(null);
          },
        },
      ]
    );
  };

  if (!group.bookEnabled) {
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyIcon}>📖</Text>
        <Text style={s.emptyTitle}>The Book is not enabled yet</Text>
        <Text style={s.emptyHint}>
          Enable The Book when this group needs an annual financial record for donations,
          fundraisers, income, expenses, and carryover.
        </Text>

        {canManage && (
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={handleEnableBook}
            activeOpacity={0.85}
          >
            <Text style={s.primaryBtnText}>Enable The Book</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const entries = summary?.entries ?? [];
  const balanceCents = summary?.balanceCents ?? 0;
  const incomeCents = summary?.incomeCents ?? 0;
  const expenseCents = summary?.expenseCents ?? 0;
  const pendingIncomeCents = summary?.pendingIncomeCents ?? 0;
  const pendingExpenseCents = summary?.pendingExpenseCents ?? 0;

  return (
    <View style={s.wrap}>
      <View style={s.pinnedTop}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>The Book</Text>
            <Text style={s.subtitle}>
              {group.name}{group.season ? ` · ${group.season}` : ''}
            </Text>
          </View>

          {canManage && (
            <TouchableOpacity
              style={s.addEntryBtn}
              onPress={() => setShowEntryModal(true)}
              activeOpacity={0.85}
            >
              <Text style={s.addEntryBtnText}>+ Entry</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.snapshotCard}>
          <Text style={s.snapshotLabel}>Annual Balance</Text>
          <Text style={s.snapshotBalance}>{formatMoney(balanceCents)}</Text>

          <View style={s.snapshotGrid}>
            <View style={s.snapshotItem}>
              <Text style={s.snapshotItemLabel}>Income</Text>
              <Text style={s.snapshotIncome}>{formatMoney(incomeCents)}</Text>
            </View>

            <View style={s.snapshotItem}>
              <Text style={s.snapshotItemLabel}>Expenses</Text>
              <Text style={s.snapshotExpense}>{formatMoney(expenseCents)}</Text>
            </View>
          </View>

          {(pendingIncomeCents > 0 || pendingExpenseCents > 0) && (
            <Text style={s.pendingText}>
              Pending: +{formatMoney(pendingIncomeCents)} / -{formatMoney(pendingExpenseCents)}
            </Text>
          )}
        </View>
      </View>

      <FlatList
        data={entries}
        keyExtractor={item => item.id}
        contentContainerStyle={entries.length === 0 ? s.listEmpty : s.list}
        ListHeaderComponent={
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Annual Entries</Text>
            <Text style={s.sectionHint}>
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.entryCard}
            activeOpacity={canManage ? 0.82 : 1}
            onPress={() => {
              if (canManage) {
                setSelectedEntry(item);
              }
            }}
          >
            <View style={s.entryTop}>
              <View
                style={[
                  s.entryTypePill,
                  item.type === 'expense' && s.entryTypePillExpense,
                ]}
              >
                <Text
                  style={[
                    s.entryTypePillText,
                    item.type === 'expense' && s.entryTypePillTextExpense,
                  ]}
                >
                  {item.type === 'income' ? 'Income' : 'Expense'}
                </Text>
              </View>

              <Text
                style={[
                  s.entryAmount,
                  item.type === 'expense' && s.entryAmountExpense,
                ]}
              >
                {item.type === 'expense' ? '-' : '+'}
                {formatMoney(item.amountCents)}
              </Text>
            </View>

            <Text style={s.entryTitle}>{item.title}</Text>

            {!!item.contributorName && (
              <Text style={s.entryContributor}>{item.contributorName}</Text>
            )}

            {!!item.description && (
              <Text style={s.entryDescription}>{item.description}</Text>
            )}

            <View style={s.entryFooter}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.entryDate}>{formatEntryDate(item.createdAt)}</Text>
                <Text style={s.entryCreator} numberOfLines={1}>
                  Logged by {getEntryCreatorLabel(item)}
                </Text>
              </View>

              <Text
                style={[
                  s.entryStatus,
                  item.status === 'pending' && s.entryStatusPending,
                ]}
              >
                {item.status === 'pending' ? 'Pending' : 'Confirmed'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={s.emptyWrapSmall}>
            <Text style={s.emptyIcon}>📖</Text>
            <Text style={s.emptyTitle}>No Book entries yet</Text>
            <Text style={s.emptyHint}>
              Add the carryover from last year as the first income entry, then log each donation,
              fundraiser, purchase, and team expense.
            </Text>

            {canManage && (
              <TouchableOpacity
                style={s.primaryBtn}
                onPress={() => setShowEntryModal(true)}
                activeOpacity={0.85}
              >
                <Text style={s.primaryBtnText}>Add first Entry</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

            <Modal
        visible={!!selectedEntry}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedEntry(null)}
      >
        <View style={s.actionOverlay}>
          <TouchableOpacity
            style={s.actionBackdrop}
            activeOpacity={1}
            onPress={() => setSelectedEntry(null)}
          />

          {selectedEntry && (
            <View style={s.actionSheet}>
              <View style={s.actionHandle} />

              <Text style={s.actionTitle}>{selectedEntry.title}</Text>

              {!!selectedEntry.contributorName && (
                <Text style={s.actionSubtitle}>{selectedEntry.contributorName}</Text>
              )}

              <Text
                style={[
                  s.actionAmount,
                  selectedEntry.type === 'expense' && s.actionAmountExpense,
                ]}
              >
                {selectedEntry.type === 'expense' ? '-' : '+'}
                {formatMoney(selectedEntry.amountCents)}
              </Text>

              <View style={s.actionStatusRow}>
                <Text style={s.actionStatusLabel}>Current status</Text>
                <Text
                  style={[
                    s.actionStatusValue,
                    selectedEntry.status === 'pending' && s.actionStatusPending,
                  ]}
                >
                  {selectedEntry.status === 'pending' ? 'Pending' : 'Confirmed'}
                </Text>
              </View>

              {selectedEntry.status === 'pending' && (
                <TouchableOpacity
                  style={s.actionPrimary}
                  activeOpacity={0.85}
                  onPress={() => handleConfirmEntry(selectedEntry)}
                >
                  <Text style={s.actionPrimaryText}>Mark Confirmed</Text>
                </TouchableOpacity>
              )}

              {selectedEntry.status === 'confirmed' && (
                <Text style={s.actionHint}>
                  Confirmed entries are locked for trust. Add a correction entry if something needs adjusted.
                </Text>
              )}

              <TouchableOpacity
                style={s.actionCancel}
                activeOpacity={0.85}
                onPress={() => setSelectedEntry(null)}
              >
                <Text style={s.actionCancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      <Modal
        visible={showEntryModal}
        transparent
        animationType="slide"
        onRequestClose={resetEntryModal}
      >
        <ScrollView
          style={s.modalOverlay}
          contentContainerStyle={s.modalScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>New Book Entry</Text>

            <Text style={s.inputLabel}>TYPE</Text>
            <View style={s.typeRow}>
              <TouchableOpacity
                style={[s.typeBtn, entryType === 'income' && s.typeBtnActive]}
                onPress={() => setEntryType('income')}
              >
                <Text style={[s.typeText, entryType === 'income' && s.typeTextActive]}>
                  Income
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.typeBtn, entryType === 'expense' && s.typeBtnActive]}
                onPress={() => setEntryType('expense')}
              >
                <Text style={[s.typeText, entryType === 'expense' && s.typeTextActive]}>
                  Expense
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={s.inputLabel}>STATUS</Text>
            <View style={s.typeRow}>
              <TouchableOpacity
                style={[s.typeBtn, entryStatus === 'confirmed' && s.typeBtnActive]}
                onPress={() => setEntryStatus('confirmed')}
              >
                <Text style={[s.typeText, entryStatus === 'confirmed' && s.typeTextActive]}>
                  Confirmed
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.typeBtn, entryStatus === 'pending' && s.typeBtnActive]}
                onPress={() => setEntryStatus('pending')}
              >
                <Text style={[s.typeText, entryStatus === 'pending' && s.typeTextActive]}>
                  Pending
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={s.inputLabel}>TITLE</Text>
            <TextInput
              style={s.input}
              value={entryTitle}
              onChangeText={setEntryTitle}
              placeholder="Carryover from 2025, donation, team meal..."
              placeholderTextColor={theme.textMuted}
            />

            <Text style={s.inputLabel}>DONOR / VENDOR / SOURCE</Text>
            <TextInput
              style={s.input}
              value={entryContributor}
              onChangeText={setEntryContributor}
              placeholder="First National Bank, concession stand, Walmart..."
              placeholderTextColor={theme.textMuted}
            />

            <Text style={s.inputLabel}>AMOUNT</Text>
            <TextInput
              style={s.input}
              value={entryAmount}
              onChangeText={setEntryAmount}
              placeholder="1800.00"
              placeholderTextColor={theme.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={s.inputLabel}>DESCRIPTION</Text>
            <TextInput
              style={[s.input, s.inputMulti]}
              value={entryDescription}
              onChangeText={setEntryDescription}
              placeholder="Optional details for annual reporting"
              placeholderTextColor={theme.textMuted}
              multiline
              textAlignVertical="top"
            />

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={resetEntryModal}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.confirmBtn} onPress={handleCreateEntry}>
                <Text style={s.confirmText}>Save Entry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>
    </View>
  );
}

const createStyles = (theme: typeof Colors.dark) => StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.bg,
  },
    pinnedTop: {
    backgroundColor: theme.bg,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    paddingBottom: 2,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  addEntryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: theme.gold,
  },
  addEntryBtnText: {
    color: theme.bg,
    fontSize: 12,
    fontWeight: '800',
  },
  list: {
    paddingHorizontal: 18,
    paddingBottom: 110,
  },
  listEmpty: {
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: theme.bg,
  },
  emptyWrapSmall: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    marginTop: 24,
  },
  emptyIcon: {
    fontSize: 42,
    marginBottom: 14,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyHint: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 18,
  },
  primaryBtn: {
    backgroundColor: theme.gold,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  primaryBtnText: {
    color: theme.bg,
    fontWeight: '800',
    fontSize: 14,
  },
  snapshotCard: {
    marginHorizontal: 18,
    marginTop: 4,
    marginBottom: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  snapshotLabel: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  snapshotBalance: {
    color: theme.gold,
    fontSize: 34,
    fontWeight: '900',
    marginTop: 5,
  },
  snapshotGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  snapshotItem: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.bg,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  snapshotItemLabel: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  snapshotIncome: {
    color: theme.gold,
    fontSize: 15,
    fontWeight: '900',
  },
  snapshotExpense: {
    color: theme.danger,
    fontSize: 15,
    fontWeight: '900',
  },
  pendingText: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 12,
    fontWeight: '600',
  },
  sectionHeader: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  sectionHint: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  entryCard: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 0.5,
    borderColor: theme.border,
    marginBottom: 10,
  },
  entryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  entryTypePill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.raised,
    borderWidth: 0.5,
    borderColor: theme.gold,
  },
  entryTypePillExpense: {
    borderColor: theme.danger,
  },
  entryTypePillText: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  entryTypePillTextExpense: {
    color: theme.danger,
  },
  entryAmount: {
    color: theme.gold,
    fontSize: 15,
    fontWeight: '900',
  },
  entryAmountExpense: {
    color: theme.danger,
  },
  entryTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  entryContributor: {
    color: theme.textSecondary,
    fontSize: 12,
    marginTop: 3,
    fontWeight: '600',
  },
  entryDescription: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },
  entryFooter: {
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
    marginTop: 11,
    paddingTop: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  entryDate: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
    entryCreator: {
    color: theme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  entryStatus: {
    color: theme.success,
    fontSize: 11,
    fontWeight: '800',
  },
  entryStatusPending: {
    color: theme.warning,
  },
    actionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    justifyContent: 'flex-end',
  },
  actionBackdrop: {
    flex: 1,
  },
  actionSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 28,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  actionHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  actionTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  actionSubtitle: {
    color: theme.textMuted,
    fontSize: 13,
    marginBottom: 12,
  },
  actionAmount: {
    color: theme.gold,
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 14,
  },
  actionAmountExpense: {
    color: theme.danger,
  },
  actionStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: theme.border,
    marginBottom: 14,
  },
  actionStatusLabel: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  actionStatusValue: {
    color: theme.success,
    fontSize: 13,
    fontWeight: '900',
  },
  actionStatusPending: {
    color: theme.warning,
  },
  actionPrimary: {
    backgroundColor: theme.gold,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionPrimaryText: {
    color: theme.bg,
    fontSize: 14,
    fontWeight: '900',
  },
  actionHint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  actionCancel: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  actionCancelText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    borderWidth: 0.5,
    borderColor: theme.border,
  },
  modalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  inputLabel: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 7,
  },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 0.5,
    borderColor: theme.border,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 14,
  },
  inputMulti: {
    minHeight: 78,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: theme.bg,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
  },
  typeBtnActive: {
    backgroundColor: theme.gold,
    borderColor: theme.gold,
  },
  typeText: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  typeTextActive: {
    color: theme.bg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 13,
    borderWidth: 0.5,
    borderColor: theme.border,
    alignItems: 'center',
  },
  cancelText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  confirmBtn: {
    flex: 2,
    padding: 14,
    borderRadius: 13,
    backgroundColor: theme.gold,
    alignItems: 'center',
  },
  confirmText: {
    color: theme.bg,
    fontSize: 14,
    fontWeight: '900',
  },
});