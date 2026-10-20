// Draws the campus walkways from src/data/walk-graph.json for the About page: public/about/campus-paths.svg,
// and a few real walks across campus in src/data/about-art.json for the hero to draw in the accent color.
// Run it again after `npm run campus:paths`, then commit both files.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, readCampus } from "./lib/campus.mjs";

const OUT_DIR = join(APP_DIR, "public", "about");
const DATA_FILE = join(APP_DIR, "src", "data", "about-art.json");
const WIDTH = 1600;
const WALKS = 3;

const campus = readCampus();
const graph = JSON.parse(readFileSync(join(APP_DIR, "src", "data", "walk-graph.json"), "utf8"));
const { south, west, north, east } = campus.map.walkingArea;

// Longitude degrees shrink with latitude, so x is scaled to keep the campus its real shape.
const shrink = Math.cos((((north + south) / 2) * Math.PI) / 180);
const scale = WIDTH / ((east - west) * shrink);
const height = Math.round((north - south) * scale);

const nodeCount = graph.nodes.length / 2;
const project = (lat, lng) => [Math.round((lng - west) * shrink * scale), Math.round((north - lat) * scale)];
const points = Array.from({ length: nodeCount }, (_, i) =>
  project((graph.nodes[i * 2] + graph.baseLat) / graph.scale, (graph.nodes[i * 2 + 1] + graph.baseLng) / graph.scale),
);
const inside = ([x, y]) => x >= 0 && x <= WIDTH && y >= 0 && y <= height;

const seen = new Set();
const segments = [];
const neighbors = Array.from({ length: nodeCount }, () => []);
for (let e = 0; e < graph.edges.length; e += 3) {
  const a = graph.edges[e];
  const b = graph.edges[e + 1];
  const [pa, pb] = [points[a], points[b]];
  const length = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
  neighbors[a].push([b, length]);
  neighbors[b].push([a, length]);
  if (!inside(pa) && !inside(pb)) continue;
  if (length === 0) continue;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (seen.has(key)) continue;
  seen.add(key);
  segments.push(`M${pa[0]} ${pa[1]}L${pb[0]} ${pb[1]}`);
}

function nearestNode([x, y]) {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < nodeCount; i++) {
    const d = (points[i][0] - x) ** 2 + (points[i][1] - y) ** 2;
    if (d < bestDistance && inside(points[i])) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

// Plain Dijkstra over the drawing: good enough for a picture, and it needs nothing from the app's TypeScript.
function shortestPath(from, to) {
  const distance = new Float64Array(nodeCount).fill(Infinity);
  const previous = new Int32Array(nodeCount).fill(-1);
  const done = new Uint8Array(nodeCount);
  distance[from] = 0;
  const queue = [[0, from]];
  while (queue.length > 0) {
    queue.sort((a, b) => b[0] - a[0]);
    const [d, node] = queue.pop();
    if (done[node]) continue;
    done[node] = 1;
    if (node === to) break;
    for (const [next, length] of neighbors[node]) {
      if (d + length < distance[next]) {
        distance[next] = d + length;
        previous[next] = node;
        queue.push([distance[next], next]);
      }
    }
  }
  if (previous[to] === -1) return null;
  const path = [];
  for (let node = to; node !== -1; node = previous[node]) path.push(points[node]);
  return path.reverse();
}

// Walks between buildings on opposite sides of campus, so each one crosses the middle of the picture.
const buildings = campus.places
  .filter((place) => place.isBuilding)
  .map((place) => ({ id: place.id, at: project(place.latitude, place.longitude) }))
  .filter((place) => inside(place.at))
  .sort((a, b) => Math.atan2(a.at[1] - height / 2, a.at[0] - WIDTH / 2) - Math.atan2(b.at[1] - height / 2, b.at[0] - WIDTH / 2));
const routes = [];
for (let i = 0; i < WALKS && buildings.length >= 2; i++) {
  const from = buildings[Math.floor((i * buildings.length) / (WALKS * 2))];
  const to = buildings[Math.floor((i * buildings.length) / (WALKS * 2) + buildings.length / 2) % buildings.length];
  const path = shortestPath(nearestNode(from.at), nearestNode(to.at));
  if (!path || path.length < 2) continue;
  routes.push({ from: from.id, to: to.id, d: path.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(""), end: path.at(-1) });
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"><path d="${segments.join("")}"/></svg>\n`;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "campus-paths.svg"), svg);
writeFileSync(DATA_FILE, `${JSON.stringify({ width: WIDTH, height, routes })}\n`);
console.log(`campus-paths.svg: ${segments.length} segments, ${WIDTH}x${height}, ${Math.round(svg.length / 1024)} KB`);
console.log(`about-art.json: ${routes.map((r) => `${r.from} to ${r.to}`).join(", ")}`);
