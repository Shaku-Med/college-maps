import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useSyncExternalStore } from 'react';

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

type Snapshot = { status: LocationStatus; fix: Fix | null; compass: number | undefined };

let snapshot: Snapshot = { status: 'idle', fix: null, compass: undefined };
const listeners = new Set<() => void>();
const fixListeners = new Set<(fix: Fix) => void>();

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
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
    watch?.position.remove();
    watch?.heading?.remove();
    const position = navigation
      ? // Android can refuse to start the background service on some phones and power settings. Directions then
        // still follow along with the app open, rather than sitting still with no location at all.
        await startNavigationUpdates().catch(() =>
          Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 },
            publish,
          ),
        )
      : await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 1000 }, publish);
    const heading = await Location.watchHeadingAsync((reading) => {
      const degrees = reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
      if (Number.isFinite(degrees) && reading.accuracy !== 0) set({ compass: degrees });
    }).catch(() => undefined);
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

/** The latest location and compass. Pass `watching` to keep the GPS running while the caller is on screen. */
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
export const currentCompass = () => snapshot.compass;
