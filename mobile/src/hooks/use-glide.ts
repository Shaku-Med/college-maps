import { useEffect, useRef, useState } from 'react';

import type { Coordinate } from '@/data/campus';
import { distanceMeters } from '@/lib/geo';
import { glideMs } from '@/lib/location';
import type { Route } from '@/lib/routing';

// Further than this is a new place, not a step: the glide goes straight there.
const JUMP_METERS = 120;
// GPS often slips back a few meters while moving forward; holding still reads better than stepping back.
const SLIP_BACK_METERS = 5;

/** Runs `onFrame` with 0 to 1 at an even pace over `duration`, at most once per `frameMs`. Returns a cancel. */
function glide(duration: number, frameMs: number, onFrame: (t: number) => void) {
  let frame = 0;
  let painted = 0;
  const began = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - began) / duration);
    if (t === 1 || now - painted >= frameMs) {
      painted = now;
      onFrame(t);
    }
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** Moves to each new position at an even pace over the time between fixes, so the dot never stops and starts. */
export function useGlide(target: Coordinate, frameMs = 33) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const { latitude, longitude } = target;

  useEffect(() => {
    const start = shownRef.current;
    const end = { latitude, longitude };
    const gap = distanceMeters(start, end);
    if (gap < 0.3 || gap > JUMP_METERS) {
      shownRef.current = end;
      setShown(end);
      return;
    }
    return glide(glideMs(), frameMs, (t) => {
      const at = {
        latitude: start.latitude + (end.latitude - start.latitude) * t,
        longitude: start.longitude + (end.longitude - start.longitude) * t,
      };
      shownRef.current = at;
      setShown(at);
    });
  }, [latitude, longitude, frameMs]);

  return shown;
}

/** Glides a distance along a route the same way, so the dot and the line follow the road's curves. Null without one. */
export function useAlongGlide(route: Route | null, along: number | null, frameMs = 33) {
  const [shown, setShown] = useState(along);
  const shownRef = useRef<{ route: Route | null; along: number | null }>({ route, along });

  useEffect(() => {
    const from = shownRef.current;
    if (!route || along === null || from.route !== route || from.along === null || Math.abs(along - from.along) > JUMP_METERS) {
      shownRef.current = { route, along };
      setShown(along);
      return;
    }
    const start = from.along;
    if (along <= start && start - along < SLIP_BACK_METERS) return;
    return glide(glideMs(), frameMs, (t) => {
      const at = start + (along - start) * t;
      shownRef.current = { route, along: at };
      setShown(at);
    });
  }, [route, along, frameMs]);

  return route && along !== null ? shown : null;
}
