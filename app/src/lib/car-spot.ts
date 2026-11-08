import { CAMPUS, contains, getPlace, setDevicePlace, type Coordinate, type Place } from "@/data/campus";
import { distanceMeters } from "@/lib/geo";
import type { Route } from "@/lib/routing";

// Where the car was left on campus. It stays on this device and is never sent anywhere.
export const CAR_ID = "CAR";
const KEY = "csimap.car";
// Long enough for a full day of classes, short enough that yesterday's spot is gone by morning.
const KEEP_MS = 18 * 60 * 60 * 1000;
// Saying "I parked here" from further than this from the lot uses the lot itself, not where the phone is.
const IN_LOT_METERS = 250;
// Starting a drive this close to the car means it has been found.
const BACK_AT_CAR_METERS = 80;

export type CarSpot = { coordinate: Coordinate; lotId?: string; at: number };

const listeners = new Set<() => void>();

function isLot(id: unknown): id is string {
  return getPlace(id)?.category === "parking";
}

function read(): CarSpot | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw || raw.length > 500) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const coordinate = saved.coordinate as Record<string, unknown> | undefined;
    const latitude = coordinate?.latitude;
    const longitude = coordinate?.longitude;
    const at = saved.at;
    if (typeof latitude !== "number" || typeof longitude !== "number" || typeof at !== "number") return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(at)) return null;
    const point = { latitude, longitude };
    if (!contains(CAMPUS.map.walkingArea, point) || Date.now() - at > KEEP_MS || at > Date.now() + 60_000) return null;
    return { coordinate: point, lotId: isLot(saved.lotId) ? saved.lotId : undefined, at };
  } catch {
    return null;
  }
}

function placeFor(spot: CarSpot): Place {
  const lot = spot.lotId ? getPlace(spot.lotId) : undefined;
  return {
    id: CAR_ID,
    label: "Car",
    name: "Your car",
    category: "parking",
    coordinate: spot.coordinate,
    details: lot ? `Parked in ${lot.name}.` : undefined,
    isBuilding: false,
  };
}

let spot = read();
setDevicePlace(CAR_ID, spot ? placeFor(spot) : undefined);

function write(next: CarSpot | null) {
  spot = next;
  setDevicePlace(CAR_ID, next ? placeFor(next) : undefined);
  try {
    if (next) globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
  for (const listener of listeners) listener();
}

/** Remembers the car, but only somewhere on campus. */
export function parkCar(coordinate: Coordinate, lotId?: string | null) {
  if (!contains(CAMPUS.map.walkingArea, coordinate)) return false;
  write({ coordinate, lotId: isLot(lotId) ? lotId : undefined, at: Date.now() });
  return true;
}

/** "I parked here" from a lot's card: where the phone is when it is in the lot, or else the lot. */
export function parkInLot(lot: Place, here?: Coordinate) {
  const inLot = here && distanceMeters(here, lot.coordinate) <= IN_LOT_METERS;
  return parkCar(inLot ? here : lot.coordinate, lot.id);
}

export const forgetCar = () => write(null);

/** True when the car was saved at the lot itself, right on top of the lot's label. */
export function onLotLabel(car: CarSpot | null) {
  const lot = car?.lotId ? getPlace(car.lotId) : undefined;
  return Boolean(car && lot && distanceMeters(lot.coordinate, car.coordinate) < 15);
}

export function getCarSpot() {
  if (spot && Date.now() - spot.at > KEEP_MS) write(null);
  return spot;
}

// Each app wraps this in its own useCarSpot hook, since this file is bundled for the phone without React.
export function subscribeCarSpot(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A drive that starts beside the car means the car is no longer parked there. */
export function leavingCar(position: Coordinate) {
  const car = getCarSpot();
  if (car && distanceMeters(car.coordinate, position) <= BACK_AT_CAR_METERS) forgetCar();
}

// Follows a drive: the first fix on foot by the lot is where the car is, saved once the trip goes on on foot.
export function createCarWatch() {
  let leftAt: Coordinate | null = null;
  return {
    /** `parked` is a drive near its lot with the phone moving on foot; any other drive fix means still in the car. */
    update(travel: Route["travel"], parked: boolean, position: Coordinate) {
      if (parked) leftAt ??= position;
      else if (travel === "drive") leftAt = null;
    },
    switched(leaving: Route, chosen: Route, position: Coordinate) {
      if (leaving.travel === "drive" && chosen.travel !== "drive") parkCar(leftAt ?? position, leaving.parkAt);
      leftAt = null;
    },
    reset() {
      leftAt = null;
    },
  };
}
