import raw from "./indoor.json";

type Point = { latitude: number; longitude: number };

export type IndoorBuilding = {
  floors: number[];
  assembly?: Point;
  exits: (Point & { name: string; floor: number })[];
  /** Doors people can walk in through, marked on the plans; not every fire exit opens from outside. */
  entrances: (Point & { name?: string; floor: number })[];
  stairs: (Point & { name: string; floors: number[] })[];
  elevators: (Point & { name?: string; floors: number[] })[];
  aeds: (Point & { floor: number })[];
  evacuationChairs: (Point & { floor: number })[];
  /** Where each room is, from a 3D model of the building lined up with its plans. */
  rooms: (Point & { name: string; floor: number })[];
  restrooms: (Point & { floors: number[] })[];
  /** Who made the room layout, to credit them. */
  roomCredit?: string;
};

/** Exits, stairs, and the other safety points of each building, read off its evacuation maps by `npm run campus:indoor`. */
export const INDOOR = raw as Record<string, IndoorBuilding>;
