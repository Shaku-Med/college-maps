// Drafts a places list from OpenStreetMap for the campus in campus.json.
// Writes campus/places.draft.json for review; it never touches campus.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, fetchOverpass, overpassBox, readCampus } from "./lib/campus.mjs";

const campus = readCampus();
const box = overpassBox(campus.map.walkingArea);
const DUPLICATE_STOP_METERS = 80;

const placeFilters = (scope) => `
  nwr["building"]["name"](${scope});
  nwr["building"]["ref"](${scope});
  nwr["amenity"~"^(parking|library|cafe|restaurant|fast_food|food_court|clinic|doctors|pharmacy)$"]["name"](${scope});
  nwr["amenity"="parking"]["ref"](${scope});
  nwr["leisure"~"^(sports_centre|stadium)$"]["name"](${scope});`;

// Prefer places inside the mapped campus boundary so nearby shops, churches, and houses stay out.
const campusQuery = `[out:json][timeout:90];
wr["amenity"~"^(university|college)$"](${box});
map_to_area->.campus;
(${placeFilters("area.campus")}
);
out center tags;`;

const boxQuery = `[out:json][timeout:90];
(${placeFilters(box)}
);
out center tags;`;

const stopQuery = `[out:json][timeout:60];
node["highway"="bus_stop"]["name"](${box});
out body qt;`;

const GENERIC_WORDS = new Set(
  ["the", "of", "and", "for", "at", "hall", "building", "center", "centre", "complex"].concat(
    campus.college.name.toLowerCase().split(/[^a-z0-9]+/),
  ),
);

function categoryFor(tags, insideCampus) {
  if (tags.highway === "bus_stop") return "transit";
  if (tags.amenity === "parking") return "parking";
  if (["cafe", "restaurant", "fast_food", "food_court"].includes(tags.amenity)) return "dining";
  if (tags.amenity === "library" || /library/i.test(tags.name ?? "")) return "student";
  if (["clinic", "doctors", "pharmacy"].includes(tags.amenity)) return "health";
  if (["sports_centre", "stadium"].includes(tags.leisure) || tags.building === "sports_hall") return "athletics";
  if (tags.building === "dormitory" || tags.building === "residential") return "housing";
  if (/student (center|union)/i.test(tags.name ?? "")) return "student";
  return insideCampus ? "academic" : "services";
}

function slug(value) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function idFor(tags, used) {
  const words = (tags.name ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const meaningful = words.filter((word) => !GENERIC_WORDS.has(word.toLowerCase()));
  const fromName = slug((meaningful.length ? meaningful : words).slice(0, 2).join(" "));
  const base =
    tags.highway === "bus_stop" ? "BUS" : (slug(tags.ref ?? "") || fromName || "PLACE").slice(0, 13).replace(/-+$/, "");

  let id = tags.highway === "bus_stop" ? "BUS-1" : base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

function normalize(elements) {
  return elements
    .map((el) => ({ tags: el.tags ?? {}, lat: el.center?.lat ?? el.lat, lon: el.center?.lon ?? el.lon }))
    .filter(({ tags, lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon) && (tags.name || tags.ref))
    .filter(({ tags }) => !["house", "detached", "garage", "shed", "roof", "church"].includes(tags.building));
}

let insideCampus = true;
let found = normalize(await fetchOverpass(campusQuery));
if (found.length === 0) {
  insideCampus = false;
  console.warn("No campus boundary found in OpenStreetMap, using the whole walkingArea box instead.");
  found = normalize(await fetchOverpass(boxQuery));
}

const stops = [];
for (const stop of normalize(await fetchOverpass(stopQuery))) {
  const duplicate = stops.some(
    (s) => s.tags.name === stop.tags.name && distanceMeters(s, stop) < DUPLICATE_STOP_METERS,
  );
  if (!duplicate) stops.push(stop);
}

const used = new Set();
const places = [...found, ...stops]
  .map(({ tags, lat, lon }) => {
    const category = categoryFor(tags, insideCampus);
    return {
      id: idFor(tags, used),
      name: (tags.name || `Building ${tags.ref}`).slice(0, 80),
      category,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lon.toFixed(6)),
      isBuilding: Boolean(tags.building) && !["parking", "transit"].includes(category),
    };
  })
  .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

const out = join(APP_DIR, "campus", "places.draft.json");
writeFileSync(out, JSON.stringify(places, null, 2) + "\n");

console.log(
  `Wrote ${places.length} places (${found.length} on campus, ${stops.length} bus stops) to campus/places.draft.json`,
);
console.log("Review names, ids, and categories, then copy the ones you want into campus.json places.");
console.log("Building ids should match the codes students see on signs and schedules, since room search uses them.");
