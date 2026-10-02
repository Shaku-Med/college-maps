import { useSyncExternalStore } from 'react';

import { loadSchedule, saveSchedule, type ClassEntry } from '@/lib/schedule';

// Classes stay on this phone only, like the web app keeps them in the browser.
let classes: ClassEntry[] | null = null;
const listeners = new Set<() => void>();

function current() {
  classes ??= loadSchedule();
  return classes;
}

export function setClasses(next: ClassEntry[]) {
  classes = next;
  const saved = saveSchedule(next);
  for (const listener of listeners) listener();
  return saved;
}

export const getClasses = current;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useClasses() {
  return useSyncExternalStore(subscribe, current, current);
}
