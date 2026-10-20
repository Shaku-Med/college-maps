import { BUILDING_OUTLINES } from "@/data/building-outlines";
import type { Coordinate } from "@/data/campus";

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
