import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import type { Coordinate } from '@/data/campus';

export type Fix = {
  position: Coordinate;
  accuracy: number;
  /** The direction of travel the phone reports while moving, in degrees from north. */
  heading?: number;
  /** Metres per second, when the phone knows it. */
  speed?: number;
  at: number;
};

export type LocationStatus = 'idle' | 'asking' | 'denied' | 'active' | 'error';

type Snapshot = { status: LocationStatus; fix: Fix | null };

let snapshot: Snapshot = { status: 'idle', fix: null };
const listeners = new Set<() => void>();
const fixListeners = new Set<(fix: Fix) => void>();

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

// The compass is kept apart from the location: Android reports it many times a second, and if every reading
// re-rendered the map screen the JS thread would have no time left to answer taps.
const COMPASS_STEP = 3;
// iOS hands over a fused, steady heading. Android's comes straight from the magnetometer and shakes, so it is
// averaged as a direction (sine and cosine, so 359 and 1 average to 0, not 180).
const COMPASS_SMOOTHING = Platform.OS === 'android' ? 0.15 : 1;
let compass: number | undefined;
let pointing: { x: number; y: number } | null = null;
const compassListeners = new Set<() => void>();

function setCompass(reading: number) {
  const radians = (reading * Math.PI) / 180;
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  pointing = pointing
    ? { x: pointing.x + (x - pointing.x) * COMPASS_SMOOTHING, y: pointing.y + (y - pointing.y) * COMPASS_SMOOTHING }
    : { x, y };
  const degrees = ((Math.atan2(pointing.y, pointing.x) * 180) / Math.PI + 360) % 360;
  if (compass !== undefined && Math.abs(((degrees - compass + 540) % 360) - 180) < COMPASS_STEP) return;
  compass = degrees;
  for (const listener of compassListeners) listener();
}

function subscribeCompass(listener: () => void) {
  compassListeners.add(listener);
  return () => void compassListeners.delete(listener);
}

/** Which way the phone points, in degrees from north, redrawn only when it turns a few degrees. */
export function useCompass() {
  return useSyncExternalStore(subscribeCompass, () => compass, () => compass);
}

// Everything that needs the location asks for it here, so the phone runs one GPS watch, not one per screen,
// and only while something is using it. Navigation asks for the most accurate mode.
const users = new Map<symbol, boolean>();
let watch: { navigation: boolean; position: { remove: () => void }; heading?: Location.LocationSubscription } | null = null;
let starting = false;

// During directions the location comes from a background task, so guidance carries on with the app in the
// background or the phone locked. iOS shows its blue location pill, and Android an ongoing notification, for
// as long as it runs. It uses the while in use permission: it only ever starts from a tap in the app.
const NAVIGATION_TASK = 'csimap-navigation-location';

type TaskData = { locations?: Location.LocationObject[] };

TaskManager.defineTask<TaskData>(NAVIGATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return;
  for (const location of data.locations) publish(location);
});

async function startNavigationUpdates() {
  await Location.startLocationUpdatesAsync(NAVIGATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.OtherNavigation,
    distanceInterval: 1,
    timeInterval: 1000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Directions are on',
      notificationBody: 'CSI Map is guiding you. Open the app to see the route.',
      notificationColor: '#1268D2',
      killServiceOnDestroy: true,
    },
  });
  return {
    remove: () => {
      void Location.hasStartedLocationUpdatesAsync(NAVIGATION_TASK)
        .then((started) => (started ? Location.stopLocationUpdatesAsync(NAVIGATION_TASK) : undefined))
        .catch(() => undefined);
    },
  };
}

const validNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

function publish(location: Location.LocationObject) {
  const { latitude, longitude, accuracy, heading, speed } = location.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const fix: Fix = {
    position: { latitude, longitude },
    accuracy: validNumber(accuracy) ?? 50,
    heading: validNumber(heading),
    speed: validNumber(speed),
    at: location.timestamp || Date.now(),
  };
  set({ fix, status: 'active' });
  for (const listener of fixListeners) listener(fix);
}

// How long the background service gets to start before directions use the plain foreground watch instead.
const NAVIGATION_START_MS = 8_000;

// Resolves with the watch, or rejects after the time limit. A service that starts after the limit is stopped
// again, so it never keeps running with nothing listening.
function withTimeout(start: Promise<{ remove: () => void }>, ms: number) {
  return new Promise<{ remove: () => void }>((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      reject(new Error('location service took too long'));
    }, ms);
    start.then(
      (sub) => {
        clearTimeout(timer);
        if (late) sub.remove();
        else resolve(sub);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function reconcile() {
  if (starting) return;
  const wanted = users.size > 0;
  const navigation = [...users.values()].some(Boolean);
  if (!wanted) {
    watch?.position.remove();
    watch?.heading?.remove();
    watch = null;
    return;
  }
  if (watch && watch.navigation === navigation) return;

  starting = true;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    let granted = permission.granted;
    if (!granted && permission.canAskAgain) {
      set({ status: 'asking' });
      granted = (await Location.requestForegroundPermissionsAsync()).granted;
    }
    if (!granted) {
      set({ status: 'denied' });
      return;
    }
    // The new watch starts before the old one stops, so switching into directions never leaves a gap with no
    // location at all.
    const previous = watch;
    const position = navigation
      ? // Android can refuse, or be slow, to start the background service on some phones and power settings.
        // Directions then follow along with the app open instead of sitting still with no location.
        await withTimeout(startNavigationUpdates(), NAVIGATION_START_MS).catch(() =>
          Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 },
            publish,
          ),
        )
      : await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 1000 }, publish);
    previous?.position.remove();
    const heading =
      previous?.heading ??
      (await Location.watchHeadingAsync((reading) => {
        const degrees = reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
        // Expo: 0 is high accuracy, negative means the reading is not usable yet.
        if (Number.isFinite(degrees) && reading.accuracy >= 0) setCompass(degrees);
      }).catch(() => undefined));
    watch = { navigation, position, heading };
    if (snapshot.status !== 'active') set({ status: snapshot.fix ? 'active' : 'asking' });
  } catch {
    set({ status: 'error' });
  } finally {
    starting = false;
    // Someone may have started or stopped while this was setting up.
    const stillWanted = users.size > 0;
    const stillNavigation = [...users.values()].some(Boolean);
    if (stillWanted !== !!watch || (watch && watch.navigation !== stillNavigation)) void reconcile();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The latest location. Pass `watching` to keep the GPS running while the caller is on screen. */
export function useLocation({ watching = false, navigation = false }: { watching?: boolean; navigation?: boolean } = {}) {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  useEffect(() => {
    if (!watching) return;
    const key = Symbol('location user');
    users.set(key, navigation);
    void reconcile();
    return () => {
      users.delete(key);
      void reconcile();
    };
  }, [watching, navigation]);
  return current;
}

/** Calls back on every new fix, for navigation, which needs each one rather than the latest. */
export function onFix(listener: (fix: Fix) => void) {
  fixListeners.add(listener);
  return () => void fixListeners.delete(listener);
}

export const currentFix = () => snapshot.fix;
export const currentCompass = () => compass;
