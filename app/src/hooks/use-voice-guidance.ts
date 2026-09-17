"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RouteNotice } from "@/components/navigation-hud";
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
// How many turns ahead get their lines made in advance. Making speech takes a moment on a phone.
const LOOKAHEAD_STEPS = 2;

type StepLines = { prepare?: string; act: string };
type Spoken = { route: Route | null; prepared: Set<number>; acted: Set<number>; lines: Map<number, StepLines> };

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const arrivalLine = (destination: string) => `You have arrived at ${destination}.`;

// Every campus walk is made of the same few instructions. Making them once, in the background, means that
// from the second walk on nearly every line is already in the natural voice before it is needed.
const CAMPUS_TURNS: TurnDirection[] = ["slight-left", "left", "sharp-left", "slight-right", "right", "sharp-right"];
const COMMON_CAMPUS_LINES = (() => {
  const step = (kind: RouteStep["kind"], direction?: TurnDirection, bearing?: number): RouteStep => ({
    kind,
    direction,
    bearing,
    startDistance: 0,
    length: 0,
  });
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

// The heads up names a distance. It is fixed when the line is planned, so the clip made in advance is
// exactly what gets said. A turn that is already close only gets the call at the turn.
function planLines(route: Route, index: number, from: number, destination: string): StepLines {
  const step = route.steps[index];
  const cue = CUES[route.travel ?? "walk"];
  const act = actLine(route, index, destination);
  const ahead = step.startDistance - from;
  if (ahead <= cue.act) return { act };
  // Walking turns come close together, so the heads up always names the same distance and one clip serves
  // every turn of that kind. A turn too close for that only gets the call at the turn.
  const walking = (route.travel ?? "walk") === "walk";
  if (walking && ahead < cue.act * 2) return { act };
  const distance = walking ? cue.prepare : Math.min(ahead, cue.prepare);
  const headsUp = step.alert ?? `${stepText(step, destination)}.`;
  return { act, prepare: `In ${spokenDistance(distance)}, ${lowerFirst(headsUp)}` };
}

/** Plans the next few turns and returns the lines that were not planned before. */
function planAhead(spoken: Spoken, route: Route, stepIndex: number, along: number, destination: string) {
  const fresh: string[] = [];
  const last = Math.min(stepIndex + LOOKAHEAD_STEPS, route.steps.length - 1);
  for (let i = stepIndex + 1; i <= last; i++) {
    if (route.steps[i].kind === "arrive") break;
    if (spoken.lines.has(i)) continue;
    // A later turn is announced after passing the one before it, so its distance counts from there.
    const from = i === stepIndex + 1 ? along : route.steps[i - 1].startDistance;
    const lines = planLines(route, i, from, destination);
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
};

export function useVoiceGuidance({ route, progress, destinationName, isWrongWay, hasArrived, notice }: Guidance) {
  const [enabled, setEnabled] = useState(readVoicePreference);
  const enabledRef = useRef(enabled);
  const nameRef = useRef(destinationName);
  const spokenRef = useRef<Spoken>({ route: null, prepared: new Set(), acted: new Set(), lines: new Map() });
  const primedRef = useRef<{ route: Route | null; lines: Map<number, StepLines> }>({ route: null, lines: new Map() });

  useEffect(() => {
    nameRef.current = destinationName;
  }, [destinationName]);

  /** Starts making the opening lines while the route is only being previewed, so they are ready on Start. */
  const prime = useCallback((preview: Route) => {
    if (!enabledRef.current || primedRef.current.route === preview) return;
    const destination = nameRef.current ?? "your destination";
    const spoken: Spoken = { route: preview, prepared: new Set(), acted: new Set(), lines: new Map() };
    const lines = planAhead(spoken, preview, 0, 0, destination);
    primedRef.current = { route: preview, lines: spoken.lines };
    warmUpVoice();
    prepareSpeech([actLine(preview, 0, destination), ...lines, ...Object.values(NOTICE_LINES), WRONG_WAY_LINE, arrivalLine(destination)]);
    if (!preview.travel) prepareSpeech(COMMON_CAMPUS_LINES, { later: true });
  }, []);

  /** Speaks the first instruction. Call it from the tap that starts navigation: iPhones only allow sound
   * that begins inside a tap, and after that the rest of the trip can talk freely. */
  const begin = useCallback((next: Route) => {
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
    speak(actLine(next, 0, destination), { urgent: true });
    planAhead(spokenRef.current, next, 0, 0, destination);
    const planned = [...spokenRef.current.lines.values()].flatMap((lines) => (lines.prepare ? [lines.prepare, lines.act] : [lines.act]));
    prepareSpeech([...planned, ...Object.values(NOTICE_LINES), WRONG_WAY_LINE, arrivalLine(destination)]);
    if (!next.travel) prepareSpeech(COMMON_CAMPUS_LINES, { later: true });
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

  useEffect(() => {
    if (!route || !progress || hasArrived || isWrongWay || !enabledRef.current) return;
    const spoken = spokenRef.current;
    const destination = nameRef.current ?? "your destination";
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
      if (!route.travel) prepareSpeech(COMMON_CAMPUS_LINES, { later: true });
    }
    prepareSpeech(planAhead(spoken, route, progress.stepIndex, progress.distanceAlong, destination));

    const index = Math.min(progress.stepIndex + 1, route.steps.length - 1);
    if (route.steps[index].kind === "arrive") return;
    const cue = CUES[route.travel ?? "walk"];
    const toStep = route.steps[index].startDistance - progress.distanceAlong;
    const lines = spoken.lines.get(index) ?? planLines(route, index, progress.distanceAlong, destination);

    if (toStep <= cue.act && !spoken.acted.has(index)) {
      spoken.acted.add(index);
      spoken.prepared.add(index);
      speak(lines.act, { urgent: true });
    } else if (lines.prepare && toStep <= cue.prepare && !spoken.prepared.has(index)) {
      spoken.prepared.add(index);
      speak(lines.prepare);
    }
  }, [route, progress, hasArrived, isWrongWay]);

  useEffect(() => {
    if (isWrongWay && enabledRef.current) speak(WRONG_WAY_LINE, { urgent: true });
  }, [isWrongWay]);

  useEffect(() => {
    if (hasArrived && enabledRef.current) speak(arrivalLine(nameRef.current ?? "your destination"), { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin, prime };
}
