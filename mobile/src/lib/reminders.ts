import * as Notifications from 'expo-notifications';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { getPlace } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import { useClasses } from '@/lib/classes';
import {
  MINUTES_IN_WEEK,
  classReminders,
  isReminderLead,
  minuteOfWeek,
  type ReminderLead,
} from '@/lib/class-reminders';
import { distanceMeters } from '@/lib/geo';
import { usePhonePrefs } from '@/lib/notifications';
import { findRoute } from '@/lib/routing';

// Scheduled on the phone itself, so the class list never leaves it.
const KEY = 'csimap.classReminders';
const ID_PREFIX = 'class-';
const CHANNEL = 'classes';
// iOS keeps 64 waiting notifications per app; this leaves room for the rest.
const MAX_SCHEDULED = 60;

export type ReminderPrefs = { on: boolean; lead: ReminderLead };
const DEFAULTS: ReminderPrefs = { on: false, lead: 15 };
const listeners = new Set<() => void>();

function load(): ReminderPrefs {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Record<keyof ReminderPrefs, unknown>>;
    return {
      on: typeof saved.on === 'boolean' ? saved.on : DEFAULTS.on,
      lead: isReminderLead(saved.lead) ? saved.lead : DEFAULTS.lead,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = load();

function save(next: ReminderPrefs) {
  prefs = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Kept for this visit only.
  }
  for (const listener of listeners) listener();
}

export function useReminderPrefs() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => prefs,
    () => prefs,
  );
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Class reminders',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Asks for permission the first time, from the switch the student flips. */
export async function turnOnClassReminders(): Promise<'on' | 'denied'> {
  await ensureChannel().catch(() => undefined);
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return 'denied';
  save({ ...prefs, on: true });
  return 'on';
}

export const turnOffClassReminders = () => save({ ...prefs, on: false });
export const setReminderLead = (lead: ReminderLead) => save({ ...prefs, lead });

function walkMeters(fromId: string, toId: string) {
  const from = getPlace(fromId);
  const to = getPlace(toId);
  if (!from || !to) return null;
  return findRoute(walkGraph(), from.coordinate, to.coordinate, { avoidStairs: false })?.distance ?? distanceMeters(from.coordinate, to.coordinate) * 1.3;
}

// Weekdays here count from 1 for Sunday.
const weekdayOf = (minute: number) => ((Math.floor(minute / (24 * 60)) + 1) % 7) + 1;

async function apply(classes: Parameters<typeof classReminders>[0], sound: boolean) {
  const waiting = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    waiting
      .filter((request) => request.identifier.startsWith(ID_PREFIX))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
  if (!prefs.on) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await ensureChannel();

  const now = minuteOfWeek(new Date());
  const soonest = classReminders(classes, prefs.lead, walkMeters)
    .sort((a, b) => ((a.minuteOfWeek - now + MINUTES_IN_WEEK) % MINUTES_IN_WEEK) - ((b.minuteOfWeek - now + MINUTES_IN_WEEK) % MINUTES_IN_WEEK))
    .slice(0, MAX_SCHEDULED);
  for (const reminder of soonest) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${ID_PREFIX}${reminder.id}`,
      content: {
        title: reminder.title,
        body: reminder.body,
        sound,
        data: { kind: 'class', placeId: reminder.placeId, room: reminder.room },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: weekdayOf(reminder.minuteOfWeek),
        hour: Math.floor((reminder.minuteOfWeek % (24 * 60)) / 60),
        minute: reminder.minuteOfWeek % 60,
        channelId: CHANNEL,
      },
    });
  }
}

// One at a time, so a quick run of edits cannot leave two sets scheduled.
let queue: Promise<void> = Promise.resolve();

/** Keeps the scheduled reminders matching the classes and the choices on this phone. Mounted once, at the root. */
export function useClassReminders() {
  const classes = useClasses();
  const { on, lead } = useReminderPrefs();
  const { sound } = usePhonePrefs();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    queue = queue.then(() => apply(classes, sound)).catch(() => undefined);
  }, [classes, on, lead, sound]);
}
