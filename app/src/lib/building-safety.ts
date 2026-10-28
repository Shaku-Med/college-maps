// Which buildings show their exits, stairs, and other safety points, and how those points group into chips on the map.
import type { Coordinate } from "@/data/campus";
import { INDOOR } from "@/data/indoor";
import { metersFromBuilding } from "@/lib/buildings";
import { distanceMeters } from "@/lib/geo";

export type SafetyKind = "exit" | "aed" | "stairs" | "elevator" | "chair" | "assembly";

export type SafetySpot = {
  id: string;
  coordinate: Coordinate;
  /** Most urgent first; zoomed out a chip shows only the first. */
  kinds: SafetyKind[];
  label: string;
  /** Everything at the spot, with floors, for screen readers. */
  description: string;
};

// The order a chip lists what is at a spot in, so an exit or an AED is the one icon shown when zoomed out.
const ORDER: SafetyKind[] = ["exit", "aed", "stairs", "elevator", "chair", "assembly"];
// An exit this close to the building's own pin is the door the pin already marks, so it becomes a badge on that pin.
const PIN_EXIT_METERS = 10;
// The elevator, AED, and evacuation chair join the stairs beside them instead of crowding the map with chips.
const JOIN_METERS = 9;
// Indoors the fix is rough, so being this close to the walls counts as being in the building.
const HERE_METERS = 8;
// Leaving takes clearly walking away, so the chips do not flicker on and off at the door.
const LEAVE_METERS = 25;
// A fix rougher than this cannot tell which building someone is in.
const HERE_ACCURACY_METERS = 65;

export const hasSafety = (buildingId: string | undefined): buildingId is string =>
  buildingId !== undefined && Object.hasOwn(INDOOR, buildingId);

/** The building someone is standing in, or null; `current` is the answer from the last fix. */
export function safetyBuildingHere(position: Coordinate | undefined, accuracy: number | undefined, current: string | null): string | null {
  if (!position) return null;
  if (current && hasSafety(current)) {
    const away = metersFromBuilding(position, current);
    if (away !== undefined && away <= LEAVE_METERS) return current;
  }
  if ((accuracy ?? 0) > HERE_ACCURACY_METERS) return null;
  return Object.keys(INDOOR).find((id) => (metersFromBuilding(position, id) ?? Infinity) <= HERE_METERS) ?? null;
}

/** The buildings to show safety points for: the one being walked to, and the one someone is in. */
export function safetyBuildings(goingTo: string | undefined, here: string | null): string[] {
  return [...new Set([goingTo, here ?? undefined].filter(hasSafety))];
}

type Group = { members: Coordinate[]; kinds: Set<SafetyKind>; label: string; notes: string[] };

const floorNote = (thing: string, floor: number) => `${thing} on floor ${floor}`;

/** A building's safety points as chips, and whether its own pin is also an exit; null when it has no evacuation map yet. */
export function safetyFor(buildingId: string, pin: Coordinate): { spots: SafetySpot[]; exitAtPin: boolean } | null {
  if (!hasSafety(buildingId)) return null;
  const building = INDOOR[buildingId];
  const atPin = (exit: Coordinate) => distanceMeters(exit, pin) <= PIN_EXIT_METERS;
  const exits = building.exits.filter((exit) => !atPin(exit));
  const groups: Group[] = building.stairs.map((stair) => {
    const name = `Stair ${stair.name}`;
    const exit = exits.find((e) => e.name === name);
    return {
      members: exit ? [stair, exit] : [stair],
      kinds: new Set<SafetyKind>(exit ? ["exit", "stairs"] : ["stairs"]),
      label: name,
      notes: exit ? [name, "exit to outside"] : [name],
    };
  });
  for (const exit of exits) {
    if (groups.some((g) => g.label === exit.name)) continue;
    groups.push({ members: [exit], kinds: new Set(["exit"]), label: exit.name, notes: [`${exit.name}, exit to outside`] });
  }
  const join = (at: Coordinate, kind: SafetyKind, note: string, label: string) => {
    const near = groups
      .map((g) => ({ g, d: distanceMeters(g.members[0], at) }))
      .filter(({ d }) => d <= JOIN_METERS)
      .sort((a, b) => a.d - b.d)[0]?.g;
    if (near) {
      near.members.push(at);
      near.kinds.add(kind);
      near.notes.push(note);
    } else {
      groups.push({ members: [at], kinds: new Set([kind]), label, notes: [note] });
    }
  };
  for (const elevator of building.elevators) join(elevator, "elevator", elevator.name ? `${elevator.name} elevator` : "elevator", "Elevator");
  for (const aed of building.aeds) join(aed, "aed", floorNote("AED", aed.floor), "AED");
  for (const chair of building.evacuationChairs) join(chair, "chair", floorNote("evacuation chair", chair.floor), "Evacuation chair");
  if (building.assembly) {
    groups.push({ members: [building.assembly], kinds: new Set(["assembly"]), label: "Assembly area", notes: ["Assembly area outside"] });
  }

  const spots = groups.map((g, i): SafetySpot => ({
    id: `${buildingId}-${i}`,
    coordinate: {
      latitude: g.members.reduce((a, p) => a + p.latitude, 0) / g.members.length,
      longitude: g.members.reduce((a, p) => a + p.longitude, 0) / g.members.length,
    },
    kinds: ORDER.filter((kind) => g.kinds.has(kind)),
    label: g.label,
    description: g.notes.join(", "),
  }));
  return { spots, exitAtPin: building.exits.some(atPin) };
}
