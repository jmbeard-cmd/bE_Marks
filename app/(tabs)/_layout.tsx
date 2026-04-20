import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

function LogIcon({ color }: { color: string }) {
  return (
    <View style={[s.iconWrap, { borderColor: color }]}>
      <Text style={[s.iconPlus, { color }]}>+</Text>
    </View>
  );
}

function TimelineIcon({ color }: { color: string }) {
  return (
    <View style={s.timelineIcon}>
      <View style={[s.tLine, { backgroundColor: color }]} />
      <View style={[s.tLine, { backgroundColor: color, width: 14 }]} />
      <View style={[s.tLine, { backgroundColor: color, width: 10 }]} />
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
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ color }) => <LogIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: 'Timeline',
          tabBarIcon: ({ color }) => <TimelineIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon color={color} />,
        }}
      />
    </Tabs>
  );
}

const s = StyleSheet.create({
  iconWrap: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  iconPlus: { fontSize: 16, lineHeight: 20, fontWeight: '300' },
  timelineIcon: { gap: 3, justifyContent: 'center', height: 22 },
  tLine: { height: 2, width: 18, borderRadius: 1 },
  settingsIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  sCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, position: 'absolute' },
  sDot: { width: 6, height: 6, borderRadius: 3 },
});