import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../src/constants/theme';

export type SpaceDetailTabKey =
  | 'stickies'
  | 'chat'
  | 'board'
  | 'calendar'
  | 'gallery'
  | 'legacy'
  | 'book';

type SpaceDetailTabBarTheme = typeof Colors.dark;

type SpaceDetailTabBarProps = {
  activeTab: string;
  theme: SpaceDetailTabBarTheme;
  onSelect: (tab: SpaceDetailTabKey) => void;
  showBook?: boolean;
  counts?: Partial<Record<SpaceDetailTabKey, number>>;
};

const SPACE_DETAIL_TABS = [
  {
    key: 'stickies',
    icon: 'albums-outline',
    activeIcon: 'albums',
  },
  {
    key: 'chat',
    icon: 'chatbubble-ellipses-outline',
    activeIcon: 'chatbubble-ellipses',
  },
  {
    key: 'board',
    icon: 'megaphone-outline',
    activeIcon: 'megaphone',
  },
  {
    key: 'calendar',
    icon: 'calendar-outline',
    activeIcon: 'calendar',
  },
] as const;

export default function SpaceDetailTabBar({
  activeTab,
  theme,
  onSelect,
  counts = {},
}: SpaceDetailTabBarProps) {
  const s = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={s.spaceHeaderDock}>
      {SPACE_DETAIL_TABS.map(item => {
        const active = activeTab === item.key;
        const count = counts[item.key] ?? 0;
        const showCount = count > 0;
        const countLabel = count > 99 ? '99+' : String(count);

        return (
          <TouchableOpacity
            key={item.key}
            style={[s.spaceHeaderDockItem, active && s.spaceHeaderDockItemActive]}
            onPress={() => onSelect(item.key)}
            activeOpacity={0.86}
          >
            <Ionicons
              name={active ? item.activeIcon : item.icon}
              size={22}
              color={active ? theme.gold : theme.textSecondary}
            />

            {showCount && (
              <View style={s.spaceHeaderDockBadge}>
                <Text style={s.spaceHeaderDockBadgeText}>{countLabel}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const createStyles = (theme: SpaceDetailTabBarTheme) => StyleSheet.create({
  spaceHeaderDock: {
    alignSelf: 'flex-start',
    marginTop: 10,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 0.5,
    borderColor: theme.bg === Colors.light.bg
      ? 'rgba(23,18,14,0.12)'
      : 'rgba(255,255,255,0.14)',
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.72)'
      : 'rgba(18,20,19,0.72)',
    padding: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  spaceHeaderDockItem: {
    width: 42,
    height: 40,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaceHeaderDockItemActive: {
    backgroundColor: theme.gold + '2E',
    borderColor: theme.gold + '7A',
  },
  spaceHeaderDockBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.gold,
    borderWidth: 1,
    borderColor: theme.bg,
  },
  spaceHeaderDockBadgeText: {
    color: theme.bg,
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 11,
  },
});