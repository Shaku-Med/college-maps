// When each spoken direction is said, shared by the web app and the phone app so both talk the same way.
import { turnAngle } from "@/lib/geo";
import { stepText } from "@/lib/instructions";
import type { Route, RouteProgress, TravelMode } from "@/lib/routing";
import {
  COMMON_CAMPUS_LINES,
  CUES,
  FACING_TURNS,
  NOTICE_LINES,
  RIDING_LINES,
  STAND_IN_LINES,
  THEN_METERS,
  WRONG_WAY_LINE,
  actLine,
  arrivalHeadsUp,
  arrivalLine,
  chainedStep,
  departVariants,
  destinationSide,
  headsUpLine,
  lowerFirst,
  nextSpokenIndex,
  onwardLine,
  previousSpoken,
  standInAct,
  standInHeadsUp,
  streetAct,
  streetEarly,
  streetHeadsUp,
  streetInstruction,
} from "@/lib/voice-lines";

// Faster travel needs more warning: heads up about ten seconds out, the call a few seconds before.
const HEADS_UP_SECONDS = 10;
const CALL_SECONDS = 3.5;
// Within this of the way the route leaves, the person is already facing it; beyond the other, it leaves behind them.
const FACING_AHEAD_DEGREES = 35;
const FACING_BEHIND_DEGREES = 145;
// How many maneuvers ahead get their lines made in advance. Making speech takes a moment on a phone.
const LOOKAHEAD_STEPS = 3;
// About a mile out on a highway, drivers hear which lane to get into, as long as the stretch is long enough to fit it.
const EARLY_METERS = 1609;
const EARLY_ROOM_METERS = 600;
const HIGHWAY_MPS = 20;
// A stretch this long after a maneuver gets "Continue on ... for ..." once the maneuver is a little way behind.
const ONWARD: Record<TravelMode, { min: number; after: number }> = {
  walk: { min: 400, after: 15 },
  bike: { min: 800, after: 30 },
  drive: { min: 1600, after: 80 },
};

type Cue = "onward" | "early" | "prepare" | "act";

// Each line has a plainer stand in kept ready in the natural voice, said when the exact line is late.
export type StepLines = {
  act: string;
  actStandIn: string;
  /** The maneuver the act line already names with "then", so its own heads up is not said again. */
  chains?: number;
  prepare?: string;
  prepareStandIn?: string;
  early?: { line: string; meters: number };
  onward?: string;
};
export type Spoken = { route: Route | null; said: Set<string>; lines: Map<number, StepLines> };
export type DueLine = { line: string; urgent?: boolean; fallback?: string; optional?: boolean };

export const freshSpoken = (route: Route | null = null, lines = new Map<number, StepLines>()): Spoken => ({
  route,
  said: new Set(),
  lines,
});

const key = (index: number, cue: Cue) => `${index}:${cue}`;

/** Marks every line of the steps up to `index` as said, such as the ones behind someone when a route starts. */
export function markPassed(spoken: Spoken, index: number) {
  for (let i = 0; i <= index; i++) for (const cue of ["onward", "early", "prepare", "act"] as const) spoken.said.add(key(i, cue));
}

// Once "Turn right, then keep left" is said, "In 500 feet, keep left" would only repeat it; the call at the fork still comes.
const markChained = (spoken: Spoken, index: number | undefined) => {
  if (index === undefined) return;
  for (const cue of ["onward", "early", "prepare"] as const) spoken.said.add(key(index, cue));
};

/** After the first line of a trip, which may already name the next maneuver. */
export function markStart(spoken: Spoken, route: Route, destination: string) {
  markPassed(spoken, 0);
  markChained(spoken, chainedStep(route, 0, destination)?.index);
}

function cueFor(travel: TravelMode | undefined, speed: number) {
  const base = CUES[travel ?? "walk"];
  return { prepare: Math.max(base.prepare, speed * HEADS_UP_SECONDS), act: Math.max(base.act, speed * CALL_SECONDS) };
}

// "Head west" only helps someone who knows which way west is, so the first line says which way to turn.
export function departLine(route: Route, destination: string, facing: number | undefined) {
  const line = actLine(route, 0, destination);
  const step = route.steps[0];
  if (facing === undefined || step.kind !== "depart" || step.bearing === undefined) return line;
  const turn = turnAngle(facing, step.bearing);
  const size = Math.abs(turn);
  if (size < FACING_AHEAD_DEGREES) return line;
  const lead = size > FACING_BEHIND_DEGREES ? FACING_TURNS[0] : turn > 0 ? FACING_TURNS[1] : FACING_TURNS[2];
  return `${lead}, then ${lowerFirst(line)}`;
}

/** What to make, in order: what is said first, then what could come up. */
export function voicePlan(route: Route, destination: string, planned: readonly string[], arrivalNote?: string) {
  return {
    now: [actLine(route, 0, destination), ...planned, NOTICE_LINES.rerouted, WRONG_WAY_LINE],
    later: [
      ...STAND_IN_LINES,
      arrivalLine(destination, arrivalNote),
      NOTICE_LINES.faster,
      NOTICE_LINES.switched,
      ...Object.values(RIDING_LINES),
      ...(route.travel ? [] : COMMON_CAMPUS_LINES),
      ...departVariants(route, destination),
    ],
  };
}

function campusLines(route: Route, index: number, ahead: number, destination: string, speed: number): StepLines {
  const step = route.steps[index];
  const cue = cueFor(route.travel, speed);
  const act = actLine(route, index, destination);
  const actStandIn = standInAct(step, destination);
  if (ahead <= cue.act) return { act, actStandIn };
  // Walking heads ups name one fixed distance so a single clip serves every turn of that kind.
  const walking = (route.travel ?? "walk") === "walk";
  if (walking && ahead < cue.act * 2) return { act, actStandIn };
  const distance = walking ? cue.prepare : Math.min(ahead, cue.prepare);
  return {
    act,
    actStandIn,
    prepare: headsUpLine(distance, step.alert ?? `${stepText(step, destination)}.`),
    prepareStandIn: standInHeadsUp(step, destination),
  };
}

function streetLines(route: Route, index: number, ahead: number, destination: string, speed: number): StepLines | null {
  const step = route.steps[index];
  // Campus paths and the parking handoff keep the lines they always had, many of them ready made clips.
  if (!step.street) return null;
  const previous = previousSpoken(route, index);
  const travel = route.travel ?? "walk";
  const instruction = streetInstruction(step, previous);
  const cue = cueFor(travel, speed);
  const gap = previous ? step.startDistance - previous.startDistance : ahead;
  const onward =
    previous && previous.kind !== "depart" && gap >= ONWARD[travel].min ? onwardLine(previous, gap) : undefined;

  if (step.kind === "arrive") {
    const side = destinationSide(step, destination);
    if (!side || ahead <= cue.act) return { act: "", actStandIn: "", onward };
    return { act: "", actStandIn: "", prepare: arrivalHeadsUp(Math.min(ahead, cue.prepare), side), onward };
  }
  if (!instruction) return { act: "", actStandIn: "" };

  const thenMeters = Math.max(THEN_METERS[travel], speed * 8);
  const act = streetAct(route, index, destination, thenMeters) ?? `${instruction}.`;
  const actStandIn = standInAct(step, destination);
  const chains = chainedStep(route, index, destination, thenMeters)?.index;
  if (ahead <= cue.act * 1.5) return { act, actStandIn, chains, onward };
  const lines: StepLines = {
    act,
    actStandIn,
    chains,
    prepare: streetHeadsUp(Math.min(ahead, cue.prepare), instruction),
    prepareStandIn: standInHeadsUp(step, destination),
    onward,
  };
  const highway = step.street?.highway || ["exit", "ramp", "keep", "merge"].includes(step.street?.type ?? "") || speed >= HIGHWAY_MPS;
  if (travel === "drive" && highway && ahead >= EARLY_METERS + EARLY_ROOM_METERS) {
    lines.early = { line: streetEarly(EARLY_METERS, step, instruction), meters: EARLY_METERS };
  }
  return lines;
}

function planLines(route: Route, index: number, from: number, destination: string, speed: number): StepLines {
  const ahead = route.steps[index].startDistance - from;
  return streetLines(route, index, ahead, destination, speed) ?? campusLines(route, index, ahead, destination, speed);
}

/** Plans the next few maneuvers and returns the lines that were not planned before, to be made ahead of time. */
export function planAhead(spoken: Spoken, route: Route, stepIndex: number, along: number, destination: string, speed: number) {
  const fresh: string[] = [];
  const last = Math.min(stepIndex + LOOKAHEAD_STEPS, route.steps.length - 1);
  const first = nextSpokenIndex(route, stepIndex + 1);
  for (let i = first; i <= last; i++) {
    const step = route.steps[i];
    if (step.kind === "arrive" && !step.street?.side) break;
    if (spoken.lines.has(i)) continue;
    // A later maneuver is announced after passing the one before it, so its distance counts from there.
    const from = i === first ? along : (previousSpoken(route, i)?.startDistance ?? along);
    const lines = planLines(route, i, from, destination, speed);
    spoken.lines.set(i, lines);
    fresh.push(...[lines.onward, lines.early?.line, lines.prepare, lines.act].filter((line): line is string => Boolean(line)));
  }
  return fresh;
}

/** Every line planned so far, for making them ahead of time when a trip starts. */
export const plannedLines = (spoken: Spoken) =>
  [...spoken.lines.values()].flatMap((lines) =>
    [lines.onward, lines.early?.line, lines.prepare, lines.act].filter((line): line is string => Boolean(line)),
  );

/** The line due at this point of the route, if any, marked as said. */
export function dueLine(spoken: Spoken, route: Route, progress: RouteProgress, destination: string, speed: number): DueLine | null {
  const index = nextSpokenIndex(route, Math.min(progress.stepIndex + 1, route.steps.length - 1));
  const step = route.steps[index];
  if (step.kind === "arrive" && !step.street?.side) return null;
  let lines = spoken.lines.get(index);
  if (!lines) {
    lines = planLines(route, index, progress.distanceAlong, destination, speed);
    spoken.lines.set(index, lines);
  }
  const cue = cueFor(route.travel, speed);
  const toStep = step.startDistance - progress.distanceAlong;
  const said = (c: Cue) => spoken.said.has(key(index, c));
  const mark = (...cues: Cue[]) => cues.forEach((c) => spoken.said.add(key(index, c)));

  if (toStep <= cue.act) {
    if (said("act")) return null;
    mark("act", "prepare", "early", "onward");
    markChained(spoken, lines.chains);
    return lines.act ? { line: lines.act, urgent: true, fallback: lines.actStandIn } : null;
  }
  if (lines.prepare && toStep <= cue.prepare) {
    if (said("prepare")) return null;
    mark("prepare", "early", "onward");
    return { line: lines.prepare, fallback: lines.prepareStandIn };
  }
  if (lines.early && toStep <= lines.early.meters) {
    if (said("early")) return null;
    mark("early", "onward");
    return { line: lines.early.line, optional: true };
  }
  const previous = previousSpoken(route, index);
  const travel = route.travel ?? "walk";
  const nextCue = lines.early?.meters ?? cue.prepare;
  if (
    lines.onward &&
    previous &&
    !said("onward") &&
    progress.distanceAlong - previous.startDistance >= ONWARD[travel].after &&
    toStep > nextCue + ONWARD[travel].min / 4
  ) {
    mark("onward");
    return { line: lines.onward, optional: true };
  }
  return null;
}
