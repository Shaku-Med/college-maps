// Heads up warnings along any route, like crosswalks, railroad crossings and cameras, plus road speed limits, from OpenStreetMap.
// Shared by the web and phone apps, and works in any state since the data is worldwide.
import type { Bounds, Coordinate } from "@/data/campus";
import { bearingDegrees, distanceMeters, projectOntoSegment } from "@/lib/geo";
import type { Route, TravelMode } from "@/lib/routing";

// OpenStreetMap's public Overpass server, then a public mirror for when it is down: both free under fair use.
// Only the route's line is sent, the same as for street routing.
export const OVERPASS_ORIGINS = ["https://overpass-api.de", "https://overpass.private.coffee"] as const;
const TIMEOUT_MS = 15_000;
const MAX_ELEMENTS = 8_000;
const MAX_GEOMETRY = 2_000;
const MAX_ROAD_POINTS = 120_000;

// Route lines and map features come from the same OpenStreetMap ways, so a hazard on the route sits right on its line.
const ON_ROUTE_METERS = 6;
// Cameras stand beside the road, not on it, so they are looked for a little further out.
const CAMERA_ROUTE_METERS = 12;
const NEAR_METERS = 15;
// The route runs down the middle of the road it follows, so its own road is right under it.
const ROAD_NEAR_METERS = 3;
const LIMIT_ROUTE_METERS = 8;
const LIMIT_SAMPLE_METERS = 10;
// Short gaps like intersections keep the last limit rather than blinking it off.
const LIMIT_GAP_METERS = 40;
const SAMPLE_METERS = 15;
const COVER_CELL_METERS = 25;
// How far ahead is looked up at once, so a long drive asks again as it goes rather than all at the start.
const WINDOW_METERS = 6_000;
// A road running within this of the walk's own direction is one the walk follows, not one it crosses.
const ALONG_ROAD_DEGREES = 35;

export type HazardKind = "crosswalk" | "signal" | "unmarked" | "rail" | "bump" | "speedCamera" | "redLightCamera";
export type HazardPoint = Coordinate & { id: number; kind: HazardKind; roads: number[] };
export type RouteHazard = { id: number; kind: HazardKind; at: number; count: number };
/** A road with a posted limit, in miles per hour. */
export type SpeedRoad = { id: number; mph: number; path: Coordinate[] };
/** From this far along the route, the limit is this, or unknown. */
export type SpeedLimit = { at: number; mph: number | null };
export type HazardData = { points: HazardPoint[]; roads: SpeedRoad[] };

const CROSSINGS: ReadonlySet<HazardKind> = new Set(["crosswalk", "signal", "unmarked"]);
const CAMERAS: ReadonlySet<HazardKind> = new Set(["speedCamera", "redLightCamera"]);

const RELEVANT: Record<TravelMode, ReadonlySet<HazardKind>> = {
  walk: new Set(["crosswalk", "signal", "unmarked", "rail"]),
  bike: new Set(["rail", "bump"]),
  drive: new Set(["rail", "bump", "speedCamera", "redLightCamera"]),
};

// Close together, two of a kind are one warning: a row of speed bumps, or both halves of a split crossing.
const MERGE_METERS: Record<TravelMode, number> = { walk: 25, bike: 60, drive: 80 };
// The same kind of warning again this soon after the last one would only nag.
export const HAZARD_REPEAT_METERS: Record<TravelMode, number> = { walk: 60, bike: 200, drive: 300 };

const WALK_LINES: Record<"crosswalk" | "signal" | "unmarked" | "rail", string> = {
  crosswalk: "Crosswalk ahead. Look both ways before you cross.",
  signal: "Crossing at the light ahead. Wait for the walk signal.",
  unmarked: "Road crossing ahead with no crosswalk. Look both ways and take care.",
  rail: "Railroad tracks ahead. Look and listen for trains.",
};
const RIDE_LINES = {
  rail: "Railroad crossing ahead.",
  bump: "Speed bump ahead.",
  bumps: "Speed bumps ahead.",
  speedCamera: "Speed camera ahead.",
  redLightCamera: "Red light camera ahead.",
} as const;

export const HAZARD_LINES = [...Object.values(WALK_LINES), ...Object.values(RIDE_LINES)];

export function hazardLine(hazard: RouteHazard, travel: TravelMode = "walk"): string {
  if (hazard.kind === "bump") return hazard.count > 1 ? RIDE_LINES.bumps : RIDE_LINES.bump;
  if (hazard.kind === "rail" && travel !== "walk") return RIDE_LINES.rail;
  if (hazard.kind === "speedCamera" || hazard.kind === "redLightCamera") return RIDE_LINES[hazard.kind];
  return WALK_LINES[hazard.kind];
}

export function hazardLabel(hazard: RouteHazard): string {
  switch (hazard.kind) {
    case "crosswalk":
      return "Crosswalk ahead";
    case "signal":
      return "Crossing at a light";
    case "unmarked":
      return "No crosswalk, look both ways";
    case "rail":
      return "Railroad crossing ahead";
    case "bump":
      return hazard.count > 1 ? "Speed bumps ahead" : "Speed bump ahead";
    case "speedCamera":
      return "Speed camera ahead";
    case "redLightCamera":
      return "Red light camera ahead";
  }
}

/** How far ahead a warning is said: about fifteen seconds out, never closer than a few steps. */
export function hazardCue(travel: TravelMode = "walk", speed = 0) {
  if (travel === "drive") return Math.max(150, speed * 10);
  if (travel === "bike") return Math.max(50, speed * 10);
  return Math.max(20, speed * 15);
}

/** The warning to show on screen right now, from a little before it is said until it is passed. */
export function hazardAhead(hazards: readonly RouteHazard[], along: number, travel: TravelMode = "walk", speed = 0) {
  const reach = hazardCue(travel, speed) * 1.5;
  return hazards.find((hazard) => hazard.at - along > -2 && hazard.at - along <= reach);
}

// ---- Matching to a route ------------------------------------------------------------------------

/** Every warning on this route that matters for how it is traveled, in order along it. */
export function hazardsOnRoute(route: Route, points: Iterable<HazardPoint>): RouteHazard[] {
  const travel = route.travel ?? "walk";
  const relevant = RELEVANT[travel];
  const found: RouteHazard[] = [];
  for (const point of points) {
    if (!relevant.has(point.kind)) continue;
    const hit = nearestOnRoute(route, point);
    if (!hit || hit.distance > (CAMERAS.has(point.kind) ? CAMERA_ROUTE_METERS : ON_ROUTE_METERS)) continue;
    // Only a crossing is about another road; a bump or a rail crossing sits on the road being followed.
    if (CROSSINGS.has(point.kind) && point.roads.some((road) => alongRoad(road, hit.bearing))) continue;
    found.push({ id: point.id, kind: point.kind, at: hit.at, count: 1 });
  }
  found.sort((a, b) => a.at - b.at);

  const merged: RouteHazard[] = [];
  const lastOfKind = new Map<HazardKind, RouteHazard>();
  for (const hazard of found) {
    const last = lastOfKind.get(hazard.kind);
    if (last && hazard.at - last.at <= MERGE_METERS[travel]) {
      last.count++;
      continue;
    }
    merged.push(hazard);
    lastOfKind.set(hazard.kind, hazard);
  }
  return merged;
}

function alongRoad(roadBearing: number, routeBearing: number) {
  const diff = Math.abs(((roadBearing - routeBearing) % 180) + 180) % 180;
  return diff < ALONG_ROAD_DEGREES || diff > 180 - ALONG_ROAD_DEGREES;
}

/** Where the posted limit changes along a drive, matched to the roads it follows. Empty for walks and rides. */
export function speedLimitsOnRoute(route: Route, roads: Iterable<SpeedRoad>): SpeedLimit[] {
  if (route.travel !== "drive" || route.path.length < 2) return [];
  const index = new Map<string, { a: Coordinate; b: Coordinate; mph: number }[]>();
  for (const road of roads) {
    for (let i = 1; i < road.path.length; i++) {
      const a = road.path[i - 1];
      const b = road.path[i];
      // Walked along in cell sized steps, so a long straight highway costs its length, not the area of its box.
      const steps = Math.min(4_000, Math.ceil(distanceMeters(a, b) / COVER_CELL_METERS));
      const keys = new Set<string>();
      for (let k = 0; k <= steps; k++) {
        const t = steps === 0 ? 0 : k / steps;
        const { x, y } = cellOf({
          latitude: a.latitude + (b.latitude - a.latitude) * t,
          longitude: a.longitude + (b.longitude - a.longitude) * t,
        });
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) keys.add(`${x + dx}:${y + dy}`);
      }
      for (const key of keys) {
        const list = index.get(key);
        if (list) list.push({ a, b, mph: road.mph });
        else index.set(key, [{ a, b, mph: road.mph }]);
      }
    }
  }
  if (index.size === 0) return [];

  const limits: SpeedLimit[] = [];
  let lastKnownAt = -Infinity;
  let segment = 1;
  for (let at = 0; at <= route.distance; at += LIMIT_SAMPLE_METERS) {
    while (segment < route.cumulative.length - 1 && route.cumulative[segment] < at) segment++;
    const bearing = bearingDegrees(route.path[segment - 1], route.path[segment]);
    const point = pointAt(route, at);
    const { x, y } = cellOf(point);
    let best: { distance: number; mph: number } | undefined;
    for (const candidate of index.get(`${x}:${y}`) ?? []) {
      const hit = projectOntoSegment(point, candidate.a, candidate.b);
      if (hit.distance > LIMIT_ROUTE_METERS || (best && hit.distance >= best.distance)) continue;
      if (!alongRoad(bearingDegrees(candidate.a, candidate.b), bearing)) continue;
      best = { distance: hit.distance, mph: candidate.mph };
    }
    const last = limits[limits.length - 1];
    if (best) {
      lastKnownAt = at;
      if (last?.mph !== best.mph) limits.push({ at, mph: best.mph });
    } else if (at - lastKnownAt > LIMIT_GAP_METERS && last && last.mph !== null) {
      limits.push({ at, mph: null });
    }
  }
  return limits;
}

export function speedLimitAt(limits: readonly SpeedLimit[], along: number): number | null {
  let mph: number | null = null;
  for (const limit of limits) {
    if (limit.at > along) break;
    mph = limit.mph;
  }
  return mph;
}

function nearestOnRoute(route: Route, point: Coordinate) {
  let best: { distance: number; at: number; bearing: number } | undefined;
  for (let i = 1; i < route.path.length; i++) {
    const a = route.path[i - 1];
    const b = route.path[i];
    const hit = projectOntoSegment(point, a, b);
    if (best && hit.distance >= best.distance) continue;
    best = {
      distance: hit.distance,
      at: route.cumulative[i - 1] + hit.t * (route.cumulative[i] - route.cumulative[i - 1]),
      bearing: bearingDegrees(a, b),
    };
  }
  return best;
}

// ---- Fetching, only for stretches not looked up yet --------------------------------------------

const cellOf = (p: Coordinate) => {
  const y = Math.floor((p.latitude * 110_540) / COVER_CELL_METERS);
  const x = Math.floor((p.longitude * 111_320 * Math.cos((p.latitude * Math.PI) / 180)) / COVER_CELL_METERS);
  return { x, y };
};

/** Everything found on a trip so far, and which ground has been looked at, so a reroute only asks about what is new. */
export class HazardCache {
  readonly points = new Map<number, HazardPoint>();
  readonly roads = new Map<number, SpeedRoad>();
  private covered = new Set<string>();
  private area: Bounds | null = null;

  /** Starts from hazards already known for an area, like the campus ones built into the app, so that ground is never asked about. */
  constructor(known?: { area: Bounds } & HazardData) {
    if (!known) return;
    this.area = known.area;
    this.store(known);
  }

  private store({ points, roads }: HazardData) {
    for (const point of points) this.points.set(point.id, point);
    for (const road of roads) this.roads.set(road.id, road);
  }

  private isCovered(p: Coordinate) {
    const a = this.area;
    if (a && p.latitude >= a.south && p.latitude <= a.north && p.longitude >= a.west && p.longitude <= a.east) return true;
    const { x, y } = cellOf(p);
    return this.covered.has(`${x}:${y}`);
  }

  /** Stretches of the route ahead that have not been looked up, as lines of points. */
  missing(route: Route, along: number): Coordinate[][] {
    const runs: Coordinate[][] = [];
    let run: Coordinate[] = [];
    const end = Math.min(route.distance, along + WINDOW_METERS);
    for (let d = Math.max(0, along - SAMPLE_METERS); d <= end; d += SAMPLE_METERS) {
      const p = pointAt(route, d);
      if (this.isCovered(p)) {
        if (run.length > 0) runs.push(run);
        run = [];
      } else run.push(p);
    }
    if (run.length > 0) runs.push(run);
    // A lone sample cannot draw a line, so it is doubled into a tiny one.
    return runs.map((r) => (r.length === 1 ? [r[0], r[0]] : r));
  }

  add(runs: Coordinate[][], found: HazardData) {
    for (const run of runs) {
      for (const p of run) {
        const { x, y } = cellOf(p);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) this.covered.add(`${x + dx}:${y + dy}`);
      }
    }
    this.store(found);
  }
}

function pointAt(route: Route, distance: number): Coordinate {
  const { path, cumulative } = route;
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < distance) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, (distance - cumulative[i - 1]) / span));
  return {
    latitude: path[i - 1].latitude + (path[i].latitude - path[i - 1].latitude) * t,
    longitude: path[i - 1].longitude + (path[i].longitude - path[i - 1].longitude) * t,
  };
}

const ROADS = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street)(_link)?$";

// Overpass measures to the line between points, so a stretch only needs the points where it bends.
const SIMPLIFY_METERS = 2;

function simplify(run: Coordinate[]): Coordinate[] {
  if (run.length < 3) return run;
  const keep = new Uint8Array(run.length);
  keep[0] = keep[run.length - 1] = 1;
  const stack: [number, number][] = [[0, run.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const off = projectOntoSegment(run[i], run[first], run[last]).distance;
      if (off > worst) {
        worst = off;
        index = i;
      }
    }
    if (index === -1 || worst <= SIMPLIFY_METERS) continue;
    keep[index] = 1;
    stack.push([first, index], [index, last]);
  }
  return run.filter((_, i) => keep[i]);
}

function overpassQuery(runs: Coordinate[][]) {
  const lines = runs.map((run) => simplify(run).map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`).join(","));
  const each = (part: (line: string) => string) => lines.map(part).join("");
  // Tag filters first keep it quick: the server only weighs up the few features that could matter.
  return (
    `[out:json][timeout:25];(` +
    each(
      (l) =>
        `node(around:${NEAR_METERS},${l})[highway~"^(crossing|speed_camera)$"];node(around:${NEAR_METERS},${l})[railway~"^(level_crossing|crossing)$"];node(around:${NEAR_METERS},${l})[traffic_calming];`,
    ) +
    `)->.h;rel(bn.h)[type=enforcement][enforcement~"^(maxspeed|average_speed|traffic_signals)$"]->.e;` +
    `.h out body;.e out body;node(r.e)->.m;.m out skel;` +
    `(way(bn.h)[highway~"${ROADS}"];` +
    each((l) => `way(around:${ROAD_NEAR_METERS},${l})[highway~"${ROADS}"][maxspeed];`) +
    `);out body geom;`
  );
}

// Overpass turns away generic agents like Android's okhttp with a 406; browsers send their own and cannot change it.
const APP_AGENT: Record<string, string> =
  typeof navigator !== "undefined" && navigator.product === "ReactNative" ? { "User-Agent": "csimap (+https://csimap.app)" } : {};

// The public server turns requests away when it is busy, and asks to be tried again after a pause.
const RETRY_DELAYS_MS = [3_000, 8_000];

/** Asks OpenStreetMap what lies on these stretches. Null when it cannot be reached, so the trip simply has no warnings. */
export async function fetchHazards(runs: Coordinate[][], signal?: AbortSignal): Promise<HazardData | null> {
  if (runs.length === 0) return { points: [], roads: [] };
  const body = `data=${encodeURIComponent(overpassQuery(runs))}`;
  for (let attempt = 0; ; attempt++) {
    const result = await askOverpass(OVERPASS_ORIGINS[attempt % OVERPASS_ORIGINS.length], body, signal);
    if (result !== "busy") return result;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined || signal?.aborted) return null;
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (signal?.aborted) return null;
  }
}

async function askOverpass(origin: string, body: string, signal?: AbortSignal): Promise<HazardData | null | "busy"> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/api/interpreter`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...APP_AGENT },
      body,
      signal: controller.signal,
    });
    if (res.status === 429 || res.status >= 500) return "busy";
    if (!res.ok) return null;
    return parseHazards(await res.json());
  } catch {
    return signal?.aborted ? null : "busy";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

type RawElement = {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  tags?: unknown;
  nodes?: unknown;
  geometry?: unknown;
  members?: unknown;
};

const isCoordinate = (lat: unknown, lon: unknown): lat is number =>
  typeof lat === "number" && typeof lon === "number" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

const tag = (tags: unknown, key: string) => {
  if (!tags || typeof tags !== "object") return undefined;
  const value = (tags as Record<string, unknown>)[key];
  return typeof value === "string" ? value.slice(0, 64) : undefined;
};

function kindOf(tags: unknown): HazardKind | null {
  const railway = tag(tags, "railway");
  if (railway === "level_crossing" || railway === "crossing") return "rail";
  if (tag(tags, "traffic_calming") && tag(tags, "traffic_calming") !== "no") return "bump";
  if (tag(tags, "highway") === "speed_camera") return "speedCamera";
  if (tag(tags, "highway") !== "crossing") return null;
  const crossing = tag(tags, "crossing");
  if (crossing === "no") return null;
  if (crossing === "traffic_signals" || tag(tags, "crossing:signals") === "yes") return "signal";
  if (crossing === "unmarked" || tag(tags, "crossing:markings") === "no") return "unmarked";
  return "crosswalk";
}

/** A posted limit in miles per hour, from tags like "35 mph" or "50" (km/h). Unknown for "none", "signals" and the like. */
function mphOf(tags: unknown): number | null {
  const match = /^(\d{1,3})(?:\.\d+)?\s*(mph)?$/i.exec(tag(tags, "maxspeed")?.trim() ?? "");
  if (!match) return null;
  const value = Number(match[1]);
  const mph = match[2] ? value : Math.round(value / 1.609344 / 5) * 5;
  return mph >= 5 && mph <= 90 ? mph : null;
}

const ENFORCEMENT_KINDS: Record<string, HazardKind> = {
  maxspeed: "speedCamera",
  average_speed: "speedCamera",
  traffic_signals: "redLightCamera",
};

/** A cache that already knows the built in hazards file (scripts/build-hazards.mjs), or an empty one if that file is unusable. */
export function knownHazardCache(data: unknown): HazardCache {
  const area = (data as { area?: unknown } | null)?.area as Record<string, unknown> | undefined;
  const found = parseHazards(data);
  const valid =
    area &&
    isCoordinate(area.south, area.west) &&
    isCoordinate(area.north, area.east) &&
    (area.south as number) < (area.north as number) &&
    (area.west as number) < (area.east as number);
  return valid && found ? new HazardCache({ area: area as Bounds, ...found }) : new HazardCache();
}

export function parseHazards(data: unknown): HazardData | null {
  const elements = (data as { elements?: unknown })?.elements;
  if (!Array.isArray(elements) || elements.length > MAX_ELEMENTS) return null;

  const points = new Map<number, HazardPoint>();
  const nodes = new Map<number, Coordinate>();
  for (const raw of elements as RawElement[]) {
    if (raw?.type !== "node" || typeof raw.id !== "number" || !isCoordinate(raw.lat, raw.lon)) continue;
    const at = { latitude: raw.lat, longitude: raw.lon as number };
    nodes.set(raw.id, at);
    const kind = kindOf(raw.tags);
    if (kind) points.set(raw.id, { id: raw.id, kind, ...at, roads: [] });
  }

  // A camera mapped as a rule: placed where it applies, like the light it watches, else where the camera stands.
  for (const raw of elements as RawElement[]) {
    if (raw?.type !== "relation" || typeof raw.id !== "number" || !Array.isArray(raw.members)) continue;
    const kind = ENFORCEMENT_KINDS[tag(raw.tags, "enforcement") ?? ""];
    if (!kind) continue;
    const members = raw.members.slice(0, 50) as Array<{ type?: unknown; ref?: unknown; role?: unknown }>;
    const nodeFor = (role: string) => {
      const member = members.find((m) => m?.type === "node" && m.role === role && typeof m.ref === "number");
      return member ? nodes.get(member.ref as number) : undefined;
    };
    const at = nodeFor("to") ?? nodeFor("device");
    // Relation ids are their own numbering, so they are kept apart from node ids.
    if (at) points.set(-raw.id, { id: -raw.id, kind, ...at, roads: [] });
  }

  const roads: SpeedRoad[] = [];
  let roadPoints = 0;
  for (const raw of elements as RawElement[]) {
    if (raw?.type !== "way" || typeof raw.id !== "number" || !Array.isArray(raw.nodes) || !Array.isArray(raw.geometry)) continue;
    if (raw.nodes.length !== raw.geometry.length || raw.nodes.length > MAX_GEOMETRY) continue;
    const geometry = raw.geometry as Array<{ lat?: unknown; lon?: unknown }>;
    // Which way each road runs at a crossing on it, so a walk along that road is not told to cross it.
    raw.nodes.forEach((id, i) => {
      const point = typeof id === "number" ? points.get(id) : undefined;
      if (!point) return;
      const before = geometry[Math.max(0, i - 1)];
      const after = geometry[Math.min(geometry.length - 1, i + 1)];
      if (!isCoordinate(before?.lat, before?.lon) || !isCoordinate(after?.lat, after?.lon)) return;
      const a = { latitude: before.lat as number, longitude: before.lon as number };
      const b = { latitude: after.lat as number, longitude: after.lon as number };
      if (distanceMeters(a, b) > 0.5) point.roads.push(bearingDegrees(a, b));
    });

    const mph = mphOf(raw.tags);
    if (mph === null || roadPoints + geometry.length > MAX_ROAD_POINTS) continue;
    const path = geometry
      .filter((p) => isCoordinate(p?.lat, p?.lon))
      .map((p) => ({ latitude: p.lat as number, longitude: p.lon as number }));
    if (path.length < 2) continue;
    roadPoints += path.length;
    roads.push({ id: raw.id, mph, path });
  }
  return { points: [...points.values()], roads };
}

// GPS speed wobbles a little, so a few miles per hour over does not light the sign.
const OVER_LIMIT_SLACK_MPH = 3;

export function isOverLimit(speed: number | undefined, mph: number) {
  return speed !== undefined && speed * 2.236_94 > mph + OVER_LIMIT_SLACK_MPH;
}
