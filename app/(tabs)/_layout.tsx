import { Tabs } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AccountTray from '../../components/AccountTray';
import FloatingTabDock from '../../components/FloatingTabDock';
import { useIdentity } from '../_layout';

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
  const [accountTrayVisible, setAccountTrayVisible] = useState(false);

  return (
    <>
<Tabs
  initialRouteName="groups"
  tabBar={(props) => {
    const activeRouteName = props.state.routes[props.state.index]?.name;

    if (activeRouteName === 'log') {
      return null;
    }

    return (
      <FloatingTabDock
        {...props}
        theme={theme}
        onOpenAccountTray={() => setAccountTrayVisible(true)}
      />
    );
  }}
  screenOptions={{
    headerShown: false,
    tabBarHideOnKeyboard: true,
    sceneStyle: { backgroundColor: theme.bg },
  }}
>
      <Tabs.Screen
        name="messages"
        options={{
          title: 'DMs',
          tabBarIcon: ({ color }) => <MessagesIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Spaces',
          tabBarIcon: ({ color }) => <GroupsIcon color={color} />,
        }}
      />
<Tabs.Screen
  name="account"
  options={{
    title: 'Account',
    tabBarIcon: ({ color }) => <SettingsIcon color={color} />,
  }}
/>

      {/* Hidden legacy screens â€” not tabs */}
      <Tabs.Screen name="timeline" options={{ href: null }} />
      <Tabs.Screen name="log" options={{ href: null }} />
    </Tabs>

      <AccountTray
        visible={accountTrayVisible}
        onClose={() => setAccountTrayVisible(false)}
      />
    </>
  );
}

const s = StyleSheet.create({
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

