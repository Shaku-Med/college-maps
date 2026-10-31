import { useCallback, useEffect, useRef, useState } from 'react';

import type { Route, RouteProgress } from '@/lib/routing';
import {
  clearPreparedSpeech,
  prepareSpeech,
  readVoicePreference,
  saveVoicePreference,
  speak,
  stopSpeaking,
  warmUpVoice,
} from '@/lib/voice';
import {
  DEFAULT_DESTINATION,
  NOTICE_LINES,
  RIDING_LINES,
  WRONG_WAY_LINE,
  actLine,
  arrivalLine,
  standInAct,
} from '@/lib/voice-lines';
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
} from '@/lib/voice-plan';

export type RouteNotice = keyof typeof NOTICE_LINES;

type Guidance = {
  route: Route | null;
  progress?: RouteProgress;
  destinationName?: string;
  /** Said after arriving, such as which floor the room is on. */
  arrivalNote?: string;
  isWrongWay: boolean;
  hasArrived: boolean;
  notice?: RouteNotice;
  paused?: boolean;
  speed: () => number;
};

/** Turn by turn speech for a trip, with the same cues and lines as the web app. */
export function useVoiceGuidance({
  route,
  progress,
  destinationName,
  arrivalNote,
  isWrongWay,
  hasArrived,
  notice,
  paused = false,
  speed,
}: Guidance) {
  const [enabled, setEnabled] = useState(readVoicePreference);
  const enabledRef = useRef(enabled);
  const spokenRef = useRef<Spoken>(freshSpoken());
  const primedRef = useRef<{ route: Route | null; lines: Map<number, StepLines> }>({ route: null, lines: new Map() });
  const nameRef = useRef(destinationName);
  const noteRef = useRef(arrivalNote);
  const routeRef = useRef(route);
  const speedRef = useRef(speed);

  useEffect(() => {
    nameRef.current = destinationName;
    noteRef.current = arrivalNote;
    routeRef.current = route;
    speedRef.current = speed;
  }, [destinationName, arrivalNote, route, speed]);

  /** Gets the voice ready while the route is being looked at, so the first line on Start has no delay. */
  const prepare = useCallback(() => {
    if (enabledRef.current) void warmUpVoice();
  }, []);

  /** Starts making the opening lines while the route is only being previewed. */
  const prime = useCallback((preview: Route) => {
    if (!enabledRef.current || primedRef.current.route === preview) return;
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    const spoken = freshSpoken(preview);
    const lines = planAhead(spoken, preview, 0, 0, destination, 0);
    primedRef.current = { route: preview, lines: spoken.lines };
    const plan = voicePlan(preview, destination, lines, noteRef.current);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Says the first instruction. Call it from the tap that starts navigation. */
  const begin = useCallback((next: Route, facing?: number) => {
    const primed = primedRef.current;
    spokenRef.current = freshSpoken(next, primed.route === next ? new Map(primed.lines) : new Map());
    markStart(spokenRef.current, next, nameRef.current ?? DEFAULT_DESTINATION);
    if (!enabledRef.current) return;
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    void speak(departLine(next, destination, facing), { urgent: true, fallback: actLine(next, 0, destination) });
    planAhead(spokenRef.current, next, 0, 0, destination, 0);
    const plan = voicePlan(next, destination, plannedLines(spokenRef.current), noteRef.current);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Says one step right now, for someone stepping through the directions by hand. */
  const announceStep = useCallback((next: Route, index: number) => {
    if (!enabledRef.current) return;
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    void speak(actLine(next, index, destination), { urgent: true, fallback: standInAct(next.steps[index], destination) });
  }, []);

  /** Says a one off line, such as a parking question, when spoken directions are on. */
  const say = useCallback((line: string) => {
    if (enabledRef.current) void speak(line, { urgent: true });
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    saveVoicePreference(next);
    if (next) void warmUpVoice();
    else stopSpeaking();
    setEnabled(next);
  }, []);

  useEffect(() => {
    if (!route) stopSpeaking();
  }, [route]);

  // Declared before the turn cues so "Route updated" is said before the new route's first line.
  useEffect(() => {
    if (notice && enabledRef.current) void speak(NOTICE_LINES[notice]);
  }, [notice]);

  useEffect(() => {
    if (!paused || !enabledRef.current) return;
    void speak(routeRef.current?.travel === 'bike' ? RIDING_LINES.bike : RIDING_LINES.walk);
  }, [paused]);

  useEffect(() => {
    if (!route || !progress || hasArrived || isWrongWay || !enabledRef.current) return;
    const destination = nameRef.current ?? DEFAULT_DESTINATION;
    if (paused) {
      // Turns passed while riding are not read out afterwards.
      markPassed(spokenRef.current, progress.stepIndex);
      return;
    }
    const currentSpeed = speedRef.current();
    if (spokenRef.current.route !== route) {
      // A new route skips steps already behind the walker, and the old route's queued lines give way.
      if (spokenRef.current.route) clearPreparedSpeech();
      spokenRef.current = freshSpoken(route);
      markPassed(spokenRef.current, progress.stepIndex);
    }
    prepareSpeech(planAhead(spokenRef.current, route, progress.stepIndex, progress.distanceAlong, destination, currentSpeed));
    const due = dueLine(spokenRef.current, route, progress, destination, currentSpeed);
    if (due) void speak(due.line, { urgent: due.urgent, fallback: due.fallback, optional: due.optional });
  }, [route, progress, hasArrived, isWrongWay, paused]);

  useEffect(() => {
    if (isWrongWay && enabledRef.current) void speak(WRONG_WAY_LINE, { urgent: true });
  }, [isWrongWay]);

  useEffect(() => {
    if (!hasArrived || !enabledRef.current) return;
    void speak(arrivalLine(nameRef.current ?? DEFAULT_DESTINATION, noteRef.current), { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin, prime, announceStep, prepare, say };
}
