import { useCallback, useEffect, useRef, useState } from 'react';

import { CAMPUS, contains, type Coordinate, type Place } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import type { RouteNotice } from '@/hooks/use-voice-guidance';
import { fetchTripRoute } from '@/lib/directions';
import { metersFromBuilding } from '@/lib/buildings';
import { getDevicePrefs } from '@/lib/device-prefs';
import { bearingDegrees, distanceMeters, turnAngle } from '@/lib/geo';
import { currentCompass, onFix, type Fix } from '@/lib/location';
import { createMotionTracker, isOnFoot, ON_FOOT_MAX_MPS, RIDING_MAX_MPS, type MotionState } from '@/lib/motion';
import {
  arrivedPrompt,
  createMissedLotWatch,
  missedPrompt,
  PARKING_PROMPT_MS,
  parkingOffer,
  type ParkingPrompt,
} from '@/lib/parking';
import {
  findRoute,
  matchWalkway,
  progressAtDistance,
  remainingPath,
  routeVia,
  sameWayAhead,
  trackProgress,
  type Route,
  type RouteProgress,
  type TravelMode,
  type WalkGraph,
} from '@/lib/routing';
import { currentSteps } from '@/lib/steps';
import { canSwitchTravel, createTravelSwitch, type SwitchableTravel } from '@/lib/travel-switch';

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
// How often a faded earlier route is checked against the route being walked, to drop it once both lead the same way.
const SAME_WAY_CHECK_MS = 3_000;
const WALKWAY_MATCH_METERS = 10;
const WALKWAY_GAP_METERS = 10;
// Campus paths run 10 to 15 m apart, about GPS error between buildings, so a switch needs three fixes in a row.
const OTHER_WALKWAY_FIXES = 3;
const STREET_REROUTE_GAP_MS = 5_000;
export const FOLLOW_ZOOM: Record<TravelMode, number> = { walk: 17.5, bike: 16.5, drive: 15.5 };
const STREET_ARRIVAL_METERS: Record<TravelMode, number> = { walk: 20, bike: 30, drive: 50 };
const TRAVEL_SLACK: Record<TravelMode, number> = { walk: 1, bike: 2, drive: 4 };
const FOLLOW_AGAIN_MS = 3_000;
const COURSE_SPEED_MPS = 0.7;
const MAX_SPEED_SLACK = 8;
const WALK_FOLLOW_ZOOM = 18;
// Arriving takes two fixes in a row, and "near the building" only counts on a fix this accurate.
const ARRIVAL_FIXES = 2;
const ARRIVAL_ACCURACY_METERS = 30;
// Indoors the fix is rough and jumps around, so standing within the destination's walls counts as arriving on its own.
const INSIDE_BUILDING_METERS = 8;
const INDOOR_ACCURACY_METERS = 150;
const INSIDE_FIXES = 2;
// A fix that would mean moving faster than this since the last good one is a GPS jump, not the traveller.
const MAX_BELIEVABLE_MPS: Record<TravelMode, number> = { walk: 12, bike: 20, drive: 60 };
// A walk or bike ride that started on streets switches to the campus paths once the traveller is on them.
const ON_CAMPUS_WALKWAY_METERS = 15;
const ON_CAMPUS_FIXES = 2;
const PARKED_METERS = 60;
// Following the steps by hand, a fix only takes over once it is this close to the route.
const TAKEOVER_METERS = 40;

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

/** Live guidance: progress, arrival, wrong way, rerouting, switching back, and holding still on a bus. */
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
  /** Where the traveller is shown: on the route when close to it, else on the walkway underfoot. */
  const [shownAt, setShownAt] = useState<Coordinate | null>(null);
  // How far along the route the dot is shown, while it sits on the route, so the dot and the line glide together.
  const [shownAlong, setShownAlong] = useState<number | null>(null);
  /** A parking choice shown on the map while driving. */
  const [parking, setParking] = useState<ParkingPrompt | null>(null);
  /** The trip just switched between driving and walking on its own. */
  const [travelSwitched, setTravelSwitched] = useState<{ to: SwitchableTravel; at: number } | null>(null);

  const nav = useRef({
    active: false,
    route: null as Route | null,
    previous: null as Route | null,
    destination,
    avoidStairs,
    following: true,
    arrived: false,
    facingUp,
    /** Following the steps by hand, without a live location. */
    manual: false,
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
  const sameWayCheck = useRef(0);
  const streetReroute = useRef({ inflight: false, at: 0, token: 0 });
  const parkingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const parkingOffered = useRef(false);
  const missedLots = useRef(createMissedLotWatch());
  // After driving right up to the place, the trip to the offered lot, started if the driver says yes.
  const parkingTrip = useRef<Route | null>(null);
  const arrivalCount = useRef(0);
  const insideCount = useRef(0);
  const travelSwitch = useRef(createTravelSwitch());
  // Someone who undoes a switch has said how they travel, so this trip stops switching on its own.
  const travelSwitchOff = useRef(false);
  const onCampusCount = useRef(0);
  const lastGood = useRef<{ position: Coordinate; at: number } | null>(null);
  // Where guidance last placed the traveller: their fix, or the step they are on when following by hand.
  const lastPoint = useRef<Coordinate | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const followTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    nav.current = { ...nav.current, destination, avoidStairs, facingUp };
  }, [destination, avoidStairs, facingUp]);

  useEffect(
    () => () => {
      clearTimeout(noticeTimer.current);
      clearTimeout(followTimer.current);
      clearTimeout(parkingTimer.current);
    },
    [],
  );

  /** The direction someone is actually travelling. Only a moving course counts. */
  const travelHeading = useCallback(
    () => (motionState.current.speed >= COURSE_SPEED_MPS ? course.current : undefined),
    [],
  );
  // Phone compass first at every speed so the map and cone stay live; GPS course only fills gaps.
  const facing = useCallback(() => currentCompass() ?? travelHeading(), [travelHeading]);
  const speed = useCallback(() => motionState.current.speed, []);

  // A card nobody answers keeps things as they are once it fades.
  const showParking = useCallback((prompt: ParkingPrompt | null) => {
    clearTimeout(parkingTimer.current);
    setParking(prompt);
    if (prompt) parkingTimer.current = setTimeout(() => setParking(null), PARKING_PROMPT_MS);
  }, []);

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

  // Without a notice the change is a handover to the same way on, so nothing is left behind on the map.
  const commit = useCallback(
    (chosen: Route, leaving: Route, position: Coordinate, asked?: RouteNotice) => {
      const leftAt = trackProgress(leaving, position, hint.current);
      const next = trackProgress(chosen, position, 0);
      // A new route that only leads back onto the old one is a quiet handover too, with nothing left behind or announced.
      const kind = asked && !sameWayAhead(chosen, next, leaving, leftAt) ? asked : undefined;
      hint.current = next.segmentIndex;
      maxAlong.current = next.distanceAlong;
      offRouteCount.current = 0;
      otherWalkwayCount.current = 0;
      previousHint.current = leftAt.segmentIndex;
      previousStartAlong.current = leftAt.distanceAlong;
      previousMatches.current = 0;
      lastRecheck.current = { at: Date.now(), along: next.distanceAlong };
      // Keep following through a reroute. Swapping the route line often looks like a finger pan on iOS, which
      // used to pause following and freeze the compass until someone tapped Recenter.
      const keepFollowing = nav.current.active && !nav.current.arrived && (nav.current.following || !!kind);
      nav.current = { ...nav.current, route: chosen, previous: kind ? leaving : null, following: keepFollowing };
      setRoute(chosen);
      setPreviousPath(kind ? remainingPath(leaving, leftAt) : null);
      setProgress(next);
      setIsWrongWay(false);
      if (kind) showNotice(kind);
      if (keepFollowing) {
        setIsFollowing(true);
        const onRoute = next.distanceFromRoute <= SNAP_TO_ROUTE_METERS;
        follow(followTarget(onRoute ? next.point : position, chosen.travel));
      }
    },
    [follow, followTarget, showNotice],
  );

  // Street routes are rerouted by asking the server again, which answers later, so this runs on its own.
  const rerouteStreet = useCallback(
    (
      position: Coordinate,
      asked = false,
      choice?: {
        parkAt?: string | null;
        skipLots?: readonly string[];
        travel?: TravelMode;
        onRoute?: (chosen: Route) => void;
      },
    ) => {
      const { route: leaving, destination: target, avoidStairs: stairs } = nav.current;
      const travel = choice?.travel ?? leaving?.travel;
      const state = streetReroute.current;
      if (!leaving || !travel || !target) return;
      // Someone tapping a choice gets an answer now; only automatic reroutes wait between tries.
      if (!asked && (state.inflight || Date.now() - state.at < STREET_REROUTE_GAP_MS)) return;
      const token = ++state.token;
      state.inflight = true;
      state.at = Date.now();
      const heading = travelHeading();
      const parkAt = choice && 'parkAt' in choice ? choice.parkAt : leaving.parkAt;
      const options = { avoidStairs: stairs, parkAt, skipLots: choice?.skipLots };
      fetchTripRoute(walkGraph(), position, target, travel, { ...options, heading })
        .then((candidate) =>
          candidate || heading === undefined ? candidate : fetchTripRoute(walkGraph(), position, target, travel, options),
        )
        .then((candidate) => {
          const current = nav.current;
          // A newer request, the trip ending, or a route change here makes this answer stale.
          if (!candidate || token !== state.token || !current.active || current.route !== leaving || current.arrived) return;
          // A parking choice already has its own card with a way back, so it skips the earlier route pill.
          commit(candidate, leaving, latestFix.current?.position ?? position, choice ? undefined : 'rerouted');
          choice?.onRoute?.(candidate);
        })
        .catch(() => undefined)
        .finally(() => {
          if (token === state.token) state.inflight = false;
        });
    },
    [commit, travelHeading],
  );

  // A fresh street route for the new way of travel, from where the traveller is now.
  const switchTravel = useCallback(
    (position: Coordinate, to: SwitchableTravel, onRoute?: () => void) => {
      rerouteStreet(position, true, {
        travel: to,
        parkAt: undefined,
        onRoute: () => {
          showParking(null);
          missedLots.current.reset();
          parkingOffered.current = to === 'walk';
          onRoute?.();
        },
      });
    },
    [rerouteStreet, showParking],
  );

  // Driving right up to the place, then needing a lot: the trip there is ready before the card asks.
  const offerParkingHere = useCallback(
    (position: Coordinate, target: Place) => {
      fetchTripRoute(walkGraph(), position, target, 'drive', { avoidStairs: nav.current.avoidStairs })
        .then((trip) => {
          const prompt = trip && arrivedPrompt(trip, target.name);
          if (!trip || !prompt || !nav.current.arrived) return;
          parkingTrip.current = trip;
          showParking(prompt);
        })
        .catch(() => undefined);
    },
    [showParking],
  );

  const handleFix = useCallback(
    (fix: Fix) => {
      const { position, accuracy, heading, speed: reported } = fix;
      const guiding = nav.current.active && nav.current.route !== null;
      const good = lastGood.current;
      if (guiding && good) {
        const seconds = Math.max((fix.at - good.at) / 1000, 0.5);
        const limit = MAX_BELIEVABLE_MPS[nav.current.route?.travel ?? 'walk'];
        if (distanceMeters(good.position, position) / seconds > limit && accuracy > 10) return;
      }
      lastGood.current = { position, at: fix.at };
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
      lastPoint.current = position;

      const current = nav.current;
      if (!current.active || !current.route || !current.destination) return;
      // Past the door the dot stays live and the map keeps up, so people can walk on inside to the room.
      if (current.arrived) {
        setShownAt(null);
        setShownAlong(null);
        if (current.following) follow(followTarget(position, current.route.travel));
        return;
      }
      if (current.manual) {
        const probe = trackProgress(current.route, position, hint.current);
        if (accuracy > UNTRUSTED_ACCURACY_METERS || probe.distanceFromRoute > TAKEOVER_METERS) return;
        // On the route for real now: guidance follows the location from here.
        nav.current = { ...current, manual: false, following: true };
        setIsFollowing(true);
      }
      setManualStep(null);

      let active = current.route;
      let next = trackProgress(active, position, hint.current);
      let changed: RouteNotice | undefined;
      const trusted = accuracy <= UNTRUSTED_ACCURACY_METERS;
      const graph: WalkGraph | null = active.travel ? null : walkGraph();
      const target = current.destination;
      const travel = active.travel;

      // Getting off a bus mid trip, or picked up mid walk, swaps the street route to match.
      const switching = canSwitchTravel(travel) && !travelSwitchOff.current && getDevicePrefs().autoTravel;
      if (switching) {
        const sample = { at: Date.now(), speed: state.speed, motion: state.motion, reported, steps: currentSteps() };
        const to = travelSwitch.current.update(sample, travel);
        if (to) switchTravel(position, to, () => setTravelSwitched({ to, at: Date.now() }));
      }
      // With the switch on, riding on a walk turns the trip into a drive instead of being announced.
      const nowRiding =
        travel === 'drive' || switching ? false : travel === 'bike' ? state.motion === 'vehicle' : !isOnFoot(state.motion);
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

      // A trip from off campus follows streets until the campus paths, and a drive until the car is parked.
      const parked =
        travel === 'drive' &&
        active.campusFrom !== undefined &&
        isOnFoot(state.motion) &&
        next.distanceAlong >= active.campusFrom - PARKED_METERS;
      const onFoot = (travel === 'walk' || travel === 'bike') && !holding;
      if ((onFoot || parked) && trusted && contains(CAMPUS.map.walkingArea, position)) {
        const onPath = matchWalkway(walkGraph(), position, { avoidStairs: current.avoidStairs });
        onCampusCount.current = onPath && onPath.distance <= ON_CAMPUS_WALKWAY_METERS ? onCampusCount.current + 1 : 0;
        if (onCampusCount.current >= ON_CAMPUS_FIXES) {
          onCampusCount.current = 0;
          const campus = findRoute(walkGraph(), position, target.coordinate, {
            avoidStairs: current.avoidStairs,
            heading: facing(),
            start: onPath,
          });
          if (campus) {
            commit(campus, active, position, active.campusFrom === undefined ? 'rerouted' : undefined);
            return;
          }
        }
      } else {
        onCampusCount.current = 0;
      }

      // About a mile out the lot is offered; driving past it finds the best lot still ahead instead of turning back.
      let missedLot = false;
      if (travel === 'drive' && trusted) {
        if (!parkingOffered.current) {
          const offer = parkingOffer(active, next, target.name);
          if (offer) {
            parkingOffered.current = true;
            showParking(offer);
          }
        }
        const lot = active.parkAt;
        if (lot && missedLots.current.update(active, next, position, fastest)) {
          missedLot = true;
          rerouteStreet(position, true, {
            parkAt: undefined,
            skipLots: [lot],
            onRoute: (chosen) => showParking(missedPrompt(chosen, lot, target.name)),
          });
        }
      }

      const adopt = (candidate: Route, kind: RouteNotice) => {
        const leaving = active;
        const leftAt = next;
        active = candidate;
        next = trackProgress(candidate, position, 0);
        const quiet = sameWayAhead(candidate, next, leaving, leftAt);
        changed = quiet ? undefined : kind;
        maxAlong.current = next.distanceAlong;
        offRouteCount.current = 0;
        otherWalkwayCount.current = 0;
        previousHint.current = leftAt.segmentIndex;
        previousStartAlong.current = leftAt.distanceAlong;
        previousMatches.current = 0;
        lastRecheck.current = { at: Date.now(), along: next.distanceAlong };
        // Same as commit: a live reroute must not drop following, or the compass sticks until Recenter.
        nav.current = { ...nav.current, route: candidate, previous: quiet ? null : leaving, following: true };
        setIsFollowing(true);
        setRoute(candidate);
        setPreviousPath(quiet ? null : remainingPath(leaving, leftAt));
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
        const checkSameWay =
          nearPrevious && next.distanceFromRoute <= limit && Date.now() - sameWayCheck.current > SAME_WAY_CHECK_MS;
        if (checkSameWay) sameWayCheck.current = Date.now();
        // On a stretch both routes share and lead the same way on from, the faded one offers nothing.
        const sameWay = checkSameWay && sameWayAhead(active, next, previous, onPrevious);
        if (previousMatches.current >= 2) {
          adopt(previous, 'switched');
        } else if (onPrevious.distanceFromRoute > DROP_PREVIOUS_METERS || sameWay) {
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
        otherWalkwayCount.current >= OTHER_WALKWAY_FIXES ||
        clearlyLost ||
        (justGotOff && next.distanceFromRoute > limit);
      const turnedBack = wrongWay && backtracked > WRONG_WAY_REROUTE_METERS * slack;
      if (!changed && travel && (lost || turnedBack)) {
        if (!missedLot) rerouteStreet(position);
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
      // Only someone on the route reaches its end; being near its line from far off is not arriving.
      const onTheRoute = next.distanceFromRoute <= limit;
      const nearDestination =
        accuracy <= ARRIVAL_ACCURACY_METERS && distanceMeters(position, target.coordinate) <= NEAR_DESTINATION_METERS;
      arrivalCount.current = trusted && !holding && ((reachedEntrance && onTheRoute) || nearDestination) ? arrivalCount.current + 1 : 0;
      // Nobody rides a bus inside a building, so this skips the riding check that indoor jumps can trip.
      const fromWalls = metersFromBuilding(position, target.id);
      const insideTarget =
        (!travel || travel === 'walk') &&
        accuracy <= INDOOR_ACCURACY_METERS &&
        (fromWalls !== undefined
          ? fromWalls <= INSIDE_BUILDING_METERS
          : distanceMeters(position, target.coordinate) <= NEAR_DESTINATION_METERS);
      insideCount.current = insideTarget ? insideCount.current + 1 : 0;
      const arrived = arrivalCount.current >= ARRIVAL_FIXES || insideCount.current >= INSIDE_FIXES;
      if (arrived) {
        nav.current = { ...nav.current, arrived: true, previous: null };
        setHasArrived(true);
        setPreviousPath(null);
        setIsWrongWay(false);
        if (travel === 'drive' && active.parkAt === null) offerParkingHere(position, target);
      }
      const onRoute = next.distanceFromRoute <= SNAP_TO_ROUTE_METERS;
      const shown = onRoute ? next.point : (walkway?.point ?? position);
      setShownAt(shown);
      setShownAlong(onRoute ? next.distanceAlong : null);
      if (nav.current.following) follow(followTarget(shown, travel));
    },
    [commit, facing, follow, followTarget, offerParkingHere, rerouteStreet, showNotice, showParking, switchTravel],
  );

  useEffect(() => onFix(handleFix), [handleFix]);

  const reset = () => {
    hint.current = 0;
    offRouteCount.current = 0;
    otherWalkwayCount.current = 0;
    maxAlong.current = 0;
    lastRecheck.current = { at: Date.now(), along: 0 };
    streetReroute.current = { inflight: false, at: Date.now(), token: streetReroute.current.token + 1 };
    clearTimeout(parkingTimer.current);
    setParking(null);
    parkingOffered.current = false;
    missedLots.current.reset();
    parkingTrip.current = null;
    riding.current = false;
    arrivalCount.current = 0;
    insideCount.current = 0;
    travelSwitch.current.reset();
    travelSwitchOff.current = false;
    setTravelSwitched(null);
    onCampusCount.current = 0;
    lastGood.current = null;
    lastPoint.current = null;
    setShownAt(null);
    setShownAlong(null);
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
      lastPoint.current = from ?? chosen.path[0];
      nav.current = {
        ...nav.current,
        active: true,
        route: chosen,
        previous: null,
        arrived: false,
        following: !!from,
        manual: !from,
      };
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

  /** Someone moved the map: stop following until they recenter or the map sits still. */
  const pauseFollowing = useCallback(() => {
    if (!nav.current.active || nav.current.arrived) return;
    nav.current = { ...nav.current, following: false };
    setIsFollowing(false);
    clearTimeout(followTimer.current);
  }, []);

  /** After a pan settles, pick following back up once the map has sat still for a while. */
  const scheduleFollowAgain = useCallback(() => {
    if (!nav.current.active || nav.current.arrived || nav.current.following) return;
    clearTimeout(followTimer.current);
    followTimer.current = setTimeout(() => {
      if (!nav.current.active || nav.current.arrived) return;
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

  /** Avoid stairs switched on or off mid route: the way is found again from where the traveller is now. */
  const changeAvoidStairs = useCallback(
    (avoid: boolean) => {
      const current = nav.current;
      const at = lastPoint.current;
      if (!current.active || !current.route || !current.destination || current.arrived || !at) return true;
      if (current.route.travel) {
        nav.current = { ...current, avoidStairs: avoid };
        rerouteStreet(at, true);
        return true;
      }
      const chosen = findRoute(walkGraph(), at, current.destination.coordinate, { avoidStairs: avoid, heading: facing() });
      if (!chosen) return false;
      nav.current = { ...nav.current, avoidStairs: avoid };
      commit(chosen, current.route, at, 'rerouted');
      // Following by hand starts the new route from its first step.
      setManualStep((step) => (step === null ? null : 0));
      return true;
    },
    [commit, facing, rerouteStreet],
  );

  /** Without a live location, the traveller moves through the steps themselves. */
  const showStep = useCallback(
    (index: number) => {
      const current = nav.current.route;
      if (!current) return null;
      const clamped = Math.max(0, Math.min(current.steps.length - 1, index));
      const at = progressAtDistance(current, current.steps[clamped].startDistance);
      lastPoint.current = at.point;
      setManualStep(clamped);
      setProgress(at);
      const arrived = clamped === current.steps.length - 1;
      nav.current = { ...nav.current, arrived };
      setHasArrived(arrived);
      return { index: clamped, point: at.point };
    },
    [],
  );

  /** Goes back to how the trip was travelling before it switched, and stops switching for the rest of it. */
  const undoTravelSwitch = useCallback(() => {
    const current = nav.current.route?.travel;
    const at = latestFix.current?.position ?? lastPoint.current;
    travelSwitchOff.current = true;
    setTravelSwitched(null);
    if (!canSwitchTravel(current) || !at) return null;
    const back: SwitchableTravel = current === 'walk' ? 'drive' : 'walk';
    switchTravel(at, back);
    return back;
  }, [switchTravel]);

  /** Keeps the lot on the card. */
  const keepParking = useCallback(() => showParking(null), [showParking]);

  /** Drives right up to the place instead of parking first. */
  const driveCloser = useCallback(() => {
    showParking(null);
    const at = latestFix.current?.position ?? lastPoint.current;
    if (at) rerouteStreet(at, true, { parkAt: null });
  }, [rerouteStreet, showParking]);

  /** Heads for this lot instead, such as the one just driven past. */
  const parkInstead = useCallback(
    (lotId: string) => {
      showParking(null);
      missedLots.current.reset();
      const at = latestFix.current?.position ?? lastPoint.current;
      if (at) rerouteStreet(at, true, { parkAt: lotId });
    },
    [rerouteStreet, showParking],
  );

  /** After driving right up to the place, drives on to the offered lot and walks back. */
  const parkAfterArriving = useCallback(() => {
    const trip = parkingTrip.current;
    showParking(null);
    if (!trip) return;
    start(trip, latestFix.current?.position ?? trip.path[0]);
    // The driver just chose this lot, so the trip does not ask about it again.
    parkingOffered.current = true;
  }, [showParking, start]);

  return {
    route,
    progress,
    shownAt,
    shownAlong,
    previousPath,
    isWrongWay,
    hasArrived,
    notice,
    isRiding,
    travelSwitched,
    undoTravelSwitch,
    isFollowing,
    manualStep,
    parking,
    facing,
    speed,
    travelHeading,
    start,
    end,
    pauseFollowing,
    scheduleFollowAgain,
    recenter,
    switchToPrevious,
    showStep,
    changeAvoidStairs,
    keepParking,
    driveCloser,
    parkInstead,
    parkAfterArriving,
  };
}
