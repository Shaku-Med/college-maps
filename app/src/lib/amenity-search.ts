// Finds the SOS phones, benches, and other outdoor things closest to you or to a building, from words like "bench near 1N".
import { AMENITY_KINDS, AMENITY_PLACES, isAmenity, type AmenityKind, type AmenityPlace } from "@/data/amenities";
import { CAMPUS_CENTER, PLACES, type Coordinate, type Place } from "@/data/campus";
import { distanceMeters } from "@/lib/geo";
import { MAX_QUERY_LENGTH, searchPlaces } from "@/lib/search";

const MAX_RESULTS = 5;
// A building this close names where something is, like "Outside 1N".
const BY_BUILDING_METERS = 120;
// Words that only say where to look, so "bench near 1N" leaves just the building to find.
const FILLER = new Set(["near", "nearest", "closest", "nearby", "close", "by", "at", "around", "next", "to", "in", "the", "a", "an", "me", "my", "find", "where", "is", "are", "of"]);
const BUILDINGS = PLACES.filter((place) => place.isBuilding);
const KINDS = Object.keys(AMENITY_KINDS) as AmenityKind[];

export type AmenityMatch = { place: AmenityPlace; meters: number; by?: Place };
/** `measured` is false when there is nowhere to measure from but the middle of campus, so distances mean little. */
export type AmenitySearch = { kind: AmenityKind; title: string; measured: boolean; matches: AmenityMatch[] };

/** The kinds offered as one tap searches, most needed first. */
export const AMENITY_SHORTCUTS: AmenityKind[] = ["sos", "bench", "trash", "bikes", "picnic"];

const words = (query: string) =>
  query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

// "benc" finds benches and "benches" finds a bench, but "rec" stays the rec center and "binder" is not a bin.
const matchesWord = (typed: string, keyword: string) =>
  typed === keyword ||
  (typed.length >= 4 && keyword.startsWith(typed)) ||
  (typed.startsWith(keyword) && typed.length - keyword.length <= 2);

/** The building something outdoors is by, to say where it is. */
export function nearestBuilding(at: Coordinate): Place | undefined {
  let best: { place: Place; meters: number } | undefined;
  for (const place of BUILDINGS) {
    const meters = distanceMeters(at, place.coordinate);
    if (meters <= BY_BUILDING_METERS && (!best || meters < best.meters)) best = { place, meters };
  }
  return best?.place;
}

/** Where an SOS phone or bench is, like "Outside 1N". */
export function amenityWhere(place: AmenityPlace): string {
  const by = nearestBuilding(place.coordinate);
  return by ? `Outside ${by.label ?? by.id}` : "Outdoors on campus";
}

function closest(kind: AmenityKind, origin: Coordinate, limit: number): AmenityMatch[] {
  return AMENITY_PLACES.filter((place) => place.amenity === kind)
    .map((place) => ({ place, meters: distanceMeters(origin, place.coordinate) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit)
    .map((match) => ({ ...match, by: nearestBuilding(match.place.coordinate) }));
}

/** The stops someone mid walk most often wants, a tap each. */
export const QUICK_STOPS: { kind: AmenityKind; label: string }[] = [
  { kind: "trash", label: "Trash can" },
  { kind: "bikes", label: "Bike rack" },
  { kind: "bench", label: "Bench" },
  { kind: "sos", label: "SOS phone" },
];

/** The one of a kind nearest a point, such as the trash can closest to someone mid walk. */
export const nearestAmenity = (kind: AmenityKind, at: Coordinate): AmenityMatch | undefined => closest(kind, at, 1)[0];

/** The one closest to you of each kind, for a list that is a tap away from directions. */
export const closestOfEach = (here: Coordinate): AmenityMatch[] => AMENITY_SHORTCUTS.flatMap((kind) => closest(kind, here, 1));

/** Problem reports only take map places, so one about an SOS phone or bench is filed under the building it is by. */
export const reportPlaceId = (place: Place): string | undefined =>
  isAmenity(place) ? nearestBuilding(place.coordinate)?.id : place.id;

/** The kind of thing asked for and the closest few, or null when the query is not asking for one. */
export function searchAmenities(query: string, { here, around }: { here?: Coordinate; around?: Place } = {}): AmenitySearch | null {
  const typed = words(query.slice(0, MAX_QUERY_LENGTH));
  let kind: AmenityKind | undefined;
  const used = new Set<string>();
  for (const word of typed) {
    const found = KINDS.find((k) => AMENITY_KINDS[k].words.some((keyword) => matchesWord(word, keyword)));
    if (!found) continue;
    kind ??= found;
    if (found === kind) used.add(word);
  }
  if (!kind) return null;

  const rest = typed.filter((word) => !used.has(word) && !FILLER.has(word)).join(" ");
  const named = rest ? searchPlaces(rest, 1)[0] : undefined;
  const origin = named?.coordinate ?? here ?? around?.coordinate;
  const where = named
    ? `near ${named.label ?? named.id}`
    : here
      ? "near you"
      : around
        ? `near ${around.label ?? around.id}`
        : "on campus";
  const matches = closest(kind, origin ?? CAMPUS_CENTER, MAX_RESULTS);
  return { kind, title: `${AMENITY_KINDS[kind].plural} ${where}`, measured: origin !== undefined, matches };
}
