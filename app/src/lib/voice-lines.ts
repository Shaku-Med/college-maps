// What spoken directions say, shared by the web app, the phone app, and scripts/build-voice-bank.mjs.
import { cardinal } from "@/lib/geo";
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
  if (miles < 0.85) return "three quarters of a mile";
  if (miles < 1.25) return "1 mile";
  if (miles < 2.25) return `${Math.round(miles * 2) / 2} miles`;
  return `${Math.round(miles)} miles`;
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
  const street = streetAct(route, index, destination);
  if (street !== undefined) return street;
  return step.spoken ?? `${stepText(step, destination)}.`;
}

// ---- Street directions, worded the way a person says them ----------------------------------------

const ROUTE_PREFIXES: Record<string, string> = {
  I: "Interstate",
  US: "U.S.",
  NY: "New York",
  NJ: "New Jersey",
  SR: "State Route",
  CR: "County Road",
};
const ROAD_WORDS: Record<string, string> = {
  Ave: "Avenue",
  Av: "Avenue",
  St: "Street",
  Rd: "Road",
  Blvd: "Boulevard",
  Pkwy: "Parkway",
  Expy: "Expressway",
  Hwy: "Highway",
  Dr: "Drive",
  Ln: "Lane",
  Pl: "Place",
  Ct: "Court",
  Tpke: "Turnpike",
  Ter: "Terrace",
  Sq: "Square",
  Cir: "Circle",
};
const HEADINGS: Record<string, string> = { N: "North", S: "South", E: "East", W: "West" };
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

// Route numbers are said the way drivers say them: 278 as "2 78", 101 as "1 oh 1".
const sayRouteNumber = (number: string) =>
  /^\d{3}$/.test(number) ? `${number[0]} ${number[1] === "0" ? `oh ${number[2]}` : number.slice(1)}` : number;

/** A road name as it is said aloud: "I 278 West" as "Interstate 2 78 West", "Victory Blvd" as "Victory Boulevard". */
export function spokenRoad(name: string) {
  const words = name.trim().split(/\s+/);
  const isRoute = words.length >= 2 && words[0] in ROUTE_PREFIXES && /^\d{1,4}[A-Z]?$/.test(words[1]);
  return words
    .map((word, i) => {
      if (isRoute && i === 0) return ROUTE_PREFIXES[word];
      if (isRoute && i === 1) return sayRouteNumber(word);
      if (i === 0 && word === "St" && words.length > 1) return "Saint";
      // A lone letter is a heading only at the front, as in "E 42nd St", or after a route number; "Avenue N" stays a letter.
      if ((i === 0 || (isRoute && i === 2)) && word in HEADINGS && words.length > 1) return HEADINGS[word];
      return ROAD_WORDS[word.replace(/\.$/, "")] ?? word;
    })
    .join(" ");
}

const towardPhrase = (toward?: string[]) => (toward?.length ? ` toward ${toward.map(spokenRoad).join(" and ")}` : "");

/** What to do at a street maneuver, without a period, or undefined when there is nothing to say there. */
export function streetInstruction(step: RouteStep, previous?: RouteStep): string | undefined {
  const street = step.street;
  if (!street) return undefined;
  const onto = street.onto ? spokenRoad(street.onto) : undefined;
  const side = street.side ? ` on the ${street.side}` : "";
  const toward = towardPhrase(street.toward);
  switch (street.type) {
    case "depart":
      return `Head ${cardinal(step.bearing ?? 0)}${onto ? ` on ${onto}` : ""}`;
    case "turn": {
      const turn = stepText(plainStep("turn", step.direction), "");
      return onto ? `${turn} onto ${onto}` : `${turn}${toward}`;
    }
    case "uturn":
      return `Make a U turn${onto ? ` onto ${onto}` : ""}`;
    case "continue":
      return onto ? `Continue onto ${onto}` : "Continue straight";
    case "ramp":
      if (street.branch) return `Take the ${spokenRoad(street.branch)} ramp${side}${toward}`;
      return `Take the ramp${side}${onto ? ` onto ${onto}` : ""}${toward}`;
    case "exit":
      if (street.exitNumber) return `Take exit ${street.exitNumber}${toward}`;
      if (street.branch) return `Take the ${spokenRoad(street.branch)} exit${toward}`;
      return `Take the exit${side}${onto ? ` onto ${onto}` : ""}${toward}`;
    case "keep": {
      const way = street.side ?? "straight";
      if (!onto) return `Keep ${way}${toward}`;
      return previous?.street?.onto === street.onto ? `Keep ${way} to stay on ${onto}` : `Keep ${way} onto ${onto}`;
    }
    case "merge":
      return `Merge${street.side ? ` ${street.side}` : ""}${onto ? ` onto ${onto}` : ""}`;
    case "roundabout": {
      const exit = street.roundaboutExit;
      if (!exit) return `Enter the roundabout${onto ? ` and take the exit onto ${onto}` : ""}`;
      const nth = ORDINALS[exit - 1] ?? `number ${exit}`;
      return `At the roundabout, take the ${nth} exit${onto ? ` onto ${onto}` : ""}`;
    }
    // A road that only changes its name, and leaving a roundabout already announced, need no words.
    case "becomes":
    case "leaveRoundabout":
      return "";
    case "arrive":
      return undefined;
    default:
      // Ferries and the like keep the router's own sentence, minus any second instruction tacked on.
      return step.spoken?.split(/\.\s+Then\s/i)[0].replace(/\.$/, "");
  }
}

/** A road that only changes its name, or leaving a roundabout already announced: nothing to say there. */
export const isSilentStep = (step: RouteStep) => step.street?.type === "becomes" || step.street?.type === "leaveRoundabout";

/** The nearest step before `index` that is said out loud. */
export function previousSpoken(route: Route, index: number) {
  for (let i = index - 1; i >= 0; i--) if (!isSilentStep(route.steps[i])) return route.steps[i];
  return undefined;
}

/** The first step from `index` on that is said out loud. */
export function nextSpokenIndex(route: Route, index: number) {
  let i = index;
  while (i < route.steps.length - 1 && isSilentStep(route.steps[i])) i++;
  return i;
}

/** "Physics and Astronomy is on your right", when the router knows the side. */
export function destinationSide(step: RouteStep, destination: string) {
  const side = step.street?.side;
  if (!side) return undefined;
  return destination === DEFAULT_DESTINATION ? `your destination is on the ${side}` : `${destination} is on your ${side}`;
}

/** Within this of the maneuver after, the two are said together: "Turn right, then keep left." */
export const THEN_METERS: Record<TravelMode, number> = { walk: 40, bike: 80, drive: 220 };

/** The maneuver said together with this one ("..., then keep left"), when it follows close behind. */
export function chainedStep(route: Route, index: number, destination: string, thenMeters?: number) {
  if (index + 1 >= route.steps.length) return undefined;
  const step = route.steps[index];
  const nextIndex = nextSpokenIndex(route, index + 1);
  const next = route.steps[nextIndex];
  const close = thenMeters ?? THEN_METERS[route.travel ?? "walk"];
  if (next.startDistance - step.startDistance > close) return undefined;
  const line = next.kind === "arrive" ? destinationSide(next, destination) : streetInstruction(next, step);
  return line ? { index: nextIndex, line } : undefined;
}

/** The line said at a street maneuver, with the next one when it follows close behind. Undefined off the streets. */
export function streetAct(route: Route, index: number, destination: string, thenMeters?: number) {
  const instruction = streetInstruction(route.steps[index], previousSpoken(route, index));
  if (instruction === undefined) return undefined;
  if (!instruction) return "";
  const chained = chainedStep(route, index, destination, thenMeters);
  if (!chained) return `${instruction}.`;
  return `${instruction}, then ${lowerFirst(chained.line)}${chained.line === instruction ? " again" : ""}.`;
}

export const streetHeadsUp = (meters: number, instruction: string) => `In ${spokenDistance(meters)}, ${lowerFirst(instruction)}.`;

/** A mile out on the highway: which lane to be in for an exit or ramp. */
export function streetEarly(meters: number, step: RouteStep, instruction: string) {
  const side = step.street?.side;
  const lane = side && (step.street?.type === "exit" || step.street?.type === "ramp") ? `use the ${side} lane to ` : "";
  return `In ${spokenDistance(meters)}, ${lane}${lowerFirst(instruction)}.`;
}

/** Said once a turn is behind and the next one is a long way off: "Continue on NY 440 North for 3 miles." */
export function onwardLine(previous: RouteStep, meters: number) {
  const road = previous.street?.onto;
  return `Continue${road ? ` on ${spokenRoad(road)}` : ""} for ${spokenDistance(meters)}.`;
}

/** Coming up to the end of a drive or walk on the streets: "In 500 feet, Marcus Hall is on your left." */
export const arrivalHeadsUp = (meters: number, side: string) => `In ${spokenDistance(meters)}, ${side}.`;

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
