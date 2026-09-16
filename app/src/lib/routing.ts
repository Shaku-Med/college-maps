import type { Coordinate } from "@/data/campus";
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
};

export type Route = {
  path: Coordinate[];
  cumulative: number[];
  distance: number;
  arrivalDistance: number;
  steps: RouteStep[];
  hasStairs: boolean;
  stairs: boolean[];
};

export type RouteOptions = { avoidStairs: boolean };

const MAX_SNAP_METERS = 250;
const TURN_LOOK_METERS = 12;
const DEPART_LOOK_METERS = 35;
const MIN_TURN_DEGREES = 32;
const MIN_STEP_METERS = 8;

export function parseGraph(raw: RawWalkGraph): WalkGraph {
  if (raw.version !== 1 || raw.nodes.length % 2 !== 0 || raw.edges.length % 3 !== 0) {
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
  const degree = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e++) {
    const a = raw.edges[e * 3];
    const b = raw.edges[e * 3 + 1];
    if (a >= nodeCount || b >= nodeCount) throw new Error("Walk graph edge out of range");
    edgeA[e] = a;
    edgeB[e] = b;
    edgeStairs[e] = raw.edges[e * 3 + 2] ? 1 : 0;
    degree[a + 1]++;
    degree[b + 1]++;
  }

  const offsets = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i] + degree[i + 1];

  const cursor = offsets.slice(0, nodeCount);
  const targets = new Int32Array(edgeCount * 2);
  const lengths = new Float64Array(edgeCount * 2);
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
      stairs[slot] = edgeStairs[e];
    }
  }

  return { lat, lng, offsets, targets, lengths, stairs, edgeA, edgeB, edgeStairs };
}

const nodeCoord = (g: WalkGraph, i: number): Coordinate => ({ latitude: g.lat[i], longitude: g.lng[i] });

type Snap = { a: number; b: number; t: number; point: Coordinate; distance: number };

function snapToGraph(g: WalkGraph, p: Coordinate, avoidStairs: boolean): Snap | undefined {
  let best: Snap | undefined;
  for (let e = 0; e < g.edgeA.length; e++) {
    if (avoidStairs && g.edgeStairs[e]) continue;
    const a = g.edgeA[e];
    const b = g.edgeB[e];
    const hit = projectOntoSegment(p, nodeCoord(g, a), nodeCoord(g, b));
    if (!best || hit.distance < best.distance) best = { a, b, t: hit.t, point: hit.point, distance: hit.distance };
  }
  return best && best.distance <= MAX_SNAP_METERS ? best : undefined;
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

export function findRoute(g: WalkGraph, from: Coordinate, to: Coordinate, { avoidStairs }: RouteOptions): Route | null {
  const start = snapToGraph(g, from, avoidStairs);
  const goal = snapToGraph(g, to, avoidStairs);
  if (!start || !goal) return null;

  const nodeCount = g.lat.length;
  const goalNode = nodeCount;
  const cost = new Float64Array(nodeCount + 1).fill(Infinity);
  const previous = new Int32Array(nodeCount + 1).fill(-1);
  const closed = new Uint8Array(nodeCount + 1);
  const heap = new MinHeap();
  const heuristic = (i: number) => (i === goalNode ? 0 : distanceMeters(nodeCoord(g, i), goal.point));

  const goalCost = (i: number) =>
    i === goal.a || i === goal.b ? distanceMeters(nodeCoord(g, i), goal.point) : Infinity;

  const startLinks: Array<[number, number]> = [
    [start.a, distanceMeters(start.point, nodeCoord(g, start.a))],
    [start.b, distanceMeters(start.point, nodeCoord(g, start.b))],
  ];
  for (const [node, d] of startLinks) {
    if (d < cost[node]) {
      cost[node] = d;
      heap.push(node, d + heuristic(node));
    }
  }

  const sameEdge = (start.a === goal.a && start.b === goal.b) || (start.a === goal.b && start.b === goal.a);
  if (sameEdge) {
    cost[goalNode] = distanceMeters(start.point, goal.point);
    heap.push(goalNode, cost[goalNode]);
  }

  while (heap.size > 0) {
    const node = heap.pop();
    if (closed[node]) continue;
    closed[node] = 1;
    if (node === goalNode) break;

    const toGoal = goalCost(node);
    if (toGoal !== Infinity && cost[node] + toGoal < cost[goalNode]) {
      cost[goalNode] = cost[node] + toGoal;
      previous[goalNode] = node;
      heap.push(goalNode, cost[goalNode]);
    }

    for (let slot = g.offsets[node]; slot < g.offsets[node + 1]; slot++) {
      if (avoidStairs && g.stairs[slot]) continue;
      const next = g.targets[slot];
      if (closed[next]) continue;
      const candidate = cost[node] + g.lengths[slot];
      if (candidate < cost[next]) {
        cost[next] = candidate;
        previous[next] = node;
        heap.push(next, candidate + heuristic(next));
      }
    }
  }

  if (cost[goalNode] === Infinity) return null;

  const nodes: number[] = [];
  for (let at = previous[goalNode]; at !== -1; at = previous[at]) nodes.push(at);
  nodes.reverse();

  const path: Coordinate[] = [from, start.point, ...nodes.map((i) => nodeCoord(g, i)), goal.point, to];
  // A flag at index k marks the edge that ends at path[k]; graph node j lives at index j + 2.
  const stairFlags = path.map((_, k) => k >= 3 && k < 2 + nodes.length && isStairsEdge(g, nodes[k - 3], nodes[k - 2]));

  return buildRoute(g, dedupe(path, stairFlags), distanceMeters(goal.point, to));
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

export function remainingPath(route: Route, progress: RouteProgress): Coordinate[] {
  return [progress.point, ...route.path.slice(progress.segmentIndex)];
}

const ON_ROUTE_METERS = 15;

/**
 * Walks the user to the nearest point of a route they picked, then follows that route to its end.
 * Used when someone taps their earlier route instead of the one they were re-routed onto.
 */
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
