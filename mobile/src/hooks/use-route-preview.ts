import { useEffect, useMemo, useRef, useState } from 'react';

import { CAMPUS, contains, getPlace, type Coordinate } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import { fetchStreetRoute } from '@/lib/directions';
import { distanceMeters } from '@/lib/geo';
import type { LocationStatus } from '@/lib/location';
import { findRoute, type Route } from '@/lib/routing';
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

// Campus walking directions only exist inside the campus path network. Anywhere outside it the route has to
// come from the street network instead.
const onCampusPaths = (point: Coordinate) => contains(CAMPUS.map.walkingArea, point);

type Preview = { route: Route | null; issue?: RouteIssue; isOffCampus: boolean };

/** The route to show before starting: campus paths on campus, or the street network from anywhere else. */
export function useRoutePreview(
  trip: Trip,
  position: Coordinate | undefined,
  status: LocationStatus,
  heading: () => number | undefined,
): Preview {
  const planning = trip.phase === 'preview' && trip.destination !== null;
  const fromMe = trip.origin === MY_LOCATION;
  const originCoordinate = fromMe ? position : getPlace(trip.origin)?.coordinate;
  const isOffCampus = fromMe && position !== undefined && !onCampusPaths(position);

  const campusRoute = useMemo(() => {
    if (!planning || !trip.destination || !originCoordinate || isOffCampus) return null;
    return findRoute(walkGraph(), originCoordinate, trip.destination.coordinate, { avoidStairs: trip.avoidStairs });
  }, [planning, trip.destination, originCoordinate, isOffCampus, trip.avoidStairs]);

  const streetKey = planning && isOffCampus && trip.destination ? `${trip.destination.id}|${trip.travelMode}|${trip.avoidStairs}` : null;
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
    const target = trip.destination;
    if (!streetKey || !target || !from) return;
    const last = lastFetch.current;
    if (last && last.key === streetKey && distanceMeters(last.origin, from) < STREET_REFRESH_METERS) return;
    lastFetch.current = { key: streetKey, origin: from };

    const controller = new AbortController();
    let settled = false;
    fetchStreetRoute(from, target.coordinate, trip.travelMode, {
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
  }, [streetKey, streetCell, trip.destination, trip.travelMode, trip.avoidStairs, heading]);

  if (!planning) return { route: null, isOffCampus };
  if (isOffCampus) {
    if (!street || street.key !== streetKey) return { route: null, issue: 'finding', isOffCampus };
    if (street.failed) return { route: null, issue: 'street-failed', isOffCampus };
    return street.route ? { route: street.route, isOffCampus } : { route: null, issue: 'no-street-route', isOffCampus };
  }
  if (fromMe && status === 'denied') return { route: null, issue: 'denied', isOffCampus };
  if (fromMe && !position) return { route: null, issue: 'locating', isOffCampus };
  if (!campusRoute) return { route: null, issue: trip.avoidStairs ? 'no-step-free' : 'no-route', isOffCampus };
  return { route: campusRoute, isOffCampus };
}
