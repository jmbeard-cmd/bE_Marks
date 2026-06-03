import {
    FlatList,
    Platform,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from 'react-native';

type MyMarksFeedProps = {
  items: any[];
  syncing: boolean;
  refreshing: boolean;
  theme: any;
  renderItem: any;
  onRefresh: () => void;
  onScroll: (event: any) => void;
  viewabilityConfig: any;
  onViewableItemsChanged: any;
};

export default function MyMarksFeed({
  items,
  syncing,
  refreshing,
  theme,
  renderItem,
  onRefresh,
  onScroll,
  viewabilityConfig,
  onViewableItemsChanged,
}: MyMarksFeedProps) {
  if (items.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={[s.emptyIcon, { color: theme.textMuted }]}>
          {syncing ? '⟳' : '◎'}
        </Text>
        <Text style={[s.emptyText, { color: theme.text }]}>
          {syncing ? 'Syncing…' : 'No Marks yet'}
        </Text>
        <Text style={[s.emptyHint, { color: theme.textMuted }]}>
          {syncing ? '' : 'Tap + to capture your first Mark.'}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={item => item.id}
      renderItem={renderItem}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      contentContainerStyle={s.list}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      updateCellsBatchingPeriod={24}
      windowSize={5}
      removeClippedSubviews={Platform.OS === 'android'}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.gold}
        />
      }
    />
  );
}

const s = StyleSheet.create({
  list: {
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 116,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
});