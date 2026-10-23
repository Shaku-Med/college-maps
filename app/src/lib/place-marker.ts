// How a place looks on the map, shared by the web map and the phone app's map.
import type { Place } from "@/data/campus";

export type MarkerKind = "building" | "lot" | "stop";

export const markerKind = (place: Place): MarkerKind =>
  place.category === "parking" ? "lot" : place.category === "transit" ? "stop" : "building";

export const markerLabel = (place: Place) => place.label ?? place.id;

/** A lot's chip draws the P itself, so its text is just the number. */
export const lotNumber = (place: Place) => markerLabel(place).replace(/^P\s*/i, "") || markerLabel(place);

/** Zoomed out the chips shrink so the campus stays readable; zoomed in, buildings also show what they are. */
export type ZoomBand = "far" | "mid" | "near";

export const zoomBand = (zoom: number): ZoomBand => (zoom < 16.5 ? "far" : zoom < 18 ? "mid" : "near");
