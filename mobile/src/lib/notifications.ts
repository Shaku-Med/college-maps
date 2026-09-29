import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { apiCall } from '@/lib/api';

// Friend requests and meetup invites reach the phone through Expo's push service, the same notifications the
// web app sends to browsers. The choice is kept on this phone; the server only ever holds the token.
const PREFERENCE_KEY = 'csimap.notifications';
const TOKEN_PATTERN = /^ExponentPushToken\[[A-Za-z0-9_-]{8,128}\]$/;

let registered: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function readPreference() {
  try {
    return globalThis.localStorage?.getItem(PREFERENCE_KEY) === 'on';
  } catch {
    return false;
  }
}

function savePreference(on: boolean) {
  try {
    globalThis.localStorage?.setItem(PREFERENCE_KEY, on ? 'on' : 'off');
  } catch {
    // Kept for this visit only.
  }
}

async function phoneToken() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return TOKEN_PATTERN.test(data) ? data : null;
}

// Android 13 and later only show the permission prompt once the app has a channel to post to. Expo's push
// service sends to the channel named default when a message names none.
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Friends and meetups',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export type EnableResult = 'on' | 'denied' | 'unavailable' | 'failed';

/** Asks for permission and registers this phone. Call it from the switch the student flips. */
export async function enableNotifications(): Promise<EnableResult> {
  await ensureChannel().catch(() => undefined);
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return 'denied';
  let token: string | null;
  try {
    token = await phoneToken();
  } catch {
    // On Android this means the build has no Firebase set up, so the phone cannot get a push token at all.
    return 'unavailable';
  }
  if (!token) return 'unavailable';
  try {
    const res = await apiCall<void>('/v1/push/app-tokens', 'POST', { token });
    if (!res.ok) return 'failed';
    registered = token;
    savePreference(true);
    return 'on';
  } catch {
    return 'failed';
  }
}

/** Stops notifications on this phone. Also runs before signing out, so they never reach a phone after that. */
export async function disableNotifications() {
  savePreference(false);
  void Notifications.setBadgeCountAsync(0).catch(() => undefined);
  const token = registered ?? (await phoneToken().catch(() => null));
  registered = null;
  if (token) await apiCall<void>('/v1/push/app-tokens', 'DELETE', { token });
}

/**
 * Registers the phone again after signing in or launching, when notifications were on. Apple can change a
 * phone's token, so the server keeps the current one.
 */
export async function syncNotifications() {
  if (!readPreference()) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  try {
    const token = await phoneToken();
    if (token && token !== registered) {
      const res = await apiCall<void>('/v1/push/app-tokens', 'POST', { token });
      if (res.ok) registered = token;
    }
  } catch {
    // Tried again next launch.
  }
}

export function useNotificationsEnabled() {
  const [enabled, setEnabled] = useState(readPreference);
  return [enabled, setEnabled] as const;
}

/** Opens Friends when a friend request or meetup invite notification is tapped, including from a cold start. */
export function useNotificationTaps() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!last || Platform.OS === 'web') return;
    router.navigate('/friends');
  }, [last]);
}
