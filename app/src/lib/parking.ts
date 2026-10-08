import { getPlace, type Coordinate } from "@/data/campus";
import { distanceMeters, WALK_SPEED_MPS } from "@/lib/geo";
import { progressAtDistance, type Route, type RouteProgress } from "@/lib/routing";

// About a mile before the lot, when the choice still matters but the driver is nearly there.
const OFFER_WITHIN_METERS = 1600;
// Leaving the route in its last stretch before the lot, still driving and getting farther away, means the lot was missed.
const LAST_STRETCH_METERS = 300;
const ON_ROUTE_METERS = 40;
const OFF_ROUTE_METERS = 60;
const PAST_LOT_METERS = 40;
const DRIVING_MPS = 4;
/** How long the card waits for a tap before keeping the lot. */
export const PARKING_PROMPT_MS = 15_000;

export type ParkingPrompt =
  | { kind: "offer" | "arrived"; lotId: string; lotName: string; walkMinutes: number; destinationName: string }
  | { kind: "missed"; lotId: string; lotName: string; walkMinutes: number; destinationName: string; missedId: string; missedName: string };

const lotName = (id: string) => getPlace(id)?.name ?? "the lot";

/** Minutes on foot from the lot to the place, never less than one. */
export function walkMinutes(route: Route) {
  const walk = route.campusFrom === undefined ? 0 : route.distance - route.campusFrom;
  return Math.max(1, Math.round(walk / WALK_SPEED_MPS / 60));
}

/** Where a drive parks, if it parks. */
export function parkingPoint(route: Route): Coordinate | null {
  if (route.travel !== "drive" || !route.parkAt || route.campusFrom === undefined) return null;
  return progressAtDistance(route, route.campusFrom).point;
}

/** The card a drive shows once it is close enough to its lot to decide. */
export function parkingOffer(route: Route, progress: RouteProgress, destinationName: string): ParkingPrompt | null {
  if (route.travel !== "drive" || !route.parkAt || route.campusFrom === undefined) return null;
  const toLot = route.campusFrom - progress.distanceAlong;
  if (toLot > OFFER_WITHIN_METERS || toLot < 0) return null;
  return { kind: "offer", lotId: route.parkAt, lotName: lotName(route.parkAt), walkMinutes: walkMinutes(route), destinationName };
}

/** After driving right up to the place, the lot to park in and walk back from. */
export function arrivedPrompt(route: Route, destinationName: string): ParkingPrompt | null {
  if (route.travel !== "drive" || !route.parkAt) return null;
  return { kind: "arrived", lotId: route.parkAt, lotName: lotName(route.parkAt), walkMinutes: walkMinutes(route), destinationName };
}

export function missedPrompt(route: Route, missedId: string, destinationName: string): ParkingPrompt | null {
  if (!route.parkAt) return null;
  return {
    kind: "missed",
    lotId: route.parkAt,
    lotName: lotName(route.parkAt),
    walkMinutes: walkMinutes(route),
    destinationName,
    missedId,
    missedName: lotName(missedId),
  };
}

/** Follows how close a drive came to its lot, and says once it has clearly gone past. */
export function createMissedLotWatch() {
  let lot: string | null = null;
  let closest = Infinity;
  let approached = false;
  let missed = false;
  const forget = () => {
    lot = null;
    closest = Infinity;
    approached = false;
    missed = false;
  };
  return {
    update(route: Route, progress: RouteProgress, position: Coordinate, speed: number): boolean {
      const point = parkingPoint(route);
      if (!point || !route.parkAt || route.campusFrom === undefined) {
        forget();
        return false;
      }
      if (route.parkAt !== lot) {
        forget();
        lot = route.parkAt;
      }
      if (progress.distanceFromRoute <= ON_ROUTE_METERS && progress.distanceAlong >= route.campusFrom - LAST_STRETCH_METERS) {
        approached = true;
      }
      if (!approached || missed) return false;
      const away = distanceMeters(position, point);
      closest = Math.min(closest, away);
      if (progress.distanceFromRoute < OFF_ROUTE_METERS || away < closest + PAST_LOT_METERS || speed < DRIVING_MPS) return false;
      missed = true;
      return true;
    },
    /** Watches again from scratch, such as after the driver turns back for the lot they passed. */
    reset: forget,
  };
}

export const parkingTitle = (prompt: ParkingPrompt) =>
  prompt.kind === "missed"
    ? `Missed ${prompt.missedName}? ${prompt.lotName} is a ${prompt.walkMinutes} min walk`
    : prompt.kind === "arrived"
      ? `Need to park? ${prompt.lotName} is a ${prompt.walkMinutes} min walk`
      : `${prompt.lotName} is a ${prompt.walkMinutes} min walk`;

export const parkingDetail = (prompt: ParkingPrompt) => `from ${prompt.destinationName}`;

export const parkingSpoken = (prompt: ParkingPrompt) =>
  prompt.kind === "missed"
    ? `You passed ${prompt.missedName}. ${prompt.lotName} is a ${prompt.walkMinutes} minute walk from ${prompt.destinationName}. Want to park there instead?`
    : prompt.kind === "arrived"
      ? `Need to park? ${prompt.lotName} is a ${prompt.walkMinutes} minute walk from ${prompt.destinationName}.`
      : `${prompt.lotName} is a ${prompt.walkMinutes} minute walk from ${prompt.destinationName}. Want to park there?`;

/** What the card's two buttons say. */
export const parkingChoices = (prompt: ParkingPrompt) => ({
  primary: prompt.kind === "offer" ? "Park there" : `Park in ${prompt.lotName}`,
  secondary: prompt.kind === "offer" ? "Drive closer" : prompt.kind === "missed" ? `Back to ${prompt.missedName}` : "No thanks",
});
