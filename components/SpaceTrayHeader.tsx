import { useMemo } from 'react';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Colors } from '../src/constants/theme';
import SpaceDetailTabBar, { SpaceDetailTabKey } from './SpaceDetailTabBar';

type SpaceTrayHeaderTheme = typeof Colors.dark;

type SpaceTrayHeaderProps = {
  title: string;
  meta: string;
  activeTab: string;
  theme: SpaceTrayHeaderTheme;
  onOpenControls: () => void;
  onSelectTab: (tab: SpaceDetailTabKey) => void;
};

export default function SpaceTrayHeader({
  title,
  meta,
  activeTab,
  theme,
  onOpenControls,
  onSelectTab,
}: SpaceTrayHeaderProps) {
  const s = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={s.spaceTrayHeader}>
      <TouchableOpacity
        style={s.spaceProfileIdentityTap}
        onPress={onOpenControls}
        activeOpacity={0.86}
      >
        <Text style={s.spaceProfileTitle} numberOfLines={2}>
          {title}
        </Text>

        <Text style={s.spaceProfileMeta} numberOfLines={1}>
          Tap for controls • {meta}
        </Text>
      </TouchableOpacity>

      <SpaceDetailTabBar
        activeTab={activeTab}
        theme={theme}
        onSelect={onSelectTab}
      />
    </View>
  );
}

const createStyles = (theme: SpaceTrayHeaderTheme) => StyleSheet.create({
  spaceTrayHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.border,
    backgroundColor: theme.bg === Colors.light.bg
      ? 'rgba(255,255,255,0.42)'
      : 'rgba(18,18,18,0.38)',
  },
  spaceProfileTitle: {
    color: theme.text,
    fontSize: 23,
    fontWeight: '900',
  },
  spaceProfileMeta: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  spaceProfileIdentityTap: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
});