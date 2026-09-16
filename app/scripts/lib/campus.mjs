import { readFileSync } from "node:fs";
import { join } from "node:path";

export const APP_DIR = join(import.meta.dirname, "..", "..");
export const CAMPUS_FILE = join(APP_DIR, "campus", "campus.json");

export function readCampus() {
  const campus = JSON.parse(readFileSync(CAMPUS_FILE, "utf8"));
  const area = campus?.map?.walkingArea;
  const valid = area && ["south", "west", "north", "east"].every((key) => Number.isFinite(area[key]));
  if (!valid || area.south >= area.north || area.west >= area.east) {
    throw new Error("campus.json map.walkingArea needs numeric south, west, north, east (south < north, west < east)");
  }
  return campus;
}

export function overpassBox({ south, west, north, east }) {
  return `${south},${west},${north},${east}`;
}

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export async function fetchOverpass(query) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const server = OVERPASS_SERVERS[attempt % OVERPASS_SERVERS.length];
    try {
      const response = await fetch(server, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "CampusMapBuilder/1.0" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return (await response.json()).elements;
      console.warn(`${server} returned ${response.status}`);
    } catch (error) {
      console.warn(`${server} failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
  }
  throw new Error("All Overpass servers failed, try again later");
}
