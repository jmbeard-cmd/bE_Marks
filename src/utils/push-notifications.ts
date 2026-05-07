// src/utils/push-notifications.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const PUSH_TOKEN_KEY = 'be_expo_push_token_v1';
const PUSH_TOKEN_OWNER_KEY = 'be_expo_push_token_owner_v1';

const PUSH_REGISTER_URL = 'https://be-marks-push.jmbeard.workers.dev/push/register';
const PUSH_SEND_TEST_URL = 'https://be-marks-push.jmbeard.workers.dev/push/send-test';
const PUSH_SECRET = 'be_marks_pull_short_precise_announce_1980_2006_10_03';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getProjectId(): string | null {
  const fromExpoConfig = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEasConfig = Constants.easConfig?.projectId;

  if (typeof fromExpoConfig === 'string' && fromExpoConfig.length > 0) {
    return fromExpoConfig;
  }

  if (typeof fromEasConfig === 'string' && fromEasConfig.length > 0) {
    return fromEasConfig;
  }

  return null;
}

async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#C9973A',
    sound: 'default',
  });
}

export async function getStoredExpoPushToken() {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

export async function registerForPushNotifications(npub: string) {
  try {
    console.log('[Push] registering push notifications for:', npub.slice(0, 12));

    if (!Device.isDevice) {
      console.log('[Push] physical device required for push notifications');
      return null;
    }

    await ensureAndroidNotificationChannel();

    const existingPermission = await Notifications.getPermissionsAsync();
    let finalStatus = existingPermission.status;

    if (existingPermission.status !== 'granted') {
      const requestedPermission = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermission.status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] notification permission not granted');
      return null;
    }

    const projectId = getProjectId();

    if (!projectId) {
      console.warn('[Push] missing EAS projectId');
      return null;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const token = tokenResult.data;

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    await AsyncStorage.setItem(PUSH_TOKEN_OWNER_KEY, npub);

    console.log('[Push] Expo token:', token);

    await registerTokenWithBackend({
      npub,
      expoPushToken: token,
      platform: Platform.OS,
    });

    return token;
  } catch (error) {
    console.warn('[Push] registration failed:', error);
    return null;
  }
}

async function registerTokenWithBackend({
  npub,
  expoPushToken,
  platform,
}: {
  npub: string;
  expoPushToken: string;
  platform: string;
}) {
  if (!PUSH_REGISTER_URL) {
    console.log('[Push] backend registration skipped; no PUSH_REGISTER_URL yet');
    return;
  }

  try {
    const response = await fetch(PUSH_REGISTER_URL, {
      method: 'POST',
headers: {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${PUSH_SECRET}`,
},
      body: JSON.stringify({
        npub,
        expoPushToken,
        platform,
        app: 'be-marks',
        registeredAt: Math.floor(Date.now() / 1000),
      }),
    });

    if (!response.ok) {
      console.warn('[Push] backend registration failed:', response.status);
      return;
    }

    console.log('[Push] token registered with backend');
  } catch (error) {
    console.warn('[Push] backend registration error:', error);
  }
}

export async function clearStoredPushToken() {
  await AsyncStorage.multiRemove([PUSH_TOKEN_KEY, PUSH_TOKEN_OWNER_KEY]);
}

export async function sendRemoteTestPushToSelf(npub: string) {
  try {
    if (!PUSH_SEND_TEST_URL) {
      console.log('[Push] remote test skipped; no PUSH_SEND_TEST_URL');
      return false;
    }

    const response = await fetch(PUSH_SEND_TEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PUSH_SECRET}`,
      },
      body: JSON.stringify({
        npub,
        title: 'bE Marks',
        body: 'Remote push notifications are working.',
      }),
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      console.warn('[Push] remote test failed:', response.status, result);
      return false;
    }

    console.log('[Push] remote test sent:', result);
    return true;
  } catch (error) {
    console.warn('[Push] remote test error:', error);
    return false;
  }
}

export async function sendLocalTestNotification() {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'bE Marks test',
      body: 'Notifications are enabled on this device.',
      sound: true,
      data: {
        type: 'test',
      },
    },
    trigger: null,
  });
}