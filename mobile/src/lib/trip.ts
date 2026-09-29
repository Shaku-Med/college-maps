import { useSyncExternalStore } from 'react';

import { getPlace, type Place } from '@/data/campus';
import type { TravelMode } from '@/lib/routing';
import { isValidRoom } from '@/lib/search';

export const MY_LOCATION = 'me';

export type TripPhase = 'idle' | 'preview' | 'navigate';

export type Trip = {
  phase: TripPhase;
  destination: Place | null;
  room?: string;
  /** Where the route starts: the phone's location, or a building picked instead. */
  origin: string;
  avoidStairs: boolean;
  /** How someone gets to campus from off campus. On campus it is always a walk on the campus paths. */
  travelMode: TravelMode;
};

let trip: Trip = { phase: 'idle', destination: null, origin: MY_LOCATION, avoidStairs: false, travelMode: 'drive' };
const listeners = new Set<() => void>();

function set(next: Partial<Trip>) {
  trip = { ...trip, ...next };
  for (const listener of listeners) listener();
}

/** Opens directions to a place, starting from wherever the phone is. */
export function planTrip(placeId: string, room?: string, origin: string = MY_LOCATION) {
  const destination = getPlace(placeId);
  if (!destination) return;
  const from = origin !== MY_LOCATION && getPlace(origin) && origin !== placeId ? origin : MY_LOCATION;
  set({ phase: 'preview', destination, room: isValidRoom(room) ? room : undefined, origin: from });
}

export function setTripOrigin(origin: string) {
  set({ origin: origin === MY_LOCATION || (getPlace(origin) && origin !== trip.destination?.id) ? origin : MY_LOCATION });
}

export const setAvoidStairs = (avoidStairs: boolean) => set({ avoidStairs });
export const setTravelMode = (travelMode: TravelMode) => set({ travelMode });
export const startNavigating = () => trip.destination && set({ phase: 'navigate' });
export const stopNavigating = () => set({ phase: trip.destination ? 'preview' : 'idle' });
export const closeTrip = () => set({ phase: 'idle', destination: null, room: undefined, origin: MY_LOCATION });

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useTrip() {
  return useSyncExternalStore(subscribe, () => trip, () => trip);
}
