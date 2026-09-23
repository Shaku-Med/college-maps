import type { Coordinate } from "@/data/campus";
import { distanceMeters, formatDuration, formatSeconds } from "@/lib/geo";
import type { Route, RouteStep, TravelMode, TurnDirection } from "@/lib/routing";

// Street directions for people who are not on campus yet. The campus path network only covers campus,
// so these come from OpenStreetMap's public Valhalla server, run by FOSSGIS. It is free under fair use,
// about one request a second per person, and asks apps to name themselves in X-Client-Id.
export const STREET_ROUTING_ORIGIN = "https://valhalla1.openstreetmap.de";
const CLIENT_ID = "csimap";
const TIMEOUT_MS = 12_000;
const MAX_SHAPE_CHARS = 400_000;
const MAX_MANEUVERS = 1_000;
const MAX_TEXT = 200;
// Valhalla will happily snap a point to a road 14 km away. A start or end that far from any road is a
// bad fix or open water, and a route from there would only look like the walker is lost.
const MAX_SNAP_METERS = 1_000;
// With a known direction of travel, the start is matched to a road running that way. Left to itself the
// router only looks at the single nearest road, which on a divided road or a bridge can be the wrong
// carriageway or the street underneath, so it is also given room to consider the others.
const HEADING_TOLERANCE_DEGREES = 45;
const HEADING_SEARCH_METERS: Record<TravelMode, number> = { walk: 15, bike: 25, drive: 35 };

const COSTING: Record<TravelMode, string> = { walk: "pedestrian", drive: "auto", bike: "bicycle" };

// Valhalla maneuver types that bend left or right. Everything else reads as going straight on.
const TURNS: Record<number, TurnDirection> = {
  9: "slight-right",
  10: "right",
  11: "sharp-right",
  12: "sharp-right",
  13: "sharp-left",
  14: "sharp-left",
  15: "left",
  16: "slight-left",
  18: "slight-right",
  19: "slight-left",
  20: "slight-right",
  21: "slight-left",
  23: "slight-right",
  24: "slight-left",
  37: "slight-right",
  38: "slight-left",
};
const DEPART = new Set([1, 2, 3]);
const ARRIVE = new Set([4, 5, 6]);
const STAIRS = 40;

export class StreetRoutingError extends Error {}

/**
 * A street route from `from` to `to`. Resolves to null when no route exists, and rejects with a
 * StreetRoutingError when the service could not be reached, so the two can be told apart on screen.
 */
export async function fetchStreetRoute(
  from: Coordinate,
  to: Coordinate,
  travel: TravelMode,
  {
    avoidStairs = false,
    heading,
    signal,
  }: { avoidStairs?: boolean; heading?: number; signal?: AbortSignal } = {},
): Promise<Route | null> {
  const facing =
    heading !== undefined && Number.isFinite(heading)
      ? { heading: ((heading % 360) + 360) % 360, heading_tolerance: HEADING_TOLERANCE_DEGREES, radius: HEADING_SEARCH_METERS[travel] }
      : {};
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT_MS);

  try {
    const response = await fetch(`${STREET_ROUTING_ORIGIN}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
      body: JSON.stringify({
        locations: [
          { lat: from.latitude, lon: from.longitude, search_cutoff: MAX_SNAP_METERS, ...facing },
          { lat: to.latitude, lon: to.longitude, search_cutoff: MAX_SNAP_METERS },
        ],
        costing: COSTING[travel],
        // Wheelchair walking keeps to curb cuts and ramps, which is what avoiding stairs means off campus.
        ...(travel === "walk" && avoidStairs ? { costing_options: { pedestrian: { type: "wheelchair" } } } : {}),
        directions_options: { units: "miles", language: "en-US" },
      }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    // Valhalla answers 400 when the places cannot be joined, such as no road near one end.
    if (response.status === 400) return null;
    if (!response.ok) throw new StreetRoutingError(`Directions service returned ${response.status}`);
    const route = toRoute(await response.json(), travel);
    if (
      !route ||
      distanceMeters(route.path[0], from) > MAX_SNAP_METERS ||
      distanceMeters(route.path[route.path.length - 1], to) > MAX_SNAP_METERS
    ) {
      return null;
    }
    return route;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof StreetRoutingError) throw err;
    throw new StreetRoutingError("Directions service could not be reached");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_TEXT) : undefined);

// The answer comes from a server we do not run, so every field is checked before it is trusted.
function toRoute(data: unknown, travel: TravelMode): Route | null {
  const trip = (data as { trip?: { legs?: unknown; summary?: { time?: unknown } } } | null)?.trip;
  const leg = Array.isArray(trip?.legs) ? (trip.legs[0] as { shape?: unknown; maneuvers?: unknown }) : undefined;
  if (!leg || typeof leg.shape !== "string" || leg.shape.length > MAX_SHAPE_CHARS || !Array.isArray(leg.maneuvers)) {
    return null;
  }
  const path = decodePolyline6(leg.shape);
  if (path.length < 2 || leg.maneuvers.length === 0 || leg.maneuvers.length > MAX_MANEUVERS) return null;

  const cumulative = [0];
  for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + distanceMeters(path[i - 1], path[i]));
  const distance = cumulative[cumulative.length - 1];
  const last = path.length - 1;

  const steps: RouteStep[] = [];
  for (const raw of leg.maneuvers as Array<Record<string, unknown>>) {
    const type = typeof raw.type === "number" ? raw.type : 0;
    const begin = typeof raw.begin_shape_index === "number" ? Math.min(Math.max(0, Math.trunc(raw.begin_shape_index)), last) : 0;
    const instruction = text(raw.instruction);
    steps.push({
      kind: DEPART.has(type) ? "depart" : ARRIVE.has(type) ? "arrive" : type === STAIRS ? "stairs" : "turn",
      direction: TURNS[type] ?? "straight",
      bearing: typeof raw.bearing_after === "number" ? raw.bearing_after : undefined,
      startDistance: cumulative[begin],
      length: 0,
      text: instruction,
      alert: text(raw.verbal_transition_alert_instruction) ?? text(raw.verbal_pre_transition_instruction) ?? instruction,
      spoken: text(raw.verbal_pre_transition_instruction) ?? instruction,
    });
  }
  if (steps[steps.length - 1].kind !== "arrive") steps.push({ kind: "arrive", startDistance: distance, length: 0 });
  for (let i = 0; i < steps.length - 1; i++) steps[i].length = Math.max(0, steps[i + 1].startDistance - steps[i].startDistance);

  const time = trip?.summary?.time;
  return {
    path,
    cumulative,
    distance,
    arrivalDistance: distance,
    steps,
    hasStairs: steps.some((step) => step.kind === "stairs"),
    stairs: path.map(() => false),
    travel,
    duration: typeof time === "number" && Number.isFinite(time) && time >= 0 ? time : undefined,
  };
}

// Valhalla encodes the route line as a polyline with six decimal places.
export function decodePolyline6(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    const deltas = [0, 0];
    for (let axis = 0; axis < 2; axis++) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) return points;
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && shift < 35);
      deltas[axis] = result & 1 ? ~(result >> 1) : result >> 1;
    }
    lat += deltas[0];
    lng += deltas[1];
    points.push({ latitude: lat / 1e6, longitude: lng / 1e6 });
  }
  return points;
}

/** Time for the rest of a route: the router's own estimate when it gave one, walking pace otherwise. */
export function formatRouteTime(route: Route, meters = route.distance) {
  if (route.duration === undefined || route.distance === 0) return formatDuration(meters);
  return formatSeconds(route.duration * (meters / route.distance));
}
