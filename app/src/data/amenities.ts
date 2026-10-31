import type * as GeoJSON from "geojson";

import raw from "./amenities.json";
import type { Place } from "./campus";

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

/** What each kind is called, and the words that find it in search. */
export const AMENITY_KINDS: Record<AmenityKind, { name: string; plural: string; label: string; prefix: string; words: string[] }> = {
  sos: { name: "SOS emergency phone", plural: "SOS phones", label: "SOS", prefix: "SOS", words: ["sos", "emergency", "phone", "bluelight", "safety"] },
  bench: { name: "Bench", plural: "Benches", label: "Bench", prefix: "BENCH", words: ["bench", "seat"] },
  trash: { name: "Trash can", plural: "Trash cans", label: "Trash", prefix: "TRASH", words: ["trash", "cans", "garbage", "bin", "waste", "litter", "recycle"] },
  picnic: { name: "Picnic table", plural: "Picnic tables", label: "Picnic", prefix: "PICNIC", words: ["picnic", "table"] },
  bikes: { name: "Bike rack", plural: "Bike racks", label: "Bikes", prefix: "BIKES", words: ["bike", "bicycle", "rack", "cycle"] },
};

/** An SOS phone, bench, or the like as a place, so it can be picked, shared, and walked to like any building. */
export type AmenityPlace = Place & { amenity: AmenityKind };

export const AMENITY_PLACES: AmenityPlace[] = (Object.keys(AMENITIES.kinds) as AmenityKind[]).flatMap((kind) => {
  const flat = AMENITIES.kinds[kind];
  const { name, label, prefix } = AMENITY_KINDS[kind];
  return Array.from({ length: flat.length / 2 }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    label,
    name,
    category: "services" as const,
    coordinate: { latitude: flat[i * 2] / AMENITIES.scale, longitude: flat[i * 2 + 1] / AMENITIES.scale },
    isBuilding: false,
    amenity: kind,
  }));
});

const AMENITY_BY_ID = new Map(AMENITY_PLACES.map((place) => [place.id, place]));

export const getAmenityPlace = (id: string): AmenityPlace | undefined => AMENITY_BY_ID.get(id);
export const isAmenity = (place: Place): place is AmenityPlace => "amenity" in place;

/** How a place is named in a sentence: "the bench" or "the SOS emergency phone" for these, a building by its name. */
export function placeCalled(place: Place) {
  if (!isAmenity(place)) return place.name;
  const { name } = place;
  // Acronyms like SOS keep their capitals.
  return `the ${name[1] === name[1]?.toUpperCase() ? name : name.charAt(0).toLowerCase() + name.slice(1)}`;
}
