import { useSyncExternalStore } from 'react';

import { getPlace, type Place } from '@/data/campus';
import type { TravelMode } from '@/lib/routing';
import { rememberPlace } from '@/lib/recent-places';
import { isValidRoom } from '@/lib/search';
import { MY_LOCATION, withStop } from '@/lib/stops';

export { MY_LOCATION };

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
  /** Places to visit on the way, in order, before the destination. */
  stops: string[];
  /** While guiding: every place the walk visits, in order, fixed when it started. The last is the destination. */
  legs: string[];
  /** While guiding: which of `legs` is being walked to now. */
  leg: number;
};

let trip: Trip = {
  phase: 'idle',
  destination: null,
  origin: MY_LOCATION,
  avoidStairs: false,
  travelMode: 'drive',
  stops: [],
  legs: [],
  leg: 0,
};
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
  rememberPlace(destination.id);
  set({ phase: 'preview', destination, room: isValidRoom(room) ? room : undefined, origin: from, stops: [], legs: [], leg: 0 });
}

export function setTripOrigin(origin: string) {
  set({ origin: origin === MY_LOCATION || (getPlace(origin) && origin !== trip.destination?.id) ? origin : MY_LOCATION });
}

export const addStop = (id: string) => set({ stops: withStop(trip.stops, id, trip.destination?.id) });
export const removeStop = (id: string) => set({ stops: trip.stops.filter((stop) => stop !== id) });

export const setAvoidStairs = (avoidStairs: boolean) => set({ avoidStairs });
export const setTravelMode = (travelMode: TravelMode) => set({ travelMode });
/** Starts guiding through `legs`, the places in the order they are visited. */
export const startNavigating = (legs: string[]) => trip.destination && set({ phase: 'navigate', legs, leg: 0 });
/** On to the next place after arriving at a stop. */
export const nextLeg = () => trip.leg < trip.legs.length - 1 && set({ leg: trip.leg + 1 });
export const stopNavigating = () => set({ phase: trip.destination ? 'preview' : 'idle', legs: [], leg: 0 });
export const closeTrip = () =>
  set({ phase: 'idle', destination: null, room: undefined, origin: MY_LOCATION, stops: [], legs: [], leg: 0 });

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useTrip() {
  return useSyncExternalStore(subscribe, () => trip, () => trip);
}
