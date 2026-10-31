import { useSyncExternalStore } from 'react';

import { getPlace, type Coordinate, type Place } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import { fetchTripRoute } from '@/lib/directions';
import type { TravelMode } from '@/lib/routing';
import { rememberPlace } from '@/lib/recent-places';
import { isValidRoom } from '@/lib/search';
import { legSeconds, MY_LOCATION, placeStop, withoutStop, type StopQuestion } from '@/lib/stops';

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
  /** Places saved for after the destination, in order. */
  after: string[];
  /** Where the newest stop went, until the traveller answers. */
  stopQuestion: StopQuestion | null;
  /** A stop being fitted in while the router says how long heading there first would take. */
  stopPending: string | null;
  /** While guiding: every place the walk visits, in order, fixed when it started. The last is the destination. */
  legs: string[];
  /** While guiding: which of `legs` is being walked to now. */
  leg: number;
  /** When to be there, picked by hand for one destination; otherwise a class there sets it. */
  arrivePick: { placeId: string; id: string; at: number | null } | null;
};

let trip: Trip = {
  phase: 'idle',
  destination: null,
  origin: MY_LOCATION,
  avoidStairs: false,
  travelMode: 'drive',
  stops: [],
  after: [],
  stopQuestion: null,
  stopPending: null,
  legs: [],
  leg: 0,
  arrivePick: null,
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
  set({
    phase: 'preview',
    destination,
    room: isValidRoom(room) ? room : undefined,
    origin: from,
    stops: [],
    after: [],
    stopQuestion: null,
    stopPending: null,
    legs: [],
    leg: 0,
  });
  stopToken += 1;
}

export function setTripOrigin(origin: string) {
  set({ origin: origin === MY_LOCATION || (getPlace(origin) && origin !== trip.destination?.id) ? origin : MY_LOCATION });
}

type StopsContext = {
  /** Where the walk to the stops starts. */
  from: Coordinate | null;
  /** Set when the trip starts on the streets, where heading for a stop first can change where a drive parks. */
  streets: { here: Coordinate; travel: TravelMode; toFirst: number } | null;
};

// Kept current by the route preview, so a new stop lands in the right place.
let stopsContext: StopsContext = { from: null, streets: null };
export const setStopsContext = (next: StopsContext) => {
  stopsContext = next;
};
// A newer add, removal or trip makes a stop still being fitted in stale.
let stopToken = 0;

function placeTripStop(id: string, first?: boolean, streets?: { toFirst: number; toStop: number }) {
  const destination = trip.destination;
  if (!destination) return;
  const placing = { graph: walkGraph(), destination, from: stopsContext.from, avoidStairs: trip.avoidStairs, streets };
  const placed = placeStop({ stops: trip.stops, after: trip.after }, id, placing, first);
  if (placed) set({ ...placed.order, stopQuestion: first === undefined ? placed.question : null });
}

/** Adds a stop where it adds the least time, then asks whether that suits. */
export function addStop(id: string) {
  const token = ++stopToken;
  const stop = getPlace(id);
  const streets = stopsContext.streets;
  if (!stop || !streets) return placeTripStop(id);
  set({ stopPending: id, stopQuestion: null });
  fetchTripRoute(walkGraph(), streets.here, stop, streets.travel, { avoidStairs: trip.avoidStairs })
    .then((route) => (route ? { toFirst: streets.toFirst, toStop: legSeconds(route) } : undefined))
    .catch(() => undefined)
    .then((estimate) => {
      if (token !== stopToken) return;
      set({ stopPending: null });
      placeTripStop(id, undefined, estimate);
    });
}
export const keepStop = () => set({ stopQuestion: null });
/** Moves the newest stop to the other side of the destination. */
export const moveStop = () => {
  const question = trip.stopQuestion;
  if (question) placeTripStop(question.id, !question.onTheWay);
};
export function removeStop(id: string) {
  stopToken += 1;
  set({ ...withoutStop(trip, id), stopPending: null, stopQuestion: trip.stopQuestion?.id === id ? null : trip.stopQuestion });
}

export const setAvoidStairs = (avoidStairs: boolean) => set({ avoidStairs });
export const setTravelMode = (travelMode: TravelMode) => set({ travelMode });
/** Starts guiding through `legs`, the places in the order they are visited. */
export const startNavigating = (legs: string[]) =>
  trip.destination && set({ phase: 'navigate', legs, leg: 0, stopQuestion: null });
/** On to the next place after arriving at a stop. */
export const nextLeg = () => trip.leg < trip.legs.length - 1 && set({ leg: trip.leg + 1 });
export const stopNavigating = () => set({ phase: trip.destination ? 'preview' : 'idle', legs: [], leg: 0 });
export const pickArrive = (placeId: string, id: string, at: number | null) => set({ arrivePick: { placeId, id, at } });

/** Puts a stop in as the very next place mid walk; standing at a stop already, it comes after that one. */
export function insertStopNow(id: string, atStop: boolean) {
  const at = atStop ? trip.leg + 1 : trip.leg;
  set({ legs: [...trip.legs.slice(0, at), id, ...trip.legs.slice(at)], leg: at });
}

// The map owns the walk, so a stop picked on the search sheet mid walk is handed to it.
let stopNowHandler: ((id: string) => void) | null = null;
export function onStopNow(handler: (id: string) => void) {
  stopNowHandler = handler;
  return () => {
    if (stopNowHandler === handler) stopNowHandler = null;
  };
}
export const requestStopNow = (id: string) => stopNowHandler?.(id);
export function closeTrip() {
  stopToken += 1;
  set({
    phase: 'idle',
    destination: null,
    room: undefined,
    origin: MY_LOCATION,
    stops: [],
    after: [],
    stopQuestion: null,
    stopPending: null,
    legs: [],
    leg: 0,
    arrivePick: null,
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useTrip() {
  return useSyncExternalStore(subscribe, () => trip, () => trip);
}
