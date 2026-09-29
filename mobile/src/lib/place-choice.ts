import { useSyncExternalStore } from 'react';

import { getPlace } from '@/data/campus';

// The place picked on a form's "Where" page, handed back to the form underneath it in the stack.
let chosen: string | undefined;
const listeners = new Set<() => void>();

export function choosePlace(id: string | undefined) {
  const next = id && getPlace(id) ? id : undefined;
  if (next === chosen) return;
  chosen = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useChosenPlace() {
  return useSyncExternalStore(subscribe, () => chosen, () => undefined);
}
