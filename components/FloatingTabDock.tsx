import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useRef } from 'react';
import { Animated, DeviceEventEmitter, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../src/constants/theme';

type FloatingTabDockProps = BottomTabBarProps & {
  theme: typeof Colors.dark;
};

function withAlpha(color: string, alphaHex: string) {
  if (/^#[0-9A-F]{6}$/i.test(color)) return `${color}${alphaHex}`;
  return color;
}

export default function FloatingTabDock({
  state,
  descriptors,
  navigation,
  theme,
}: FloatingTabDockProps) {
  const dockTranslateY = useRef(new Animated.Value(0)).current;
  const dockOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      'be:floatingDock:setHidden',
      (hidden: boolean) => {
        Animated.parallel([
          Animated.timing(dockTranslateY, {
            toValue: hidden ? 96 : 0,
            duration: hidden ? 180 : 220,
            useNativeDriver: true,
          }),
          Animated.timing(dockOpacity, {
            toValue: hidden ? 0 : 1,
            duration: hidden ? 150 : 200,
            useNativeDriver: true,
          }),
        ]).start();
      }
    );

    return () => {
      subscription.remove();
    };
  }, [dockOpacity, dockTranslateY]);

  const visibleRoutes = state.routes.filter(route =>
    route.name === 'messages' || route.name === 'settings'
  );

return (
  <Animated.View
    pointerEvents="box-none"
    style={[
      s.wrap,
      {
        opacity: dockOpacity,
        transform: [{ translateY: dockTranslateY }],
      },
    ]}
  >
    <View
        style={[
          s.dock,
          {
            backgroundColor:
              theme.bg === '#0D0F0E'
                ? 'rgba(18,20,19,0.88)'
                : withAlpha(theme.surface, 'EE'),
            borderColor:
              theme.bg === '#0D0F0E'
                ? 'rgba(255,255,255,0.14)'
                : withAlpha(theme.border, 'CC'),
          },
        ]}
      >
        {visibleRoutes.map(route => {
          const descriptor = descriptors[route.key];
          const options = descriptor?.options ?? {};
          const routeIndex = state.routes.findIndex(item => item.key === route.key);
          const focused = state.index === routeIndex;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title ?? route.name;

          const color = focused
            ? theme.gold
            : theme.bg === '#0D0F0E'
              ? 'rgba(255,255,255,0.82)'
              : theme.textMuted;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              style={[
                s.item,
                focused && {
                  backgroundColor: withAlpha(theme.gold, '2E'),
                  borderColor: withAlpha(theme.gold, '7A'),
                },
              ]}
              onPress={onPress}
              activeOpacity={0.86}
            >
              <View style={s.iconWrap}>
                {options.tabBarIcon?.({
                  color,
                  focused,
                  size: 22,
                })}
              </View>

              <Text
                style={[
                  s.label,
                  {
                    color,
                    fontWeight: focused ? '800' : '700',
                  },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
    </View>
  </Animated.View>
);
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    alignItems: 'center',
  },
  dock: {
    width: 244,
    minHeight: 64,
    borderRadius: 32,
    borderWidth: 0.5,
    padding: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 10,
  },
  item: {
    flex: 1,
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 0.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  iconWrap: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.15,
  },
});