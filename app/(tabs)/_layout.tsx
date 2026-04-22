import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

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

function LogIcon({ color }: { color: string }) {
  return (
    <View style={s.logIcon}>
      <View style={[s.logCircle, { borderColor: color }]} />
      <View style={[s.logPlus1, { backgroundColor: color }]} />
      <View style={[s.logPlus2, { backgroundColor: color }]} />
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
  return (
    <Tabs
      initialRouteName="timeline"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          borderTopWidth: 0.5,
          borderTopColor: '#222',
          backgroundColor: '#111',
          elevation: 0,
          shadowOpacity: 0,
          height: 64,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#c9973a',
        tabBarInactiveTintColor: '#444',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
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
        name="log"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color }) => <MessagesIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon color={color} />,
        }}
      />
      {/* dm-thread is NOT a tab — it lives in the root Stack */}
      <Tabs.Screen
        name="dm-thread"
        options={{ href: null }}
      />
    </Tabs>
  );
}

const s = StyleSheet.create({
  timelineIcon: { gap: 3, justifyContent: 'center', height: 22 },
  tLine: { height: 2, width: 18, borderRadius: 1 },

  logIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  logCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, position: 'absolute' },
  logPlus1: { width: 10, height: 1.5, borderRadius: 1, position: 'absolute' },
  logPlus2: { width: 1.5, height: 10, borderRadius: 1, position: 'absolute' },

  messagesIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  mBubble: {
    width: 18, height: 14, borderRadius: 5, borderWidth: 1.5,
    position: 'absolute', top: 2,
  },
  mLine: { width: 10, height: 1.5, borderRadius: 1, position: 'absolute', top: 7 },
  mLineShort: { width: 6, height: 1.5, borderRadius: 1, position: 'absolute', top: 11 },

  settingsIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  sCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, position: 'absolute' },
  sDot: { width: 6, height: 6, borderRadius: 3 },
});