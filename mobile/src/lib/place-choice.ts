import { useSyncExternalStore } from 'react';

import { CAMPUS, contains, getPlace, type Coordinate } from '@/data/campus';

// The place or dropped pin picked on a form's "Where" page, handed back to the form underneath it in the stack.
let chosen: string | undefined;
let pin: Coordinate | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function choosePlace(id: string | undefined) {
  const next = id && getPlace(id) ? id : undefined;
  if (next === chosen && !pin) return;
  chosen = next;
  pin = undefined;
  notify();
}

/** A pin anywhere a meetup is allowed, which is inside the campus walking area. */
export function choosePin(at: Coordinate) {
  if (!contains(CAMPUS.map.walkingArea, at)) return false;
  pin = at;
  chosen = undefined;
  notify();
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useChosenPlace() {
  return useSyncExternalStore(subscribe, () => chosen, () => undefined);
}

export function useChosenPin() {
  return useSyncExternalStore(subscribe, () => pin, () => undefined);
}
