import { BUILDING_OUTLINES } from "@/data/building-outlines";
import { getPlace, type Coordinate } from "@/data/campus";
import { INDOOR } from "@/data/indoor";
import { distanceMeters } from "@/lib/geo";
import type { WalkGraph } from "@/lib/routing";

type Ring = Coordinate[];

const rings = new Map<string, Ring | null>();

function ringFor(placeId: string): Ring | null {
  let ring = rings.get(placeId);
  if (ring === undefined) {
    const flat = BUILDING_OUTLINES.outlines[placeId];
    ring =
      flat && flat.length >= 6
        ? Array.from({ length: flat.length / 2 }, (_, i) => ({
            latitude: flat[i * 2] / BUILDING_OUTLINES.scale,
            longitude: flat[i * 2 + 1] / BUILDING_OUTLINES.scale,
          }))
        : null;
    rings.set(placeId, ring);
  }
  return ring;
}

/** The building's footprint as a GeoJSON polygon for drawing on the map, or null when it has none, like a parking lot. */
export function buildingPolygon(placeId: string): { type: "Polygon"; coordinates: number[][][] } | null {
  const ring = ringFor(placeId);
  if (!ring) return null;
  const points = ring.map((point) => [point.longitude, point.latitude]);
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}

/** How far a position is from a building's walls in meters, 0 inside it, or undefined when it has no outline. */
export function metersFromBuilding(position: Coordinate, placeId: string): number | undefined {
  const ring = ringFor(placeId);
  if (!ring) return undefined;
  // Meters on a flat plane around the position; plenty accurate across one building.
  const metersPerLng = 111_320 * Math.cos((position.latitude * Math.PI) / 180);
  const points = ring.map((p) => [(p.longitude - position.longitude) * metersPerLng, (p.latitude - position.latitude) * 110_540]);

  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j];
    const [bx, by] = points[i];
    if (ay > 0 !== by > 0 && 0 < ((bx - ax) * (0 - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return inside ? 0 : nearest;
}

/** Whether walking straight from a to b would go through the building's walls. */
export function crossesBuilding(placeId: string, a: Coordinate, b: Coordinate): boolean {
  const ring = ringFor(placeId);
  if (!ring) return false;
  const metersPerLng = 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  const xy = (p: Coordinate) => [(p.longitude - a.longitude) * metersPerLng, (p.latitude - a.latitude) * 110_540];
  const [bx, by] = xy(b);
  const points = ring.map(xy);
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [cx, cy] = points[j];
    const [dx, dy] = points[i];
    const denom = bx * (dy - cy) - by * (dx - cx);
    if (denom === 0) continue;
    const t = (cx * (dy - cy) - cy * (dx - cx)) / denom;
    const u = (cx * by - cy * bx) / denom;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}

/** The building a route is headed for when its destination is that building's own pin, or null. */
export function buildingAt(point: Coordinate): string | null {
  for (const id of Object.keys(BUILDING_OUTLINES.outlines)) {
    const pin = getPlace(id)?.coordinate;
    if (pin && distanceMeters(pin, point) < 1) return id;
  }
  return null;
}

// A walkway that stops this close to a building's walls stops at a door; maps draw paths right up to them.
const DOOR_WALL_METERS = 3;
const doorCache = new WeakMap<WalkGraph, Map<string, Coordinate[]>>();

/** The doors a building is entered by: walkways that end at its walls, and entrances read off its evacuation maps. */
export function buildingDoors(g: WalkGraph, placeId: string): Coordinate[] {
  let byBuilding = doorCache.get(g);
  if (!byBuilding) doorCache.set(g, (byBuilding = new Map()));
  const cached = byBuilding.get(placeId);
  if (cached) return cached;
  const doors: Coordinate[] = [];
  for (let i = 0; i < g.lat.length; i++) {
    if (g.offsets[i + 1] - g.offsets[i] !== 1) continue;
    const end = { latitude: g.lat[i], longitude: g.lng[i] };
    if ((metersFromBuilding(end, placeId) ?? Infinity) <= DOOR_WALL_METERS) doors.push(end);
  }
  if (Object.hasOwn(INDOOR, placeId)) {
    for (const { latitude, longitude } of INDOOR[placeId].entrances) doors.push({ latitude, longitude });
  }
  byBuilding.set(placeId, doors);
  return doors;
}
