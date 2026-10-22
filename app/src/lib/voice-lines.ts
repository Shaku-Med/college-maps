// What spoken directions say, shared by the web app, the phone app, and scripts/build-voice-bank.mjs.
import { stepText } from "@/lib/instructions";
import type { Route, RouteStep, TravelMode, TurnDirection } from "@/lib/routing";
import { PREVIEW_LINE } from "@/lib/voice-options";

// When a maneuver is announced ahead of time, and when it is said again at the turn.
export const CUES: Record<TravelMode, { prepare: number; act: number }> = {
  walk: { prepare: 30, act: 8 },
  bike: { prepare: 90, act: 20 },
  drive: { prepare: 350, act: 60 },
};

export const NOTICE_LINES = {
  rerouted: "Route updated.",
  faster: "Found a faster route.",
  switched: "Back on your earlier route.",
} as const;
export const WRONG_WAY_LINE = "Wrong way. Turn around when it is safe.";
export const RIDING_LINES = {
  walk: "Looks like you're riding. Walking directions will pick up when you're back on foot.",
  bike: "Looks like you're in a vehicle. Directions will pick up when you're back on your bike.",
} as const;
export const TRAVEL_SWITCH_LINES = {
  walk: "Switching to walking directions.",
  drive: "Switching to driving directions.",
} as const;
export const FACING_TURNS = ["Turn around", "Turn right", "Turn left"] as const;
export const DEFAULT_DESTINATION = "your destination";

export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
export const arrivalLine = (destination: string, note?: string) =>
  `You have arrived at ${destination}.${note ? ` ${note}` : ""}`;

/** Speech for distances, so "80 ft" is read as "80 feet" and long ones are rounded the way people say them. */
export function spokenDistance(meters: number) {
  const feet = meters * 3.28084;
  if (feet < 100) return `${Math.max(10, Math.round(feet / 10) * 10)} feet`;
  if (feet < 1000) return `${Math.round(feet / 50) * 50} feet`;
  const miles = feet / 5280;
  if (miles < 0.35) return "a quarter mile";
  if (miles < 0.65) return "half a mile";
  if (miles < 1.15) return "1 mile";
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} miles`;
}

export const headsUpLine = (meters: number, instruction: string) => `In ${spokenDistance(meters)}, ${lowerFirst(instruction)}`;

// Every campus walk is made of the same few instructions.
const CAMPUS_TURNS: TurnDirection[] = ["slight-left", "left", "sharp-left", "slight-right", "right", "sharp-right"];
export const plainStep = (kind: RouteStep["kind"], direction?: TurnDirection, bearing?: number): RouteStep => ({
  kind,
  direction,
  bearing,
  startDistance: 0,
  length: 0,
});

/** The step's instruction without street names or places: what any route can say in its place. */
export function standInAct(step: RouteStep, destination: string) {
  if (step.kind === "arrive") return arrivalLine(destination);
  return `${stepText(plainStep(step.kind, step.direction, step.bearing), destination)}.`;
}

export const standInHeadsUp = (step: RouteStep, destination: string) => `Coming up, ${lowerFirst(standInAct(step, destination))}`;

// Every stand in there is: one per kind of turn and the stairs.
const STAND_IN_STEPS = [plainStep("turn", "straight"), ...CAMPUS_TURNS.map((turn) => plainStep("turn", turn)), plainStep("stairs")];
export const STAND_IN_LINES = [
  ...STAND_IN_STEPS.map((step) => standInAct(step, "")),
  ...STAND_IN_STEPS.map((step) => standInHeadsUp(step, "")),
];

/** The lines every trip falls back on. */
export const EVERYDAY_LINES = [...STAND_IN_LINES, NOTICE_LINES.rerouted, WRONG_WAY_LINE];

const CAMPUS_INSTRUCTIONS = [...CAMPUS_TURNS.map((turn) => stepText(plainStep("turn", turn), "")), stepText(plainStep("stairs"), "")];
const DEPART_LINES = Array.from({ length: 8 }, (_, i) => `${stepText(plainStep("depart", undefined, i * 45), "")}.`);

export const COMMON_CAMPUS_LINES = [
  ...CAMPUS_INSTRUCTIONS.flatMap((instruction) => [`${headsUpLine(CUES.walk.prepare, instruction)}.`, `${instruction}.`]),
  ...DEPART_LINES,
];

export function actLine(route: Route, index: number, destination: string) {
  const step = route.steps[index];
  return step.spoken ?? `${stepText(step, destination)}.`;
}

export const departVariants = (route: Route, destination: string) =>
  FACING_TURNS.map((lead) => `${lead}, then ${lowerFirst(actLine(route, 0, destination))}`);

// A brisk walk or a jog moves the heads up a little further out than the usual 30 meters.
const CAMPUS_HEADS_UP_METERS = [30, 45];

/** Every line a walk on campus can say, made ahead of time in each natural voice so it plays at once. */
export function bankLines(placeNames: readonly string[]) {
  const destinations = [...placeNames, DEFAULT_DESTINATION];
  const lines = [
    PREVIEW_LINE,
    ...EVERYDAY_LINES,
    ...Object.values(NOTICE_LINES),
    ...Object.values(RIDING_LINES),
    ...Object.values(TRAVEL_SWITCH_LINES),
    ...COMMON_CAMPUS_LINES,
    ...CAMPUS_INSTRUCTIONS.flatMap((instruction) => CAMPUS_HEADS_UP_METERS.map((meters) => `${headsUpLine(meters, instruction)}.`)),
    ...DEPART_LINES.flatMap((line) => FACING_TURNS.map((lead) => `${lead}, then ${lowerFirst(line)}`)),
    ...destinations.flatMap((name) => [arrivalLine(name), `${stepText(plainStep("arrive"), name)}.`]),
  ];
  return [...new Set(lines.map((line) => line.trim()))].sort();
}
