"use client";

import { Button, Separator, Spinner, Surface, ToggleButton, ToggleButtonGroup, toast } from "@heroui/react";
import { Building2, CalendarClock, Compass, LocateFixed, Navigation, Radio, School, UserRound, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccountPanel, initials } from "@/components/account-panel";
import { CampusMap, type CampusMapHandle, type MapPerson } from "@/components/campus-map";
import { DirectionsPanel, type RouteIssue } from "@/components/directions-panel";
import { DragScroll } from "@/components/drag-scroll";
import { LaunchSplash } from "@/components/launch-splash";
import { NavigationHud, type RouteNotice } from "@/components/navigation-hud";
import { MeetupPeek, MeetupSheet } from "@/components/meetup-sheet";
import { PeoplePanel, initialsFor } from "@/components/people-panel";
import { PersonCard } from "@/components/person-card";
import { PlaceSheet } from "@/components/place-sheet";
import { SchedulePanel } from "@/components/schedule-panel";
import { SearchPanel } from "@/components/search-panel";
import { SHEET_FULL_WRAP, SHEET_PEEK_WRAP, SheetLayer, SheetPeek } from "@/components/sheet-chrome";
import { TabBar, type TabId } from "@/components/tab-bar";
import { CAMPUS, CAMPUS_CENTER, CATEGORY_LABELS, PLACES, getPlace, type Coordinate, type Place } from "@/data/campus";
import { useAccount } from "@/hooks/use-account";
import { useGeolocation, type GeoFix } from "@/hooks/use-geolocation";
import { useHeading } from "@/hooks/use-heading";
import { useMeetupLive } from "@/hooks/use-meetup-live";
import { useSocial } from "@/hooks/use-social";
import { useVoiceChoice } from "@/hooks/use-voice-choice";
import { useVoiceGuidance } from "@/hooks/use-voice-guidance";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { campusActivityByPlace, eventsAtPlace } from "@/lib/campus-activity";
import { MAP_FILTERS, type MapFilter } from "@/lib/categories";
import { fetchTripRoute } from "@/lib/directions";
import { bearingDegrees, distanceMeters, turnAngle } from "@/lib/geo";
import { ON_FOOT_MAX_MPS, RIDING_MAX_MPS, createMotionTracker, isOnFoot, type MotionState } from "@/lib/motion";
import { loadSchedule, saveSchedule, type ClassEntry } from "@/lib/schedule";
import { MY_LOCATION, tripPlan, withStop } from "@/lib/stops";
import {
  findRoute,
  matchWalkway,
  parseGraph,
  progressAtDistance,
  remainingPath,
  routeVia,
  trackProgress,
  type RawWalkGraph,
  type Route,
  type RouteProgress,
  type TravelMode,
  type WalkGraph,
} from "@/lib/routing";

const OFF_CAMPUS_METERS = CAMPUS.map.onCampusRadiusMeters;
const WALKING_AREA = CAMPUS.map.walkingArea;
const NEAR_CAMPUS_PATH_METERS = 40;
// Following the steps by hand, a fix only takes over once it is this close to the route.
const TAKEOVER_METERS = 40;

// Campus walking directions only exist where the campus path network does.
function onCampusPaths({ latitude, longitude }: Coordinate) {
  return (
    latitude >= WALKING_AREA.south &&
    latitude <= WALKING_AREA.north &&
    longitude >= WALKING_AREA.west &&
    longitude <= WALKING_AREA.east
  );
}
const ARRIVAL_METERS = 15;
const NEAR_DESTINATION_METERS = 25;
const WEAK_ACCURACY_METERS = 60;
const UNTRUSTED_ACCURACY_METERS = 65;
const SNAP_TO_ROUTE_METERS = 14;
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
// Within this of a walkway, that walkway is where the walker is.
const WALKWAY_MATCH_METERS = 10;
// How much closer another walkway has to be than the route before it counts as the path they took.
const WALKWAY_GAP_METERS = 10;
// Street routes come from a shared free server, so previews and reroutes are spaced out.
const STREET_REFRESH_METERS = 75;
const STREET_REROUTE_GAP_MS = 5_000;
// A trip that started on streets moves onto the campus paths after two fixes this close to one.
const ON_CAMPUS_WALKWAY_METERS = 15;
const ON_CAMPUS_FIXES = 2;
const PARKED_METERS = 60;
const FOLLOW_ZOOM: Record<TravelMode, number> = { walk: 17.5, bike: 16.5, drive: 15.5 };
const STREET_ARRIVAL_METERS: Record<TravelMode, number> = { walk: 20, bike: 30, drive: 50 };
// Faster travel covers more ground between fixes, so wrong way and off route need more room before firing.
const TRAVEL_SLACK: Record<TravelMode, number> = { walk: 1, bike: 2, drive: 4 };
// After someone moves the map while navigating, following resumes once it has sat still this long.
const FOLLOW_AGAIN_MS = 8_000;
// Standing still, a phone's reported course is meaningless, so it only counts above a walking pace.
const COURSE_SPEED_MPS = 0.7;
// Above this, the way the phone points stops meaning anything: it is in a pocket, a bag, or a hand on a bus.
const COURSE_OVER_COMPASS_MPS = 5;
// Fast movement puts GPS fixes further behind, so the off route and wrong way limits widen with speed.
const MAX_SPEED_SLACK = 8;

// Looser on a weak GPS fix so a jumpy signal does not trigger constant re-routing.
function offRouteLimit(accuracy: number) {
  return Math.min(45, Math.max(20, accuracy * 1.5));
}

function isMeaningfullyShorter(candidate: number, current: number) {
  return current - candidate > Math.max(25, current * 0.15);
}

type Mode = "browse" | "directions" | "navigate";

type MapAppProps = {
  initialPlaceId?: string;
  initialRoom?: string;
};

const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;

function sheetPadding() {
  return isDesktop() ? { left: 440 } : { top: 120, bottom: Math.round(window.innerHeight * 0.4) };
}

function peekPadding() {
  return isDesktop() ? { bottom: 100 } : { top: 120, bottom: 110 };
}

function previewPadding() {
  return isDesktop()
    ? { left: 480, right: 80, top: 80, bottom: 80 }
    : { top: 70, left: 40, right: 40, bottom: Math.round(window.innerHeight * 0.5) };
}

function navigationPadding() {
  return isDesktop() ? { left: 440 } : { top: 140, bottom: 140 };
}

function MapViewControls({
  buildingView,
  locating,
  located,
  rotated,
  onToggleBuildingView,
  onCampus,
  onLocate,
  onPointNorth,
}: {
  buildingView: boolean;
  locating: boolean;
  located: boolean;
  rotated: boolean;
  onToggleBuildingView: () => void;
  onCampus: () => void;
  onLocate: () => void;
  onPointNorth: () => void;
}) {
  return (
    <Surface className="glass-chrome flex flex-col overflow-hidden rounded-2xl p-1 shadow-lg">
      {rotated ? (
        <>
          <Button isIconOnly variant="ghost" aria-label="Point north" onPress={onPointNorth}>
            <Compass aria-hidden />
          </Button>
          <Separator className="mx-2 my-0.5 w-auto" />
        </>
      ) : null}
      <Button
        isIconOnly
        variant="ghost"
        aria-label={buildingView ? "Exit building view" : "Building view"}
        aria-pressed={buildingView}
        onPress={onToggleBuildingView}
        className={buildingView ? "text-accent" : undefined}>
        <Building2 aria-hidden />
      </Button>
      <Separator className="mx-2 my-0.5 w-auto" />
      <Button
        isIconOnly
        variant="ghost"
        aria-label="Show whole campus"
        onPress={onCampus}>
        <School aria-hidden />
      </Button>
      <Separator className="mx-2 my-0.5 w-auto" />
      <Button
        isIconOnly
        variant="ghost"
        aria-label="Show my location"
        isDisabled={locating}
        onPress={onLocate}
        className={located ? "text-accent" : undefined}>
        {locating ? <Spinner size="sm" /> : <LocateFixed aria-hidden />}
      </Button>
    </Surface>
  );
}

export function MapApp({ initialPlaceId, initialRoom }: MapAppProps) {
  const mapRef = useRef<CampusMapHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("browse");
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(initialPlaceId);
  const [room, setRoom] = useState(initialRoom);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isPeopleOpen, setIsPeopleOpen] = useState(false);
  const [meetupId, setMeetupId] = useState<string | null>(null);
  const [isMeetupSheetOpen, setIsMeetupSheetOpen] = useState(true);
  const [isScheduleExpanded, setIsScheduleExpanded] = useState(true);
  const [isPeopleExpanded, setIsPeopleExpanded] = useState(true);
  const [isAccountExpanded, setIsAccountExpanded] = useState(true);
  const [isPlaceExpanded, setIsPlaceExpanded] = useState(true);
  const [isDirectionsExpanded, setIsDirectionsExpanded] = useState(true);
  const [buildingView, setBuildingView] = useState(false);
  const [activePersonId, setActivePersonId] = useState<string | null>(null);
  const account = useAccount();
  const voiceChoice = useVoiceChoice(account.state);
  const social = useSocial(account.state);
  const [classes, setClasses] = useState<ClassEntry[]>([]);

  const [graph, setGraph] = useState<WalkGraph | null>(null);
  const [graphFailed, setGraphFailed] = useState(false);
  const [origin, setOrigin] = useState(MY_LOCATION);
  // Places to visit on the way, in order, before the destination.
  const [stops, setStops] = useState<string[]>([]);
  // While guiding: every place visited in order, fixed at the start, and which one is being walked to now.
  const [legs, setLegs] = useState<string[]>([]);
  const [leg, setLeg] = useState(0);
  // Following the steps by hand, a fix only takes over once it is on the route.
  const manualRef = useRef(false);
  const [avoidStairs, setAvoidStairs] = useState(false);

  const [navRoute, setNavRoute] = useState<Route | null>(null);
  const [progress, setProgress] = useState<RouteProgress>();
  const [isFollowing, setIsFollowing] = useState(true);
  const [routeNotice, setRouteNotice] = useState<RouteNotice>();
  const [previousRoute, setPreviousRoute] = useState<{ route: Route; path: Coordinate[] } | null>(null);
  const [isWrongWay, setIsWrongWay] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [walkwayPoint, setWalkwayPoint] = useState<Coordinate>();
  const [isRotated, setIsRotated] = useState(false);
  // Navigation turns the map the way the walker faces, like every navigation app.
  const [facingUp, setFacingUp] = useState(true);
  // Set when navigating without a live location: the walker moves through the steps themselves.
  const [manualStep, setManualStep] = useState<number | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>("drive");
  const [streetResult, setStreetResult] = useState<{ key: string; route: Route | null; failed: boolean } | null>(null);

  const selected = getPlace(selectedId);
  const placeEvents = useMemo(
    () => (selectedId && social.signedIn ? eventsAtPlace(social.campus, selectedId) : []),
    [selectedId, social.signedIn, social.campus],
  );
  const activityByPlace = useMemo(() => {
    if (!social.signedIn) return undefined;
    const map: Record<string, number> = {};
    for (const row of campusActivityByPlace(social.campus)) map[row.placeId] = row.count;
    return Object.keys(map).length ? map : undefined;
  }, [social.signedIn, social.campus]);

  const centerOnFixRef = useRef(false);
  const navRef = useRef({
    mode,
    navRoute,
    previousRoute: previousRoute?.route ?? null,
    graph,
    avoidStairs,
    isFollowing,
    hasArrived,
    destination: selected,
  });
  const maxAlongRef = useRef(0);
  const lastCourseFixRef = useRef<Coordinate | null>(null);
  const courseRef = useRef<number | undefined>(undefined);
  const previousHintRef = useRef(0);
  const previousStartAlongRef = useRef(0);
  const previousMatchesRef = useRef(0);

  const handleHeading = useCallback((degrees: number) => mapRef.current?.setHeading(degrees), []);
  const { request: requestHeading, setCourse, compass } = useHeading(handleHeading);
  const motionRef = useRef(createMotionTracker());
  const motionStateRef = useRef<MotionState>({ speed: 0, motion: "still" });
  // Set while moving faster than the way of travel allows, like walking directions on a bus.
  const ridingRef = useRef(false);
  const onCampusCountRef = useRef(0);
  const [isRiding, setIsRiding] = useState(false);

  // The direction someone is actually travelling. Only a moving course counts; roads are matched to this.
  const travelHeading = useCallback(
    () => (motionStateRef.current.speed >= COURSE_SPEED_MPS ? courseRef.current : undefined),
    [],
  );
  // The way someone faces: their travel direction while moving, the compass while they stand still.
  const facing = useCallback(() => travelHeading() ?? compass(), [travelHeading, compass]);
  const progressHintRef = useRef(0);
  const offRouteCountRef = useRef(0);
  const otherWalkwayCountRef = useRef(0);
  const lastRecheckRef = useRef({ at: 0, along: 0 });
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const latestFixRef = useRef<Coordinate | null>(null);
  const streetFetchRef = useRef<{ key: string; origin: Coordinate } | null>(null);
  const streetRerouteRef = useRef({ inflight: false, at: 0 });

  const followAgainRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);
  useEffect(() => () => clearTimeout(followAgainRef.current), []);

  // Picks up following where the walker is right now, not where they were when the timer started.
  const followAgain = useCallback(() => {
    clearTimeout(followAgainRef.current);
    const nav = navRef.current;
    if (nav.mode !== "navigate" || nav.isFollowing) return;
    navRef.current = { ...nav, isFollowing: true };
    setIsFollowing(true);
    const at = latestFixRef.current;
    const travel = nav.navRoute?.travel;
    if (at) mapRef.current?.follow(at, navigationPadding(), travel ? FOLLOW_ZOOM[travel] : undefined);
  }, []);

  // Swaps in a new route and keeps the one being left on the map, faded, unless it is a quiet handover to the same way on.
  const commitRoute = useCallback((chosen: Route, leaving: Route, position: Coordinate, notice?: RouteNotice) => {
    const leftAt = trackProgress(leaving, position, progressHintRef.current);
    const next = trackProgress(chosen, position, 0);
    progressHintRef.current = next.segmentIndex;
    maxAlongRef.current = next.distanceAlong;
    offRouteCountRef.current = 0;
    otherWalkwayCountRef.current = 0;
    previousHintRef.current = leftAt.segmentIndex;
    previousStartAlongRef.current = leftAt.distanceAlong;
    previousMatchesRef.current = 0;
    lastRecheckRef.current = { at: Date.now(), along: next.distanceAlong };
    navRef.current = { ...navRef.current, navRoute: chosen, previousRoute: notice ? leaving : null };
    setNavRoute(chosen);
    setPreviousRoute(notice ? { route: leaving, path: remainingPath(leaving, leftAt) } : null);
    setProgress(next);
    setIsWrongWay(false);
    if (!notice) return;
    setRouteNotice(notice);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setRouteNotice(undefined), NOTICE_MS);
  }, []);

  // Street routes are rerouted by asking the server again, which answers later, so this runs on its own.
  const rerouteStreet = useCallback(
    (position: Coordinate, asked = false) => {
      const nav = navRef.current;
      const leaving = nav.navRoute;
      const travel = leaving?.travel;
      const state = streetRerouteRef.current;
      // Someone changing a setting gets an answer now; only automatic reroutes wait between tries.
      if (!leaving || !travel || !nav.destination || state.inflight || (!asked && Date.now() - state.at < STREET_REROUTE_GAP_MS)) {
        return;
      }
      state.inflight = true;
      state.at = Date.now();
      const { destination, graph } = nav;
      const heading = travelHeading();
      fetchTripRoute(graph, position, destination, travel, { avoidStairs: nav.avoidStairs, heading })
        // If nothing runs the way they are going, a route without the heading beats no route at all.
        .then((candidate) =>
          candidate || heading === undefined
            ? candidate
            : fetchTripRoute(graph, position, destination, travel, { avoidStairs: nav.avoidStairs }),
        )
        .then((candidate) => {
          const current = navRef.current;
          // An answer that lands after the trip ended, or after the route already changed, is stale.
          if (!candidate || current.mode !== "navigate" || current.navRoute !== leaving || current.hasArrived) return;
          commitRoute(candidate, leaving, latestFixRef.current ?? position, "rerouted");
        })
        // Guidance carries on along the current route; the next fix that is still off route asks again.
        .catch(() => undefined)
        .finally(() => {
          state.inflight = false;
        });
    },
    [commitRoute, travelHeading],
  );

  const handlePosition = useCallback(
    ({ position, accuracy, heading, speed }: GeoFix) => {
      if (centerOnFixRef.current) {
        centerOnFixRef.current = false;
        if (distanceMeters(position, CAMPUS_CENTER) > OFF_CAMPUS_METERS) {
          toast.info("You look off campus", { description: "Pick a place and tap Directions to drive, walk, or bike here." });
        } else {
          mapRef.current?.focus(position);
        }
      }

      const motionState = motionRef.current.update({ position, accuracy, speed }, Date.now());
      motionStateRef.current = motionState;
      const courseWins = motionState.speed >= COURSE_OVER_COMPASS_MPS;

      // A phone that reports its own course while moving knows better than two fixes compared by hand.
      if (heading !== undefined && (speed ?? 0) >= COURSE_SPEED_MPS) {
        courseRef.current = heading;
        setCourse(heading, courseWins);
        lastCourseFixRef.current = position;
      } else {
        const lastCourseFix = lastCourseFixRef.current;
        if (!lastCourseFix || distanceMeters(lastCourseFix, position) >= COURSE_MIN_METERS) {
          if (lastCourseFix && accuracy <= UNTRUSTED_ACCURACY_METERS) {
            courseRef.current = bearingDegrees(lastCourseFix, position);
            setCourse(courseRef.current, courseWins);
          }
          lastCourseFixRef.current = position;
        }
      }
      latestFixRef.current = position;

      const nav = navRef.current;
      if (nav.mode !== "navigate" || !nav.navRoute || !nav.destination || nav.hasArrived) return;
      if (manualRef.current) {
        const probe = trackProgress(nav.navRoute, position, progressHintRef.current);
        if (accuracy > UNTRUSTED_ACCURACY_METERS || probe.distanceFromRoute > TAKEOVER_METERS) return;
        // On the route for real now: guidance follows the location from here.
        manualRef.current = false;
        navRef.current = { ...navRef.current, isFollowing: true };
        setIsFollowing(true);
      }
      setManualStep(null);

      let route = nav.navRoute;
      let next = trackProgress(route, position, progressHintRef.current);
      let notice: RouteNotice | undefined;
      const trusted = accuracy <= UNTRUSTED_ACCURACY_METERS;
      const { graph, destination } = nav;
      const travel = route.travel;

      // Too fast for the way of travel, like a bus, so guidance holds instead of rerouting onto the road.
      const riding =
        travel === "drive" ? false : travel === "bike" ? motionState.motion === "vehicle" : !isOnFoot(motionState.motion);
      const justGotOff = ridingRef.current && !riding;
      if (riding !== ridingRef.current) {
        ridingRef.current = riding;
        setIsRiding(riding);
      }
      // Being sure someone is riding takes a few seconds.
      const fastest = Math.max(motionState.speed, speed ?? 0);
      const holding =
        riding || (travel !== "drive" && fastest >= (travel === "bike" ? RIDING_MAX_MPS : ON_FOOT_MAX_MPS));

      const slack = Math.max(TRAVEL_SLACK[travel ?? "walk"], Math.min(MAX_SPEED_SLACK, motionState.speed / 2));
      const limit = offRouteLimit(accuracy) * Math.sqrt(slack);

      // Matching to the walkway underfoot catches shortcuts and stairs early, and gives the dot a path.
      const match =
        graph && !travel && !holding ? matchWalkway(graph, position, { avoidStairs: nav.avoidStairs }) : undefined;
      const walkway = match && match.distance <= WALKWAY_MATCH_METERS ? match : undefined;
      const rerouteFromHere = (g: WalkGraph) =>
        findRoute(g, position, destination.coordinate, {
          avoidStairs: nav.avoidStairs,
          heading: facing(),
          start: walkway,
        });

      // A trip from off campus follows streets until the campus paths, and a drive until the car is parked.
      const parked =
        travel === "drive" &&
        route.campusFrom !== undefined &&
        isOnFoot(motionState.motion) &&
        next.distanceAlong >= route.campusFrom - PARKED_METERS;
      const onFoot = (travel === "walk" || travel === "bike") && !holding;
      if (graph && (onFoot || parked) && trusted && onCampusPaths(position)) {
        const onPath = matchWalkway(graph, position, { avoidStairs: nav.avoidStairs });
        onCampusCountRef.current = onPath && onPath.distance <= ON_CAMPUS_WALKWAY_METERS ? onCampusCountRef.current + 1 : 0;
        if (onCampusCountRef.current >= ON_CAMPUS_FIXES) {
          onCampusCountRef.current = 0;
          const campus = findRoute(graph, position, destination.coordinate, {
            avoidStairs: nav.avoidStairs,
            heading: facing(),
            start: onPath,
          });
          if (campus) {
            commitRoute(campus, route, position, route.campusFrom === undefined ? "rerouted" : undefined);
            return;
          }
        }
      } else {
        onCampusCountRef.current = 0;
      }

      // The route being left stays on the map, faded, so the walker can still change their mind.
      const adopt = (candidate: Route, kind: RouteNotice) => {
        const leaving = route;
        const leftAt = next;
        route = candidate;
        next = trackProgress(candidate, position, 0);
        notice = kind;
        maxAlongRef.current = next.distanceAlong;
        offRouteCountRef.current = 0;
        otherWalkwayCountRef.current = 0;
        previousHintRef.current = leftAt.segmentIndex;
        previousStartAlongRef.current = leftAt.distanceAlong;
        previousMatchesRef.current = 0;
        lastRecheckRef.current = { at: Date.now(), along: next.distanceAlong };
        navRef.current = { ...navRef.current, navRoute: candidate, previousRoute: leaving };
        setNavRoute(candidate);
        setPreviousRoute({ route: leaving, path: remainingPath(leaving, leftAt) });
        setIsWrongWay(false);
      };

      const previous = nav.previousRoute;
      let nearPrevious = false;
      if (previous && trusted && !holding) {
        const onPrevious = trackProgress(previous, position, previousHintRef.current);
        previousHintRef.current = onPrevious.segmentIndex;
        nearPrevious = onPrevious.distanceFromRoute <= BACK_ON_PREVIOUS_METERS;
        // Only switch back once the walker is clearly following the old route, not just standing near where both begin.
        const followingPrevious =
          onPrevious.distanceFromRoute <= BACK_ON_PREVIOUS_METERS &&
          next.distanceFromRoute > limit &&
          onPrevious.distanceAlong - previousStartAlongRef.current >= ALONG_PREVIOUS_METERS;
        previousMatchesRef.current = followingPrevious ? previousMatchesRef.current + 1 : 0;
        if (previousMatchesRef.current >= 2) {
          adopt(previous, "switched");
        } else if (onPrevious.distanceFromRoute > DROP_PREVIOUS_METERS) {
          navRef.current = { ...navRef.current, previousRoute: null };
          setPreviousRoute(null);
        }
      }

      const isOff = trusted && !holding && next.distanceFromRoute > limit;
      offRouteCountRef.current = isOff ? offRouteCountRef.current + 1 : 0;
      const clearlyLost = isOff && next.distanceFromRoute > 80;

      // Walking the old route again is handled above as switching back, which keeps that route intact.
      const onOtherWalkway =
        trusted &&
        !nearPrevious &&
        walkway !== undefined &&
        next.distanceFromRoute - walkway.distance >= Math.max(WALKWAY_GAP_METERS, accuracy);
      otherWalkwayCountRef.current = onOtherWalkway ? otherWalkwayCountRef.current + 1 : 0;

      maxAlongRef.current = Math.max(maxAlongRef.current, next.distanceAlong);
      const backtracked = maxAlongRef.current - next.distanceAlong;
      const segmentStart = route.path[Math.max(0, next.segmentIndex - 1)];
      const segmentEnd = route.path[next.segmentIndex] ?? segmentStart;
      const walkingOpposite =
        courseRef.current !== undefined &&
        Math.abs(turnAngle(bearingDegrees(segmentStart, segmentEnd), courseRef.current)) > OPPOSITE_DEGREES;
      const wrongWay =
        trusted &&
        !holding &&
        !isOff &&
        (backtracked > WRONG_WAY_WARN_METERS * slack || (walkingOpposite && backtracked > COURSE_MIN_METERS * slack));

      // Reroutes from the walkway they are on, the way they head, so a shortcut is followed, not undone.
      const lost =
        offRouteCountRef.current >= 2 ||
        otherWalkwayCountRef.current >= 2 ||
        clearlyLost ||
        (justGotOff && next.distanceFromRoute > limit);
      const turnedBack = wrongWay && backtracked > WRONG_WAY_REROUTE_METERS * slack;
      if (!notice && travel && (lost || turnedBack)) {
        rerouteStreet(position);
      } else if (!notice && graph && (lost || turnedBack)) {
        const rerouted = rerouteFromHere(graph);
        if (rerouted) adopt(rerouted, "rerouted");
      } else if (!notice && graph && !travel && trusted && !holding && !wrongWay) {
        const since = lastRecheckRef.current;
        const due =
          Date.now() - since.at > RECHECK_INTERVAL_MS || next.distanceAlong - since.along > RECHECK_WALKED_METERS;
        if (due) {
          lastRecheckRef.current = { at: Date.now(), along: next.distanceAlong };
          const candidate = findRoute(graph, position, destination.coordinate, {
            avoidStairs: nav.avoidStairs,
          });
          if (candidate && isMeaningfullyShorter(candidate.distance, next.remaining)) adopt(candidate, "faster");
        }
      }

      if (notice) {
        setRouteNotice(notice);
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setRouteNotice(undefined), NOTICE_MS);
      } else {
        setIsWrongWay(wrongWay);
      }

      progressHintRef.current = next.segmentIndex;
      setProgress(next);

      // Building centers sit inside walls, so arrival counts once the walker reaches where the path meets the building.
      const reachedEntrance =
        next.distanceAlong >= route.arrivalDistance - (travel ? STREET_ARRIVAL_METERS[travel] : ARRIVAL_METERS);
      // Riding past the place is not arriving at it.
      const onTheRoute = next.distanceFromRoute <= limit;
      const arrived =
        !holding &&
        trusted &&
        ((reachedEntrance && onTheRoute) || distanceMeters(position, destination.coordinate) <= NEAR_DESTINATION_METERS);
      if (arrived) {
        navRef.current = { ...navRef.current, hasArrived: true, previousRoute: null };
        setHasArrived(true);
        setPreviousRoute(null);
        setIsWrongWay(false);
      }
      // On the route the dot sits on the route; off it, on the walkway they are actually walking.
      const onRoute = next.distanceFromRoute <= SNAP_TO_ROUTE_METERS;
      const offRoutePoint = onRoute || arrived ? undefined : walkway?.point;
      setWalkwayPoint(offRoutePoint);
      const shown = onRoute ? next.point : (offRoutePoint ?? position);
      if (navRef.current.isFollowing) {
        const zoom = riding ? FOLLOW_ZOOM.drive : travel ? FOLLOW_ZOOM[travel] : undefined;
        mapRef.current?.follow(shown, navigationPadding(), zoom);
      }
    },
    [setCourse, rerouteStreet, facing, commitRoute],
  );

  const handleGeoError = useCallback((status: "denied" | "unavailable" | "error") => {
    if (!centerOnFixRef.current) return;
    centerOnFixRef.current = false;
    if (status === "denied") {
      toast.danger("Location permission is off", {
        description: "Allow location for this site in your browser settings.",
      });
    } else {
      toast.danger(
        status === "unavailable" ? "Location is not available in this browser" : "Could not find your location",
      );
    }
  }, []);

  // While guiding, the place being walked to now: the next stop, or the destination after the last one.
  const target = mode === "navigate" ? (getPlace(legs[leg]) ?? selected) : selected;
  const nextTarget = mode === "navigate" ? getPlace(legs[leg + 1]) : undefined;

  const geo = useGeolocation({ onPosition: handlePosition, onError: handleGeoError });
  useWakeLock(mode === "navigate");
  const voice = useVoiceGuidance({
    route: mode === "navigate" ? navRoute : null,
    progress,
    destinationName: target?.name,
    isWrongWay,
    hasArrived,
    notice: routeNotice,
    paused: isRiding,
    speed: () => motionStateRef.current.speed,
  });
  const primeVoice = voice.prime;

  useEffect(() => {
    navRef.current = {
      mode,
      navRoute,
      previousRoute: previousRoute?.route ?? null,
      graph,
      avoidStairs,
      isFollowing,
      hasArrived,
      destination: target,
    };
  }, [mode, navRoute, previousRoute, graph, avoidStairs, isFollowing, hasArrived, target]);

  useEffect(() => {
    if ((mode === "browse" && !isScheduleOpen) || graph || graphFailed) return;
    let cancelled = false;
    import("@/data/walk-graph.json")
      .then((module) => {
        if (!cancelled) setGraph(parseGraph(module.default as RawWalkGraph));
      })
      .catch(() => {
        if (!cancelled) setGraphFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, isScheduleOpen, graph, graphFailed]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = "";
    if (selectedId) url.searchParams.set("place", selectedId);
    if (selectedId && room) url.searchParams.set("room", room);
    window.history.replaceState(null, "", url);
  }, [selectedId, room]);

  const plan = useMemo(
    () =>
      mode === "directions" && selected
        ? tripPlan({ origin, stops, destination: selected, here: geo.position })
        : null,
    [mode, selected, origin, stops, geo.position],
  );
  const firstStop = plan?.targets[0];
  const originCoordinate = plan?.start ?? undefined;
  // A fix just past the walking area still counts as campus while a walkway is close by.
  const isOffCampus = useMemo(() => {
    const position = geo.position;
    if (!plan?.live || position === undefined || onCampusPaths(position)) return false;
    const nearest = graph ? matchWalkway(graph, position, { avoidStairs: false }) : undefined;
    return !(nearest && nearest.distance <= NEAR_CAMPUS_PATH_METERS);
  }, [geo.position, graph, plan?.live]);

  const campusRoute = useMemo(() => {
    if (mode !== "directions" || !graph || !firstStop || !originCoordinate || isOffCampus) return null;
    return findRoute(graph, originCoordinate, firstStop.coordinate, { avoidStairs });
  }, [mode, graph, firstStop, originCoordinate, isOffCampus, avoidStairs]);

  // Stops are campus places, so every leg after the first follows the campus paths.
  const laterLegs = useMemo(() => {
    const targets = plan?.targets ?? [];
    if (!graph || targets.length < 2) return [];
    const found: Route[] = [];
    for (let i = 1; i < targets.length; i++) {
      const next = findRoute(graph, targets[i - 1].coordinate, targets[i].coordinate, { avoidStairs });
      if (!next) return null;
      found.push(next);
    }
    return found;
  }, [graph, plan?.targets, avoidStairs]);

  // Off campus the route comes from the street network, by whatever way the person travels.
  const streetKey = mode === "directions" && isOffCampus && firstStop ? `${firstStop.id}|${travelMode}|${avoidStairs}` : null;
  // Roughly a 100 m grid, so the preview is reconsidered as someone moves but not on every GPS fix.
  const streetCell = geo.position ? `${geo.position.latitude.toFixed(3)},${geo.position.longitude.toFixed(3)}` : "";

  useEffect(() => {
    const from = latestFixRef.current;
    // Waits for the campus paths, which the trip switches to once it reaches campus.
    if (!streetKey || !firstStop || !from || (!graph && !graphFailed)) return;
    const last = streetFetchRef.current;
    if (last && last.key === streetKey && distanceMeters(last.origin, from) < STREET_REFRESH_METERS) return;
    streetFetchRef.current = { key: streetKey, origin: from };

    const controller = new AbortController();
    let settled = false;
    fetchTripRoute(graph, from, firstStop, travelMode, { avoidStairs, heading: travelHeading(), signal: controller.signal })
      .then((route) => {
        settled = true;
        setStreetResult({ key: streetKey, route, failed: false });
      })
      .catch(() => {
        settled = true;
        if (controller.signal.aborted) return;
        // Forget this attempt so moving, or picking another way to travel, tries again.
        streetFetchRef.current = null;
        setStreetResult({ key: streetKey, route: null, failed: true });
      });
    return () => {
      if (settled) return;
      controller.abort();
      if (streetFetchRef.current?.key === streetKey) streetFetchRef.current = null;
    };
  }, [streetKey, streetCell, firstStop, travelMode, avoidStairs, travelHeading, graph, graphFailed]);

  const streetRoute = streetKey && streetResult?.key === streetKey ? streetResult.route : null;
  const previewRoute = isOffCampus ? streetRoute : campusRoute;

  let routeIssue: RouteIssue | undefined;
  if (laterLegs === null) routeIssue = avoidStairs ? "no-step-free" : "no-route";
  else if (isOffCampus) {
    if (!streetResult || streetResult.key !== streetKey) routeIssue = "finding";
    else if (streetResult.failed) routeIssue = "street-failed";
    else if (!streetResult.route) routeIssue = "no-street-route";
  } else if (graphFailed) routeIssue = "no-route";
  else if (!graph) routeIssue = "loading";
  else if (origin === MY_LOCATION && geo.status === "denied") routeIssue = "denied";
  else if (origin === MY_LOCATION && geo.status === "unavailable") routeIssue = "unavailable";
  else if (origin === MY_LOCATION && !geo.position) routeIssue = "locating";
  else if (!previewRoute) routeIssue = avoidStairs ? "no-step-free" : "no-route";

  // Voice lines start being made while the route is previewed, so they are ready when Start is tapped.
  useEffect(() => {
    if (mode === "directions" && previewRoute && plan?.live) primeVoice(previewRoute);
  }, [mode, previewRoute, plan?.live, primeVoice]);

  const hasPreviewRoute = previewRoute !== null;
  // The whole walk drawn as one line: to the first stop, then on from stop to stop.
  const previewPath = useMemo(
    () => (previewRoute ? [...previewRoute.path, ...(laterLegs ?? []).flatMap((next) => next.path)] : undefined),
    [previewRoute, laterLegs],
  );
  const previewPathRef = useRef(previewPath);
  useEffect(() => {
    previewPathRef.current = previewPath;
  }, [previewPath]);
  const previewRouteRef = useRef(previewRoute);
  useEffect(() => {
    previewRouteRef.current = previewRoute;
  }, [previewRoute]);

  useEffect(() => {
    if (mode === "directions" && hasPreviewRoute && previewPathRef.current) {
      mapRef.current?.fitPath(previewPathRef.current, previewPadding());
    }
  }, [mode, hasPreviewRoute, origin, stops, avoidStairs, selectedId, travelMode]);

  const selectPlace = useCallback(
    (place: Place | undefined, nextRoom?: string) => {
      if (mode === "navigate") return;
      if (mode === "directions") {
        if (place) {
          setSelectedId(place.id);
          setRoom(undefined);
          if (origin === place.id) setOrigin(MY_LOCATION);
        }
        return;
      }
      setSelectedId(place?.id);
      setRoom(place?.isBuilding ? nextRoom : undefined);
      if (place) {
        setIsPlaceExpanded(true);
        mapRef.current?.focus(place.coordinate, sheetPadding());
      }
    },
    [mode, origin],
  );

  const walkMeters = useCallback(
    (from: Coordinate, to: Coordinate) => {
      if (!graph) return distanceMeters(from, to) * 1.3;
      return findRoute(graph, from, to, { avoidStairs })?.distance ?? null;
    },
    [graph, avoidStairs],
  );

  function openSchedule() {
    setClasses(loadSchedule());
    setIsSearchOpen(false);
    setIsAccountOpen(false);
    setIsPeopleOpen(false);
    setIsScheduleOpen(true);
    setIsScheduleExpanded(true);
  }

  const myUsername = account.state.status === "signed-in" ? account.state.user.username : "";
  const meetup = social.meetups.find((m) => m.id === meetupId && m.active && m.yourStatus === "joined") ?? null;
  const live = useMeetupLive(meetup ? meetup.id : null, geo.position ? { position: geo.position, accuracy: geo.accuracy ?? 0 } : undefined);
  const meetupSheetOpen = Boolean(meetup && isMeetupSheetOpen);
  const scheduleExpanded = isScheduleOpen && isScheduleExpanded;
  const peopleExpanded = isPeopleOpen && isPeopleExpanded;
  const accountExpanded = isAccountOpen && isAccountExpanded;
  const mapChromeOpen = mode === "browse" && !scheduleExpanded && !peopleExpanded && !accountExpanded && !meetupSheetOpen;
  // Directions and navigation take the whole screen, so the tab bar steps aside for them, as it does in the app.
  const showTabBar = mode === "browse" && !meetupSheetOpen;
  const selectedTab: TabId = isSearchOpen
    ? "search"
    : isScheduleOpen
      ? "classes"
      : isPeopleOpen
        ? "friends"
        : isAccountOpen
          ? "account"
          : "map";

  function selectTab(tab: TabId) {
    if (tab === "classes") openSchedule();
    else if (tab === "friends") openPeople();
    else if (tab === "account") openAccount();
    else {
      setIsScheduleOpen(false);
      setIsPeopleOpen(false);
      setIsAccountOpen(false);
      if (tab === "map") setIsSearchOpen(false);
      // Focusing inside the tap is what lets a phone open its keyboard.
      else if (searchInputRef.current) searchInputRef.current.focus();
      else setIsSearchOpen(true);
    }
  }

  // Friends who are sharing right now, labelled with their initials.
  const meetupPeople: MapPerson[] = meetup
    ? live.positions
        .filter((position) => {
          if (position.member === meetup.yourLiveId) return false;
          const member = meetup.members.find((m) => m.liveId === position.member);
          return !member || member.username !== myUsername;
        })
        .map((position) => {
          const member = meetup.members.find((m) => m.liveId === position.member);
          const name = member?.displayName || position.name;
          return {
            id: position.member,
            label: initialsFor(name, member?.username ?? "?"),
            name,
            coordinate: position.coordinate,
            isDestination: meetup.destination?.kind === "member" && meetup.destination.liveId === position.member,
            isActive: activePersonId === position.member,
          };
        })
    : [];
  const activePosition = meetup && activePersonId ? live.positions.find((p) => p.member === activePersonId) : undefined;
  const activeMember = activePosition ? meetup?.members.find((m) => m.liveId === activePosition.member) : undefined;

  const meetupPin =
    meetup?.destination?.kind === "pin" && meetup.destination.lat !== undefined && meetup.destination.lng !== undefined
      ? { latitude: meetup.destination.lat, longitude: meetup.destination.lng }
      : undefined;

  function openPeople() {
    setIsSearchOpen(false);
    setIsScheduleOpen(false);
    setIsAccountOpen(false);
    setIsPeopleOpen(true);
    setIsPeopleExpanded(true);
  }

  function openMeetup(id: string) {
    setIsPeopleOpen(false);
    setMeetupId(id);
    setIsMeetupSheetOpen(true);
    geo.start();
    requestCompass();
  }

  function openAccount() {
    setIsSearchOpen(false);
    setIsScheduleOpen(false);
    setIsPeopleOpen(false);
    setIsAccountOpen(true);
    setIsAccountExpanded(true);
  }

  function updateClasses(next: ClassEntry[]) {
    setClasses(next);
    if (!saveSchedule(next)) toast.danger("Could not save your classes on this device");
  }

  function directionsToClass(entry: ClassEntry, fromPlaceId?: string) {
    const place = getPlace(entry.placeId);
    if (!place) return;
    const from = fromPlaceId ? getPlace(fromPlaceId) : undefined;
    setOrigin(geo.status !== "active" && from && from.id !== place.id ? from.id : MY_LOCATION);
    setIsScheduleOpen(false);
    setSelectedId(place.id);
    setRoom(entry.room);
    setStops([]);
    setIsDirectionsExpanded(true);
    setMode("directions");
    geo.start();
  }

  function handleLocate() {
    requestCompass();
    if (geo.position) {
      mapRef.current?.focus(geo.position);
      return;
    }
    centerOnFixRef.current = true;
    geo.start();
  }

  function openDirections() {
    setStops([]);
    setIsDirectionsExpanded(true);
    setMode("directions");
    geo.start();
  }

  function handleOriginChange(next: string) {
    setOrigin(next === MY_LOCATION || getPlace(next) ? next : MY_LOCATION);
    if (next === MY_LOCATION) geo.start();
  }

  // iPhones drop a second permission prompt, so the compass is only asked for after location.
  function requestCompass() {
    if (geo.position) requestHeading();
  }

  // Guides along one leg: live from `from`, or step by step by hand without a location.
  function beginRoute(route: Route, from: Coordinate | undefined) {
    if (!from) {
      manualRef.current = true;
      setManualStep(0);
      setProgress(progressAtDistance(route, 0));
      setNavRoute(route);
      setPreviousRoute(null);
      setIsWrongWay(false);
      setHasArrived(false);
      setIsFollowing(false);
      navRef.current = {
        ...navRef.current,
        mode: "navigate",
        navRoute: route,
        previousRoute: null,
        isFollowing: false,
        hasArrived: false,
      };
      voice.begin(route, facing());
      setMode("navigate");
      mapRef.current?.fitPath(route.path, previewPadding());
      return;
    }
    requestCompass();
    manualRef.current = false;
    progressHintRef.current = 0;
    offRouteCountRef.current = 0;
    otherWalkwayCountRef.current = 0;
    maxAlongRef.current = 0;
    lastRecheckRef.current = { at: Date.now(), along: 0 };
    streetRerouteRef.current = { inflight: false, at: Date.now() };
    setWalkwayPoint(undefined);
    setManualStep(null);
    ridingRef.current = false;
    onCampusCountRef.current = 0;
    setIsRiding(false);
    voice.begin(route, facing());
    navRef.current = {
      ...navRef.current,
      mode: "navigate",
      navRoute: route,
      previousRoute: null,
      isFollowing: true,
      hasArrived: false,
    };
    setPreviousRoute(null);
    setIsWrongWay(false);
    setNavRoute(route);
    setProgress(trackProgress(route, from, 0));
    setHasArrived(false);
    setIsFollowing(true);
    setMode("navigate");
    mapRef.current?.follow(from, navigationPadding(), route.travel ? FOLLOW_ZOOM[route.travel] : undefined);
  }

  function startNavigation() {
    if (!previewRoute || !plan) return;
    const from = plan.live ? geo.position : undefined;
    // No location and no starting building: there is nowhere to start from yet.
    if (!from && origin === MY_LOCATION) return;
    setLegs(plan.targets.map((place) => place.id));
    setLeg(0);
    beginRoute(previewRoute, from);
  }

  // Arrived at a stop: on to the next place, from wherever the walker is now.
  function continueTrip() {
    const next = nextTarget;
    if (!next || !target || !graph) return;
    const from = geo.position ?? target.coordinate;
    const route = findRoute(graph, from, next.coordinate, { avoidStairs });
    if (!route) {
      toast.danger(`Could not find a way to ${next.name}`);
      return;
    }
    setLeg((current) => current + 1);
    beginRoute(route, geo.position);
  }

  function endNavigation() {
    clearTimeout(followAgainRef.current);
    manualRef.current = false;
    setLegs([]);
    setLeg(0);
    ridingRef.current = false;
    setIsRiding(false);
    setManualStep(null);
    setFacingUp(true);
    setMode("browse");
    setNavRoute(null);
    setPreviousRoute(null);
    setIsWrongWay(false);
    setProgress(undefined);
    setWalkwayPoint(undefined);
    setHasArrived(false);
    if (selected) mapRef.current?.focus(selected.coordinate, sheetPadding());
  }

  function switchToPreviousRoute() {
    const nav = navRef.current;
    if (nav.mode !== "navigate" || !nav.previousRoute || !nav.navRoute || !geo.position) return;
    // Street routes have no campus paths to walk over to the old line, so the old route is simply taken back.
    if (nav.previousRoute.travel) {
      commitRoute(nav.previousRoute, nav.navRoute, geo.position, "switched");
      return;
    }
    if (!nav.graph) return;
    // Tapping the faded line means "take me that way", so walk to it first if the user is not already on it.
    const chosen = routeVia(nav.graph, geo.position, nav.previousRoute, { avoidStairs: nav.avoidStairs });
    if (!chosen) {
      toast.danger("Could not find a way to that route");
      return;
    }
    commitRoute(chosen, nav.navRoute, geo.position, "switched");
  }

  // Turning Avoid stairs on or off mid walk finds the way again from where the walker is now.
  function changeAvoidStairs(avoid: boolean) {
    const nav = navRef.current;
    const route = nav.navRoute;
    const from =
      geo.position ??
      (route && manualStep !== null ? progressAtDistance(route, route.steps[manualStep].startDistance).point : undefined);
    if (nav.mode !== "navigate" || !route || !nav.destination || !from || nav.hasArrived) {
      setAvoidStairs(avoid);
      return;
    }
    if (route.travel) {
      navRef.current = { ...nav, avoidStairs: avoid };
      setAvoidStairs(avoid);
      rerouteStreet(from, true);
      return;
    }
    if (!nav.graph) return;
    const chosen = findRoute(nav.graph, from, nav.destination.coordinate, { avoidStairs: avoid, heading: facing() });
    if (!chosen) {
      toast.info("No step-free way from here", { description: "Your route stays the same for now." });
      return;
    }
    navRef.current = { ...navRef.current, avoidStairs: avoid };
    setAvoidStairs(avoid);
    commitRoute(chosen, route, from, "rerouted");
    if (manualStep !== null) setManualStep(0);
  }

  // Without a live location the walker moves through the steps themselves, and the map shows each one.
  function showStep(index: number) {
    const route = navRoute;
    if (!route) return;
    const clamped = Math.max(0, Math.min(route.steps.length - 1, index));
    const at = progressAtDistance(route, route.steps[clamped].startDistance);
    setManualStep(clamped);
    setProgress(at);
    setHasArrived(clamped === route.steps.length - 1);
    voice.announceStep(route, clamped);
    mapRef.current?.focus(at.point, navigationPadding());
  }

  function recenter() {
    clearTimeout(followAgainRef.current);
    setIsFollowing(true);
    if (geo.position) {
      mapRef.current?.follow(geo.position, navigationPadding(), navRoute?.travel ? FOLLOW_ZOOM[navRoute.travel] : undefined);
    }
  }

  const visiblePlaces = useMemo(() => {
    if (mode !== "browse" || filter === "all") return PLACES;
    return PLACES.filter((place) => place.category === filter || place.id === selectedId);
  }, [mode, filter, selectedId]);

  // While navigating, the walks between the stops still ahead stay on the map, not only the one being walked now.
  const legsAhead = useMemo(() => {
    if (mode !== "navigate" || !graph) return [];
    const ahead: Route[] = [];
    for (let i = leg; i < legs.length - 1; i++) {
      const from = getPlace(legs[i]);
      const to = getPlace(legs[i + 1]);
      const next = from && to ? findRoute(graph, from.coordinate, to.coordinate, { avoidStairs }) : null;
      if (next) ahead.push(next);
    }
    return ahead;
  }, [mode, graph, legs, leg, avoidStairs]);

  const navPath = useMemo(() => {
    const current = navRoute && progress ? remainingPath(navRoute, progress) : navRoute?.path;
    return current && [...current, ...legsAhead.flatMap((next) => next.path)];
  }, [navRoute, progress, legsAhead]);

  // Stops keep their number from the plan, so stop 2 is still stop 2 once stop 1 is done.
  const stopNumbers = useMemo(() => {
    const visits = mode === "navigate" ? legs : mode === "directions" ? (plan?.targets.map((place) => place.id) ?? []) : [];
    const numbers: Record<string, number> = {};
    visits.slice(0, -1).forEach((id, index) => {
      if (mode !== "navigate" || index >= leg) numbers[id] = index + 1;
    });
    return numbers;
  }, [mode, legs, leg, plan]);
  const stopCount = mode === "navigate" ? legs.length - 1 : 0;
  const mapRoute = mode === "navigate" ? navPath : mode === "directions" ? previewPath : undefined;
  const snappedToRoute = mode === "navigate" && progress && progress.distanceFromRoute <= SNAP_TO_ROUTE_METERS;
  const shownLocation = snappedToRoute
    ? progress.point
    : mode === "navigate" && walkwayPoint
      ? walkwayPoint
      : geo.position;
  const peopleOpenPeeked = isPeopleOpen && !isPeopleExpanded;
  const scheduleOpenPeeked = isScheduleOpen && !isScheduleExpanded;
  const accountOpenPeeked = isAccountOpen && !isAccountExpanded;
  const directionsPeeked = mode === "directions" && !isDirectionsExpanded;
  const placePeeked =
    mapChromeOpen && Boolean(selected) && !isPlaceExpanded && !isSearchOpen && !peopleOpenPeeked && !scheduleOpenPeeked && !accountOpenPeeked;
  const meetupPeeked =
    mapChromeOpen && Boolean(meetup) && !isMeetupSheetOpen && !selected && !isSearchOpen && !peopleOpenPeeked && !scheduleOpenPeeked && !accountOpenPeeked;
  const hasPeek = peopleOpenPeeked || scheduleOpenPeeked || accountOpenPeeked || directionsPeeked || placePeeked || meetupPeeked;

  return (
    <main className="map-bleed bg-background" data-tabbar={showTabBar || undefined}>
      <CampusMap
        ref={mapRef}
        places={visiblePlaces}
        selectedId={selectedId}
        originId={mode === "directions" && origin !== MY_LOCATION ? origin : undefined}
        stopNumbers={stopNumbers}
        userLocation={shownLocation}
        route={mapRoute}
        people={meetupPeople}
        destinationPin={meetupPin}
        previousRoute={mode === "navigate" ? previousRoute?.path : undefined}
        onPreviousRoutePress={switchToPreviousRoute}
        initialFocus={selected?.coordinate}
        getFocusPadding={meetupSheetOpen || peopleExpanded || scheduleExpanded || accountExpanded || (mode === "directions" && isDirectionsExpanded) ? sheetPadding : hasPeek ? peekPadding : sheetPadding}
        onSelect={selectPlace}
        onLoad={() => setMapLoaded(true)}
        activityByPlace={activityByPlace}
        onUserPan={() => {
          if (mode !== "navigate") return;
          clearTimeout(followAgainRef.current);
          // Set right away, so a GPS fix arriving mid gesture does not pull the map out from under a finger.
          navRef.current = { ...navRef.current, isFollowing: false };
          setIsFollowing(false);
        }}
        onUserSettle={() => {
          if (mode !== "navigate" || hasArrived) return;
          clearTimeout(followAgainRef.current);
          followAgainRef.current = setTimeout(followAgain, FOLLOW_AGAIN_MS);
        }}
        onRotatedChange={setIsRotated}
        rotatable={mode === "directions" || mode === "navigate"}
        headingUp={mode === "navigate" && isFollowing && facingUp && manualStep === null}
        onPersonPress={(id) => setActivePersonId((current) => (current === id ? null : id))}
        buildingView={buildingView}
        unbounded={mode === "directions" ? isOffCampus : mode === "navigate" && navRoute?.travel !== undefined}
      />

      {activePosition && meetup ? (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--map-safe-top)+4.25rem)] z-40 flex justify-center md:left-[436px] md:right-auto md:top-4 md:justify-start">
          <PersonCard
            person={{
              name: activeMember?.displayName || activePosition.name,
              username: activeMember?.username,
              isHost: activeMember?.role === "host",
              isMeetingPoint: meetup.destination?.kind === "member" && meetup.destination.liveId === activePosition.member,
              coordinate: activePosition.coordinate,
              accuracy: activePosition.accuracy,
              at: activePosition.at,
            }}
            youAt={geo.position}
            onCenter={() => mapRef.current?.focus(activePosition.coordinate)}
            onClose={() => setActivePersonId(null)}
          />
        </div>
      ) : null}

      {mode === "browse" && scheduleExpanded ? (
        <SheetLayer wrapClassName={SHEET_FULL_WRAP} onCollapse={() => setIsScheduleExpanded(false)}>
          <SchedulePanel
            classes={classes}
            userPosition={geo.position}
            walkMeters={walkMeters}
            onChange={updateClasses}
            onDirections={directionsToClass}
            onCollapse={() => setIsScheduleExpanded(false)}
            onClose={() => setIsScheduleOpen(false)}
          />
        </SheetLayer>
      ) : null}

      {mode === "browse" && peopleExpanded ? (
        <SheetLayer wrapClassName={SHEET_FULL_WRAP} onCollapse={() => setIsPeopleExpanded(false)}>
          <PeoplePanel
            myUsername={myUsername}
            friends={social.friends}
            meetups={social.meetups}
            campus={social.campus}
            isLoading={social.isLoading}
            onRefresh={() => void social.refresh()}
            onMeetupChange={social.updateMeetup}
            onOpenMeetup={openMeetup}
            onCollapse={() => setIsPeopleExpanded(false)}
            onClose={() => setIsPeopleOpen(false)}
          />
        </SheetLayer>
      ) : null}

      {mode === "browse" && !isPeopleOpen && meetup && isMeetupSheetOpen ? (
        <SheetLayer wrapClassName={SHEET_FULL_WRAP} onCollapse={() => setIsMeetupSheetOpen(false)}>
          <MeetupSheet
            meetup={meetup}
            myUsername={myUsername}
            positions={live.positions}
            state={live.state}
            elsewhere={live.elsewhere}
            onTakeOver={live.takeOver}
            youAt={geo.position}
            onMeetupChange={(updated) => {
              social.updateMeetup(updated);
              if (!updated.active || updated.yourStatus !== "joined") setMeetupId(null);
            }}
            onDirections={(place) => {
              selectPlace(place);
              openDirections();
            }}
            onShowOnMap={(coordinate, liveId) => {
              setActivePersonId(liveId ?? null);
              mapRef.current?.focus(coordinate, sheetPadding());
            }}
            onCollapse={() => setIsMeetupSheetOpen(false)}
            onClose={() => setMeetupId(null)}
          />
        </SheetLayer>
      ) : null}

      {meetupPeeked && meetup ? (
        <SheetLayer wrapClassName={SHEET_PEEK_WRAP} onExpand={() => setIsMeetupSheetOpen(true)}>
          <MeetupPeek
            meetup={meetup}
            myUsername={myUsername}
            state={live.state}
            onExpand={() => setIsMeetupSheetOpen(true)}
          />
        </SheetLayer>
      ) : null}

      {mode === "browse" && accountExpanded ? (
        <SheetLayer wrapClassName={SHEET_FULL_WRAP} onCollapse={() => setIsAccountExpanded(false)}>
          <AccountPanel
            state={account.state}
            voice={voiceChoice.voice}
            voiceSavedTo={voiceChoice.savedTo}
            onChooseVoice={voiceChoice.choose}
            onUser={account.setUser}
            onRetry={() => void account.refresh()}
            onCollapse={() => setIsAccountExpanded(false)}
            onClose={() => setIsAccountOpen(false)}
            onDeleted={() => setClasses([])}
          />
        </SheetLayer>
      ) : null}

      {peopleOpenPeeked ? (
        <SheetLayer wrapClassName={SHEET_PEEK_WRAP} onExpand={() => setIsPeopleExpanded(true)}>
          <SheetPeek
            icon={<Users className="size-4" aria-hidden />}
            title="Friends"
            subtitle="Meet up on campus · tap to open"
            label="Open friends"
            onExpand={() => setIsPeopleExpanded(true)}
          />
        </SheetLayer>
      ) : null}

      {scheduleOpenPeeked ? (
        <SheetLayer wrapClassName={SHEET_PEEK_WRAP} onExpand={() => setIsScheduleExpanded(true)}>
          <SheetPeek
            icon={<CalendarClock className="size-4" aria-hidden />}
            title="My classes"
            subtitle="Saved on this device · tap to open"
            label="Open my classes"
            onExpand={() => setIsScheduleExpanded(true)}
          />
        </SheetLayer>
      ) : null}

      {accountOpenPeeked ? (
        <SheetLayer wrapClassName={SHEET_PEEK_WRAP} onExpand={() => setIsAccountExpanded(true)}>
          <SheetPeek
            icon={<UserRound className="size-4" aria-hidden />}
            title="Account"
            subtitle={account.state.status === "signed-in" ? "Signed in · tap to open" : "Sign in · tap to open"}
            label="Open account"
            onExpand={() => setIsAccountExpanded(true)}
          />
        </SheetLayer>
      ) : null}

      {placePeeked && selected ? (
        <SheetLayer wrapClassName={SHEET_PEEK_WRAP} onExpand={() => setIsPlaceExpanded(true)}>
          <SheetPeek
            icon={<School className="size-4" aria-hidden />}
            title={selected.name}
            subtitle="tap to open"
            label={`Open ${selected.name}`}
            onExpand={() => setIsPlaceExpanded(true)}
          />
        </SheetLayer>
      ) : null}

      {directionsPeeked && selected ? (
        <SheetLayer wrapClassName={SHEET_PEEK_WRAP} onExpand={() => setIsDirectionsExpanded(true)}>
          <SheetPeek
            icon={<Navigation className="size-4" aria-hidden />}
            title={`Walk to ${selected.name}`}
            subtitle="tap to open"
            label="Open directions"
            onExpand={() => setIsDirectionsExpanded(true)}
          />
        </SheetLayer>
      ) : null}

      {mapChromeOpen ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2.5 pl-[var(--map-safe-left)] pr-[var(--map-safe-right)] pt-[var(--map-safe-top)] md:w-[420px] md:px-4 md:pt-4">
            <div className="pointer-events-auto flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <SearchPanel
                  query={query}
                  isOpen={isSearchOpen}
                  onQueryChange={setQuery}
                  onOpenChange={setIsSearchOpen}
                  onSelect={selectPlace}
                  inputRef={searchInputRef}
                />
              </div>
              {isSearchOpen ? null : (
                <Surface className="glass-chrome flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg phone:hidden">
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label="My classes"
                    onPress={openSchedule}
                    className="rounded-full">
                    <CalendarClock aria-hidden />
                  </Button>
                </Surface>
              )}
              {isSearchOpen || !social.signedIn ? null : (
                <Surface className="glass-chrome relative flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg phone:hidden">
                  <Button isIconOnly variant="ghost" aria-label="Friends" onPress={openPeople} className="rounded-full">
                    <Users aria-hidden />
                  </Button>
                  {social.waiting > 0 ? (
                    <span
                      aria-hidden
                      className="absolute right-2 top-2 size-2.5 rounded-full bg-accent ring-2 ring-surface"
                    />
                  ) : null}
                </Surface>
              )}
              {isSearchOpen || !meetup || !selected ? null : (
                <Surface className="glass-chrome flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg">
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label="Open meetup"
                    onPress={() => setIsMeetupSheetOpen(true)}
                    className="rounded-full text-accent">
                    <Radio aria-hidden />
                  </Button>
                </Surface>
              )}
              {isSearchOpen || account.state.status === "disabled" ? null : (
                <Surface className="glass-chrome flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg phone:hidden">
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label={account.state.status === "signed-in" ? "Account" : "Sign in"}
                    onPress={openAccount}
                    className="rounded-full">
                    {account.state.status === "signed-in" && !account.state.user.needsProfile ? (
                      <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                        {initials(account.state.user)}
                      </span>
                    ) : (
                      <UserRound aria-hidden />
                    )}
                  </Button>
                </Surface>
              )}
            </div>

            {isSearchOpen ? null : (
              <DragScroll activeKey={filter} className="pointer-events-auto -mx-3 px-3 md:mx-0 md:px-0">
                <ToggleButtonGroup
                  aria-label="Filter places"
                  selectionMode="single"
                  disallowEmptySelection
                  isDetached
                  size="sm"
                  selectedKeys={[filter]}
                  onSelectionChange={(keys) => {
                    const [next] = keys;
                    if (next) setFilter(next as MapFilter);
                  }}
                  className="gap-2 py-1">
                  {MAP_FILTERS.map((option) => (
                    <ToggleButton
                      key={option}
                      id={option}
                      className="glass-chrome shrink-0 rounded-full bg-overlay px-3.5 shadow-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[selected=true]:[--glass-strength:85%] data-[selected=true]:[--glass-tint:var(--accent)]">
                      {option === "all" ? "All" : CATEGORY_LABELS[option]}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </DragScroll>
            )}
          </div>

          <div
            className={
              selected && isPlaceExpanded
                ? "absolute bottom-12 z-10 max-md:hidden right-[var(--map-safe-right)] md:right-4"
                : hasPeek
                  ? "absolute bottom-[calc(6.5rem+var(--map-safe-bottom))] z-10 right-[var(--map-safe-right)] md:bottom-[calc(5.5rem+var(--map-safe-bottom))] md:right-4"
                  : "absolute bottom-[calc(3rem+var(--map-safe-bottom))] z-10 right-[var(--map-safe-right)] md:right-4"
            }>
            <MapViewControls
              buildingView={buildingView}
              locating={geo.status === "locating"}
              located={Boolean(geo.position)}
              onToggleBuildingView={() => setBuildingView((on) => !on)}
              onCampus={() => mapRef.current?.showCampus()}
              onLocate={handleLocate}
              rotated={isRotated}
              onPointNorth={() => mapRef.current?.resetNorth()}
            />
          </div>

          {selected && !isSearchOpen && isPlaceExpanded && !peopleOpenPeeked && !scheduleOpenPeeked && !accountOpenPeeked ? (
            <SheetLayer
              wrapClassName="absolute inset-x-0 bottom-0 z-20 md:bottom-auto md:left-4 md:right-auto md:top-[124px] md:w-[400px]"
              onCollapse={() => setIsPlaceExpanded(false)}>
              <PlaceSheet
                key={`${selected.id}-${room ?? ""}`}
                place={selected}
                room={room}
                events={placeEvents}
                onOpenEvent={(meetup) => openMeetup(meetup.id)}
                onDirections={openDirections}
                onCollapse={() => setIsPlaceExpanded(false)}
                onClose={() => selectPlace(undefined)}
              />
            </SheetLayer>
          ) : null}
        </>
      ) : null}

      {mode === "directions" && selected && isDirectionsExpanded ? (
        <SheetLayer
          wrapClassName="absolute inset-x-0 bottom-0 z-20 md:bottom-auto md:left-4 md:right-auto md:top-4 md:w-[420px]"
          onCollapse={() => setIsDirectionsExpanded(false)}>
          <DirectionsPanel
            destination={selected}
            origin={origin}
            avoidStairs={avoidStairs}
            route={previewRoute}
            issue={routeIssue}
            located={geo.located}
            travel={isOffCampus ? travelMode : null}
            events={placeEvents}
            onOpenEvent={(meetup) => openMeetup(meetup.id)}
            onTravelChange={setTravelMode}
            onOriginChange={handleOriginChange}
            plan={plan}
            stopIds={stops}
            laterLegs={laterLegs ?? []}
            onAddStop={(id) => setStops((current) => withStop(current, id, selected.id))}
            onRemoveStop={(id) => setStops((current) => current.filter((stop) => stop !== id))}
            onAvoidStairsChange={setAvoidStairs}
            onStart={startNavigation}
            onBack={() => {
              setMode("browse");
              setIsPlaceExpanded(true);
              setIsDirectionsExpanded(true);
            }}
            onCollapse={() => setIsDirectionsExpanded(false)}
            onClose={() => {
              setMode("browse");
              setSelectedId(undefined);
              setRoom(undefined);
              setIsDirectionsExpanded(true);
              setIsPlaceExpanded(true);
            }}
          />
        </SheetLayer>
      ) : null}

      {directionsPeeked ? (
        <div className="absolute bottom-[calc(6.5rem+var(--map-safe-bottom))] z-10 right-[var(--map-safe-right)] md:bottom-[calc(5.5rem+var(--map-safe-bottom))] md:right-4">
          <MapViewControls
            buildingView={buildingView}
            locating={geo.status === "locating"}
            located={Boolean(geo.position)}
            onToggleBuildingView={() => setBuildingView((on) => !on)}
            onCampus={() => mapRef.current?.showCampus()}
            onLocate={handleLocate}
            rotated={isRotated}
            onPointNorth={() => mapRef.current?.resetNorth()}
          />
        </div>
      ) : null}

      {showTabBar ? (
        <TabBar
          selected={selectedTab}
          showFriends={social.signedIn}
          showAccount={account.state.status !== "disabled"}
          friendsWaiting={social.waiting}
          onSelect={selectTab}
        />
      ) : null}

      {mode === "navigate" && target && navRoute ? (
        <NavigationHud
          destination={target}
          nextStopName={nextTarget?.name}
          stopLabel={stopCount > 0 && leg < stopCount ? `Stop ${leg + 1} of ${stopCount}` : undefined}
          onContinue={continueTrip}
          route={navRoute}
          progress={progress}
          isFollowing={isFollowing}
          notice={routeNotice}
          isWrongWay={isWrongWay}
          hasAlternate={previousRoute !== null}
          hasArrived={hasArrived}
          weakSignal={(geo.accuracy ?? 0) > WEAK_ACCURACY_METERS}
          isRiding={isRiding}
          voiceOn={voice.enabled}
          onToggleVoice={voice.toggle}
          onRecenter={recenter}
          isRotated={isRotated}
          onPointNorth={() => mapRef.current?.resetNorth()}
          facingUp={facingUp}
          onToggleFacing={() => {
            const next = !facingUp;
            setFacingUp(next);
            if (next) recenter();
            else mapRef.current?.resetNorth();
          }}
          manualStep={manualStep}
          onStepBack={() => showStep((manualStep ?? 0) - 1)}
          onStepNext={() => showStep((manualStep ?? 0) + 1)}
          avoidStairs={avoidStairs}
          canAvoidStairs={!navRoute.travel || navRoute.travel === "walk"}
          onAvoidStairsChange={changeAvoidStairs}
          onEnd={endNavigation}
        />
      ) : null}
      <LaunchSplash ready={mapLoaded} />
    </main>
  );
}
