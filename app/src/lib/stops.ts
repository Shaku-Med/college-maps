import { getPlace, type Coordinate, type Place } from "@/data/campus";
import { WALK_SPEED_MPS, distanceMeters } from "@/lib/geo";
import type { Route } from "@/lib/routing";

/** Closer than this to a building, someone is already there. */
export const AT_PLACE_METERS = 60;
export const MAX_STOPS = 5;
export const MY_LOCATION = "me";

export type TripPlan = {
  /** Where the first leg starts, or null when there is no location to start from yet. */
  start: Coordinate | null;
  /** True when the first leg starts from the traveller's own location and can be followed live. */
  live: boolean;
  /** The places visited in order. The last one is the destination; the rest are stops. */
  targets: Place[];
};

/** The order a trip visits places in. */
export function tripPlan({
  origin,
  stops,
  destination,
  here,
}: {
  origin: string;
  stops: readonly string[];
  destination: Place;
  here?: Coordinate;
}): TripPlan {
  const middle = stops.map((id) => getPlace(id)).filter((place): place is Place => place !== undefined);
  const from = origin === MY_LOCATION ? undefined : getPlace(origin);

  let start: Coordinate | null = here ?? null;
  let live = here !== undefined;
  const targets: Place[] = [];
  if (from) {
    if (here && distanceMeters(here, from.coordinate) > AT_PLACE_METERS) {
      targets.push(from);
    } else if (!here) {
      start = from.coordinate;
      live = false;
    }
  }
  targets.push(...middle, destination);

  // Two of the same place in a row is one visit.
  const deduped = targets.filter((place, i) => i === 0 || targets[i - 1].id !== place.id);
  return { start, live, targets: deduped };
}

/** Adds a stop, ignoring repeats, the destination itself, and anything past the limit. */
export function withStop(stops: readonly string[], id: string, destinationId?: string): string[] {
  if (!getPlace(id) || id === destinationId || stops.includes(id) || stops.length >= MAX_STOPS) return [...stops];
  return [...stops, id];
}

/** Time and distance across every leg of a trip with stops. Legs without a known duration are walked. */
export function tripTotals(legs: readonly Route[]): { meters: number; seconds: number } {
  let meters = 0;
  let seconds = 0;
  for (const leg of legs) {
    meters += leg.distance;
    seconds += leg.duration ?? leg.distance / WALK_SPEED_MPS;
  }
  return { meters, seconds };
}
