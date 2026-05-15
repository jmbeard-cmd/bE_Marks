import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useIdentity } from '../_layout';

function TimelineIcon({ color }: { color: string }) {
  return (
    <View style={s.timelineIcon}>
      <View style={[s.tLine, { backgroundColor: color }]} />
      <View style={[s.tLine, { backgroundColor: color, width: 14 }]} />
      <View style={[s.tLine, { backgroundColor: color, width: 10 }]} />
    </View>
  );
}

function MessagesIcon({ color }: { color: string }) {
  return (
    <View style={s.messagesIcon}>
      <View style={[s.mBubble, { borderColor: color }]} />
      <View style={[s.mLine, { backgroundColor: color }]} />
      <View style={[s.mLineShort, { backgroundColor: color }]} />
    </View>
  );
}

function GroupsIcon({ color }: { color: string }) {
  return (
    <View style={s.groupsIcon}>
      <View style={[s.gCircle1, { borderColor: color }]} />
    <View style={[s.gCircle2, { borderColor: color }]} />
    <View style={[s.gCircle3, { borderColor: color }]} />
    </View>
  );
}

function SettingsIcon({ color }: { color: string }) {
  return (
    <View style={s.settingsIcon}>
      <View style={[s.sCircle, { borderColor: color }]} />
      <View style={[s.sDot, { backgroundColor: color }]} />
    </View>
  );
}

export default function TabLayout() {
  const { theme } = useIdentity();
  return (
    <Tabs
      initialRouteName="timeline"
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          borderTopWidth: 0.5,
          borderTopColor: theme.border,
          backgroundColor: theme.surface,
          elevation: 0,
          shadowOpacity: 0,
          height: 78,
          paddingBottom: 22,
          paddingTop: 6,
        },
        tabBarActiveTintColor: theme.gold,
        tabBarInactiveTintColor:
          theme.bg === '#0D0F0E'
            ? 'rgba(255,255,255,0.75)'
            : theme.textMuted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.5,
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
        tabBarIconStyle: {
          marginBottom: 2,
        },
      }}
    >
      <Tabs.Screen
        name="timeline"
        options={{
          title: 'Timeline',
          tabBarIcon: ({ color }) => <TimelineIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Spaces',
          tabBarIcon: ({ color }) => <MessagesIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color }) => <GroupsIcon color={color} />,
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon color={color} />,
        }}
      />
      {/* Hidden screens — not tabs */}
      <Tabs.Screen name="log" options={{ href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  timelineIcon: { gap: 3, justifyContent: 'center', height: 22 },
  tLine: { height: 2, width: 18, borderRadius: 1 },

  messagesIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  mBubble: {
    width: 18, height: 14, borderRadius: 5, borderWidth: 1.5,
    position: 'absolute', top: 2,
  },
  mLine: { width: 10, height: 1.5, borderRadius: 1, position: 'absolute', top: 7 },
  mLineShort: { width: 6, height: 1.5, borderRadius: 1, position: 'absolute', top: 11 },

  groupsIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  gCircle1: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, position: 'absolute', left: 0, top: 2 },
  gCircle2: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, position: 'absolute', left: 6, top: 2 },
  gCircle3: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, position: 'absolute', left: 3, top: 10 },

  settingsIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  sCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, position: 'absolute' },
  sDot: { width: 6, height: 6, borderRadius: 3 },
});
