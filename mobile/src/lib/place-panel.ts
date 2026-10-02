import { useSyncExternalStore } from 'react';

import { getPlace, type Place } from '@/data/campus';
import { isValidRoom } from '@/lib/search';

export type PanelPlace = { place: Place; room?: string };

let shown: PanelPlace | null = null;
const listeners = new Set<() => void>();

function set(next: PanelPlace | null) {
  shown = next;
  for (const listener of listeners) listener();
}

/** Shows a place in the map's left column, where tablets show it instead of a sheet. */
export function openPlacePanel(id: string, room?: string) {
  const place = getPlace(id);
  if (place) set({ place, room: isValidRoom(room) ? room : undefined });
}

export const closePlacePanel = () => set(null);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function usePlacePanel() {
  return useSyncExternalStore(subscribe, () => shown, () => null);
}
