// Fetches the SOS emergency phones, benches, trash cans, picnic tables, and bike racks on campus from OpenStreetMap
// and writes src/data/amenities.json; run it again when the map gets new ones, then commit the file.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, fetchOverpass, overpassBox, readCampus } from "./lib/campus.mjs";

const OUT = join(APP_DIR, "src", "data", "amenities.json");
const SCALE = 1_000_000;
// Two of the same kind this close are one thing mapped twice.
const SAME_METERS = 1.5;

// In this order, so a picnic table also tagged as a bench counts as a picnic table.
const KINDS = {
  sos: (tags) => tags.emergency === "phone",
  picnic: (tags) => tags.leisure === "picnic_table",
  bench: (tags) => tags.amenity === "bench",
  trash: (tags) => tags.amenity === "waste_basket",
  bikes: (tags) => tags.amenity === "bicycle_parking",
};

const campus = readCampus();
const area = campus.map.walkingArea;
const filters = (scope) => `
  node["emergency"="phone"](${scope});
  node["amenity"~"^(bench|waste_basket|bicycle_parking)$"](${scope});
  node["leisure"="picnic_table"](${scope});`;

// The campus boundary keeps out benches in the streets around it; the walking area box is the fallback.
let elements = await fetchOverpass(`[out:json][timeout:90];
wr["amenity"~"^(university|college)$"](${overpassBox(area)});
map_to_area->.campus;
(${filters("area.campus")}
);
out;`);
if (elements.length === 0) {
  elements = await fetchOverpass(`[out:json][timeout:90];(${filters(overpassBox(area))});out;`);
}

const meters = (a, b) =>
  Math.hypot((a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180), (a[0] - b[0]) * 110_540);
const inArea = ([lat, lng]) => lat >= area.south && lat <= area.north && lng >= area.west && lng <= area.east;

const found = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, []]));
for (const element of elements) {
  const at = [element.lat, element.lon];
  if (element.type !== "node" || !Number.isFinite(at[0]) || !Number.isFinite(at[1]) || !inArea(at)) continue;
  const kind = Object.keys(KINDS).find((k) => KINDS[k](element.tags ?? {}));
  if (!kind || found[kind].some((other) => meters(other, at) < SAME_METERS)) continue;
  found[kind].push(at);
}

const kinds = {};
for (const [kind, points] of Object.entries(found)) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  kinds[kind] = points.flatMap(([lat, lng]) => [Math.round(lat * SCALE), Math.round(lng * SCALE)]);
}

const previous = (() => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return "";
  }
})();
const next = `${JSON.stringify({ scale: SCALE, kinds })}\n`;
writeFileSync(OUT, next);
console.log(Object.entries(found).map(([kind, points]) => `${kind} ${points.length}`).join(", "));
console.log(`amenities.json: ${Math.round(next.length / 1024)} KB${previous === next ? " (unchanged)" : ""}`);
