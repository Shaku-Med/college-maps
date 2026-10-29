// Close up, a safety chip that would cover another keeps one icon instead of all of them and its name; a tap still opens it.
import type { SafetyKind, SafetySpot } from "@/lib/building-safety";

export type ScreenPoint = { x: number; y: number };
type Size = { width: number; height: number };
/** Something on screen the safety chips must not cover, like the building's own chip. */
export type Obstacle = ScreenPoint & Size;

// Sizes in screen points, matching the chips' padding, icon tiles, and 12 px text closely enough to see a collision coming.
const HEIGHT = 28;
const ICON = 20;
const ICON_GAP = 2;
const EDGE = 3;
const CHAR = 6.8;
const LABEL_PAD = 10;
const GAP = 4;
// Exits first, then what someone looks for in a hurry; assembly areas and restrooms give way to them.
const PRIORITY: SafetyKind[] = ["exit", "stairs", "aed", "elevator", "chair", "restroom", "assembly"];

const textWidth = (text: string) => text.length * CHAR;

const safetySize = (icons: number, label?: string): Size => ({
  width: EDGE * 2 + icons * ICON + (icons - 1) * ICON_GAP + (label ? textWidth(label) + LABEL_PAD : 0),
  height: HEIGHT,
});

/** A place chip close up: its icon and code, and its name when picked. */
export const placeChipSize = (code: string, name?: string): Size => ({
  width: 34 + textWidth(code) + (name ? 14 + Math.min(textWidth(name), 176) : 0),
  height: HEIGHT,
});

/** The room chip: its number and floor. */
export const roomChipSize = (room: string, floor?: string): Size => ({
  width: 40 + textWidth(room) + (floor ? 10 + textWidth(floor) : 0),
  height: HEIGHT,
});

type Box = { left: number; right: number; top: number; bottom: number };

const boxAt = ({ x, y }: ScreenPoint, { width, height }: Size): Box => ({
  left: x - width / 2 - GAP,
  right: x + width / 2 + GAP,
  top: y - height / 2,
  bottom: y + height / 2,
});

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const rank = (spot: SafetySpot) => Math.min(...spot.kinds.map((kind) => PRIORITY.indexOf(kind)));

/** The safety chips that should show one icon, because in full they would land on a chip already there. */
export function compactSafetySpots(
  spots: readonly (SafetySpot & { at: ScreenPoint })[],
  obstacles: readonly Obstacle[],
): Set<string> {
  const taken = obstacles.map((obstacle) => boxAt(obstacle, obstacle));
  const compact = new Set<string>();
  const ordered = [...spots].sort((a, b) => rank(a) - rank(b) || b.kinds.length - a.kinds.length);
  for (const spot of ordered) {
    const full = boxAt(spot.at, safetySize(spot.kinds.length, spot.label));
    if (taken.some((box) => overlaps(box, full))) {
      compact.add(spot.id);
      taken.push(boxAt(spot.at, safetySize(1)));
    } else {
      taken.push(full);
    }
  }
  return compact;
}

export const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));
