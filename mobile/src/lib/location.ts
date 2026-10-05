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

// Only the cone redraws on a turn, so a degree is a fine enough step.
const COMPASS_STEP = 1;
// Android's raw readings jitter more than the heading iOS fuses, so it eases toward them more calmly.
const COMPASS_EASE_MS = Platform.OS === 'android' ? 220 : 120;
const COMPASS_TICK_MS = 33;
// iOS ends the heading stream for good on a heading failure, such as strong interference in a car, so it is restarted.
const COMPASS_RETRY_MS = 2000;
// A stream that has said nothing this long is restarted in case it died without saying so.
const COMPASS_SILENT_MS = 15_000;
let compass: number | undefined;
let compassAt = 0;
let pointing: { x: number; y: number } | null = null;
let aim: { x: number; y: number } | null = null;
let easing: ReturnType<typeof setInterval> | undefined;
const compassListeners = new Set<() => void>();

const turnBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const degreesOf = (v: { x: number; y: number }) => ((Math.atan2(v.y, v.x) * 180) / Math.PI + 360) % 360;

function notifyCompass() {
  for (const listener of compassListeners) listener();
}

function publishCompass(settled: boolean) {
  if (!pointing) return;
  const degrees = degreesOf(pointing);
  if (compass !== undefined && turnBetween(degrees, compass) < (settled ? 0.25 : COMPASS_STEP)) return;
  compass = degrees;
  notifyCompass();
}

// Expo only reports a turn of a degree or two, so a phone that stops turning sends nothing more: the easing finishes on a timer.
function easeCompass() {
  if (!pointing || !aim) return;
  const share = 1 - Math.exp(-COMPASS_TICK_MS / COMPASS_EASE_MS);
  pointing = { x: pointing.x + (aim.x - pointing.x) * share, y: pointing.y + (aim.y - pointing.y) * share };
  const settled = turnBetween(degreesOf(pointing), degreesOf(aim)) < 0.25;
  if (settled) {
    pointing = aim;
    clearInterval(easing);
    easing = undefined;
  }
  publishCompass(settled);
}

function setCompass(reading: number) {
  const radians = (reading * Math.PI) / 180;
  aim = { x: Math.cos(radians), y: Math.sin(radians) };
  compassAt = Date.now();
  if (!pointing) {
    pointing = aim;
    publishCompass(true);
    return;
  }
  easing ??= setInterval(easeCompass, COMPASS_TICK_MS);
}

// A compass that stopped is no compass: the cone goes back to the direction of travel until it returns.
function dropCompass() {
  clearInterval(easing);
  easing = undefined;
  pointing = null;
  aim = null;
  if (compass === undefined) return;
  compass = undefined;
  notifyCompass();
}

let headingWanted = false;
let headingWatch: { remove: () => void } | null = null;
let headingRun = 0;
let headingRetry: ReturnType<typeof setTimeout> | undefined;
let headingWatchdog: ReturnType<typeof setInterval> | undefined;

function stopHeading() {
  headingRun++;
  headingWatch?.remove();
  headingWatch = null;
  clearTimeout(headingRetry);
  headingRetry = undefined;
}

function retryHeading() {
  stopHeading();
  if (headingWanted) headingRetry = setTimeout(() => void startHeading(), COMPASS_RETRY_MS);
}

async function startHeading() {
  if (!headingWanted || headingWatch) return;
  const run = ++headingRun;
  const watching = await Location.watchHeadingAsync(
    (reading) => {
      if (run !== headingRun) return;
      const degrees = reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
      // Expo: 3 is high accuracy, and a negative number means the reading is not usable yet.
      if (Number.isFinite(degrees) && reading.accuracy >= 0) setCompass(degrees);
    },
    () => {
      if (run !== headingRun) return;
      dropCompass();
      retryHeading();
    },
  ).catch(() => null);
  if (run !== headingRun || !headingWanted) {
    watching?.remove();
    return;
  }
  if (!watching) {
    retryHeading();
    return;
  }
  headingWatch = watching;
  compassAt = Date.now();
}

function wantHeading(wanted: boolean) {
  headingWanted = wanted;
  if (!wanted) {
    stopHeading();
    clearInterval(headingWatchdog);
    headingWatchdog = undefined;
    return;
  }
  void startHeading();
  headingWatchdog ??= setInterval(() => {
    if (headingWatch && Date.now() - compassAt > COMPASS_SILENT_MS) {
      stopHeading();
      void startHeading();
    }
  }, COMPASS_SILENT_MS);
}

export function subscribeCompass(listener: () => void) {
  compassListeners.add(listener);
  return () => void compassListeners.delete(listener);
}

/** Which way the phone points, in degrees from north, or undefined while there is no working compass. */
export function useCompass() {
  return useSyncExternalStore(subscribeCompass, () => compass, () => compass);
}

// One shared GPS watch for every screen, running only while something uses it.
const users = new Map<symbol, boolean>();
let watch: { navigation: boolean; position: { remove: () => void } } | null = null;
let starting = false;

// Directions use a background task that only starts from a tap, so guidance goes on with the screen locked.
const NAVIGATION_TASK = 'csimap-navigation-location';

type TaskData = { locations?: Location.LocationObject[] };

TaskManager.defineTask<TaskData>(NAVIGATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return;
  for (const location of data.locations) publish(location);
});

// Google's accuracy prompt shows once per launch; after a no, GPS alone is used instead of asking again.
let mayAskForAccuracy = true;

function takeAccuracyPrompt() {
  const ask = mayAskForAccuracy;
  mayAskForAccuracy = false;
  return ask;
}

async function startNavigationUpdates(mayShowUserSettingsDialog: boolean) {
  await Location.startLocationUpdatesAsync(NAVIGATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    mayShowUserSettingsDialog,
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

// Resolves with the watch, or rejects after the time limit.
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
    watch = null;
    wantHeading(false);
    return;
  }
  if (watch && watch.navigation === navigation) return;

  starting = true;
  let failed = false;
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
    // The new watch starts before the old one stops, so switching never leaves a gap.
    const previous = watch;
    const startWatch = (mayShowUserSettingsDialog: boolean) =>
      navigation
        ? // Some Android power settings refuse the background service, so directions then follow with the app open.
          withTimeout(startNavigationUpdates(mayShowUserSettingsDialog), NAVIGATION_START_MS).catch(() =>
            Location.watchPositionAsync(
              { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000, mayShowUserSettingsDialog },
              publish,
            ),
          )
        : Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 1000, mayShowUserSettingsDialog },
            publish,
          );
    const position = await startWatch(takeAccuracyPrompt()).catch(() => startWatch(false));
    previous?.position.remove();
    wantHeading(true);
    watch = { navigation, position };
    if (snapshot.status !== 'active') set({ status: snapshot.fix ? 'active' : 'asking' });
  } catch {
    failed = true;
    set({ status: 'error' });
  } finally {
    starting = false;
    // Catches a start or stop during setup; after a failure it waits for the next request, so it cannot loop.
    const stillWanted = users.size > 0;
    const stillNavigation = [...users.values()].some(Boolean);
    if (!failed && (stillWanted !== !!watch || (watch && watch.navigation !== stillNavigation))) void reconcile();
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
