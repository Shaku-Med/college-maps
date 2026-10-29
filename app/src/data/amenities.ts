import type * as GeoJSON from "geojson";

import raw from "./amenities.json";

export type AmenityKind = "sos" | "picnic" | "bench" | "trash" | "bikes";

const AMENITIES = raw as { scale: number; kinds: Record<AmenityKind, number[]> };

/** SOS phones, benches, trash cans, picnic tables, and bike racks on campus, from `npm run campus:amenities`. */
export const AMENITY_POINTS: GeoJSON.FeatureCollection<GeoJSON.Point, { kind: AmenityKind }> = {
  type: "FeatureCollection",
  features: (Object.keys(AMENITIES.kinds) as AmenityKind[]).flatMap((kind) => {
    const flat = AMENITIES.kinds[kind];
    return Array.from({ length: flat.length / 2 }, (_, i) => ({
      type: "Feature" as const,
      properties: { kind },
      geometry: { type: "Point" as const, coordinates: [flat[i * 2 + 1] / AMENITIES.scale, flat[i * 2] / AMENITIES.scale] },
    }));
  }),
};
