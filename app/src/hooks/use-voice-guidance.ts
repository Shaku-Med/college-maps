"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RouteNotice } from "@/components/navigation-hud";
import { stepText } from "@/lib/instructions";
import type { Route, RouteProgress, TravelMode } from "@/lib/routing";
import { readVoicePreference, saveVoicePreference, speak, spokenDistance, stopSpeaking } from "@/lib/voice";

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

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

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
  const spokenRef = useRef({ route: null as Route | null, prepared: new Set<number>(), acted: new Set<number>() });

  useEffect(() => {
    nameRef.current = destinationName;
  }, [destinationName]);

  /** Speaks the first instruction. Call it from the tap that starts navigation: iPhones only allow speech
   * that begins inside a tap, and after that first line the rest of the trip can talk freely. */
  const begin = useCallback((next: Route) => {
    spokenRef.current = { route: next, prepared: new Set([0]), acted: new Set([0]) };
    if (!enabledRef.current) return;
    const first = next.steps[0];
    speak(first.spoken ?? `${stepText(first, nameRef.current ?? "your destination")}.`, { urgent: true });
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

  // Declared before the turn cues on purpose: effects run in order, so "Route updated" is said before the
  // first instruction of the new route rather than after it.
  useEffect(() => {
    if (notice && enabledRef.current) speak(NOTICE_LINES[notice]);
  }, [notice]);

  useEffect(() => {
    if (!route || !progress || hasArrived || isWrongWay || !enabledRef.current) return;
    const spoken = spokenRef.current;
    if (spoken.route !== route) {
      // A new route after rerouting stays quiet about steps that are already behind the walker.
      spoken.route = route;
      spoken.prepared = new Set();
      spoken.acted = new Set();
      for (let i = 0; i <= progress.stepIndex; i++) {
        spoken.prepared.add(i);
        spoken.acted.add(i);
      }
    }

    const index = Math.min(progress.stepIndex + 1, route.steps.length - 1);
    const step = route.steps[index];
    if (step.kind === "arrive") return;
    const cue = CUES[route.travel ?? "walk"];
    const toStep = step.startDistance - progress.distanceAlong;
    const destination = nameRef.current ?? "your destination";

    if (toStep <= cue.act && !spoken.acted.has(index)) {
      spoken.acted.add(index);
      spoken.prepared.add(index);
      speak(step.spoken ?? `${stepText(step, destination)}.`, { urgent: true });
    } else if (toStep <= cue.prepare && !spoken.prepared.has(index)) {
      spoken.prepared.add(index);
      speak(`In ${spokenDistance(toStep)}, ${lowerFirst(step.alert ?? `${stepText(step, destination)}.`)}`);
    }
  }, [route, progress, hasArrived, isWrongWay]);

  useEffect(() => {
    if (isWrongWay && enabledRef.current) speak("Wrong way. Turn around when it is safe.", { urgent: true });
  }, [isWrongWay]);

  useEffect(() => {
    if (hasArrived && enabledRef.current) speak(`You have arrived at ${nameRef.current ?? "your destination"}.`, { urgent: true });
  }, [hasArrived]);

  return { enabled, toggle, begin };
}
