import { useSyncExternalStore } from 'react';

// Which way the map is turned, kept outside React state so following it at 60 frames a second only redraws
// the few things drawn relative to it, not the whole map screen.
let bearing = 0;
const listeners = new Set<() => void>();

export function setMapBearing(next: number) {
  if (!Number.isFinite(next) || Math.abs(next - bearing) < 0.5) return;
  bearing = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useMapBearing() {
  return useSyncExternalStore(subscribe, () => bearing, () => 0);
}
