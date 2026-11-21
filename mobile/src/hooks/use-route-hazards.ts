import { useEffect, useMemo, useState } from 'react';

import { campusHazardCache } from '@/data/campus-hazards';
import { fetchHazardPoints, hazardsOnRoute, type HazardPoint, type RouteHazard } from '@/lib/hazards';
import type { Route } from '@/lib/routing';

// Looks further ahead each time this much more of the trip is behind, so a long drive keeps its warnings coming.
const RECHECK_METERS = 1_000;

/** Warnings along the route being followed, looked up as the trip goes. Empty until they arrive, or when offline. */
export function useRouteHazards(route: Route | null, along: number): RouteHazard[] {
  // Campus warnings ship with the app, so only off campus ground is ever looked up.
  const [cache] = useState(() => campusHazardCache());
  const [points, setPoints] = useState<readonly HazardPoint[]>(() => [...cache.points.values()]);
  const stretch = Math.floor(along / RECHECK_METERS);

  useEffect(() => {
    if (!route) return;
    const runs = cache.missing(route, stretch * RECHECK_METERS);
    if (runs.length === 0) return;
    const controller = new AbortController();
    void fetchHazardPoints(runs, controller.signal).then((found) => {
      if (!found || controller.signal.aborted) return;
      cache.add(runs, found);
      setPoints([...cache.points.values()]);
    });
    return () => controller.abort();
  }, [cache, route, stretch]);

  return useMemo(() => (route ? hazardsOnRoute(route, points) : []), [route, points]);
}
