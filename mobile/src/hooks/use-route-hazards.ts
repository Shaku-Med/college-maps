import { useEffect, useMemo, useState } from 'react';

import { campusHazardCache } from '@/data/campus-hazards';
import {
  fetchHazards,
  hazardsOnRoute,
  speedLimitsOnRoute,
  type HazardData,
  type RouteHazard,
  type SpeedLimit,
} from '@/lib/hazards';
import type { Route } from '@/lib/routing';

// Looks further ahead each time this much more of the trip is behind, so a long drive keeps its warnings coming.
const RECHECK_METERS = 1_000;
const NONE: { hazards: RouteHazard[]; limits: SpeedLimit[] } = { hazards: [], limits: [] };

/** Warnings and speed limits along the route being followed, looked up as the trip goes. Empty until they arrive, or when offline. */
export function useRouteHazards(route: Route | null, along: number) {
  // Campus warnings ship with the app, so only off campus ground is ever looked up.
  const [cache] = useState(() => campusHazardCache());
  const [known, setKnown] = useState<HazardData>(() => ({ points: [...cache.points.values()], roads: [...cache.roads.values()] }));
  const stretch = Math.floor(along / RECHECK_METERS);

  useEffect(() => {
    if (!route) return;
    const runs = cache.missing(route, stretch * RECHECK_METERS);
    if (runs.length === 0) return;
    const controller = new AbortController();
    void fetchHazards(runs, controller.signal).then((found) => {
      if (!found || controller.signal.aborted) return;
      cache.add(runs, found);
      setKnown({ points: [...cache.points.values()], roads: [...cache.roads.values()] });
    });
    return () => controller.abort();
  }, [cache, route, stretch]);

  return useMemo(
    () => (route ? { hazards: hazardsOnRoute(route, known.points), limits: speedLimitsOnRoute(route, known.roads) } : NONE),
    [route, known],
  );
}
