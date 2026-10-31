"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RouteNotice } from "@/components/navigation-hud";
import type { Route, RouteProgress } from "@/lib/routing";
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
  DEFAULT_DESTINATION,
  EVERYDAY_LINES,
  NOTICE_LINES,
  RIDING_LINES,
  WRONG_WAY_LINE,
  actLine,
  arrivalLine,
  standInAct,
} from "@/lib/voice-lines";
import {
  departLine,
  dueLine,
  freshSpoken,
  markPassed,
  markStart,
  planAhead,
  plannedLines,
  voicePlan,
  type Spoken,
  type StepLines,
} from "@/lib/voice-plan";

/** Makes the lines every trip falls back on in the voice just picked. */
export function prepareEverydayLines() {
  prepareSpeech(EVERYDAY_LINES, { later: true });
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
  const spokenRef = useRef<Spoken>(freshSpoken());
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
    const spoken = freshSpoken(preview);
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
    spokenRef.current = freshSpoken(next, primed.route === next ? new Map(primed.lines) : new Map());
    markStart(spokenRef.current, next, nameRef.current ?? DEFAULT_DESTINATION);
    if (!enabledRef.current) return;
    unlockAudio();
    warmUpVoice();
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    speak(departLine(next, destination, facing), { urgent: true, fallback: actLine(next, 0, destination) });
    planAhead(spokenRef.current, next, 0, 0, destination, 0);
    const plan = voicePlan(next, destination, plannedLines(spokenRef.current), noteRef.current);
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

  /** Asks something that can wait its turn, like offering a break, without cutting off a direction being said. */
  const ask = useCallback((line: string) => {
    if (enabledRef.current) speak(line);
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
      markPassed(spoken, progress.stepIndex);
      return;
    }
    const speed = speedRef.current?.() ?? 0;
    if (spoken.route !== route) {
      // A new route skips steps already behind the walker, and the old route's queued lines give way.
      if (spoken.route) clearPreparedSpeech();
      spokenRef.current = freshSpoken(route);
      markPassed(spokenRef.current, progress.stepIndex);
    }
    prepareSpeech(planAhead(spokenRef.current, route, progress.stepIndex, progress.distanceAlong, destination, speed));
    const due = dueLine(spokenRef.current, route, progress, destination, speed);
    if (due) speak(due.line, { urgent: due.urgent, fallback: due.fallback, optional: due.optional });
  }, [route, progress, hasArrived, isWrongWay, paused]);

  useEffect(() => {
    if (isWrongWay && enabledRef.current) speak(WRONG_WAY_LINE, { urgent: true });
  }, [isWrongWay]);

  useEffect(() => {
    if (hasArrived && enabledRef.current) speak(arrivalLine(nameRef.current ?? DEFAULT_DESTINATION, noteRef.current), { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin, prime, announceStep, say, ask };
}
