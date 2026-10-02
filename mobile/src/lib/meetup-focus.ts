import { useSyncExternalStore } from 'react';

// The meetup whose people are shown live on the map.
let shown: string | null = null;
const listeners = new Set<() => void>();

export function showMeetupOnMap(id: string | null) {
  if (id === shown) return;
  shown = id;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useShownMeetup() {
  return useSyncExternalStore(subscribe, () => shown, () => null);
}
