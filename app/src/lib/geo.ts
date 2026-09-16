import type { Coordinate } from "@/data/campus";

const EARTH_RADIUS_M = 6_371_000;
const FEET_PER_METER = 3.28084;
export const WALK_SPEED_MPS = 1.3;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function turnAngle(fromBearing: number, toBearing: number): number {
  return ((toBearing - fromBearing + 540) % 360) - 180;
}

export function projectOntoSegment(p: Coordinate, a: Coordinate, b: Coordinate) {
  // Equirectangular is accurate to centimeters at campus scale and far cheaper than spherical math.
  const cosLat = Math.cos(toRad(p.latitude));
  const ax = a.longitude * cosLat;
  const bx = b.longitude * cosLat;
  const px = p.longitude * cosLat;
  const dx = bx - ax;
  const dy = b.latitude - a.latitude;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p.latitude - a.latitude) * dy) / lengthSq));
  const point = { latitude: a.latitude + dy * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
  return { t, point, distance: distanceMeters(p, point) };
}

export function interpolate(a: Coordinate, b: Coordinate, t: number): Coordinate {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

export function formatDistance(meters: number): string {
  const feet = meters * FEET_PER_METER;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  return `${(feet / 5280).toFixed(feet < 5280 * 10 ? 1 : 0)} mi`;
}

export function formatDuration(meters: number): string {
  const minutes = Math.max(1, Math.round(meters / WALK_SPEED_MPS / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const CARDINALS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

export function cardinal(bearing: number): string {
  return CARDINALS[Math.round(bearing / 45) % 8];
}
