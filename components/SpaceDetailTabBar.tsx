import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import {
  StyleSheet,
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
  {
    key: 'gallery',
    icon: 'images-outline',
    activeIcon: 'images',
  },
  {
    key: 'legacy',
    icon: 'library-outline',
    activeIcon: 'library',
  },
  {
    key: 'book',
    icon: 'book-outline',
    activeIcon: 'book',
  },
] as const;

export default function SpaceDetailTabBar({
  activeTab,
  theme,
  onSelect,
  showBook = true,
}: SpaceDetailTabBarProps) {
  const s = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={s.spaceHeaderDock}>
      {SPACE_DETAIL_TABS.filter(item => showBook || item.key !== 'book').map(item => {
        const active = activeTab === item.key;

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
});