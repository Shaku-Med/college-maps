import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { apiCall } from '@/lib/api';

// Push through Expo, matching the web's browser notifications; the server only ever holds the token.
const PREFERENCE_KEY = 'csimap.notifications';
const TOKEN_PATTERN = /^ExponentPushToken\[[A-Za-z0-9_-]{8,128}\]$/;

let registered: string | null = null;

// Choices that belong to this phone rather than the account: the icon badge, banners while the app is open, and sound.
export type PhonePrefs = { badge: boolean; banners: boolean; sound: boolean };
const PHONE_KEY = 'csimap.notifications.phone';
const PHONE_DEFAULTS: PhonePrefs = { badge: true, banners: true, sound: true };
const phoneListeners = new Set<() => void>();

function loadPhonePrefs(): PhonePrefs {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(PHONE_KEY) ?? '{}') as Partial<Record<keyof PhonePrefs, unknown>>;
    return {
      badge: typeof saved.badge === 'boolean' ? saved.badge : true,
      banners: typeof saved.banners === 'boolean' ? saved.banners : true,
      sound: typeof saved.sound === 'boolean' ? saved.sound : true,
    };
  } catch {
    return PHONE_DEFAULTS;
  }
}

let phonePrefs = loadPhonePrefs();

export const getPhonePrefs = () => phonePrefs;

export function setPhonePref(key: keyof PhonePrefs, value: boolean) {
  phonePrefs = { ...phonePrefs, [key]: value };
  try {
    globalThis.localStorage?.setItem(PHONE_KEY, JSON.stringify(phonePrefs));
  } catch {
    // Kept for this visit only.
  }
  if (key === 'badge') {
    if (!value) void Notifications.setBadgeCountAsync(0).catch(() => undefined);
    // The server puts the count on notifications that arrive while the app is closed, so it has to know too.
    if (registered) void apiCall<void>('/v1/push/app-tokens', 'POST', { token: registered, badge: value });
  }
  for (const listener of phoneListeners) listener();
}

export function usePhonePrefs() {
  return useSyncExternalStore(
    (listener) => {
      phoneListeners.add(listener);
      return () => void phoneListeners.delete(listener);
    },
    () => phonePrefs,
    () => phonePrefs,
  );
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: phonePrefs.banners,
    shouldShowList: true,
    shouldPlaySound: phonePrefs.sound,
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

// Android 13 and later only show the permission prompt once the app has a channel to post to.
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
    const res = await apiCall<void>('/v1/push/app-tokens', 'POST', { token, badge: phonePrefs.badge });
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

/** Registers the phone again after signing in or launching, when notifications were on. */
export async function syncNotifications() {
  if (!readPreference()) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  try {
    const token = await phoneToken();
    if (token && token !== registered) {
      const res = await apiCall<void>('/v1/push/app-tokens', 'POST', { token, badge: phonePrefs.badge });
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
