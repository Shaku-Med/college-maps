import type { Coordinate } from "@/data/campus";
import { buildingAt, buildingDoors, crossesBuilding } from "@/lib/buildings";
import { bearingDegrees, distanceMeters, interpolate, projectOntoSegment, turnAngle } from "@/lib/geo";

export type RawWalkGraph = {
  version: number;
  scale: number;
  baseLat: number;
  baseLng: number;
  nodes: number[];
  edges: number[];
};

export type WalkGraph = {
  lat: Float64Array;
  lng: Float64Array;
  offsets: Int32Array;
  targets: Int32Array;
  lengths: Float64Array;
  /** Lengths with roads counted longer, so routes keep to the walkways when that costs little extra. */
  costs: Float64Array;
  stairs: Uint8Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeStairs: Uint8Array;
};

export type TurnDirection =
  "straight" | "slight-left" | "left" | "sharp-left" | "slight-right" | "right" | "sharp-right";

export type RouteStep = {
  kind: "depart" | "turn" | "stairs" | "arrive";
  direction?: TurnDirection;
  bearing?: number;
  startDistance: number;
  length: number;
  /** Street directions come with their own wording, like "Turn left onto Bay Street." */
  text?: string;
  /** Said ahead of the maneuver. */
  alert?: string;
  /** Said at the maneuver. */
  spoken?: string;
};

export type TravelMode = "walk" | "drive" | "bike";

export type Route = {
  path: Coordinate[];
  cumulative: number[];
  distance: number;
  arrivalDistance: number;
  steps: RouteStep[];
  hasStairs: boolean;
  stairs: boolean[];
  /** Set on street routes from off campus. Campus routes are always walks on the campus paths. */
  travel?: TravelMode;
  /** Travel time in seconds when the router knows it, such as driving at road speeds. */
  duration?: number;
  /** How far along a trip from off campus picks up the campus paths, which it follows from there. */
  campusFrom?: number;
  /** The lot a drive parks in before the walk, or null when the driver chose to drive right up instead. */
  parkAt?: string | null;
};

/** A point on the walkway someone is on, found by matching their position to the nearest path. */
export type WalkwayMatch = { a: number; b: number; edge: number; point: Coordinate; distance: number; stairs: boolean };

export type RouteOptions = {
  avoidStairs: boolean;
  /** The way the walker is heading. Turning back costs a little extra, so the route keeps going their way. */
  heading?: number;
  /** Start from this walkway instead of the nearest step-free one, such as a staircase they chose to take. */
  start?: WalkwayMatch;
};

const MAX_SNAP_METERS = 250;
// A staircase only counts as where someone is when it is clearly closer than the step-free path beside it.
const STAIRS_CLEARLY_CLOSER_METERS = 6;
const U_TURN_METERS = 25;
// A building can be entered from any walkway beside it, within this much of the nearest one.
const GOAL_SIDE_METERS = 40;
const MAX_GOALS = 12;
// Between two ways in, a closer one wins a near tie, but a much shorter walk always wins.
const GOAL_SIDE_WEIGHT = 0.5;
// A building's door counts as a way in when a walkway passes this close to it.
const DOOR_SNAP_METERS = 15;
const BEHIND_DEGREES = 100;
const TURN_LOOK_METERS = 12;
const DEPART_LOOK_METERS = 35;
const MIN_TURN_DEGREES = 32;
const MIN_STEP_METERS = 8;

// Edge kinds from scripts/build-walk-graph.mjs, and how much longer each counts than it is when choosing a route.
const EDGE_STEPS = 1;
// A link is a short step across between two ways the map never joined, such as a sidewalk and its road.
const KIND_COST = [1, 1, 1.6, 2.5, 1.8];
// The walkway route is used while its extra walk stays within 12% of the shortest, at least 40 m and at most 100 m.
const WALKWAY_DETOUR_SHARE = 0.12;
const WALKWAY_DETOUR_MIN_METERS = 40;
const WALKWAY_DETOUR_MAX_METERS = 100;

export function parseGraph(raw: RawWalkGraph): WalkGraph {
  if ((raw.version !== 1 && raw.version !== 2) || raw.nodes.length % 2 !== 0 || raw.edges.length % 3 !== 0) {
    throw new Error("Unsupported walk graph");
  }

  const nodeCount = raw.nodes.length / 2;
  const lat = new Float64Array(nodeCount);
  const lng = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    lat[i] = (raw.nodes[i * 2] + raw.baseLat) / raw.scale;
    lng[i] = (raw.nodes[i * 2 + 1] + raw.baseLng) / raw.scale;
  }

  const edgeCount = raw.edges.length / 3;
  const edgeA = new Int32Array(edgeCount);
  const edgeB = new Int32Array(edgeCount);
  const edgeStairs = new Uint8Array(edgeCount);
  const edgeCost = new Float64Array(edgeCount);
  const degree = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e++) {
    const a = raw.edges[e * 3];
    const b = raw.edges[e * 3 + 1];
    if (a >= nodeCount || b >= nodeCount) throw new Error("Walk graph edge out of range");
    edgeA[e] = a;
    edgeB[e] = b;
    // Version 1 only marked stairs with a 1; anything else was a plain walkway.
    const kind = raw.version === 1 ? (raw.edges[e * 3 + 2] ? EDGE_STEPS : 0) : raw.edges[e * 3 + 2];
    edgeStairs[e] = kind === EDGE_STEPS ? 1 : 0;
    edgeCost[e] = KIND_COST[kind] ?? KIND_COST[KIND_COST.length - 1];
    degree[a + 1]++;
    degree[b + 1]++;
  }

  const offsets = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i] + degree[i + 1];

  const cursor = offsets.slice(0, nodeCount);
  const targets = new Int32Array(edgeCount * 2);
  const lengths = new Float64Array(edgeCount * 2);
  const costs = new Float64Array(edgeCount * 2);
  const stairs = new Uint8Array(edgeCount * 2);
  for (let e = 0; e < edgeCount; e++) {
    const a = edgeA[e];
    const b = edgeB[e];
    const length = distanceMeters({ latitude: lat[a], longitude: lng[a] }, { latitude: lat[b], longitude: lng[b] });
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const slot = cursor[from]++;
      targets[slot] = to;
      lengths[slot] = length;
      costs[slot] = length * edgeCost[e];
      stairs[slot] = edgeStairs[e];
    }
  }

  return { lat, lng, offsets, targets, lengths, costs, stairs, edgeA, edgeB, edgeStairs };
}

const nodeCoord = (g: WalkGraph, i: number): Coordinate => ({ latitude: g.lat[i], longitude: g.lng[i] });

function snapToGraph(g: WalkGraph, p: Coordinate, avoidStairs: boolean): WalkwayMatch | undefined {
  let best: WalkwayMatch | undefined;
  for (let e = 0; e < g.edgeA.length; e++) {
    if (avoidStairs && g.edgeStairs[e]) continue;
    const a = g.edgeA[e];
    const b = g.edgeB[e];
    const hit = projectOntoSegment(p, nodeCoord(g, a), nodeCoord(g, b));
    if (!best || hit.distance < best.distance) {
      best = { a, b, edge: e, point: hit.point, distance: hit.distance, stairs: g.edgeStairs[e] === 1 };
    }
  }
  return best && best.distance <= MAX_SNAP_METERS ? best : undefined;
}

/** Where a route may finish: a walkway point, the spot past it the route ends at, and what finishing there costs extra. */
type Goal = WalkwayMatch & { end: Coordinate; extra: number; reach: number };

// Every walkway reaching the destination within GOAL_SIDE_METERS, so the route uses the shortest side,
// and for a building the walkway at each of its doors, so the route ends at whichever door is nearest.
function snapGoals(g: WalkGraph, p: Coordinate, avoidStairs: boolean): Goal[] {
  const building = buildingAt(p);
  const goals: Goal[] = sideGoals(g, p, avoidStairs, building);
  for (const door of building ? buildingDoors(g, building) : []) {
    const hit = snapToGraph(g, door, avoidStairs);
    if (hit && hit.distance <= DOOR_SNAP_METERS) goals.push({ ...hit, end: door, extra: 0, reach: distanceMeters(hit.point, p) });
  }
  return goals;
}

function sideGoals(g: WalkGraph, p: Coordinate, avoidStairs: boolean, building: string | null): Goal[] {
  let hits: WalkwayMatch[] = [];
  for (let e = 0; e < g.edgeA.length; e++) {
    if (avoidStairs && g.edgeStairs[e]) continue;
    const a = g.edgeA[e];
    const b = g.edgeB[e];
    const hit = projectOntoSegment(p, nodeCoord(g, a), nodeCoord(g, b));
    if (hit.distance <= MAX_SNAP_METERS) {
      hits.push({ a, b, edge: e, point: hit.point, distance: hit.distance, stairs: g.edgeStairs[e] === 1 });
    }
  }
  if (hits.length === 0) return [];
  // A building's pin is its front door, so a walkway behind the building is no way in: the last steps would go through its walls.
  if (building) {
    const clear = hits.filter((hit) => !crossesBuilding(building, hit.point, p));
    if (clear.length > 0) hits = clear;
  }
  hits.sort((x, y) => x.distance - y.distance);
  const nearest = hits[0].distance;
  return hits
    .filter((hit) => hit.distance <= nearest + GOAL_SIDE_METERS)
    .slice(0, MAX_GOALS)
    // A side far from the building loses ties.
    .map((hit) => ({ ...hit, end: p, extra: (hit.distance - nearest) * GOAL_SIDE_WEIGHT, reach: hit.distance }));
}

/** The walkway someone is actually on, stairs included. */
export function matchWalkway(g: WalkGraph, p: Coordinate, { avoidStairs }: { avoidStairs: boolean }) {
  const nearest = snapToGraph(g, p, false);
  if (!nearest || !nearest.stairs || !avoidStairs) return nearest;
  const stepFree = snapToGraph(g, p, true);
  if (stepFree && stepFree.distance - nearest.distance < STAIRS_CLEARLY_CLOSER_METERS) return stepFree;
  return nearest;
}

class MinHeap {
  private keys: number[] = [];
  private priorities: number[] = [];

  get size() {
    return this.keys.length;
  }

  push(key: number, priority: number) {
    const keys = this.keys;
    const pr = this.priorities;
    let i = keys.length;
    keys.push(key);
    pr.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= priority) break;
      keys[i] = keys[parent];
      pr[i] = pr[parent];
      i = parent;
    }
    keys[i] = key;
    pr[i] = priority;
  }

  pop(): number {
    const keys = this.keys;
    const pr = this.priorities;
    const top = keys[0];
    const lastKey = keys.pop()!;
    const lastPr = pr.pop()!;
    if (keys.length > 0) {
      let i = 0;
      const n = keys.length;
      while (true) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const child = r < n && pr[r] < pr[l] ? r : l;
        if (pr[child] >= lastPr) break;
        keys[i] = keys[child];
        pr[i] = pr[child];
        i = child;
      }
      keys[i] = lastKey;
      pr[i] = lastPr;
    }
    return top;
  }
}

export function findRoute(g: WalkGraph, from: Coordinate, to: Coordinate, options: RouteOptions): Route | null {
  const preferred = searchRoute(g, from, to, options, g.costs);
  const shortest = searchRoute(g, from, to, options, g.lengths);
  if (!preferred || !shortest) return preferred ?? shortest;
  const allowance = Math.min(
    WALKWAY_DETOUR_MAX_METERS,
    Math.max(WALKWAY_DETOUR_MIN_METERS, shortest.distance * WALKWAY_DETOUR_SHARE),
  );
  return preferred.distance <= shortest.distance + allowance ? preferred : shortest;
}

function searchRoute(
  g: WalkGraph,
  from: Coordinate,
  to: Coordinate,
  { avoidStairs, heading, start: startOn }: RouteOptions,
  weights: Float64Array,
): Route | null {
  const start = startOn ?? snapToGraph(g, from, avoidStairs);
  const goals = snapGoals(g, to, avoidStairs);
  if (!start || goals.length === 0) return null;
  const farthestGoal = Math.max(...goals.map((goal) => goal.reach));

  // Someone partway down a staircase has to finish it, and long ones are several stair segments in a row.
  const flight = avoidStairs && start.stairs ? stairFlight(g, start) : undefined;

  const nodeCount = g.lat.length;
  const goalNode = nodeCount;
  const cost = new Float64Array(nodeCount + 1).fill(Infinity);
  const previous = new Int32Array(nodeCount + 1).fill(-1);
  const closed = new Uint8Array(nodeCount + 1);
  const heap = new MinHeap();
  // Every way in lies within farthestGoal of the destination, so this never overestimates.
  const heuristic = (i: number) =>
    i === goalNode ? 0 : Math.max(0, distanceMeters(nodeCoord(g, i), to) - farthestGoal);

  // The cheapest way in reachable from a node, and which one it is.
  let chosen = -1;
  const goalCost = (i: number): [number, number] => {
    let best = Infinity;
    let which = -1;
    goals.forEach((goal, k) => {
      if (i !== goal.a && i !== goal.b) return;
      const c = distanceMeters(nodeCoord(g, i), goal.point) + goal.extra;
      if (c < best) {
        best = c;
        which = k;
      }
    });
    return [best, which];
  };

  // Someone who took a shortcut should be led on from where they are heading, not turned around to save a few steps.
  const turnBack = (node: number) => {
    const at = nodeCoord(g, node);
    if (heading === undefined || distanceMeters(start.point, at) < 1) return 0;
    return Math.abs(turnAngle(heading, bearingDegrees(start.point, at))) > BEHIND_DEGREES ? U_TURN_METERS : 0;
  };
  const startLinks: Array<[number, number]> = [
    [start.a, distanceMeters(start.point, nodeCoord(g, start.a)) + turnBack(start.a)],
    [start.b, distanceMeters(start.point, nodeCoord(g, start.b)) + turnBack(start.b)],
  ];
  for (const [node, d] of startLinks) {
    if (d < cost[node]) {
      cost[node] = d;
      heap.push(node, d + heuristic(node));
    }
  }

  goals.forEach((goal, k) => {
    const sameEdge = (start.a === goal.a && start.b === goal.b) || (start.a === goal.b && start.b === goal.a);
    if (!sameEdge) return;
    const c = distanceMeters(start.point, goal.point) + goal.extra;
    if (c < cost[goalNode]) {
      cost[goalNode] = c;
      chosen = k;
      heap.push(goalNode, c);
    }
  });

  while (heap.size > 0) {
    const node = heap.pop();
    if (closed[node]) continue;
    closed[node] = 1;
    if (node === goalNode) break;

    const [toGoal, which] = goalCost(node);
    if (toGoal !== Infinity && cost[node] + toGoal < cost[goalNode]) {
      cost[goalNode] = cost[node] + toGoal;
      previous[goalNode] = node;
      chosen = which;
      heap.push(goalNode, cost[goalNode]);
    }

    for (let slot = g.offsets[node]; slot < g.offsets[node + 1]; slot++) {
      const next = g.targets[slot];
      if (avoidStairs && g.stairs[slot] && !(flight?.has(node) && flight.has(next))) continue;
      if (closed[next]) continue;
      const candidate = cost[node] + weights[slot];
      if (candidate < cost[next]) {
        cost[next] = candidate;
        previous[next] = node;
        heap.push(next, candidate + heuristic(next));
      }
    }
  }

  if (cost[goalNode] === Infinity || chosen === -1) return null;
  const goal = goals[chosen];

  const nodes: number[] = [];
  for (let at = previous[goalNode]; at !== -1; at = previous[at]) nodes.push(at);
  nodes.reverse();

  const path: Coordinate[] = [from, start.point, ...nodes.map((i) => nodeCoord(g, i)), goal.point, goal.end];
  // A flag at index k marks the edge that ends at path[k]; graph node j lives at index j + 2.
  const goalIndex = 2 + nodes.length;
  const stairFlags = path.map((_, k) => {
    if (k === goalIndex) return goal.stairs;
    if (k === 2) return start.stairs;
    return k >= 3 && k < goalIndex && isStairsEdge(g, nodes[k - 3], nodes[k - 2]);
  });

  return buildRoute(g, dedupe(path, stairFlags), distanceMeters(goal.point, goal.end));
}

// Stair nodes from the staircase someone is on to the nearest step-free exit each way.
function stairFlight(g: WalkGraph, start: WalkwayMatch): Set<number> {
  const hasStepFreeExit = (n: number) => {
    for (let slot = g.offsets[n]; slot < g.offsets[n + 1]; slot++) if (!g.stairs[slot]) return true;
    return false;
  };
  const flight = new Set([start.a, start.b]);
  const queue = [start.a, start.b];
  while (queue.length > 0) {
    const n = queue.pop()!;
    if (hasStepFreeExit(n)) continue;
    for (let slot = g.offsets[n]; slot < g.offsets[n + 1]; slot++) {
      const next = g.targets[slot];
      if (!g.stairs[slot] || flight.has(next)) continue;
      flight.add(next);
      queue.push(next);
    }
  }
  return flight;
}

function isStairsEdge(g: WalkGraph, a: number, b: number): boolean {
  for (let slot = g.offsets[a]; slot < g.offsets[a + 1]; slot++) {
    if (g.targets[slot] === b) return g.stairs[slot] === 1;
  }
  return false;
}

function dedupe(path: Coordinate[], stairFlags: boolean[]) {
  const points: Coordinate[] = [];
  const stairs: boolean[] = [];
  path.forEach((point, i) => {
    const last = points[points.length - 1];
    if (last && distanceMeters(last, point) < 0.5) {
      stairs[stairs.length - 1] ||= stairFlags[i];
      return;
    }
    points.push(point);
    stairs.push(stairFlags[i]);
  });
  return { points, stairs };
}

function pointAtDistance(path: Coordinate[], cumulative: number[], target: number): Coordinate {
  const d = Math.max(0, Math.min(cumulative[cumulative.length - 1], target));
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < d) i++;
  const span = cumulative[i] - cumulative[i - 1];
  return interpolate(path[i - 1], path[i], span === 0 ? 0 : (d - cumulative[i - 1]) / span);
}

function classifyTurn(angle: number): TurnDirection {
  const magnitude = Math.abs(angle);
  if (magnitude < MIN_TURN_DEGREES) return "straight";
  const side = angle > 0 ? "right" : "left";
  if (magnitude < 60) return `slight-${side}`;
  if (magnitude < 140) return side;
  return `sharp-${side}`;
}

const intersectionCache = new WeakMap<WalkGraph, Set<string>>();

function intersectionsOf(g: WalkGraph) {
  let keys = intersectionCache.get(g);
  if (!keys) {
    keys = new Set();
    for (let node = 0; node < g.lat.length; node++) {
      if (g.offsets[node + 1] - g.offsets[node] >= 3) keys.add(`${g.lat[node]},${g.lng[node]}`);
    }
    intersectionCache.set(g, keys);
  }
  return keys;
}

function buildRoute(
  g: WalkGraph,
  { points, stairs }: { points: Coordinate[]; stairs: boolean[] },
  approachMeters: number,
): Route {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
  const total = cumulative[cumulative.length - 1];

  const intersections = intersectionsOf(g);

  const steps: RouteStep[] = [];
  const firstAhead = pointAtDistance(points, cumulative, Math.min(total, DEPART_LOOK_METERS));
  steps.push({ kind: "depart", bearing: bearingDegrees(points[0], firstAhead), startDistance: 0, length: 0 });

  let inStairs = false;
  for (let i = 1; i < points.length - 1; i++) {
    const at = cumulative[i];
    const last = steps[steps.length - 1];

    if (stairs[i] && !inStairs) {
      inStairs = true;
      steps.push({ kind: "stairs", startDistance: at, length: 0 });
      continue;
    }
    if (!stairs[i]) inStairs = false;
    if (inStairs || at - last.startDistance < MIN_STEP_METERS || total - at < MIN_STEP_METERS) continue;

    const behind = pointAtDistance(points, cumulative, at - TURN_LOOK_METERS);
    const ahead = pointAtDistance(points, cumulative, at + TURN_LOOK_METERS);
    const angle = turnAngle(bearingDegrees(behind, points[i]), bearingDegrees(points[i], ahead));
    const isIntersection = intersections.has(`${points[i].latitude},${points[i].longitude}`);
    const direction = classifyTurn(angle);

    if (direction !== "straight" && (isIntersection || Math.abs(angle) >= 70)) {
      steps.push({ kind: "turn", direction, startDistance: at, length: 0 });
    }
  }

  steps.push({ kind: "arrive", startDistance: total, length: 0 });
  for (let i = 0; i < steps.length - 1; i++) steps[i].length = steps[i + 1].startDistance - steps[i].startDistance;

  return {
    path: points,
    cumulative,
    distance: total,
    arrivalDistance: Math.max(0, total - approachMeters),
    steps,
    hasStairs: stairs.some(Boolean),
    stairs,
  };
}

export type RouteProgress = {
  point: Coordinate;
  distanceAlong: number;
  distanceFromRoute: number;
  remaining: number;
  stepIndex: number;
  segmentIndex: number;
};

export function trackProgress(route: Route, position: Coordinate, hintSegment = 0): RouteProgress {
  let best = { segment: 1, distance: Infinity, along: 0, point: route.path[0] };
  const from = Math.max(1, hintSegment - 5);
  const scan = (lo: number, hi: number) => {
    for (let i = lo; i < hi; i++) {
      const hit = projectOntoSegment(position, route.path[i - 1], route.path[i]);
      if (hit.distance < best.distance) {
        best = {
          segment: i,
          distance: hit.distance,
          along: route.cumulative[i - 1] + (route.cumulative[i] - route.cumulative[i - 1]) * hit.t,
          point: hit.point,
        };
      }
    }
  };
  scan(from, route.path.length);
  if (best.distance > 30) scan(1, from);

  let stepIndex = 0;
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i].startDistance <= best.along + 3) stepIndex = i;
  }

  return {
    point: best.point,
    distanceAlong: best.along,
    distanceFromRoute: best.distance,
    remaining: Math.max(0, route.distance - best.along),
    stepIndex,
    segmentIndex: best.segment,
  };
}

/** Where someone would be after covering this much of the route. */
export function progressAtDistance(route: Route, meters: number): RouteProgress {
  const along = Math.max(0, Math.min(route.distance, meters));
  let segment = 1;
  while (segment < route.path.length - 1 && route.cumulative[segment] < along) segment++;
  const span = route.cumulative[segment] - route.cumulative[segment - 1];
  const t = span === 0 ? 0 : (along - route.cumulative[segment - 1]) / span;

  let stepIndex = 0;
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i].startDistance <= along + 3) stepIndex = i;
  }

  return {
    point: interpolate(route.path[segment - 1], route.path[segment], t),
    distanceAlong: along,
    distanceFromRoute: 0,
    remaining: Math.max(0, route.distance - along),
    stepIndex,
    segmentIndex: segment,
  };
}

export function remainingPath(route: Route, progress: RouteProgress): Coordinate[] {
  return [progress.point, ...route.path.slice(progress.segmentIndex)];
}

// Two routes this close the whole way are the same streets and paths; campus paths beside each other sit 10 m or more apart.
const SAME_WAY_METERS = 8;
const SAME_WAY_SPACING_METERS = 20;
// Only the stretch ahead is compared, so a long walk from off campus costs no more to check than one across campus.
const SAME_WAY_AHEAD_METERS = 800;
const SAME_WAY_SLACK_METERS = 200;

function samplesAhead(route: Route, from: number): Coordinate[] {
  const left = Math.min(route.distance - from, SAME_WAY_AHEAD_METERS);
  const count = Math.max(1, Math.ceil(left / SAME_WAY_SPACING_METERS));
  return Array.from({ length: count + 1 }, (_, i) => progressAtDistance(route, from + (left * i) / count).point);
}

// How far a point is from the part of a route between two distances along it.
function distanceToStretch(route: Route, point: Coordinate, from: number, to: number): number {
  let nearest = Infinity;
  for (let i = 1; i < route.path.length; i++) {
    if (route.cumulative[i] < from) continue;
    if (route.cumulative[i - 1] > to) break;
    nearest = Math.min(nearest, projectOntoSegment(point, route.path[i - 1], route.path[i]).distance);
  }
  return nearest;
}

/** Whether route a, the one being taken, leads the same way on as route b, so keeping b around changes nothing. */
export function sameWayAhead(a: Route, onA: RouteProgress, b: Route, onB: RouteProgress): boolean {
  // The stretch of a that only leads someone back onto b, about as long as they are off it, does not count.
  const skip = Math.min(onA.remaining, onB.distanceFromRoute + SAME_WAY_METERS);
  const aLeft = onA.remaining - skip;
  if (Math.abs(aLeft - onB.remaining) > Math.max(30, Math.max(aLeft, onB.remaining) * 0.1)) return false;
  const along = (route: Route, from: number, points: Coordinate[]) => {
    const to = from + SAME_WAY_AHEAD_METERS + SAME_WAY_SLACK_METERS;
    return points.every((point) => distanceToStretch(route, point, from - SAME_WAY_SLACK_METERS, to) <= SAME_WAY_METERS);
  };
  return (
    along(b, onB.distanceAlong, samplesAhead(a, onA.distanceAlong + skip)) &&
    along(a, onA.distanceAlong, samplesAhead(b, onB.distanceAlong))
  );
}

/** A street route as far as `cutIndex` on its path, then a campus walk starting from that point, as one trip. */
export function joinRoutes(
  street: Route,
  cutIndex: number,
  campus: Route,
  { handoff, campusSpeed }: { handoff?: Pick<RouteStep, "text" | "alert" | "spoken">; campusSpeed: number },
): Route {
  const cut = street.cumulative[cutIndex];
  const path = [...street.path.slice(0, cutIndex + 1), ...campus.path.slice(1)];
  const cumulative = [...street.cumulative.slice(0, cutIndex + 1), ...campus.cumulative.slice(1).map((d) => d + cut)];
  const stairs = [...street.stairs.slice(0, cutIndex + 1), ...campus.stairs.slice(1)];
  const distance = cumulative[cumulative.length - 1];

  const steps: RouteStep[] = street.steps
    .filter((step, i) => i === 0 || (step.kind !== "arrive" && step.startDistance < cut - MIN_STEP_METERS))
    .map((step) => ({ ...step }));
  const comingIn = bearingDegrees(pointAtDistance(path, cumulative, cut - TURN_LOOK_METERS), path[cutIndex]);
  const direction = classifyTurn(turnAngle(comingIn, campus.steps[0].bearing ?? comingIn));
  if (handoff || direction !== "straight") steps.push({ kind: "turn", direction, startDistance: cut, length: 0, ...handoff });
  for (const step of campus.steps.slice(1)) steps.push({ ...step, startDistance: step.startDistance + cut });
  for (let i = 0; i < steps.length - 1; i++) steps[i].length = Math.max(0, steps[i + 1].startDistance - steps[i].startDistance);

  return {
    path,
    cumulative,
    distance,
    arrivalDistance: cut + campus.arrivalDistance,
    steps,
    hasStairs: stairs.some(Boolean) || steps.some((step) => step.kind === "stairs"),
    stairs,
    travel: street.travel,
    duration:
      street.duration === undefined ? undefined : street.duration * (cut / Math.max(1, street.distance)) + campus.distance / campusSpeed,
    campusFrom: cut,
  };
}

const ON_ROUTE_METERS = 15;

/** Walks the user to the nearest point of a route they picked, then follows that route to its end. */
export function routeVia(g: WalkGraph, from: Coordinate, via: Route, options: RouteOptions): Route | null {
  const joined = trackProgress(via, from);
  const rest = via.path.slice(joined.segmentIndex);
  const restStairs = via.stairs.slice(joined.segmentIndex);
  const approach = via.distance - via.arrivalDistance;

  if (joined.distanceFromRoute <= ON_ROUTE_METERS) {
    return buildRoute(g, dedupe([from, joined.point, ...rest], [false, false, ...restStairs]), approach);
  }

  const connector = findRoute(g, from, joined.point, options);
  if (!connector) return null;
  const points = [...connector.path, ...rest];
  const stairFlags = [...connector.stairs, ...restStairs];
  return buildRoute(g, dedupe(points, stairFlags), approach);
}
