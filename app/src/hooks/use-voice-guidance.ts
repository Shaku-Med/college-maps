"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RouteNotice } from "@/components/navigation-hud";
import { turnAngle } from "@/lib/geo";
import { stepText } from "@/lib/instructions";
import type { Route, RouteProgress, RouteStep, TravelMode, TurnDirection } from "@/lib/routing";
import {
  clearPreparedSpeech,
  prepareSpeech,
  readVoicePreference,
  saveVoicePreference,
  speak,
  spokenDistance,
  stopSpeaking,
  unlockAudio,
  warmUpVoice,
} from "@/lib/voice";

// When a maneuver is announced ahead of time, and when it is said again at the turn. Walkers need a few
// steps of warning; drivers need a block or more.
const CUES: Record<TravelMode, { prepare: number; act: number }> = {
  walk: { prepare: 30, act: 8 },
  bike: { prepare: 90, act: 20 },
  drive: { prepare: 350, act: 60 },
};

const NOTICE_LINES: Record<RouteNotice, string> = {
  rerouted: "Route updated.",
  faster: "Found a faster route.",
  switched: "Back on your earlier route.",
};
const WRONG_WAY_LINE = "Wrong way. Turn around when it is safe.";
const RIDING_LINES = {
  walk: "Looks like you're riding. Walking directions will pick up when you're back on foot.",
  bike: "Looks like you're in a vehicle. Directions will pick up when you're back on your bike.",
};
// Moving faster needs more warning: the heads up comes about ten seconds before the turn and the call itself
// a few seconds before, never less than the usual distance for that way of travel.
const HEADS_UP_SECONDS = 10;
const CALL_SECONDS = 3.5;
// Within this of the way the route leaves, the person is already facing it.
const FACING_AHEAD_DEGREES = 35;
// Beyond this the route leaves behind them.
const FACING_BEHIND_DEGREES = 145;
const FACING_TURNS = ["Turn around", "Turn right", "Turn left"] as const;
// How many turns ahead get their lines made in advance. Making speech takes a moment on a phone.
const LOOKAHEAD_STEPS = 2;

// Each line comes with a plainer stand in, like "Turn right." for "Turn right onto Fort Place.", that is
// always kept ready in the natural voice. When the exact line has not been made in time, the stand in is
// said instead, so the voice never switches to the phone's own mid trip.
type StepLines = { prepare?: string; act: string; prepareStandIn?: string; actStandIn: string };
type Spoken = { route: Route | null; prepared: Set<number>; acted: Set<number>; lines: Map<number, StepLines> };

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const arrivalLine = (destination: string) => `You have arrived at ${destination}.`;

// Every campus walk is made of the same few instructions. Making them once, in the background, means that
// from the second walk on nearly every line is already in the natural voice before it is needed.
const CAMPUS_TURNS: TurnDirection[] = ["slight-left", "left", "sharp-left", "slight-right", "right", "sharp-right"];
const plainStep = (kind: RouteStep["kind"], direction?: TurnDirection, bearing?: number): RouteStep => ({
  kind,
  direction,
  bearing,
  startDistance: 0,
  length: 0,
});

/** The step's instruction without street names or places: what any route can say in its place. */
function standInAct(step: RouteStep, destination: string) {
  if (step.kind === "arrive") return arrivalLine(destination);
  return `${stepText(plainStep(step.kind, step.direction, step.bearing), destination)}.`;
}

const standInHeadsUp = (step: RouteStep, destination: string) =>
  `Coming up, ${lowerFirst(standInAct(step, destination))}`;

// Every stand in there is: one per kind of turn and the stairs. They are few and short, so they are made
// once in the background and kept. The calls at a turn come first, because those never wait.
const STAND_IN_STEPS = [
  plainStep("turn", "straight"),
  ...(["slight-left", "left", "sharp-left", "slight-right", "right", "sharp-right"] as const).map((turn) =>
    plainStep("turn", turn),
  ),
  plainStep("stairs"),
];
const STAND_IN_LINES = [
  ...STAND_IN_STEPS.map((step) => standInAct(step, "")),
  ...STAND_IN_STEPS.map((step) => standInHeadsUp(step, "")),
];

/**
 * Makes the lines every trip falls back on in the voice just picked. A new voice has nothing saved yet, so
 * without this its first trip keeps dropping to the phone's own voice while each line is made.
 */
export function prepareEverydayLines() {
  prepareSpeech([...STAND_IN_LINES, NOTICE_LINES.rerouted, WRONG_WAY_LINE], { later: true });
}

const COMMON_CAMPUS_LINES = (() => {
  const step = plainStep;
  const headsUp = spokenDistance(CUES.walk.prepare);
  const lines: string[] = [];
  for (const instruction of [...CAMPUS_TURNS.map((turn) => stepText(step("turn", turn), "")), stepText(step("stairs"), "")]) {
    lines.push(`In ${headsUp}, ${lowerFirst(instruction)}.`, `${instruction}.`);
  }
  for (let bearing = 0; bearing < 360; bearing += 45) lines.push(`${stepText(step("depart", undefined, bearing), "")}.`);
  return lines;
})();

function actLine(route: Route, index: number, destination: string) {
  const step = route.steps[index];
  return step.spoken ?? `${stepText(step, destination)}.`;
}

function cueFor(travel: TravelMode | undefined, speed: number) {
  const base = CUES[travel ?? "walk"];
  return { prepare: Math.max(base.prepare, speed * HEADS_UP_SECONDS), act: Math.max(base.act, speed * CALL_SECONDS) };
}

// "Head west" only helps someone who knows which way west is. When the way they face is known, the first
// instruction says which way to turn to set off.
function departLine(route: Route, destination: string, facing: number | undefined) {
  const line = actLine(route, 0, destination);
  const step = route.steps[0];
  if (facing === undefined || step.kind !== "depart" || step.bearing === undefined) return line;
  const turn = turnAngle(facing, step.bearing);
  const size = Math.abs(turn);
  if (size < FACING_AHEAD_DEGREES) return line;
  const lead = size > FACING_BEHIND_DEGREES ? FACING_TURNS[0] : turn > 0 ? FACING_TURNS[1] : FACING_TURNS[2];
  return `${lead}, then ${lowerFirst(line)}`;
}

const departVariants = (route: Route, destination: string) =>
  FACING_TURNS.map((lead) => `${lead}, then ${lowerFirst(actLine(route, 0, destination))}`);

// What to make, in order. A phone makes a phrase every few seconds, so on a first trip there is only time for
// what is needed soonest: setting off, the first turns, and the lines a reroute or a wrong turn needs at once.
// Everything else waits in the background, stand ins first, since a late line falls back to those. The
// start in each facing comes last: if it is not ready, the plain start line is said in the natural voice.
function voicePlan(route: Route, destination: string, planned: readonly string[]) {
  return {
    now: [actLine(route, 0, destination), ...planned, NOTICE_LINES.rerouted, WRONG_WAY_LINE],
    later: [
      ...STAND_IN_LINES,
      arrivalLine(destination),
      NOTICE_LINES.faster,
      NOTICE_LINES.switched,
      ...Object.values(RIDING_LINES),
      ...(route.travel ? [] : COMMON_CAMPUS_LINES),
      ...departVariants(route, destination),
    ],
  };
}

// The heads up names a distance. It is fixed when the line is planned, so the clip made in advance is
// exactly what gets said. A turn that is already close only gets the call at the turn.
function planLines(route: Route, index: number, from: number, destination: string, speed: number): StepLines {
  const step = route.steps[index];
  const cue = cueFor(route.travel, speed);
  const act = actLine(route, index, destination);
  const actStandIn = standInAct(step, destination);
  const ahead = step.startDistance - from;
  if (ahead <= cue.act) return { act, actStandIn };
  // Walking turns come close together, so the heads up always names the same distance and one clip serves
  // every turn of that kind. A turn too close for that only gets the call at the turn.
  const walking = (route.travel ?? "walk") === "walk";
  if (walking && ahead < cue.act * 2) return { act, actStandIn };
  const distance = walking ? cue.prepare : Math.min(ahead, cue.prepare);
  const headsUp = step.alert ?? `${stepText(step, destination)}.`;
  return {
    act,
    actStandIn,
    prepare: `In ${spokenDistance(distance)}, ${lowerFirst(headsUp)}`,
    prepareStandIn: standInHeadsUp(step, destination),
  };
}

/** Plans the next few turns and returns the lines that were not planned before. */
function planAhead(spoken: Spoken, route: Route, stepIndex: number, along: number, destination: string, speed: number) {
  const fresh: string[] = [];
  const last = Math.min(stepIndex + LOOKAHEAD_STEPS, route.steps.length - 1);
  for (let i = stepIndex + 1; i <= last; i++) {
    if (route.steps[i].kind === "arrive") break;
    if (spoken.lines.has(i)) continue;
    // A later turn is announced after passing the one before it, so its distance counts from there.
    const from = i === stepIndex + 1 ? along : route.steps[i - 1].startDistance;
    const lines = planLines(route, i, from, destination, speed);
    spoken.lines.set(i, lines);
    if (lines.prepare) fresh.push(lines.prepare);
    fresh.push(lines.act);
  }
  return fresh;
}

type Guidance = {
  route: Route | null;
  progress?: RouteProgress;
  destinationName?: string;
  isWrongWay: boolean;
  hasArrived: boolean;
  notice?: RouteNotice;
  /** Guidance holds still, such as walking directions while the person is on a bus. */
  paused?: boolean;
  /** Current speed in metres per second. */
  speed?: () => number;
};

export function useVoiceGuidance({
  route,
  progress,
  destinationName,
  isWrongWay,
  hasArrived,
  notice,
  paused = false,
  speed: currentSpeed,
}: Guidance) {
  const [enabled, setEnabled] = useState(readVoicePreference);
  const enabledRef = useRef(enabled);
  const nameRef = useRef(destinationName);
  const spokenRef = useRef<Spoken>({ route: null, prepared: new Set(), acted: new Set(), lines: new Map() });
  const primedRef = useRef<{ route: Route | null; lines: Map<number, StepLines> }>({ route: null, lines: new Map() });
  const routeRef = useRef(route);
  const speedRef = useRef(currentSpeed);

  useEffect(() => {
    nameRef.current = destinationName;
    routeRef.current = route;
    speedRef.current = currentSpeed;
  }, [destinationName, route, currentSpeed]);

  /** Starts making the opening lines while the route is only being previewed, so they are ready on Start. */
  const prime = useCallback((preview: Route) => {
    if (!enabledRef.current || primedRef.current.route === preview) return;
    const destination = nameRef.current ?? "your destination";
    const spoken: Spoken = { route: preview, prepared: new Set(), acted: new Set(), lines: new Map() };
    const lines = planAhead(spoken, preview, 0, 0, destination, 0);
    primedRef.current = { route: preview, lines: spoken.lines };
    warmUpVoice();
    const plan = voicePlan(preview, destination, lines);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Speaks the first instruction. Call it from the tap that starts navigation: iPhones only allow sound
   * that begins inside a tap, and after that the rest of the trip can talk freely. */
  const begin = useCallback((next: Route, facing?: number) => {
    const primed = primedRef.current;
    spokenRef.current = {
      route: next,
      prepared: new Set([0]),
      acted: new Set([0]),
      lines: primed.route === next ? new Map(primed.lines) : new Map(),
    };
    if (!enabledRef.current) return;
    unlockAudio();
    warmUpVoice();
    const destination = nameRef.current ?? "your destination";
    speak(departLine(next, destination, facing), { urgent: true, fallback: actLine(next, 0, destination) });
    planAhead(spokenRef.current, next, 0, 0, destination, 0);
    const planned = [...spokenRef.current.lines.values()].flatMap((lines) => (lines.prepare ? [lines.prepare, lines.act] : [lines.act]));
    const plan = voicePlan(next, destination, planned);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Says one step right now, for someone stepping through the directions by hand without a live location. */
  const announceStep = useCallback((route: Route, index: number) => {
    if (!enabledRef.current) return;
    unlockAudio();
    const destination = nameRef.current ?? "your destination";
    speak(actLine(route, index, destination), { urgent: true, fallback: standInAct(route.steps[index], destination) });
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    saveVoicePreference(next);
    if (next) {
      unlockAudio();
      warmUpVoice();
    } else {
      stopSpeaking();
    }
    setEnabled(next);
  }, []);

  useEffect(() => {
    if (!route) stopSpeaking();
  }, [route]);

  // Declared before the turn cues on purpose: effects run in order, so "Route updated" is said before the
  // first instruction of the new route rather than after it.
  useEffect(() => {
    if (notice && enabledRef.current) speak(NOTICE_LINES[notice]);
  }, [notice]);

  // Said once when guidance holds still, so the silence that follows makes sense.
  useEffect(() => {
    if (!paused || !enabledRef.current) return;
    speak(routeRef.current?.travel === "bike" ? RIDING_LINES.bike : RIDING_LINES.walk);
  }, [paused]);

  useEffect(() => {
    if (!route || !progress || hasArrived || isWrongWay || !enabledRef.current) return;
    const spoken = spokenRef.current;
    const destination = nameRef.current ?? "your destination";
    if (paused) {
      // Turns passed while riding are not read out afterwards.
      for (let i = 0; i <= progress.stepIndex; i++) {
        spoken.prepared.add(i);
        spoken.acted.add(i);
      }
      return;
    }
    const speed = speedRef.current?.() ?? 0;
    if (spoken.route !== route) {
      // A new route after rerouting stays quiet about steps that are already behind the walker, and the
      // lines still queued for the old route give way to the new one.
      if (spoken.route) clearPreparedSpeech();
      spoken.route = route;
      spoken.prepared = new Set();
      spoken.acted = new Set();
      spoken.lines = new Map();
      for (let i = 0; i <= progress.stepIndex; i++) {
        spoken.prepared.add(i);
        spoken.acted.add(i);
      }
    }
    prepareSpeech(planAhead(spoken, route, progress.stepIndex, progress.distanceAlong, destination, speed));

    const index = Math.min(progress.stepIndex + 1, route.steps.length - 1);
    if (route.steps[index].kind === "arrive") return;
    const cue = cueFor(route.travel, speed);
    const toStep = route.steps[index].startDistance - progress.distanceAlong;
    const lines = spoken.lines.get(index) ?? planLines(route, index, progress.distanceAlong, destination, speed);

    if (toStep <= cue.act && !spoken.acted.has(index)) {
      spoken.acted.add(index);
      spoken.prepared.add(index);
      speak(lines.act, { urgent: true, fallback: lines.actStandIn });
    } else if (lines.prepare && toStep <= cue.prepare && !spoken.prepared.has(index)) {
      spoken.prepared.add(index);
      speak(lines.prepare, { fallback: lines.prepareStandIn });
    }
  }, [route, progress, hasArrived, isWrongWay, paused]);

  useEffect(() => {
    if (isWrongWay && enabledRef.current) speak(WRONG_WAY_LINE, { urgent: true });
  }, [isWrongWay]);

  useEffect(() => {
    if (hasArrived && enabledRef.current) speak(arrivalLine(nameRef.current ?? "your destination"), { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin, prime, announceStep };
}
