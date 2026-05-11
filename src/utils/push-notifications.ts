// src/utils/push-notifications.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getGroupById, getGroupMembers } from './group-storage';

const PUSH_TOKEN_KEY = 'be_expo_push_token_v1';
const PUSH_TOKEN_OWNER_KEY = 'be_expo_push_token_owner_v1';

const PUSH_REGISTER_URL = 'https://be-marks-push.jmbeard.workers.dev/push/register';
const PUSH_SEND_TEST_URL = 'https://be-marks-push.jmbeard.workers.dev/push/send-test';
const PUSH_SECRET = 'be_marks_pull_short_precise_announce_1980_2006_10_03';

export type BENotificationData = {
  type?: 'dm' | 'group' | 'mark' | 'test';
  threadId?: string;
  participantPubkey?: string;
  senderPubkey?: string;
  senderNpub?: string;
  groupId?: string;
  relayUrl?: string;
  eventId?: string;
  markId?: string;
};

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

function truncatePreview(text: string, limit = 90) {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}…`;
}

function shortKey(value?: string | null) {
  if (!value) return 'Someone';
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
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
        data: {
          type: 'test',
        },
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

export async function sendLocalDMNotification(input: {
  senderName?: string;
  senderPubkey: string;
  threadId: string;
  preview: string;
}) {
  try {
    const senderName = input.senderName?.trim() || shortKey(input.senderPubkey);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: senderName,
        body: truncatePreview(input.preview),
        sound: true,
        badge: 1,
        data: {
          type: 'dm',
          threadId: input.threadId,
          participantPubkey: input.senderPubkey,
          senderPubkey: input.senderPubkey,
        } satisfies BENotificationData,
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('[Push] local DM notification failed:', error);
  }
}

export async function sendLocalGroupNotification(input: {
  groupId: string;
  senderNpub?: string;
  senderPubkey?: string;
  senderName?: string;
  preview: string;
  eventId?: string;
}) {
  try {
    const group = await getGroupById(input.groupId);

    if (!group) {
      console.log('[Push] skipped group notification; group not found:', input.groupId);
      return;
    }

    let senderName = input.senderName?.trim();

    if (!senderName && input.senderNpub) {
      const members = await getGroupMembers(input.groupId);
      const member = members.find(m => m.npub === input.senderNpub);
      senderName = member?.displayName?.trim();
    }

    const safeSenderName =
      senderName ||
      shortKey(input.senderNpub) ||
      shortKey(input.senderPubkey);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: group.name || 'Group message',
        body: `${safeSenderName}: ${truncatePreview(input.preview)}`,
        sound: true,
        badge: 1,
        data: {
          type: 'group',
          groupId: input.groupId,
          relayUrl: group.relayUrl,
          senderNpub: input.senderNpub,
          senderPubkey: input.senderPubkey,
          eventId: input.eventId,
        } satisfies BENotificationData,
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('[Push] local group notification failed:', error);
  }
}

export function installNotificationResponseHandler(router: {
  push: (href: any) => void;
}) {
  async function routeFromData(rawData: any) {
    const data = rawData as BENotificationData;

    if (!data?.type || data.type === 'test') {
      return;
    }

    console.log('[Push] notification tapped:', data);

    if (data.type === 'dm') {
      const threadTarget = data.threadId || data.participantPubkey || data.senderPubkey;

      if (!threadTarget) {
        console.warn('[Push] DM notification missing thread target');
        return;
      }

      router.push({
        pathname: '/dm-thread',
        params: {
          threadId: threadTarget,
          participantPubkey: data.participantPubkey || data.senderPubkey || threadTarget,
        },
      } as any);

      return;
    }

    if (data.type === 'group') {
      if (!data.groupId) {
        console.warn('[Push] group notification missing groupId');
        return;
      }

      router.push({
        pathname: '/group-thread',
        params: {
          groupId: data.groupId,
          relayUrl: data.relayUrl,
        },
      } as any);

      return;
    }

    if (data.type === 'mark') {
      if (!data.markId) {
        console.warn('[Push] mark notification missing markId');
        return;
      }

      router.push({
        pathname: '/mark-detail',
        params: {
          id: data.markId,
        },
      } as any);
    }
  }

  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    routeFromData(response.notification.request.content.data).catch(error => {
      console.warn('[Push] notification response route failed:', error);
    });
  });

  Notifications.getLastNotificationResponseAsync()
    .then(response => {
      const data = response?.notification.request.content.data;

      if (!data) return;

      setTimeout(() => {
        routeFromData(data).catch(error => {
          console.warn('[Push] initial notification route failed:', error);
        });
      }, 650);
    })
    .catch(error => {
      console.warn('[Push] getLastNotificationResponseAsync failed:', error);
    });

  return () => {
    subscription.remove();
  };
}