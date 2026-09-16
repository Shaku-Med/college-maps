// Builds src/data/walk-graph.json from OpenStreetMap paths inside campus.json map.walkingArea.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, fetchOverpass, overpassBox, readCampus } from "./lib/campus.mjs";

const AREA = readCampus().map.walkingArea;
const HIGHWAYS =
  "footway|path|pedestrian|steps|service|residential|unclassified|tertiary|secondary|living_street|track|corridor|cycleway";
const SCALE = 1e6;

const query = `[out:json][timeout:90];
way["highway"~"^(${HIGHWAYS})$"](${overpassBox(AREA)});
(._;>;);
out body qt;`;

const elements = await fetchOverpass(query);

const coords = new Map();
for (const el of elements) if (el.type === "node") coords.set(el.id, [el.lat, el.lon]);

const walkable = (tags) => {
  if (tags.foot === "no" || tags.foot === "private") return false;
  if (tags.access === "no" && !["yes", "designated", "permissive"].includes(tags.foot)) return false;
  return true;
};

const edges = new Map();
const adjacency = new Map();
const link = (a, b) => {
  if (!adjacency.has(a)) adjacency.set(a, new Set());
  if (!adjacency.has(b)) adjacency.set(b, new Set());
  adjacency.get(a).add(b);
  adjacency.get(b).add(a);
};

for (const el of elements) {
  if (el.type !== "way" || !el.tags || !walkable(el.tags)) continue;
  const isSteps = el.tags.highway === "steps";
  for (let i = 1; i < el.nodes.length; i++) {
    const a = el.nodes[i - 1];
    const b = el.nodes[i];
    if (a === b || !coords.has(a) || !coords.has(b)) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edges.set(key, { a, b, isSteps: isSteps || edges.get(key)?.isSteps === true });
    link(a, b);
  }
}

// Keep only the largest connected piece so every place snaps to a reachable path.
const seen = new Set();
let largest = [];
for (const start of adjacency.keys()) {
  if (seen.has(start)) continue;
  const component = [];
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const id = stack.pop();
    component.push(id);
    for (const next of adjacency.get(id)) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  if (component.length > largest.length) largest = component;
}

if (largest.length === 0)
  throw new Error("No walkable paths found in map.walkingArea. Check the box covers your campus.");

const index = new Map(largest.map((id, i) => [id, i]));
const baseLat = Math.round(AREA.south * SCALE);
const baseLng = Math.round(AREA.west * SCALE);

const nodes = [];
for (const id of largest) {
  const [lat, lng] = coords.get(id);
  nodes.push(Math.round(lat * SCALE) - baseLat, Math.round(lng * SCALE) - baseLng);
}

const edgeList = [];
let stepEdges = 0;
for (const { a, b, isSteps } of edges.values()) {
  if (!index.has(a) || !index.has(b)) continue;
  edgeList.push(index.get(a), index.get(b), isSteps ? 1 : 0);
  if (isSteps) stepEdges++;
}

const graph = { version: 1, scale: SCALE, baseLat, baseLng, nodes, edges: edgeList };
const out = join(APP_DIR, "src", "data", "walk-graph.json");
writeFileSync(out, JSON.stringify(graph));

console.log(
  `nodes ${largest.length}, edges ${edgeList.length / 3}, stair edges ${stepEdges}, dropped nodes ${adjacency.size - largest.length}`,
);
