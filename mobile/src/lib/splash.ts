import * as SplashScreen from 'expo-splash-screen';
import { useSyncExternalStore } from 'react';

// Holds the splash until the account is known and the map has drawn, never longer than the cap.
const MAX_WAIT_MS = 5000;

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// The launch overlay draws the same logo underneath, so the system splash can go at once.
SplashScreen.setOptions({ duration: 0, fade: false });

const waiting = new Set<'account' | 'map'>(['account', 'map']);
const listeners = new Set<() => void>();
let hidden = false;

function hide() {
  if (hidden) return;
  hidden = true;
  void SplashScreen.hideAsync().catch(() => undefined);
  for (const listener of listeners) listener();
}

setTimeout(hide, MAX_WAIT_MS);

export function markReady(part: 'account' | 'map') {
  waiting.delete(part);
  if (waiting.size === 0) hide();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** True once the system splash is gone, which is the launch overlay's cue to animate. */
export function useSplashHidden() {
  return useSyncExternalStore(subscribe, () => hidden, () => hidden);
}
