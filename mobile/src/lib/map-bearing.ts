import { useSyncExternalStore } from 'react';

// Kept outside React state so following it every frame only redraws what is drawn relative to it.
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
