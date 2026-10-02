import { useEffect, useMemo, useRef, useState } from 'react';

import { CAMPUS, contains, type Coordinate } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import { fetchStreetRoute } from '@/lib/directions';
import { distanceMeters } from '@/lib/geo';
import type { LocationStatus } from '@/lib/location';
import { findRoute, matchWalkway, type Route } from '@/lib/routing';
import { tripPlan, type TripPlan } from '@/lib/stops';
import { MY_LOCATION, type Trip } from '@/lib/trip';

// Street routes come from a free shared server, so a preview is only refreshed after moving this far.
const STREET_REFRESH_METERS = 75;

export type RouteIssue =
  | 'locating'
  | 'finding'
  | 'denied'
  | 'no-route'
  | 'no-step-free'
  | 'no-street-route'
  | 'street-failed';

export const ISSUE_TEXT: Record<Exclude<RouteIssue, 'locating' | 'finding'>, string> = {
  denied: 'Location is off for CSI Map. Allow it in Settings, or pick a starting building and follow the steps.',
  'no-route': 'We could not find a walking route between these places.',
  'no-step-free': 'There is no step-free route here yet. Turn off Avoid stairs to see the fastest walk.',
  'no-street-route': 'We could not find a route from where you are. Try another way to travel.',
  'street-failed': 'Directions are not loading right now. Check your connection and try again.',
};

// Campus walking directions only exist inside the campus path network.
const NEAR_CAMPUS_PATH_METERS = 40;
const onCampusPaths = (point: Coordinate) =>
  contains(CAMPUS.map.walkingArea, point) ||
  (matchWalkway(walkGraph(), point, { avoidStairs: false })?.distance ?? Infinity) <= NEAR_CAMPUS_PATH_METERS;

type Preview = {
  /** The first leg: to the first stop, or straight to the destination. */
  route: Route | null;
  /** The legs after the first stop, on the campus paths. Empty without stops. */
  later: Route[];
  /** Every place the walk visits in order; the last is the destination. */
  plan: TripPlan | null;
  issue?: RouteIssue;
  isOffCampus: boolean;
};

/** The route to preview: campus paths on campus or streets from elsewhere, then on from stop to stop. */
export function useRoutePreview(
  trip: Trip,
  position: Coordinate | undefined,
  status: LocationStatus,
  heading: () => number | undefined,
): Preview {
  const planning = trip.phase === 'preview' && trip.destination !== null;
  const fromMe = trip.origin === MY_LOCATION;
  const plan = useMemo(
    () =>
      planning && trip.destination
        ? tripPlan({ origin: trip.origin, stops: trip.stops, destination: trip.destination, here: position })
        : null,
    [planning, trip.origin, trip.stops, trip.destination, position],
  );
  const first = plan?.targets[0];
  const start = plan?.start ?? undefined;
  // Checked once per fix, not on every render: it looks through every campus walkway.
  const isOffCampus = useMemo(
    () => !!plan?.live && start !== undefined && !onCampusPaths(start),
    [plan?.live, start],
  );

  const campusRoute = useMemo(() => {
    if (!first || !start || isOffCampus) return null;
    return findRoute(walkGraph(), start, first.coordinate, { avoidStairs: trip.avoidStairs });
  }, [first, start, isOffCampus, trip.avoidStairs]);

  // Stops are campus places, so every leg after the first follows the campus paths.
  const later = useMemo(() => {
    const targets = plan?.targets ?? [];
    const legs: Route[] = [];
    for (let i = 1; i < targets.length; i++) {
      const leg = findRoute(walkGraph(), targets[i - 1].coordinate, targets[i].coordinate, { avoidStairs: trip.avoidStairs });
      if (!leg) return null;
      legs.push(leg);
    }
    return legs;
  }, [plan?.targets, trip.avoidStairs]);

  const streetKey = planning && isOffCampus && first ? `${first.id}|${trip.travelMode}|${trip.avoidStairs}` : null;
  // Roughly a 100 m grid, so the preview is reconsidered as someone moves but not on every fix.
  const streetCell = position ? `${position.latitude.toFixed(3)},${position.longitude.toFixed(3)}` : '';
  const [street, setStreet] = useState<{ key: string; route: Route | null; failed: boolean } | null>(null);
  const lastFetch = useRef<{ key: string; origin: Coordinate } | null>(null);
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    const from = positionRef.current;
    if (!streetKey || !first || !from) return;
    const last = lastFetch.current;
    if (last && last.key === streetKey && distanceMeters(last.origin, from) < STREET_REFRESH_METERS) return;
    lastFetch.current = { key: streetKey, origin: from };

    const controller = new AbortController();
    let settled = false;
    fetchStreetRoute(from, first.coordinate, trip.travelMode, {
      avoidStairs: trip.avoidStairs,
      heading: heading(),
      signal: controller.signal,
    })
      .then((route) => {
        settled = true;
        setStreet({ key: streetKey, route, failed: false });
      })
      .catch(() => {
        settled = true;
        if (controller.signal.aborted) return;
        lastFetch.current = null;
        setStreet({ key: streetKey, route: null, failed: true });
      });
    return () => {
      if (settled) return;
      controller.abort();
      if (lastFetch.current?.key === streetKey) lastFetch.current = null;
    };
  }, [streetKey, streetCell, first, trip.travelMode, trip.avoidStairs, heading]);

  const none = { route: null, later: [], plan, isOffCampus };
  if (!planning) return none;
  if (!later) return { ...none, issue: trip.avoidStairs ? 'no-step-free' : 'no-route' };
  if (isOffCampus) {
    if (!street || street.key !== streetKey) return { ...none, issue: 'finding' };
    if (street.failed) return { ...none, issue: 'street-failed' };
    return street.route ? { route: street.route, later, plan, isOffCampus } : { ...none, issue: 'no-street-route' };
  }
  if (fromMe && status === 'denied') return { ...none, issue: 'denied' };
  if (!start) return { ...none, issue: 'locating' };
  if (!campusRoute) return { ...none, issue: trip.avoidStairs ? 'no-step-free' : 'no-route' };
  return { route: campusRoute, later, plan, isOffCampus };
}
