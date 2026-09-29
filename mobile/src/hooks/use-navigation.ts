import { useCallback, useEffect, useRef, useState } from 'react';

import type { Coordinate, Place } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import type { RouteNotice } from '@/hooks/use-voice-guidance';
import { fetchStreetRoute } from '@/lib/directions';
import { bearingDegrees, distanceMeters, turnAngle } from '@/lib/geo';
import { currentCompass, onFix, type Fix } from '@/lib/location';
import { createMotionTracker, isOnFoot, ON_FOOT_MAX_MPS, RIDING_MAX_MPS, type MotionState } from '@/lib/motion';
import {
  findRoute,
  matchWalkway,
  progressAtDistance,
  remainingPath,
  routeVia,
  trackProgress,
  type Route,
  type RouteProgress,
  type TravelMode,
  type WalkGraph,
} from '@/lib/routing';

// These match the web app's map-app.tsx, so a walk is guided the same way on the phone and in a browser.
const ARRIVAL_METERS = 15;
const NEAR_DESTINATION_METERS = 25;
const UNTRUSTED_ACCURACY_METERS = 65;
export const SNAP_TO_ROUTE_METERS = 14;
const RECHECK_INTERVAL_MS = 15_000;
const RECHECK_WALKED_METERS = 35;
const NOTICE_MS = 3500;
const COURSE_MIN_METERS = 5;
const WRONG_WAY_WARN_METERS = 10;
const WRONG_WAY_REROUTE_METERS = 30;
const OPPOSITE_DEGREES = 120;
const BACK_ON_PREVIOUS_METERS = 15;
const ALONG_PREVIOUS_METERS = 15;
const DROP_PREVIOUS_METERS = 200;
const WALKWAY_MATCH_METERS = 10;
const WALKWAY_GAP_METERS = 10;
const STREET_REROUTE_GAP_MS = 5_000;
export const FOLLOW_ZOOM: Record<TravelMode, number> = { walk: 17.5, bike: 16.5, drive: 15.5 };
const STREET_ARRIVAL_METERS: Record<TravelMode, number> = { walk: 20, bike: 30, drive: 50 };
const TRAVEL_SLACK: Record<TravelMode, number> = { walk: 1, bike: 2, drive: 4 };
const FOLLOW_AGAIN_MS = 8_000;
const COURSE_SPEED_MPS = 0.7;
const MAX_SPEED_SLACK = 8;
const WALK_FOLLOW_ZOOM = 18;

function offRouteLimit(accuracy: number) {
  return Math.min(45, Math.max(20, accuracy * 1.5));
}

function isMeaningfullyShorter(candidate: number, current: number) {
  return current - candidate > Math.max(25, current * 0.15);
}

export type FollowTarget = { point: Coordinate; zoom: number; bearing?: number };

type Options = {
  destination: Place | null;
  avoidStairs: boolean;
  /** Moves the camera to follow the traveller. */
  follow: (target: FollowTarget) => void;
  /** Turns the map the way the traveller faces while following. */
  facingUp: boolean;
};

/**
 * Live guidance along a route: progress, arrival, going the wrong way, rerouting from wherever the traveller
 * went, switching back to the route they left, and holding still while they ride a bus on walking directions.
 */
export function useNavigation({ destination, avoidStairs, follow, facingUp }: Options) {
  const [route, setRoute] = useState<Route | null>(null);
  const [progress, setProgress] = useState<RouteProgress>();
  const [previousPath, setPreviousPath] = useState<Coordinate[] | null>(null);
  const [isWrongWay, setIsWrongWay] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [notice, setNotice] = useState<RouteNotice>();
  const [isRiding, setIsRiding] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const [manualStep, setManualStep] = useState<number | null>(null);

  const nav = useRef({
    active: false,
    route: null as Route | null,
    previous: null as Route | null,
    destination,
    avoidStairs,
    following: true,
    arrived: false,
    facingUp,
  });
  const motion = useRef(createMotionTracker());
  const motionState = useRef<MotionState>({ speed: 0, motion: 'still' });
  const course = useRef<number | undefined>(undefined);
  const lastCourseFix = useRef<Coordinate | null>(null);
  const latestFix = useRef<Fix | null>(null);
  const riding = useRef(false);
  const hint = useRef(0);
  const offRouteCount = useRef(0);
  const otherWalkwayCount = useRef(0);
  const maxAlong = useRef(0);
  const lastRecheck = useRef({ at: 0, along: 0 });
  const previousHint = useRef(0);
  const previousStartAlong = useRef(0);
  const previousMatches = useRef(0);
  const streetReroute = useRef({ inflight: false, at: 0 });
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const followTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    nav.current = { ...nav.current, destination, avoidStairs, facingUp };
  }, [destination, avoidStairs, facingUp]);

  useEffect(
    () => () => {
      clearTimeout(noticeTimer.current);
      clearTimeout(followTimer.current);
    },
    [],
  );

  /** The direction someone is actually travelling. Only a moving course counts. */
  const travelHeading = useCallback(
    () => (motionState.current.speed >= COURSE_SPEED_MPS ? course.current : undefined),
    [],
  );
  /** The way someone faces: their travel direction while moving, the compass while they stand still. */
  const facing = useCallback(() => travelHeading() ?? currentCompass(), [travelHeading]);
  const speed = useCallback(() => motionState.current.speed, []);

  const showNotice = useCallback((kind: RouteNotice) => {
    setNotice(kind);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(undefined), NOTICE_MS);
  }, []);

  const followTarget = useCallback(
    (point: Coordinate, travel: TravelMode | undefined): FollowTarget => ({
      point,
      zoom: riding.current ? FOLLOW_ZOOM.drive : travel ? FOLLOW_ZOOM[travel] : WALK_FOLLOW_ZOOM,
      bearing: nav.current.facingUp ? facing() : 0,
    }),
    [facing],
  );

  const commit = useCallback(
    (chosen: Route, leaving: Route, position: Coordinate, kind: RouteNotice) => {
      const leftAt = trackProgress(leaving, position, hint.current);
      const next = trackProgress(chosen, position, 0);
      hint.current = next.segmentIndex;
      maxAlong.current = next.distanceAlong;
      offRouteCount.current = 0;
      otherWalkwayCount.current = 0;
      previousHint.current = leftAt.segmentIndex;
      previousStartAlong.current = leftAt.distanceAlong;
      previousMatches.current = 0;
      lastRecheck.current = { at: Date.now(), along: next.distanceAlong };
      nav.current = { ...nav.current, route: chosen, previous: leaving };
      setRoute(chosen);
      setPreviousPath(remainingPath(leaving, leftAt));
      setProgress(next);
      setIsWrongWay(false);
      showNotice(kind);
    },
    [showNotice],
  );

  // Street routes are rerouted by asking the server again, which answers later, so this runs on its own.
  const rerouteStreet = useCallback(
    (position: Coordinate) => {
      const { route: leaving, destination: target, avoidStairs: stairs } = nav.current;
      const travel = leaving?.travel;
      const state = streetReroute.current;
      if (!leaving || !travel || !target || state.inflight || Date.now() - state.at < STREET_REROUTE_GAP_MS) return;
      state.inflight = true;
      state.at = Date.now();
      const heading = travelHeading();
      fetchStreetRoute(position, target.coordinate, travel, { avoidStairs: stairs, heading })
        .then((candidate) =>
          candidate || heading === undefined
            ? candidate
            : fetchStreetRoute(position, target.coordinate, travel, { avoidStairs: stairs }),
        )
        .then((candidate) => {
          const current = nav.current;
          if (!candidate || !current.active || current.route !== leaving || current.arrived) return;
          commit(candidate, leaving, latestFix.current?.position ?? position, 'rerouted');
        })
        .catch(() => undefined)
        .finally(() => {
          state.inflight = false;
        });
    },
    [commit, travelHeading],
  );

  const handleFix = useCallback(
    (fix: Fix) => {
      const { position, accuracy, heading, speed: reported } = fix;
      const state = motion.current.update({ position, accuracy, speed: reported }, Date.now());
      motionState.current = state;

      if (heading !== undefined && (reported ?? 0) >= COURSE_SPEED_MPS) {
        course.current = heading;
        lastCourseFix.current = position;
      } else {
        const last = lastCourseFix.current;
        if (!last || distanceMeters(last, position) >= COURSE_MIN_METERS) {
          if (last && accuracy <= UNTRUSTED_ACCURACY_METERS) course.current = bearingDegrees(last, position);
          lastCourseFix.current = position;
        }
      }
      latestFix.current = fix;

      const current = nav.current;
      if (!current.active || !current.route || !current.destination || current.arrived) return;
      setManualStep(null);

      let active = current.route;
      let next = trackProgress(active, position, hint.current);
      let changed: RouteNotice | undefined;
      const trusted = accuracy <= UNTRUSTED_ACCURACY_METERS;
      const graph: WalkGraph | null = active.travel ? null : walkGraph();
      const target = current.destination;
      const travel = active.travel;

      const nowRiding =
        travel === 'drive' ? false : travel === 'bike' ? state.motion === 'vehicle' : !isOnFoot(state.motion);
      const justGotOff = riding.current && !nowRiding;
      if (nowRiding !== riding.current) {
        riding.current = nowRiding;
        setIsRiding(nowRiding);
      }
      const fastest = Math.max(state.speed, reported ?? 0);
      const holding =
        nowRiding || (travel !== 'drive' && fastest >= (travel === 'bike' ? RIDING_MAX_MPS : ON_FOOT_MAX_MPS));

      const slack = Math.max(TRAVEL_SLACK[travel ?? 'walk'], Math.min(MAX_SPEED_SLACK, state.speed / 2));
      const limit = offRouteLimit(accuracy) * Math.sqrt(slack);

      const match = graph && !holding ? matchWalkway(graph, position, { avoidStairs: current.avoidStairs }) : undefined;
      const walkway = match && match.distance <= WALKWAY_MATCH_METERS ? match : undefined;

      const adopt = (candidate: Route, kind: RouteNotice) => {
        const leaving = active;
        const leftAt = next;
        active = candidate;
        next = trackProgress(candidate, position, 0);
        changed = kind;
        maxAlong.current = next.distanceAlong;
        offRouteCount.current = 0;
        otherWalkwayCount.current = 0;
        previousHint.current = leftAt.segmentIndex;
        previousStartAlong.current = leftAt.distanceAlong;
        previousMatches.current = 0;
        lastRecheck.current = { at: Date.now(), along: next.distanceAlong };
        nav.current = { ...nav.current, route: candidate, previous: leaving };
        setRoute(candidate);
        setPreviousPath(remainingPath(leaving, leftAt));
        setIsWrongWay(false);
      };

      const previous = nav.current.previous;
      let nearPrevious = false;
      if (previous && trusted && !holding) {
        const onPrevious = trackProgress(previous, position, previousHint.current);
        previousHint.current = onPrevious.segmentIndex;
        nearPrevious = onPrevious.distanceFromRoute <= BACK_ON_PREVIOUS_METERS;
        const followingPrevious =
          onPrevious.distanceFromRoute <= BACK_ON_PREVIOUS_METERS &&
          next.distanceFromRoute > limit &&
          onPrevious.distanceAlong - previousStartAlong.current >= ALONG_PREVIOUS_METERS;
        previousMatches.current = followingPrevious ? previousMatches.current + 1 : 0;
        if (previousMatches.current >= 2) {
          adopt(previous, 'switched');
        } else if (onPrevious.distanceFromRoute > DROP_PREVIOUS_METERS) {
          nav.current = { ...nav.current, previous: null };
          setPreviousPath(null);
        }
      }

      const isOff = trusted && !holding && next.distanceFromRoute > limit;
      offRouteCount.current = isOff ? offRouteCount.current + 1 : 0;
      const clearlyLost = isOff && next.distanceFromRoute > 80;
      const onOtherWalkway =
        trusted &&
        !nearPrevious &&
        walkway !== undefined &&
        next.distanceFromRoute - walkway.distance >= Math.max(WALKWAY_GAP_METERS, accuracy);
      otherWalkwayCount.current = onOtherWalkway ? otherWalkwayCount.current + 1 : 0;

      maxAlong.current = Math.max(maxAlong.current, next.distanceAlong);
      const backtracked = maxAlong.current - next.distanceAlong;
      const segmentStart = active.path[Math.max(0, next.segmentIndex - 1)];
      const segmentEnd = active.path[next.segmentIndex] ?? segmentStart;
      const walkingOpposite =
        course.current !== undefined &&
        Math.abs(turnAngle(bearingDegrees(segmentStart, segmentEnd), course.current)) > OPPOSITE_DEGREES;
      const wrongWay =
        trusted &&
        !holding &&
        !isOff &&
        (backtracked > WRONG_WAY_WARN_METERS * slack || (walkingOpposite && backtracked > COURSE_MIN_METERS * slack));

      const lost =
        offRouteCount.current >= 2 ||
        otherWalkwayCount.current >= 2 ||
        clearlyLost ||
        (justGotOff && next.distanceFromRoute > limit);
      const turnedBack = wrongWay && backtracked > WRONG_WAY_REROUTE_METERS * slack;
      if (!changed && travel && (lost || turnedBack)) {
        rerouteStreet(position);
      } else if (!changed && graph && (lost || turnedBack)) {
        const rerouted = findRoute(graph, position, target.coordinate, {
          avoidStairs: current.avoidStairs,
          heading: facing(),
          start: walkway,
        });
        if (rerouted) adopt(rerouted, 'rerouted');
      } else if (!changed && graph && trusted && !holding && !wrongWay) {
        const since = lastRecheck.current;
        const due = Date.now() - since.at > RECHECK_INTERVAL_MS || next.distanceAlong - since.along > RECHECK_WALKED_METERS;
        if (due) {
          lastRecheck.current = { at: Date.now(), along: next.distanceAlong };
          const candidate = findRoute(graph, position, target.coordinate, { avoidStairs: current.avoidStairs });
          if (candidate && isMeaningfullyShorter(candidate.distance, next.remaining)) adopt(candidate, 'faster');
        }
      }

      if (changed) showNotice(changed);
      else setIsWrongWay(wrongWay);

      hint.current = next.segmentIndex;
      setProgress(next);

      const reachedEntrance =
        next.distanceAlong >= active.arrivalDistance - (travel ? STREET_ARRIVAL_METERS[travel] : ARRIVAL_METERS);
      const arrived = !holding && (reachedEntrance || distanceMeters(position, target.coordinate) <= NEAR_DESTINATION_METERS);
      if (arrived) {
        nav.current = { ...nav.current, arrived: true, previous: null };
        setHasArrived(true);
        setPreviousPath(null);
        setIsWrongWay(false);
      }
      const onRoute = next.distanceFromRoute <= SNAP_TO_ROUTE_METERS;
      const shown = onRoute ? next.point : (walkway?.point ?? position);
      if (nav.current.following) follow(followTarget(shown, travel));
    },
    [facing, follow, followTarget, rerouteStreet, showNotice],
  );

  useEffect(() => onFix(handleFix), [handleFix]);

  const reset = () => {
    hint.current = 0;
    offRouteCount.current = 0;
    otherWalkwayCount.current = 0;
    maxAlong.current = 0;
    lastRecheck.current = { at: Date.now(), along: 0 };
    streetReroute.current = { inflight: false, at: Date.now() };
    riding.current = false;
    setIsRiding(false);
    setPreviousPath(null);
    setIsWrongWay(false);
    setHasArrived(false);
    setNotice(undefined);
  };

  /** Starts guidance. Without a live location, the traveller steps through the directions by hand. */
  const start = useCallback(
    (chosen: Route, from: Coordinate | null) => {
      reset();
      nav.current = { ...nav.current, active: true, route: chosen, previous: null, arrived: false, following: !!from };
      setRoute(chosen);
      if (!from) {
        setManualStep(0);
        setProgress(progressAtDistance(chosen, 0));
        setIsFollowing(false);
        return;
      }
      setManualStep(null);
      setProgress(trackProgress(chosen, from, 0));
      setIsFollowing(true);
      follow(followTarget(from, chosen.travel));
    },
    [follow, followTarget],
  );

  const end = useCallback(() => {
    clearTimeout(followTimer.current);
    nav.current = { ...nav.current, active: false, route: null, previous: null, arrived: false };
    setRoute(null);
    setProgress(undefined);
    setManualStep(null);
    reset();
  }, []);

  /** Someone moved the map: stop following, and pick it back up once the map has sat still for a while. */
  const pauseFollowing = useCallback(() => {
    if (!nav.current.active || nav.current.arrived) return;
    nav.current = { ...nav.current, following: false };
    setIsFollowing(false);
    clearTimeout(followTimer.current);
    followTimer.current = setTimeout(() => {
      if (!nav.current.active) return;
      nav.current = { ...nav.current, following: true };
      setIsFollowing(true);
      const at = latestFix.current?.position;
      if (at) follow(followTarget(at, nav.current.route?.travel));
    }, FOLLOW_AGAIN_MS);
  }, [follow, followTarget]);

  const recenter = useCallback(() => {
    clearTimeout(followTimer.current);
    nav.current = { ...nav.current, following: true };
    setIsFollowing(true);
    const at = latestFix.current?.position;
    if (at) follow(followTarget(at, nav.current.route?.travel));
  }, [follow, followTarget]);

  /** Tapping the faded route means "take me that way", so the walk leads to it first. */
  const switchToPrevious = useCallback(() => {
    const current = nav.current;
    const at = latestFix.current?.position;
    if (!current.active || !current.previous || !current.route || !at) return false;
    if (current.previous.travel) {
      commit(current.previous, current.route, at, 'switched');
      return true;
    }
    const chosen = routeVia(walkGraph(), at, current.previous, { avoidStairs: current.avoidStairs });
    if (!chosen) return false;
    commit(chosen, current.route, at, 'switched');
    return true;
  }, [commit]);

  /** Without a live location, the traveller moves through the steps themselves. */
  const showStep = useCallback(
    (index: number) => {
      const current = nav.current.route;
      if (!current) return null;
      const clamped = Math.max(0, Math.min(current.steps.length - 1, index));
      const at = progressAtDistance(current, current.steps[clamped].startDistance);
      setManualStep(clamped);
      setProgress(at);
      const arrived = clamped === current.steps.length - 1;
      nav.current = { ...nav.current, arrived };
      setHasArrived(arrived);
      return { index: clamped, point: at.point };
    },
    [],
  );

  return {
    route,
    progress,
    previousPath,
    isWrongWay,
    hasArrived,
    notice,
    isRiding,
    isFollowing,
    manualStep,
    facing,
    speed,
    travelHeading,
    start,
    end,
    pauseFollowing,
    recenter,
    switchToPrevious,
    showStep,
  };
}
