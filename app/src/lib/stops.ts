import { getPlace, type Coordinate, type Place } from "@/data/campus";
import { WALK_SPEED_MPS, distanceMeters } from "@/lib/geo";
import { findRoute, progressAtDistance, type Route, type WalkGraph } from "@/lib/routing";

/** Closer than this to a building, someone is already there. */
export const AT_PLACE_METERS = 60;
export const MAX_STOPS = 5;
export const MY_LOCATION = "me";
// A stop is on the way when going there first holds the destination up by no more than this.
const ON_THE_WAY_SECONDS = 120;
// Walking is rarely straight, for the rare pair the campus paths cannot join.
const STRAIGHT_LINE_DETOUR = 1.4;

export type TripPlan = {
  /** Where the first leg starts, or null when there is no location to start from yet. */
  start: Coordinate | null;
  /** True when the first leg starts from the traveller's own location and can be followed live. */
  live: boolean;
  /** The places visited in order: stops on the way, the destination, then any stops saved for after it. */
  targets: Place[];
  /** Where the destination sits in `targets`. */
  destinationIndex: number;
  /** A starting building the traveller is not at yet, visited first. */
  startPlace: Place | null;
};

/** The stops visited before the destination, and the ones saved for after it, each in order. */
export type StopOrder = { stops: string[]; after: string[] };
export const NO_STOPS: StopOrder = { stops: [], after: [] };

const places = (ids: readonly string[]) => ids.map((id) => getPlace(id)).filter((place): place is Place => place !== undefined);

/** How a newly added stop was placed, so the traveller can be asked whether that suits them. */
export type StopQuestion = {
  id: string;
  onTheWay: boolean;
  /** How long going there first holds up the destination. */
  seconds: number;
};

/** The order a trip visits places in. */
export function tripPlan({
  origin,
  stops,
  after = [],
  destination,
  here,
}: {
  origin: string;
  stops: readonly string[];
  after?: readonly string[];
  destination: Place;
  here?: Coordinate;
}): TripPlan {
  const from = origin === MY_LOCATION ? undefined : getPlace(origin);

  let start: Coordinate | null = here ?? null;
  let live = here !== undefined;
  let startPlace: Place | null = null;
  const targets: Place[] = [];
  if (from) {
    if (here && distanceMeters(here, from.coordinate) > AT_PLACE_METERS) {
      targets.push(from);
      startPlace = from;
    } else if (!here) {
      start = from.coordinate;
      live = false;
    }
  }
  targets.push(...places(stops), destination, ...places(after));

  // Two of the same place in a row is one visit.
  const deduped = targets.filter((place, i) => i === 0 || targets[i - 1].id !== place.id);
  return { start, live, targets: deduped, destinationIndex: deduped.findIndex((place) => place.id === destination.id), startPlace };
}

/** Where the walk to the stops begins: a starting building still to reach, where the campus paths start or a drive parks, or here. */
export function stopsStart(plan: TripPlan | null, firstLeg: Route | null): Coordinate | null {
  if (!plan) return null;
  if (plan.startPlace) return plan.startPlace.coordinate;
  if (firstLeg) return firstLeg.campusFrom === undefined ? firstLeg.path[0] : progressAtDistance(firstLeg, firstLeg.campusFrom).point;
  return plan.start;
}

export const stopCount = (order: StopOrder) => order.stops.length + order.after.length;

export const withoutStop = (order: StopOrder, id: string): StopOrder => ({
  stops: order.stops.filter((stop) => stop !== id),
  after: order.after.filter((stop) => stop !== id),
});

const insertAt = (ids: readonly string[], index: number, id: string) => [...ids.slice(0, index), id, ...ids.slice(index)];

type Placing = {
  graph: WalkGraph;
  destination: Place;
  from: Coordinate | null;
  avoidStairs: boolean;
  /** For a trip that starts on the streets: seconds to reach the first place now, and to reach the stop instead, parking included. */
  streets?: { toFirst: number; toStop: number };
};

/** Fits a stop in where it adds the least walking, before the destination when that is on the way; `first` overrides. */
export function placeStop(order: StopOrder, id: string, placing: Placing, first?: boolean) {
  const stop = getPlace(id);
  const rest = withoutStop(order, id);
  const isNew = stopCount(rest) === stopCount(order);
  if (!stop || id === placing.destination.id || (isNew && stopCount(order) >= MAX_STOPS)) return null;

  const walked = new Map<string, number>();
  const walk = (a: Coordinate, b: Coordinate) => {
    const key = `${a.latitude},${a.longitude}>${b.latitude},${b.longitude}`;
    let seconds = walked.get(key);
    if (seconds === undefined) {
      const route = findRoute(placing.graph, a, b, { avoidStairs: placing.avoidStairs });
      seconds = (route?.distance ?? distanceMeters(a, b) * STRAIGHT_LINE_DETOUR) / WALK_SPEED_MPS;
      walked.set(key, seconds);
    }
    return seconds;
  };
  // The walking a stop adds between two points: the way via the stop, less the way without it.
  const added = (a: Coordinate | null, b: Coordinate | null) =>
    (a ? walk(a, stop.coordinate) : 0) + (b ? walk(stop.coordinate, b) : 0) - (a && b ? walk(a, b) : 0);
  const cheapest = (points: (Coordinate | null)[], firstGap?: (next: Coordinate) => number) => {
    let best = { index: 0, seconds: Infinity };
    for (let i = 1; i < points.length; i++) {
      const next = points[i];
      const seconds = i === 1 && firstGap && next ? firstGap(next) : added(points[i - 1], next);
      if (seconds < best.seconds) best = { index: i - 1, seconds };
    }
    return best;
  };
  const coordinates = (ids: readonly string[]) => places(ids).map((place) => place.coordinate);
  // Heading for the stop first from off campus can change where a drive parks, so the streets answer for that gap.
  const streets = placing.streets;
  const fromStreets = streets && ((next: Coordinate) => streets.toStop + walk(stop.coordinate, next) - streets.toFirst);

  const before = cheapest([placing.from, ...coordinates(rest.stops), placing.destination.coordinate], fromStreets);
  const later = cheapest([placing.destination.coordinate, ...coordinates(rest.after), null]);
  const onTheWay = before.seconds <= ON_THE_WAY_SECONDS;
  const goFirst = first ?? onTheWay;
  const next: StopOrder = goFirst
    ? { stops: insertAt(rest.stops, before.index, id), after: rest.after }
    : { stops: rest.stops, after: insertAt(rest.after, later.index, id) };
  const question: StopQuestion = { id, onTheWay, seconds: Math.max(0, before.seconds) };
  return { order: next, question };
}

const aboutMinutes = (seconds: number) => (seconds < 45 ? "under a minute" : `about ${Math.max(1, Math.round(seconds / 60))} min`);

/** What the panel asks once a stop is placed, and what its two answers say. */
export function stopQuestionText(question: StopQuestion, destinationName: string) {
  const stopName = getPlace(question.id)?.name ?? "This stop";
  return question.onTheWay
    ? {
        title: `${stopName} is on your way`,
        detail: `Stopping there first adds ${aboutMinutes(question.seconds)} before ${destinationName}.`,
        keep: "Stop on the way",
        move: "Go after",
      }
    : {
        title: `${stopName} is out of your way`,
        detail: `Going there first adds ${aboutMinutes(question.seconds)}, so it comes after ${destinationName}.`,
        keep: "Go after",
        move: "Go there first",
      };
}

/** How long a leg takes. Legs without a known duration are walked. */
export const legSeconds = (leg: Route) => leg.duration ?? leg.distance / WALK_SPEED_MPS;

/** Time and distance across every leg of a trip with stops. */
export function tripTotals(legs: readonly Route[]): { meters: number; seconds: number } {
  let meters = 0;
  let seconds = 0;
  for (const leg of legs) {
    meters += leg.distance;
    seconds += legSeconds(leg);
  }
  return { meters, seconds };
}
