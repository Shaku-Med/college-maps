import { useSyncExternalStore } from 'react';

import { getPlace, type Place } from '@/data/campus';

// The place the map should show, set by search results and the place sheet.
let focused: Place | null = null;
const listeners = new Set<() => void>();

export function focusPlace(id: string | null) {
  const next = id ? (getPlace(id) ?? null) : null;
  if (next === focused) return;
  focused = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useFocusedPlace() {
  return useSyncExternalStore(subscribe, () => focused, () => null);
}
