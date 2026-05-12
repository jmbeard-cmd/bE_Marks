// src/utils/push-notifications.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createThread, getDMThreads } from './dm-storage';
import { getGroupById, getGroupMembers } from './group-storage';

const PUSH_TOKEN_KEY = 'be_expo_push_token_v1';
const PUSH_TOKEN_OWNER_KEY = 'be_expo_push_token_owner_v1';

const PUSH_REGISTER_URL = 'https://be-marks-push.jmbeard.workers.dev/push/register';
const PUSH_SEND_TEST_URL = 'https://be-marks-push.jmbeard.workers.dev/push/send-test';
const PUSH_SECRET = 'be_marks_pull_short_precise_announce_1980_2006_10_03';
const PUSH_DM_MESSAGE_URL = 'https://be-marks-push.jmbeard.workers.dev/push/dm-message';
const PUSH_GROUP_MEMBER_URL = 'https://be-marks-push.jmbeard.workers.dev/push/register-group-member';
const PUSH_MARK_URL = 'https://be-marks-push.jmbeard.workers.dev/push/mark';
const PUSH_REMOVE_GROUP_MEMBER_URL = 'https://be-marks-push.jmbeard.workers.dev/push/remove-group-member';
const PUSH_GROUP_MESSAGE_URL = 'https://be-marks-push.jmbeard.workers.dev/push/group-message';
const handledNotificationResponseIds = new Set<string>();

export type BEGroupNotificationEventType =
  | 'chat_message'
  | 'chat_media'
  | 'chat_file'
  | 'poll_created'
  | 'highlight_created'
  | 'calendar_created'
  | 'calendar_updated'
  | 'calendar_deleted'
  | 'member_joined'
  | 'member_removed'
  | 'member_role_changed';

export type BEMarkNotificationEventType = 'mark_created';

export type BENotificationData = {
  type?: 'dm' | 'group' | 'mark' | 'test';

  // Shared/future Spaces fields
  spaceId?: string;
  spaceKind?: 'dm' | 'group';

  // Routing fields
  routeTarget?: 'dm-thread' | 'group-thread' | 'group-detail' | 'mark-detail';
  groupTab?: 'stickies' | 'calendar' | 'gallery' | 'members';

  // DM fields
  threadId?: string;
  participantPubkey?: string;
  senderPubkey?: string;
  senderNpub?: string;
  senderName?: string;

  // Group fields
  groupId?: string;
  groupName?: string;
  relayUrl?: string;
  groupEventType?: BEGroupNotificationEventType;
  highlightId?: string;
  calendarEventId?: string;
  pollId?: string;
  memberNpub?: string;

  // Mark fields
  markId?: string;
  markEventType?: BEMarkNotificationEventType;
  authorNpub?: string;
  authorName?: string;

  // Event fields
  eventId?: string;
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

function getDisplayName(name?: string | null, fallback?: string | null) {
  const trimmed = name?.trim();

  if (trimmed) return trimmed;

  return shortKey(fallback);
}

function buildGroupEventBody(input: {
  eventType: BEGroupNotificationEventType;
  actorName?: string;
  actorNpub?: string;
  preview?: string;
  title?: string;
  memberName?: string;
  role?: string;
}) {
  const actorName = getDisplayName(input.actorName, input.actorNpub);
  const preview = input.preview?.trim();
  const title = input.title?.trim();
  const memberName = input.memberName?.trim() || 'a member';

  switch (input.eventType) {
    case 'chat_message':
      return preview || 'New group message';

    case 'chat_media':
      return preview || `${actorName} sent media`;

    case 'chat_file':
      return preview || `${actorName} sent a file`;

    case 'poll_created':
      return title
        ? `${actorName} created a poll: ${title}`
        : `${actorName} created a poll`;

    case 'highlight_created':
      return title
        ? `${actorName} posted a Highlight: ${title}`
        : `${actorName} posted a Highlight`;

    case 'calendar_created':
      return title
        ? `${actorName} added a calendar event: ${title}`
        : `${actorName} added a calendar event`;

    case 'calendar_updated':
      return title
        ? `${actorName} updated a calendar event: ${title}`
        : `${actorName} updated a calendar event`;

    case 'calendar_deleted':
      return title
        ? `${actorName} removed a calendar event: ${title}`
        : `${actorName} removed a calendar event`;

    case 'member_joined':
      return `${actorName} joined the group`;

    case 'member_removed':
      return `${actorName} removed ${memberName} from the group`;

    case 'member_role_changed':
      return input.role
        ? `${actorName} changed ${memberName} to ${input.role}`
        : `${actorName} changed ${memberName}'s role`;

    default:
      return preview || 'New group activity';
  }
}

function buildMarkEventBody(input: {
  authorName?: string;
  authorNpub?: string;
  title?: string;
  preview?: string;
}) {
  const authorName = getDisplayName(input.authorName, input.authorNpub);
  const title = input.title?.trim();
  const preview = input.preview?.trim();

  if (title) {
    return `${authorName} posted a new Mark: ${title}`;
  }

  if (preview) {
    return `${authorName} posted a new Mark: ${truncatePreview(preview, 60)}`;
  }

  return `${authorName} posted a new Mark`;
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

const appOwnership = Constants.appOwnership;
const executionEnvironment = (Constants as any).executionEnvironment;
const appId =
  Constants.expoConfig?.android?.package ||
  Constants.expoConfig?.ios?.bundleIdentifier ||
  'unknown';

console.log('[Push] runtime info:', {
  appOwnership,
  executionEnvironment,
  appId,
});

if (appOwnership === 'expo' && executionEnvironment === 'storeClient') {
  console.log('[Push] skipped backend push registration in Expo Go store client');
  return null;
}

await ensureAndroidNotificationChannel();

const existingPermission = await Notifications.getPermissionsAsync();
console.log('[Push] existing permission:', existingPermission);

let finalStatus = existingPermission.status;

if (existingPermission.status !== 'granted') {
  const requestedPermission = await Notifications.requestPermissionsAsync();
  console.log('[Push] requested permission:', requestedPermission);
  finalStatus = requestedPermission.status;
}

    if (finalStatus !== 'granted') {
      console.log('[Push] notification permission not granted');
      return null;
    }

const projectId = getProjectId();

console.log('[Push] projectId:', projectId);

if (!projectId) {
  console.warn('[Push] missing EAS projectId');
  return null;
}

const tokenResult = await Notifications.getExpoPushTokenAsync({
  projectId,
});

console.log('[Push] token result:', tokenResult);

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

const result = await response.json().catch(() => null);

console.log('[Push] backend registration response:', {
  status: response.status,
  ok: response.ok,
  result,
});

if (!response.ok) {
  console.warn('[Push] backend registration failed:', response.status, result);
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

async function postToPushWorker(
  url: string,
  body: Record<string, any>,
  label: string
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PUSH_SECRET}`,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      console.warn(`[Push] ${label} failed:`, response.status, result);
      return false;
    }

    console.log(`[Push] ${label} ok:`, result);
    return true;
  } catch (error) {
    console.warn(`[Push] ${label} error:`, error);
    return false;
  }
}

export async function sendRemoteDMNotification(input: {
  recipientNpub: string;
  senderNpub: string;
  senderPubkey: string;
  senderName?: string;
  body?: string;
}) {
  const recipientNpub = input.recipientNpub?.trim();
  const senderNpub = input.senderNpub?.trim();
  const senderPubkey = input.senderPubkey?.trim();

  if (!recipientNpub || !senderNpub || !senderPubkey) {
    console.log('[Push] skipped remote DM push; missing recipient/sender fields');
    return false;
  }

  return postToPushWorker(
    PUSH_DM_MESSAGE_URL,
    {
      recipientNpub,
      senderNpub,
      senderPubkey,
      senderName: input.senderName?.trim() || undefined,
      body: input.body?.trim() || 'New private message',
    },
    'remote DM push'
  );
}

export async function registerGroupMemberForPush(input: {
  groupId: string;
  groupName: string;
  relayUrl: string;
  memberNpub: string;
  role?: 'owner' | 'admin' | 'member';
  status?: 'active' | 'removed';
  displayName?: string;
}) {
  if (!input.groupId || !input.memberNpub) {
    console.log('[Push] skipped group member push registration; missing groupId/memberNpub');
    return false;
  }

  return postToPushWorker(
    PUSH_GROUP_MEMBER_URL,
    {
      groupId: input.groupId,
      groupName: input.groupName || 'Group',
      relayUrl: input.relayUrl || 'wss://relay.beginningend.com',
      memberNpub: input.memberNpub,
      role: input.role || 'member',
      status: input.status || 'active',
      displayName: input.displayName,
    },
    'group member push registration'
  );
}

export async function removeGroupMemberFromPush(input: {
  groupId: string;
  memberNpub: string;
}) {
  if (!input.groupId || !input.memberNpub) {
    console.log('[Push] skipped group member push removal; missing groupId/memberNpub');
    return false;
  }

  return postToPushWorker(
    PUSH_REMOVE_GROUP_MEMBER_URL,
    {
      groupId: input.groupId,
      memberNpub: input.memberNpub,
    },
    'group member push removal'
  );
}

export async function sendRemoteGroupNotification(input: {
  groupId: string;
  groupName: string;
  relayUrl: string;
  senderNpub: string;
  senderName?: string;
  body: string;
  eventId?: string;
  groupEventType?: BEGroupNotificationEventType;
  routeTarget?: 'group-thread' | 'group-detail';
  groupTab?: 'stickies' | 'calendar' | 'gallery' | 'members';
  highlightId?: string;
  calendarEventId?: string;
  pollId?: string;
  memberNpub?: string;
}) {
  if (!input.groupId || !input.senderNpub) {
    console.log('[Push] skipped remote group push; missing groupId/senderNpub');
    return false;
  }

  return postToPushWorker(
    PUSH_GROUP_MESSAGE_URL,
    {
      groupId: input.groupId,
      groupName: input.groupName || 'Group',
      relayUrl: input.relayUrl || 'wss://relay.beginningend.com',
      senderNpub: input.senderNpub,
      senderName: input.senderName,
      body: input.body || 'New group activity',
      eventId: input.eventId,
      groupEventType: input.groupEventType,
      routeTarget: input.routeTarget,
      groupTab: input.groupTab,
      highlightId: input.highlightId,
      calendarEventId: input.calendarEventId,
      pollId: input.pollId,
      memberNpub: input.memberNpub,
    },
    'remote group push'
  );
}

export async function notifyGroupEvent(input: {
  groupId: string;
  groupName: string;
  relayUrl: string;
  actorNpub: string;
  actorName?: string;
  eventType: BEGroupNotificationEventType;
  preview?: string;
  title?: string;
  eventId?: string;
  routeTarget?: 'group-thread' | 'group-detail';
  groupTab?: 'stickies' | 'calendar' | 'gallery' | 'members';
  highlightId?: string;
  calendarEventId?: string;
  pollId?: string;
  memberNpub?: string;
  memberName?: string;
  role?: string;
}) {
  const body = buildGroupEventBody({
    eventType: input.eventType,
    actorName: input.actorName,
    actorNpub: input.actorNpub,
    preview: input.preview,
    title: input.title,
    memberName: input.memberName,
    role: input.role,
  });

  return sendRemoteGroupNotification({
    groupId: input.groupId,
    groupName: input.groupName,
    relayUrl: input.relayUrl,
    senderNpub: input.actorNpub,
    senderName: input.actorName,
    body,
    eventId: input.eventId,
    groupEventType: input.eventType,
    routeTarget: input.routeTarget,
    groupTab: input.groupTab,
    highlightId: input.highlightId,
    calendarEventId: input.calendarEventId,
    pollId: input.pollId,
    memberNpub: input.memberNpub,
  });
}

export async function sendRemoteMarkNotification(input: {
  recipientNpub: string;
  authorNpub: string;
  authorName?: string;
  markId: string;
  title?: string;
  preview?: string;
  eventId?: string;
  familyId?: string;
}) {
  const recipientNpub = input.recipientNpub?.trim();
  const authorNpub = input.authorNpub?.trim();

  if (!recipientNpub || !authorNpub || !input.markId) {
    console.log('[Push] skipped remote mark push; missing recipient/author/markId');
    return false;
  }

  const body = buildMarkEventBody({
    authorName: input.authorName,
    authorNpub,
    title: input.title,
    preview: input.preview,
  });

  return postToPushWorker(
    PUSH_MARK_URL,
    {
      recipientNpub,
      authorNpub,
      authorName: input.authorName,
      markId: input.markId,
      title: input.title,
      body,
      preview: input.preview,
      eventId: input.eventId,
      familyId: input.familyId,
      type: 'mark',
      markEventType: 'mark_created',
      routeTarget: 'mark-detail',
    },
    'remote mark push'
  );
}

export async function notifyMarkEvent(input: {
  recipientNpubs: string[];
  authorNpub: string;
  authorName?: string;
  markId: string;
  title?: string;
  preview?: string;
  eventId?: string;
  familyId?: string;
}) {
  const uniqueRecipients = Array.from(
    new Set(
      input.recipientNpubs
        .map(npub => npub.trim())
        .filter(npub => !!npub && npub !== input.authorNpub)
    )
  );

  if (uniqueRecipients.length === 0) {
    console.log('[Push] skipped mark notification; no recipients');
    return [];
  }

  return Promise.all(
    uniqueRecipients.map(recipientNpub =>
      sendRemoteMarkNotification({
        recipientNpub,
        authorNpub: input.authorNpub,
        authorName: input.authorName,
        markId: input.markId,
        title: input.title,
        preview: input.preview,
        eventId: input.eventId,
        familyId: input.familyId,
      })
    )
  );
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
  groupEventType?: BEGroupNotificationEventType;
  routeTarget?: 'group-thread' | 'group-detail';
  groupTab?: 'stickies' | 'calendar' | 'gallery' | 'members';
  highlightId?: string;
  calendarEventId?: string;
  pollId?: string;
  memberNpub?: string;
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
          groupEventType: input.groupEventType,
          routeTarget: input.routeTarget,
          groupTab: input.groupTab,
          highlightId: input.highlightId,
          calendarEventId: input.calendarEventId,
          pollId: input.pollId,
          memberNpub: input.memberNpub,
        } satisfies BENotificationData,
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('[Push] local group notification failed:', error);
  }
}

async function getOrCreateThreadForNotification(input: {
  participantPubkey?: string;
  senderPubkey?: string;
  senderName?: string;
  threadId?: string;
}) {
  const threads = await getDMThreads();

  if (input.threadId) {
    const existingById = threads.find(thread => thread.id === input.threadId);

    if (existingById) {
      return existingById;
    }
  }

  const participantPubkey =
    input.participantPubkey ||
    input.senderPubkey;

  if (!participantPubkey) {
    return null;
  }

  const existingByPubkey = threads.find(thread =>
    thread.participantPubkey?.toLowerCase() === participantPubkey.toLowerCase()
  );

  if (existingByPubkey) {
    return existingByPubkey;
  }

  return await createThread({
    title: input.senderName?.trim() || shortKey(participantPubkey),
    participantPubkey,
  });
}

function shouldHandleNotificationResponse(response: Notifications.NotificationResponse) {
  const requestId = response.notification.request.identifier;

  if (!requestId) return true;

  if (handledNotificationResponseIds.has(requestId)) {
    console.log('[Push] skipped duplicate notification response:', requestId);
    return false;
  }

  handledNotificationResponseIds.add(requestId);

  if (handledNotificationResponseIds.size > 30) {
    const oldest = handledNotificationResponseIds.values().next().value;

    if (oldest) {
      handledNotificationResponseIds.delete(oldest);
    }
  }

  return true;
}

export function installNotificationResponseHandler(router: {
  push: (href: any) => void;
}) {
  async function routeFromData(rawData: any) {
    const data = rawData as BENotificationData;

if (data.type === 'dm') {
  const thread = await getOrCreateThreadForNotification({
    threadId: data.threadId,
    participantPubkey: data.participantPubkey,
    senderPubkey: data.senderPubkey,
    senderName: data.senderName,
  });

  if (!thread) {
    console.warn('[Push] DM notification missing usable thread target');
    return;
  }

  router.push({
    pathname: '/dm-thread',
    params: {
      id: thread.id,
      title: data.senderName || thread.title || 'Conversation',
    },
  } as any);

  return;
}

if (data.type === 'group') {
  const groupId = data.groupId || data.spaceId;

  if (!groupId) {
    console.warn('[Push] group notification missing groupId');
    return;
  }

  if (data.routeTarget === 'group-detail' || data.groupTab) {
    router.push({
      pathname: '/group-detail',
      params: {
        id: groupId,
        tab: data.groupTab,
        highlightId: data.highlightId,
        calendarEventId: data.calendarEventId,
        memberNpub: data.memberNpub,
      },
    } as any);

    return;
  }

  router.push({
    pathname: '/group-thread',
    params: {
      id: groupId,
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

      return;
    }
  }

  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    if (!shouldHandleNotificationResponse(response)) return;

    routeFromData(response.notification.request.content.data).catch(error => {
      console.warn('[Push] notification response route failed:', error);
    });
  });

  Notifications.getLastNotificationResponseAsync()
    .then(response => {
      if (!response) return;
      if (!shouldHandleNotificationResponse(response)) return;

      const data = response.notification.request.content.data;

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