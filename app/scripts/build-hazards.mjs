// Builds src/data/campus-hazards.json: crosswalks, railroad crossings and speed bumps inside campus.json map.walkingArea,
// so warnings on campus work offline and never wait on the public Overpass server.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, fetchOverpass, overpassBox, readCampus } from "./lib/campus.mjs";

const AREA = readCampus().map.walkingArea;
const ROADS = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street)(_link)?$";
const box = overpassBox(AREA);

// Same query the app sends for a route, so src/lib/hazards.ts reads both the same way.
const elements = await fetchOverpass(`[out:json][timeout:90];
(node[highway=crossing](${box});node[railway~"^(level_crossing|crossing)$"](${box});node[traffic_calming](${box});)->.h;
.h out body;
way(bn.h)[highway~"${ROADS}"];
out body geom;`);

const KEEP_TAGS = ["highway", "railway", "crossing", "crossing:signals", "crossing:markings", "traffic_calming"];
const round = (n) => Math.round(n * 1e6) / 1e6;
const hazardIds = new Set();
const out = [];

for (const el of elements) {
  if (el.type !== "node") continue;
  const tags = Object.fromEntries(KEEP_TAGS.filter((k) => el.tags?.[k]).map((k) => [k, el.tags[k]]));
  hazardIds.add(el.id);
  out.push({ type: "node", id: el.id, lat: round(el.lat), lon: round(el.lon), tags });
}

// Only the points beside each crossing matter, which is all the app needs to tell which way the road runs.
for (const el of elements) {
  if (el.type !== "way" || !Array.isArray(el.nodes) || !Array.isArray(el.geometry)) continue;
  const nodes = [];
  const geometry = [];
  el.nodes.forEach((id, i) => {
    if (!hazardIds.has(id)) return;
    // A crossing at the end of a road stands in for its own missing neighbor, so each crossing keeps its own three points.
    for (const j of [i - 1, i, i + 1]) {
      const at = el.geometry[j] ?? el.geometry[i];
      nodes.push(j === i ? id : -1);
      geometry.push({ lat: round(at.lat), lon: round(at.lon) });
    }
  });
  if (nodes.length > 0) out.push({ type: "way", id: el.id, nodes, geometry });
}

const file = join(APP_DIR, "src", "data", "campus-hazards.json");
writeFileSync(file, `${JSON.stringify({ area: AREA, elements: out })}\n`);
const kinds = {};
for (const el of out) {
  if (el.type !== "node") continue;
  const kind = el.tags.railway ?? (el.tags.traffic_calming ? "speed bump" : (el.tags.crossing ?? "crossing"));
  kinds[kind] = (kinds[kind] ?? 0) + 1;
}
console.log(`${hazardIds.size} hazards on campus`, kinds);
