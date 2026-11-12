import { CAMPUS, type Place } from "@/data/campus";

export function placePath(place: Place) {
  return `/places/${encodeURIComponent(place.id.toLowerCase())}`;
}

export function mapLink(place: Place) {
  return `/?place=${encodeURIComponent(place.id)}`;
}

export function findPlace(slug: string) {
  const id = slug.toUpperCase();
  return CAMPUS.places.find((place) => place.id.toUpperCase() === id);
}

function meters(a: Place, b: Place) {
  const toRad = Math.PI / 180;
  const x = (b.coordinate.longitude - a.coordinate.longitude) * toRad * Math.cos(((a.coordinate.latitude + b.coordinate.latitude) / 2) * toRad);
  const y = (b.coordinate.latitude - a.coordinate.latitude) * toRad;
  return Math.hypot(x, y) * 6_371_000;
}

export function nearbyPlaces(place: Place, count: number) {
  return CAMPUS.places
    .filter((other) => other.id !== place.id && other.category !== "parking")
    .map((other) => ({ place: other, meters: meters(place, other) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count);
}

/** Walking time at an easy pace, rounded up so it never promises too much. */
export function walkMinutes(distance: number) {
  return Math.max(1, Math.ceil((distance * 1.3) / 80));
}

/** Safe to drop inside a script tag: no `<` can close it early. */
export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
