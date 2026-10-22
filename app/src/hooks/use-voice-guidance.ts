"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RouteNotice } from "@/components/navigation-hud";
import { turnAngle } from "@/lib/geo";
import { stepText } from "@/lib/instructions";
import type { Route, RouteProgress, TravelMode } from "@/lib/routing";
import {
  clearPreparedSpeech,
  prepareSpeech,
  readVoicePreference,
  saveVoicePreference,
  speak,
  stopSpeaking,
  unlockAudio,
  warmUpVoice,
} from "@/lib/voice";
import {
  COMMON_CAMPUS_LINES,
  CUES,
  DEFAULT_DESTINATION,
  EVERYDAY_LINES,
  FACING_TURNS,
  NOTICE_LINES,
  RIDING_LINES,
  STAND_IN_LINES,
  WRONG_WAY_LINE,
  actLine,
  arrivalLine,
  departVariants,
  headsUpLine,
  lowerFirst,
  standInAct,
  standInHeadsUp,
} from "@/lib/voice-lines";

// Faster travel needs more warning: heads up about ten seconds out, the call a few seconds before.
const HEADS_UP_SECONDS = 10;
const CALL_SECONDS = 3.5;
// Within this of the way the route leaves, the person is already facing it.
const FACING_AHEAD_DEGREES = 35;
// Beyond this the route leaves behind them.
const FACING_BEHIND_DEGREES = 145;
// How many turns ahead get their lines made in advance. Making speech takes a moment on a phone.
const LOOKAHEAD_STEPS = 2;

// Each line has a plainer stand in kept ready in the natural voice, said when the exact line is late.
type StepLines = { prepare?: string; act: string; prepareStandIn?: string; actStandIn: string };
type Spoken = { route: Route | null; prepared: Set<number>; acted: Set<number>; lines: Map<number, StepLines> };

/** Makes the lines every trip falls back on in the voice just picked. */
export function prepareEverydayLines() {
  prepareSpeech(EVERYDAY_LINES, { later: true });
}

function cueFor(travel: TravelMode | undefined, speed: number) {
  const base = CUES[travel ?? "walk"];
  return { prepare: Math.max(base.prepare, speed * HEADS_UP_SECONDS), act: Math.max(base.act, speed * CALL_SECONDS) };
}

// "Head west" only helps someone who knows which way west is.
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

// What to make, in order.
function voicePlan(route: Route, destination: string, planned: readonly string[], arrivalNote?: string) {
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

// The heads up names a distance.
function planLines(route: Route, index: number, from: number, destination: string, speed: number): StepLines {
  const step = route.steps[index];
  const cue = cueFor(route.travel, speed);
  const act = actLine(route, index, destination);
  const actStandIn = standInAct(step, destination);
  const ahead = step.startDistance - from;
  if (ahead <= cue.act) return { act, actStandIn };
  // Walking heads ups name one fixed distance so a single clip serves every turn of that kind.
  const walking = (route.travel ?? "walk") === "walk";
  if (walking && ahead < cue.act * 2) return { act, actStandIn };
  const distance = walking ? cue.prepare : Math.min(ahead, cue.prepare);
  const headsUp = step.alert ?? `${stepText(step, destination)}.`;
  return {
    act,
    actStandIn,
    prepare: headsUpLine(distance, headsUp),
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
  /** Said after arriving, such as which floor the room is on. */
  arrivalNote?: string;
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
  arrivalNote,
  isWrongWay,
  hasArrived,
  notice,
  paused = false,
  speed: currentSpeed,
}: Guidance) {
  const [enabled, setEnabled] = useState(readVoicePreference);
  const enabledRef = useRef(enabled);
  const nameRef = useRef(destinationName);
  const noteRef = useRef(arrivalNote);
  const spokenRef = useRef<Spoken>({ route: null, prepared: new Set(), acted: new Set(), lines: new Map() });
  const primedRef = useRef<{ route: Route | null; lines: Map<number, StepLines> }>({ route: null, lines: new Map() });
  const routeRef = useRef(route);
  const speedRef = useRef(currentSpeed);

  useEffect(() => {
    nameRef.current = destinationName;
    noteRef.current = arrivalNote;
    routeRef.current = route;
    speedRef.current = currentSpeed;
  }, [destinationName, arrivalNote, route, currentSpeed]);

  /** Starts making the opening lines while the route is only being previewed, so they are ready on Start. */
  const prime = useCallback((preview: Route) => {
    if (!enabledRef.current || primedRef.current.route === preview) return;
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    const spoken: Spoken = { route: preview, prepared: new Set(), acted: new Set(), lines: new Map() };
    const lines = planAhead(spoken, preview, 0, 0, destination, 0);
    primedRef.current = { route: preview, lines: spoken.lines };
    warmUpVoice();
    const plan = voicePlan(preview, destination, lines, noteRef.current);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Speaks the first instruction. */
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
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    speak(departLine(next, destination, facing), { urgent: true, fallback: actLine(next, 0, destination) });
    planAhead(spokenRef.current, next, 0, 0, destination, 0);
    const planned = [...spokenRef.current.lines.values()].flatMap((lines) => (lines.prepare ? [lines.prepare, lines.act] : [lines.act]));
    const plan = voicePlan(next, destination, planned, noteRef.current);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Says one step right now, for someone stepping through the directions by hand without a live location. */
  const announceStep = useCallback((route: Route, index: number) => {
    if (!enabledRef.current) return;
    unlockAudio();
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    speak(actLine(route, index, destination), { urgent: true, fallback: standInAct(route.steps[index], destination) });
  }, []);

  /** Says a one off line, such as a parking question, when spoken directions are on. */
  const say = useCallback((line: string) => {
    if (!enabledRef.current) return;
    unlockAudio();
    speak(line, { urgent: true });
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

  // Declared before the turn cues so "Route updated" is said before the new route's first line.
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
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
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
      // A new route skips steps already behind the walker, and the old route's queued lines give way.
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
    if (hasArrived && enabledRef.current) speak(arrivalLine(nameRef.current ?? DEFAULT_DESTINATION, noteRef.current), { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin, prime, announceStep, say };
}
