import { useCallback, useEffect, useRef, useState } from 'react';

import { turnAngle } from '@/lib/geo';
import { stepText } from '@/lib/instructions';
import type { Route, RouteProgress, RouteStep, TravelMode, TurnDirection } from '@/lib/routing';
import {
  clearPreparedSpeech,
  prepareSpeech,
  readVoicePreference,
  saveVoicePreference,
  speak,
  spokenDistance,
  stopSpeaking,
  warmUpVoice,
} from '@/lib/voice';

// The same timing and lines as the web app.
const CUES: Record<TravelMode, { prepare: number; act: number }> = {
  walk: { prepare: 30, act: 8 },
  bike: { prepare: 90, act: 20 },
  drive: { prepare: 350, act: 60 },
};
const HEADS_UP_SECONDS = 10;
const CALL_SECONDS = 3.5;
const FACING_AHEAD_DEGREES = 35;
const FACING_BEHIND_DEGREES = 145;
const FACING_TURNS = ['Turn around', 'Turn right', 'Turn left'] as const;
// How many turns ahead get their lines made in advance. Making speech takes a moment on a phone.
const LOOKAHEAD_STEPS = 2;

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

// Each line has a plainer stand in kept ready in the natural voice, said when the exact line is late.
type StepLines = { prepare?: string; act: string; prepareStandIn?: string; actStandIn: string };
type Spoken = { route: Route | null; prepared: Set<number>; acted: Set<number>; lines: Map<number, StepLines> };

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const arrivalLine = (destination: string, note?: string) => `You have arrived at ${destination}.${note ? ` ${note}` : ''}`;

const CAMPUS_TURNS: TurnDirection[] = ['slight-left', 'left', 'sharp-left', 'slight-right', 'right', 'sharp-right'];
const plainStep = (kind: RouteStep['kind'], direction?: TurnDirection, bearing?: number): RouteStep => ({
  kind,
  direction,
  bearing,
  startDistance: 0,
  length: 0,
});

/** The step's instruction without street names or places: what any route can say in its place. */
function standInAct(step: RouteStep, destination: string) {
  if (step.kind === 'arrive') return arrivalLine(destination);
  return `${stepText(plainStep(step.kind, step.direction, step.bearing), destination)}.`;
}

const standInHeadsUp = (step: RouteStep, destination: string) => `Coming up, ${lowerFirst(standInAct(step, destination))}`;

const STAND_IN_STEPS = [plainStep('turn', 'straight'), ...CAMPUS_TURNS.map((turn) => plainStep('turn', turn)), plainStep('stairs')];
const STAND_IN_LINES = [
  ...STAND_IN_STEPS.map((step) => standInAct(step, '')),
  ...STAND_IN_STEPS.map((step) => standInHeadsUp(step, '')),
];

/** Makes the lines every trip falls back on in the voice just picked. */
export function prepareEverydayLines() {
  prepareSpeech([...STAND_IN_LINES, NOTICE_LINES.rerouted, WRONG_WAY_LINE], { later: true });
}

const COMMON_CAMPUS_LINES = (() => {
  const headsUp = spokenDistance(CUES.walk.prepare);
  const lines: string[] = [];
  for (const instruction of [...CAMPUS_TURNS.map((turn) => stepText(plainStep('turn', turn), '')), stepText(plainStep('stairs'), '')]) {
    lines.push(`In ${headsUp}, ${lowerFirst(instruction)}.`, `${instruction}.`);
  }
  for (let bearing = 0; bearing < 360; bearing += 45) lines.push(`${stepText(plainStep('depart', undefined, bearing), '')}.`);
  return lines;
})();

export function actLine(route: Route, index: number, destination: string) {
  const step = route.steps[index];
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
  const lead = size > FACING_BEHIND_DEGREES ? FACING_TURNS[0] : turn > 0 ? FACING_TURNS[1] : FACING_TURNS[2];
  return `${lead}, then ${lowerFirst(line)}`;
}

const departVariants = (route: Route, destination: string) =>
  FACING_TURNS.map((lead) => `${lead}, then ${lowerFirst(actLine(route, 0, destination))}`);

// What to make, in order: what is said first, then what could come up.
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

function planLines(route: Route, index: number, from: number, destination: string, speed: number): StepLines {
  const step = route.steps[index];
  const cue = cueFor(route.travel, speed);
  const act = actLine(route, index, destination);
  const actStandIn = standInAct(step, destination);
  const ahead = step.startDistance - from;
  if (ahead <= cue.act) return { act, actStandIn };
  // Walking heads ups name one fixed distance so a single clip serves every turn of that kind.
  const walking = (route.travel ?? 'walk') === 'walk';
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
    if (route.steps[i].kind === 'arrive') break;
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
  const spokenRef = useRef<Spoken>({ route: null, prepared: new Set(), acted: new Set(), lines: new Map() });
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
    const destination = nameRef.current ?? 'your destination';
    const spoken: Spoken = { route: preview, prepared: new Set(), acted: new Set(), lines: new Map() };
    const lines = planAhead(spoken, preview, 0, 0, destination, 0);
    primedRef.current = { route: preview, lines: spoken.lines };
    const plan = voicePlan(preview, destination, lines, noteRef.current);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Says the first instruction. Call it from the tap that starts navigation. */
  const begin = useCallback((next: Route, facing?: number) => {
    const primed = primedRef.current;
    spokenRef.current = {
      route: next,
      prepared: new Set([0]),
      acted: new Set([0]),
      lines: primed.route === next ? new Map(primed.lines) : new Map(),
    };
    if (!enabledRef.current) return;
    const destination = nameRef.current ?? 'your destination';
    void speak(departLine(next, destination, facing), { urgent: true, fallback: actLine(next, 0, destination) });
    planAhead(spokenRef.current, next, 0, 0, destination, 0);
    const planned = [...spokenRef.current.lines.values()].flatMap((lines) => (lines.prepare ? [lines.prepare, lines.act] : [lines.act]));
    const plan = voicePlan(next, destination, planned, noteRef.current);
    prepareSpeech(plan.now);
    prepareSpeech(plan.later, { later: true });
  }, []);

  /** Says one step right now, for someone stepping through the directions by hand. */
  const announceStep = useCallback((next: Route, index: number) => {
    if (!enabledRef.current) return;
    const destination = nameRef.current ?? 'your destination';
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
    const spoken = spokenRef.current;
    const destination = nameRef.current ?? 'your destination';
    if (paused) {
      // Turns passed while riding are not read out afterwards.
      for (let i = 0; i <= progress.stepIndex; i++) {
        spoken.prepared.add(i);
        spoken.acted.add(i);
      }
      return;
    }
    const currentSpeed = speedRef.current();
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
    prepareSpeech(planAhead(spoken, route, progress.stepIndex, progress.distanceAlong, destination, currentSpeed));

    const index = Math.min(progress.stepIndex + 1, route.steps.length - 1);
    if (route.steps[index].kind === 'arrive') return;
    const cue = cueFor(route.travel, currentSpeed);
    const toStep = route.steps[index].startDistance - progress.distanceAlong;
    const lines = spoken.lines.get(index) ?? planLines(route, index, progress.distanceAlong, destination, currentSpeed);

    if (toStep <= cue.act && !spoken.acted.has(index)) {
      spoken.acted.add(index);
      spoken.prepared.add(index);
      void speak(lines.act, { urgent: true, fallback: lines.actStandIn });
    } else if (lines.prepare && toStep <= cue.prepare && !spoken.prepared.has(index)) {
      spoken.prepared.add(index);
      void speak(lines.prepare, { fallback: lines.prepareStandIn });
    }
  }, [route, progress, hasArrived, isWrongWay, paused]);

  useEffect(() => {
    if (isWrongWay && enabledRef.current) void speak(WRONG_WAY_LINE, { urgent: true });
  }, [isWrongWay]);

  useEffect(() => {
    if (!hasArrived || !enabledRef.current) return;
    void speak(arrivalLine(nameRef.current ?? 'your destination', noteRef.current), { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin, prime, announceStep, prepare, say };
}
