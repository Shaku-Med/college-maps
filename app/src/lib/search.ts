import { CAMPUS, PLACES, getPlace, type Place } from "@/data/campus";

export const MAX_QUERY_LENGTH = 60;

export type RoomMatch = {
  place: Place;
  room: string;
  floor?: number;
};

const ROOM_ID_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

export function sanitizeQuery(raw: string): string {
  return raw
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/[^\p{L}\p{N}\s.\-]/gu, "")
    .trim();
}

export function isValidRoom(room: unknown): room is string {
  return typeof room === "string" && ROOM_ID_PATTERN.test(room);
}

export function floorForRoom(room: string): number | undefined {
  const digits = /^\d+/.exec(room)?.[0] ?? "";
  if (CAMPUS.rooms.floor === "firstDigit") return digits ? Number(digits[0]) : undefined;
  if (CAMPUS.rooms.floor === "leadingDigits") return digits.length >= 3 ? Number(digits.slice(0, -2)) : undefined;
  return undefined;
}

export function roomFromMatch(groups: Record<string, string | undefined> | undefined): RoomMatch | undefined {
  const place = getPlace(groups?.building?.replace(/\s+/g, ""));
  const room = groups?.room?.replace(/\s+/g, "").toUpperCase();
  if (!place?.isBuilding || !isValidRoom(room)) return undefined;
  return { place, room, floor: floorForRoom(room) };
}

export function parseRoomCode(raw: string): RoomMatch | undefined {
  return roomFromMatch(CAMPUS.rooms.pattern.exec(sanitizeQuery(raw))?.groups);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function scorePlace(place: Place, query: string): number {
  const id = place.id.toLowerCase();
  const name = normalize(place.name);

  if (id === query) return 100;
  if (name === query) return 90;
  if (name.startsWith(query)) return 70;
  if (id.startsWith(query)) return 60;
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 50;
  if (place.keywords?.some((keyword) => keyword.startsWith(query))) return 40;
  if (name.includes(query)) return 30;
  if (place.keywords?.some((keyword) => keyword.includes(query))) return 20;
  if (place.details && normalize(place.details).includes(query)) return 10;
  return 0;
}

export function searchPlaces(raw: string, limit = 20): Place[] {
  const query = normalize(sanitizeQuery(raw));
  if (!query) return [];

  return PLACES.map((place) => ({ place, score: scorePlace(place, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map((entry) => entry.place);
}

export function floorLabel(floor: number | undefined): string | undefined {
  if (floor === undefined) return undefined;
  if (floor <= 0) return "Lower level";
  const suffix = floor === 1 ? "st" : floor === 2 ? "nd" : floor === 3 ? "rd" : "th";
  return `${floor}${suffix} floor`;
}
