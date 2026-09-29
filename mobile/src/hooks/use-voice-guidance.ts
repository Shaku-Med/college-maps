import { useCallback, useEffect, useRef, useState } from 'react';

import { turnAngle } from '@/lib/geo';
import { stepText } from '@/lib/instructions';
import type { Route, RouteProgress, RouteStep, TravelMode } from '@/lib/routing';
import { readVoicePreference, saveVoicePreference, speak, spokenDistance, stopSpeaking } from '@/lib/voice';

// The same timing as the web app. Walkers need a few steps of warning; drivers need a block or more, and
// faster travel needs more: the heads up comes about ten seconds out and the call a few seconds before.
const CUES: Record<TravelMode, { prepare: number; act: number }> = {
  walk: { prepare: 30, act: 8 },
  bike: { prepare: 90, act: 20 },
  drive: { prepare: 350, act: 60 },
};
const HEADS_UP_SECONDS = 10;
const CALL_SECONDS = 3.5;
const FACING_AHEAD_DEGREES = 35;
const FACING_BEHIND_DEGREES = 145;

export type RouteNotice = 'rerouted' | 'faster' | 'switched';

const NOTICE_LINES: Record<RouteNotice, string> = {
  rerouted: 'Route updated.',
  faster: 'Found a faster route.',
  switched: 'Back on your earlier route.',
};
const WRONG_WAY_LINE = 'Wrong way. Turn around when it is safe.';
const RIDING_LINES = {
  walk: "Looks like you're riding. Walking directions will pick up when you're back on foot.",
  bike: "Looks like you're in a vehicle. Directions will pick up when you're back on your bike.",
};

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function actLine(route: Route, index: number, destination: string) {
  const step: RouteStep = route.steps[index];
  return step.spoken ?? `${stepText(step, destination)}.`;
}

function cueFor(travel: TravelMode | undefined, speed: number) {
  const base = CUES[travel ?? 'walk'];
  return { prepare: Math.max(base.prepare, speed * HEADS_UP_SECONDS), act: Math.max(base.act, speed * CALL_SECONDS) };
}

// "Head west" only helps someone who knows which way west is, so the first line says which way to turn.
function departLine(route: Route, destination: string, facing: number | undefined) {
  const line = actLine(route, 0, destination);
  const step = route.steps[0];
  if (facing === undefined || step.kind !== 'depart' || step.bearing === undefined) return line;
  const turn = turnAngle(facing, step.bearing);
  const size = Math.abs(turn);
  if (size < FACING_AHEAD_DEGREES) return line;
  const lead = size > FACING_BEHIND_DEGREES ? 'Turn around' : turn > 0 ? 'Turn right' : 'Turn left';
  return `${lead}, then ${lowerFirst(line)}`;
}

function headsUpLine(route: Route, index: number, from: number, destination: string, speed: number) {
  const step = route.steps[index];
  const cue = cueFor(route.travel, speed);
  const ahead = step.startDistance - from;
  const walking = (route.travel ?? 'walk') === 'walk';
  if (ahead <= cue.act || (walking && ahead < cue.act * 2)) return undefined;
  const distance = walking ? cue.prepare : Math.min(ahead, cue.prepare);
  return `In ${spokenDistance(distance)}, ${lowerFirst(step.alert ?? `${stepText(step, destination)}.`)}`;
}

type Guidance = {
  route: Route | null;
  progress?: RouteProgress;
  destinationName?: string;
  isWrongWay: boolean;
  hasArrived: boolean;
  notice?: RouteNotice;
  paused?: boolean;
  speed: () => number;
};

/** Turn by turn speech for a trip, with the same cues and lines as the web app. */
export function useVoiceGuidance({ route, progress, destinationName, isWrongWay, hasArrived, notice, paused = false, speed }: Guidance) {
  const [enabled, setEnabled] = useState(readVoicePreference);
  const enabledRef = useRef(enabled);
  const spokenRef = useRef<{ route: Route | null; prepared: Set<number>; acted: Set<number> }>({
    route: null,
    prepared: new Set(),
    acted: new Set(),
  });
  const nameRef = useRef(destinationName);
  const routeRef = useRef(route);

  useEffect(() => {
    nameRef.current = destinationName;
    routeRef.current = route;
  }, [destinationName, route]);

  /** Says the first instruction. Call it from the tap that starts navigation. */
  const begin = useCallback((next: Route, facing?: number) => {
    spokenRef.current = { route: next, prepared: new Set([0]), acted: new Set([0]) };
    if (enabledRef.current) void speak(departLine(next, nameRef.current ?? 'your destination', facing), { urgent: true });
  }, []);

  const announceStep = useCallback((next: Route, index: number) => {
    if (enabledRef.current) void speak(actLine(next, index, nameRef.current ?? 'your destination'), { urgent: true });
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    saveVoicePreference(next);
    if (!next) stopSpeaking();
    setEnabled(next);
  }, []);

  useEffect(() => {
    if (!route) stopSpeaking();
  }, [route]);

  useEffect(() => {
    if (notice && enabledRef.current) void speak(NOTICE_LINES[notice]);
  }, [notice]);

  useEffect(() => {
    if (!paused || !enabledRef.current) return;
    void speak(routeRef.current?.travel === 'bike' ? RIDING_LINES.bike : RIDING_LINES.walk);
  }, [paused]);

  useEffect(() => {
    if (!route || !progress || hasArrived || isWrongWay || !enabledRef.current) return;
    const spoken = spokenRef.current;
    if (paused) {
      // Turns passed while riding are not read out afterwards.
      for (let i = 0; i <= progress.stepIndex; i++) {
        spoken.prepared.add(i);
        spoken.acted.add(i);
      }
      return;
    }
    if (spoken.route !== route) {
      // A new route after rerouting stays quiet about steps that are already behind.
      spokenRef.current = { route, prepared: new Set(), acted: new Set() };
      for (let i = 0; i <= progress.stepIndex; i++) {
        spokenRef.current.prepared.add(i);
        spokenRef.current.acted.add(i);
      }
    }
    const state = spokenRef.current;
    const index = Math.min(progress.stepIndex + 1, route.steps.length - 1);
    if (route.steps[index].kind === 'arrive') return;
    const destination = nameRef.current ?? 'your destination';
    const cue = cueFor(route.travel, speed());
    const toStep = route.steps[index].startDistance - progress.distanceAlong;

    if (toStep <= cue.act && !state.acted.has(index)) {
      state.acted.add(index);
      state.prepared.add(index);
      void speak(actLine(route, index, destination), { urgent: true });
    } else if (toStep <= cue.prepare && !state.prepared.has(index)) {
      state.prepared.add(index);
      const line = headsUpLine(route, index, progress.distanceAlong, destination, speed());
      if (line) void speak(line);
    }
  }, [route, progress, hasArrived, isWrongWay, paused, speed]);

  useEffect(() => {
    if (isWrongWay && enabledRef.current) void speak(WRONG_WAY_LINE, { urgent: true });
  }, [isWrongWay]);

  useEffect(() => {
    if (hasArrived && enabledRef.current) void speak(`You have arrived at ${nameRef.current ?? 'your destination'}.`, { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin, announceStep };
}
