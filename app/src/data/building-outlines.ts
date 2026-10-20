import raw from "./building-outlines.json";

/** Each building's footprint from OpenStreetMap, written by `npm run campus:outlines`: lat, lng pairs times `scale`. */
export const BUILDING_OUTLINES = raw as { scale: number; outlines: Record<string, number[]> };
