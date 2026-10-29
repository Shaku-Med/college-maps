// Pins the evacuation maps in campus/indoor-plans.json and the room models in campus/indoor-rooms.json onto their buildings
// and writes src/data/indoor.json; rerun after editing either.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, readCampus } from "./lib/campus.mjs";

const SOURCE = join(APP_DIR, "campus", "indoor-plans.json");
const ROOMS_SOURCE = join(APP_DIR, "campus", "indoor-rooms.json");
const OUT = join(APP_DIR, "src", "data", "indoor.json");
const PLAN_WIDTH = 1600;
const PLAN_HEIGHT = 1200;
// An anchor this far from where the fit puts it is a typo, not the drawing being a little off.
const MAX_ANCHOR_METERS = 1.5;
// Stairs and elevators stack; if two floors draw one further apart than this, one drawing is wrong and the lowest floor wins.
const STACK_METERS = 2.5;
const KINDS = new Set(["exit", "entrance", "stair", "elevator", "aed", "chair", "assembly"]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9 .'-]{0,39}$/;
const ROOM = /^\d{3,4}[A-Z]?$/;
// Restrooms on different floors this close are one stack, shown once where the ground floor has it.
const SAME_RESTROOM_METERS = 6;

const fail = (message) => {
  console.error(`indoor-plans.json: ${message}`);
  process.exit(1);
};

const isPixel = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= PLAN_WIDTH && y <= PLAN_HEIGHT;

function readPlans(buildings) {
  const source = JSON.parse(readFileSync(SOURCE, "utf8"));
  if (!Array.isArray(source?.plans) || source.plans.length === 0) fail("needs a plans array");
  const seen = new Set();
  return source.plans.map((plan, i) => {
    const at = `plans[${i}]`;
    if (!buildings.has(plan.building)) fail(`${at}.building ${JSON.stringify(plan.building)} is not a building in campus.json`);
    if (!Number.isInteger(plan.floor) || plan.floor < -3 || plan.floor > 20) fail(`${at}.floor must be a whole number from -3 to 20`);
    const key = `${plan.building} floor ${plan.floor}`;
    if (seen.has(key)) fail(`${key} is listed twice`);
    seen.add(key);
    if (!Array.isArray(plan.anchors) || plan.anchors.length < 4) fail(`${at} needs at least 4 anchors`);
    for (const [j, a] of plan.anchors.entries()) {
      const ok = Array.isArray(a) && a.length === 4 && isPixel(a[0], a[1]) && Math.abs(a[2]) <= 90 && Math.abs(a[3]) <= 180;
      if (!ok) fail(`${at}.anchors[${j}] must be [x, y, latitude, longitude] with x, y on the plan`);
    }
    if (!Array.isArray(plan.features)) fail(`${at}.features must be an array`);
    for (const [j, f] of plan.features.entries()) {
      const ok = Array.isArray(f) && (f.length === 3 || f.length === 4) && KINDS.has(f[0]) && isPixel(f[1], f[2]);
      if (!ok || (f.length === 4 && (typeof f[3] !== "string" || !NAME.test(f[3])))) {
        fail(`${at}.features[${j}] must be [kind, x, y] or [kind, x, y, name] with kind one of ${[...KINDS].join(", ")}`);
      }
      if ((f[0] === "stair" || f[0] === "exit") && f.length !== 4) fail(`${at}.features[${j}]: every ${f[0]} needs a name`);
    }
    return { ...plan, key };
  });
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// A photo of a flat wall map is a perspective view of it, so a least squares homography maps plan pixels onto meters.
function fitHomography(pairs) {
  const s = PLAN_WIDTH;
  const rows = [];
  const rhs = [];
  for (const { px: [x0, y0], m: [X, Y] } of pairs) {
    const x = x0 / s;
    const y = y0 / s;
    rows.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    rhs.push(X);
    rows.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    rhs.push(Y);
  }
  const AtA = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => rows.reduce((a, r) => a + r[i] * r[j], 0)));
  const Atb = Array.from({ length: 8 }, (_, i) => rows.reduce((a, r, k) => a + r[i] * rhs[k], 0));
  const h = solve(AtA, Atb);
  if (!h) return null;
  return ([px, py]) => {
    const x = px / s;
    const y = py / s;
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };
}

function frameFor(anchors) {
  const lat0 = anchors.reduce((a, p) => a + p[2], 0) / anchors.length;
  const lng0 = anchors.reduce((a, p) => a + p[3], 0) / anchors.length;
  const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const my = 110_540;
  return {
    toM: (lat, lng) => [(lng - lng0) * mx, (lat - lat0) * my],
    toLL: ([x, y]) => ({ latitude: lat0 + y / my, longitude: lng0 + x / mx }),
  };
}

const round = ({ latitude, longitude }) => ({ latitude: +latitude.toFixed(6), longitude: +longitude.toFixed(6) });

const meters = (a, b) => {
  const mx = 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot((a.longitude - b.longitude) * mx, (a.latitude - b.latitude) * 110_540);
};

const mean = (points) => ({
  latitude: points.reduce((a, p) => a + p.latitude, 0) / points.length,
  longitude: points.reduce((a, p) => a + p.longitude, 0) / points.length,
});

const campus = readCampus();
const plans = readPlans(new Set(campus.places.filter((p) => p.isBuilding).map((p) => p.id)));
const warnings = [];
const placed = [];

for (const plan of plans) {
  const frame = frameFor(plan.anchors);
  const toM = fitHomography(plan.anchors.map(([x, y, lat, lng]) => ({ px: [x, y], m: frame.toM(lat, lng) })));
  if (!toM) fail(`${plan.key}: the anchors do not pin the plan down; spread them over the building`);
  for (const [j, [x, y, lat, lng]] of plan.anchors.entries()) {
    const [X, Y] = toM([x, y]);
    const [ax, ay] = frame.toM(lat, lng);
    const off = Math.hypot(X - ax, Y - ay);
    if (off > MAX_ANCHOR_METERS) fail(`${plan.key}: anchor ${j} lands ${off.toFixed(1)} m from its corner; check its pixels`);
  }
  for (const [kind, x, y, name] of plan.features) {
    placed.push({ building: plan.building, floor: plan.floor, kind, name: name ?? "", at: frame.toLL(toM([x, y])) });
  }
}

const indoor = {};
for (const building of [...new Set(plans.map((p) => p.building))].sort()) {
  const here = placed.filter((p) => p.building === building);
  const of = (kind) => here.filter((p) => p.kind === kind);
  const stacked = (kind) => {
    const groups = new Map();
    for (const p of of(kind)) {
      const group = groups.get(p.name) ?? [];
      if (group.some((q) => q.floor === p.floor)) fail(`${building} floor ${p.floor} has two ${kind}s named ${JSON.stringify(p.name)}`);
      groups.set(p.name, [...group, p]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) => {
      const center = mean(group.map((p) => p.at));
      const spread = Math.max(...group.map((p) => meters(p.at, center)));
      const lowest = group.reduce((a, p) => (p.floor < a.floor ? p : a));
      if (spread * 2 > STACK_METERS) {
        warnings.push(`${building} ${kind} ${name || "(unnamed)"}: floors disagree by ${(spread * 2).toFixed(1)} m, using floor ${lowest.floor}`);
      }
      const at = spread * 2 > STACK_METERS ? lowest.at : center;
      return { ...(name ? { name } : {}), floors: group.map((p) => p.floor).sort((a, b) => a - b), ...round(at) };
    });
  };
  const perFloor = (kind) => of(kind).map((p) => ({ ...(p.name ? { name: p.name } : {}), floor: p.floor, ...round(p.at) }));
  const assembly = of("assembly");
  indoor[building] = {
    floors: plans.filter((p) => p.building === building).map((p) => p.floor).sort((a, b) => a - b),
    ...(assembly.length ? { assembly: round(mean(assembly.map((p) => p.at))) } : {}),
    exits: perFloor("exit"),
    entrances: perFloor("entrance"),
    stairs: stacked("stair"),
    elevators: stacked("elevator"),
    aeds: perFloor("aed"),
    evacuationChairs: perFloor("chair"),
  };
}

function readRooms(buildings) {
  let source;
  try {
    source = JSON.parse(readFileSync(ROOMS_SOURCE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const failRooms = (message) => {
    console.error(`indoor-rooms.json: ${message}`);
    process.exit(1);
  };
  const isNumber = (value) => Number.isFinite(value) && Math.abs(value) < 10_000;
  const isFloor = (value) => Number.isInteger(value) && value >= -3 && value <= 20;
  for (const [id, model] of Object.entries(source?.buildings ?? {})) {
    if (!buildings.has(id)) failRooms(`${id} is not a building in campus.json`);
    const anchorSets = [["anchors", model.anchors], ...Object.entries(model.floorAnchors ?? {}).map(([floor, set]) => [`floorAnchors ${floor}`, set])];
    for (const [label, set] of anchorSets) {
      if (!Array.isArray(set) || set.length < 3) failRooms(`${id} ${label} needs at least 3 anchors`);
      for (const a of set) {
        if (!Array.isArray(a) || a.length !== 4 || !a.every(isNumber)) failRooms(`${id} ${label} must be [x, z, latitude, longitude]`);
      }
    }
    for (const floor of Object.keys(model.floorAnchors ?? {})) {
      if (!isFloor(Number(floor)) || String(Number(floor)) !== floor) failRooms(`${id} floorAnchors keys must be floor numbers`);
    }
    const names = new Set();
    for (const r of model.rooms ?? []) {
      const ok = Array.isArray(r) && r.length === 4 && typeof r[0] === "string" && ROOM.test(r[0]) && isFloor(r[1]) && isNumber(r[2]) && isNumber(r[3]);
      if (!ok) failRooms(`${id} rooms must be [number, floor, x, z], like ["101", 1, 0.2, -1.3]`);
      if (names.has(r[0])) failRooms(`${id} room ${r[0]} is listed twice`);
      names.add(r[0]);
    }
    for (const r of model.restrooms ?? []) {
      if (!Array.isArray(r) || r.length !== 3 || !isFloor(r[0]) || !isNumber(r[1]) || !isNumber(r[2])) failRooms(`${id} restrooms must be [floor, x, z]`);
    }
  }
  return source?.buildings ?? {};
}

// Models are drawn to scale, only turned and stretched, so a least squares affine fit maps model x, z onto meters.
function fitAffine(pairs) {
  const normal = Array.from({ length: 3 }, () => [0, 0, 0]);
  const rhsX = [0, 0, 0];
  const rhsY = [0, 0, 0];
  for (const { model: [x, z], m: [X, Y] } of pairs) {
    const row = [x, z, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) normal[i][j] += row[i] * row[j];
      rhsX[i] += row[i] * X;
      rhsY[i] += row[i] * Y;
    }
  }
  const a = solve(normal, rhsX);
  const b = solve(normal, rhsY);
  if (!a || !b) return null;
  return ([x, z]) => [a[0] * x + a[1] * z + a[2], b[0] * x + b[1] * z + b[2]];
}

function modelPlacer(building, anchors) {
  const frame = frameFor(anchors);
  const toM = fitAffine(anchors.map(([x, z, lat, lng]) => ({ model: [x, z], m: frame.toM(lat, lng) })));
  if (!toM) fail(`${building} room anchors do not pin the model down; spread them over the building`);
  for (const [j, [x, z, lat, lng]] of anchors.entries()) {
    const [X, Y] = toM([x, z]);
    const [ax, ay] = frame.toM(lat, lng);
    const off = Math.hypot(X - ax, Y - ay);
    if (off > MAX_ANCHOR_METERS) fail(`${building} room anchor ${j} lands ${off.toFixed(1)} m off; check it`);
  }
  return (x, z) => round(frame.toLL(toM([x, z])));
}

for (const [building, model] of Object.entries(readRooms(new Set(campus.places.filter((p) => p.isBuilding).map((p) => p.id))))) {
  const placers = new Map(Object.entries(model.floorAnchors ?? {}).map(([floor, set]) => [Number(floor), modelPlacer(building, set)]));
  const anyFloor = modelPlacer(building, model.anchors);
  const at = (floor, x, z) => (placers.get(floor) ?? anyFloor)(x, z);
  const restrooms = [];
  for (const [floor, x, z] of [...(model.restrooms ?? [])].sort((p, q) => p[0] - q[0])) {
    const point = at(floor, x, z);
    const stack = restrooms.find((r) => meters(r, point) < SAME_RESTROOM_METERS);
    if (stack) stack.floors = [...new Set([...stack.floors, floor])].sort((p, q) => p - q);
    else restrooms.push({ floors: [floor], ...point });
  }
  const rooms = (model.rooms ?? [])
    .map(([name, floor, x, z]) => ({ name, floor, ...at(floor, x, z) }))
    .sort((p, q) => p.name.localeCompare(q.name));
  indoor[building] ??= { floors: [], exits: [], entrances: [], stairs: [], elevators: [], aeds: [], evacuationChairs: [] };
  indoor[building].floors = [...new Set([...indoor[building].floors, ...rooms.map((r) => r.floor)])].sort((p, q) => p - q);
  Object.assign(indoor[building], { rooms, restrooms, ...(model.credit ? { roomCredit: String(model.credit).slice(0, 200) } : {}) });
}
for (const building of Object.values(indoor)) {
  building.rooms ??= [];
  building.restrooms ??= [];
}

const previous = (() => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return "";
  }
})();
const next = `${JSON.stringify(indoor, null, 2)}\n`;
writeFileSync(OUT, next);
for (const [id, b] of Object.entries(indoor)) {
  console.log(`${id}: floors ${b.floors.join(", ")}; ${b.exits.length} exits, ${b.stairs.length} stairs, ${b.elevators.length} elevators, ${b.aeds.length} AEDs, ${b.evacuationChairs.length} evacuation chairs, ${b.rooms.length} rooms, ${b.restrooms.length} restrooms`);
}
for (const w of warnings) console.log(`warning: ${w}`);
console.log(`indoor.json: ${Object.keys(indoor).length} buildings, ${Math.round(next.length / 1024)} KB${previous === next ? " (unchanged)" : ""}`);
