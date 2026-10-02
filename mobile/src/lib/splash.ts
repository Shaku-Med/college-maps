import * as SplashScreen from 'expo-splash-screen';
import { useSyncExternalStore } from 'react';

// The splash stays up until the account is known and the map has drawn, so the app opens on a finished screen
// instead of a blank one. A slow network never holds it longer than the cap.
const MAX_WAIT_MS = 5000;

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// The launch overlay draws the same logo in the same spot underneath, so the system splash can go at once and the
// logo animates on from where it was.
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
