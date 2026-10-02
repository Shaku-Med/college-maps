import { useSyncExternalStore } from 'react';

import { getPlace } from '@/data/campus';

// Places opened or walked to lately, newest first, kept on this phone only.
const KEY = 'csimap.recent-places';
const MAX = 4;
const listeners = new Set<() => void>();

function load(): string[] {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && !!getPlace(id)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

let recent = load();

export function rememberPlace(id: string) {
  if (!getPlace(id) || recent[0] === id) return;
  recent = [id, ...recent.filter((other) => other !== id)].slice(0, MAX);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(recent));
  } catch {
    // Kept for this visit only.
  }
  for (const listener of listeners) listener();
}

export function useRecentPlaces() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => recent,
    () => recent,
  );
}
