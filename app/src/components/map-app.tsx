"use client";

import { Button, Separator, Spinner, Surface, ToggleButton, ToggleButtonGroup, toast } from "@heroui/react";
import { Building2, CalendarClock, LocateFixed, Navigation, Radio, School, UserRound, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccountPanel, initials } from "@/components/account-panel";
import { CampusMap, type CampusMapHandle, type MapPerson } from "@/components/campus-map";
import { DirectionsPanel, MY_LOCATION, type RouteIssue } from "@/components/directions-panel";
import { DragScroll } from "@/components/drag-scroll";
import { NavigationHud, type RouteNotice } from "@/components/navigation-hud";
import { MeetupPeek, MeetupSheet } from "@/components/meetup-sheet";
import { PeoplePanel, initialsFor } from "@/components/people-panel";
import { PlaceSheet } from "@/components/place-sheet";
import { SchedulePanel } from "@/components/schedule-panel";
import { SearchPanel } from "@/components/search-panel";
import { SHEET_FULL_WRAP, SHEET_PEEK_WRAP, SheetLayer, SheetPeek } from "@/components/sheet-chrome";
import { CAMPUS, CAMPUS_CENTER, CATEGORY_LABELS, PLACES, getPlace, type Coordinate, type Place } from "@/data/campus";
import { useAccount } from "@/hooks/use-account";
import { useGeolocation, type GeoFix } from "@/hooks/use-geolocation";
import { useHeading } from "@/hooks/use-heading";
import { useMeetupLive } from "@/hooks/use-meetup-live";
import { useSocial } from "@/hooks/use-social";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { MAP_FILTERS, type MapFilter } from "@/lib/categories";
import { bearingDegrees, distanceMeters, turnAngle } from "@/lib/geo";
import { loadSchedule, saveSchedule, type ClassEntry } from "@/lib/schedule";
import {
  findRoute,
  parseGraph,
  remainingPath,
  routeVia,
  trackProgress,
  type RawWalkGraph,
  type Route,
  type RouteProgress,
  type WalkGraph,
} from "@/lib/routing";

const OFF_CAMPUS_METERS = CAMPUS.map.onCampusRadiusMeters;
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
  onToggleBuildingView,
  onCampus,
  onLocate,
}: {
  buildingView: boolean;
  locating: boolean;
  located: boolean;
  onToggleBuildingView: () => void;
  onCampus: () => void;
  onLocate: () => void;
}) {
  return (
    <Surface className="flex flex-col overflow-hidden rounded-2xl p-1 shadow-lg">
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

  const [mode, setMode] = useState<Mode>("browse");
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
  const social = useSocial(account.state);
  const [classes, setClasses] = useState<ClassEntry[]>([]);

  const [graph, setGraph] = useState<WalkGraph | null>(null);
  const [graphFailed, setGraphFailed] = useState(false);
  const [origin, setOrigin] = useState(MY_LOCATION);
  const [avoidStairs, setAvoidStairs] = useState(false);

  const [navRoute, setNavRoute] = useState<Route | null>(null);
  const [progress, setProgress] = useState<RouteProgress>();
  const [isFollowing, setIsFollowing] = useState(true);
  const [routeNotice, setRouteNotice] = useState<RouteNotice>();
  const [previousRoute, setPreviousRoute] = useState<{ route: Route; path: Coordinate[] } | null>(null);
  const [isWrongWay, setIsWrongWay] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);

  const selected = getPlace(selectedId);

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
  const { request: requestHeading, setCourse } = useHeading(handleHeading);
  const progressHintRef = useRef(0);
  const offRouteCountRef = useRef(0);
  const lastRecheckRef = useRef({ at: 0, along: 0 });
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  const handlePosition = useCallback(
    ({ position, accuracy }: GeoFix) => {
      if (centerOnFixRef.current) {
        centerOnFixRef.current = false;
        if (distanceMeters(position, CAMPUS_CENTER) > OFF_CAMPUS_METERS) {
          toast.info("You look off campus", { description: "Your location will show once you are closer." });
        } else {
          mapRef.current?.focus(position);
        }
      }

      const lastCourseFix = lastCourseFixRef.current;
      if (!lastCourseFix || distanceMeters(lastCourseFix, position) >= COURSE_MIN_METERS) {
        if (lastCourseFix && accuracy <= UNTRUSTED_ACCURACY_METERS) {
          courseRef.current = bearingDegrees(lastCourseFix, position);
          setCourse(courseRef.current);
        }
        lastCourseFixRef.current = position;
      }

      const nav = navRef.current;
      if (nav.mode !== "navigate" || !nav.navRoute || !nav.destination || nav.hasArrived) return;

      let route = nav.navRoute;
      let next = trackProgress(route, position, progressHintRef.current);
      let notice: RouteNotice | undefined;
      const trusted = accuracy <= UNTRUSTED_ACCURACY_METERS;
      const limit = offRouteLimit(accuracy);

      // The route being left stays on the map, faded, so the walker can still change their mind.
      const adopt = (candidate: Route, kind: RouteNotice) => {
        const leaving = route;
        const leftAt = next;
        route = candidate;
        next = trackProgress(candidate, position, 0);
        notice = kind;
        maxAlongRef.current = next.distanceAlong;
        offRouteCountRef.current = 0;
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
      if (previous && trusted) {
        const onPrevious = trackProgress(previous, position, previousHintRef.current);
        previousHintRef.current = onPrevious.segmentIndex;
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

      const isOff = trusted && next.distanceFromRoute > limit;
      offRouteCountRef.current = isOff ? offRouteCountRef.current + 1 : 0;
      const clearlyLost = isOff && next.distanceFromRoute > 80;

      maxAlongRef.current = Math.max(maxAlongRef.current, next.distanceAlong);
      const backtracked = maxAlongRef.current - next.distanceAlong;
      const segmentStart = route.path[Math.max(0, next.segmentIndex - 1)];
      const segmentEnd = route.path[next.segmentIndex] ?? segmentStart;
      const walkingOpposite =
        courseRef.current !== undefined &&
        Math.abs(turnAngle(bearingDegrees(segmentStart, segmentEnd), courseRef.current)) > OPPOSITE_DEGREES;
      const wrongWay =
        trusted &&
        !isOff &&
        (backtracked > WRONG_WAY_WARN_METERS || (walkingOpposite && backtracked > COURSE_MIN_METERS));

      if (!notice && nav.graph && (offRouteCountRef.current >= 2 || clearlyLost)) {
        const rerouted = findRoute(nav.graph, position, nav.destination.coordinate, { avoidStairs: nav.avoidStairs });
        if (rerouted) adopt(rerouted, "rerouted");
      } else if (!notice && nav.graph && wrongWay && backtracked > WRONG_WAY_REROUTE_METERS) {
        const rerouted = findRoute(nav.graph, position, nav.destination.coordinate, { avoidStairs: nav.avoidStairs });
        if (rerouted) adopt(rerouted, "rerouted");
      } else if (!notice && nav.graph && trusted && !wrongWay) {
        const since = lastRecheckRef.current;
        const due =
          Date.now() - since.at > RECHECK_INTERVAL_MS || next.distanceAlong - since.along > RECHECK_WALKED_METERS;
        if (due) {
          lastRecheckRef.current = { at: Date.now(), along: next.distanceAlong };
          const candidate = findRoute(nav.graph, position, nav.destination.coordinate, {
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
      const reachedEntrance = next.distanceAlong >= route.arrivalDistance - ARRIVAL_METERS;
      if (reachedEntrance || distanceMeters(position, nav.destination.coordinate) <= NEAR_DESTINATION_METERS) {
        navRef.current = { ...navRef.current, hasArrived: true, previousRoute: null };
        setHasArrived(true);
        setPreviousRoute(null);
        setIsWrongWay(false);
      }
      const shown = next.distanceFromRoute <= SNAP_TO_ROUTE_METERS ? next.point : position;
      if (navRef.current.isFollowing) mapRef.current?.follow(shown, navigationPadding());
    },
    [setCourse],
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

  const geo = useGeolocation({ onPosition: handlePosition, onError: handleGeoError });
  useWakeLock(mode === "navigate");

  useEffect(() => {
    navRef.current = {
      mode,
      navRoute,
      previousRoute: previousRoute?.route ?? null,
      graph,
      avoidStairs,
      isFollowing,
      hasArrived,
      destination: selected,
    };
  }, [mode, navRoute, previousRoute, graph, avoidStairs, isFollowing, hasArrived, selected]);

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

  const originPlace = origin === MY_LOCATION ? undefined : getPlace(origin);
  const originCoordinate = origin === MY_LOCATION ? geo.position : originPlace?.coordinate;
  const isOffCampus =
    origin === MY_LOCATION &&
    geo.position !== undefined &&
    distanceMeters(geo.position, CAMPUS_CENTER) > OFF_CAMPUS_METERS;

  const previewRoute = useMemo(() => {
    if (mode !== "directions" || !graph || !selected || !originCoordinate || isOffCampus) return null;
    return findRoute(graph, originCoordinate, selected.coordinate, { avoidStairs });
  }, [mode, graph, selected, originCoordinate, isOffCampus, avoidStairs]);

  let routeIssue: RouteIssue | undefined;
  if (graphFailed) routeIssue = "no-route";
  else if (!graph) routeIssue = "loading";
  else if (origin === MY_LOCATION && geo.status === "denied") routeIssue = "denied";
  else if (origin === MY_LOCATION && geo.status === "unavailable") routeIssue = "unavailable";
  else if (origin === MY_LOCATION && !geo.position) routeIssue = "locating";
  else if (isOffCampus) routeIssue = "off-campus";
  else if (!previewRoute) routeIssue = avoidStairs ? "no-step-free" : "no-route";

  const hasPreviewRoute = previewRoute !== null;
  const previewRouteRef = useRef(previewRoute);
  useEffect(() => {
    previewRouteRef.current = previewRoute;
  }, [previewRoute]);

  useEffect(() => {
    if (mode === "directions" && hasPreviewRoute && previewRouteRef.current) {
      mapRef.current?.fitPath(previewRouteRef.current.path, previewPadding());
    }
  }, [mode, hasPreviewRoute, origin, avoidStairs, selectedId]);

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

  // Friends who are sharing right now, labelled with their initials. You already have a location
  // dot, so you are never a person pin to find.
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
    requestHeading();
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
    setIsDirectionsExpanded(true);
    setMode("directions");
    geo.start();
  }

  function handleLocate() {
    requestHeading();
    if (geo.position) {
      mapRef.current?.focus(geo.position);
      return;
    }
    centerOnFixRef.current = true;
    geo.start();
  }

  function openDirections() {
    requestHeading();
    setIsDirectionsExpanded(true);
    setMode("directions");
    geo.start();
  }

  function handleOriginChange(next: string) {
    setOrigin(next === MY_LOCATION || getPlace(next) ? next : MY_LOCATION);
    if (next === MY_LOCATION) geo.start();
  }

  function startNavigation() {
    if (!previewRoute || !geo.position) return;
    requestHeading();
    progressHintRef.current = 0;
    offRouteCountRef.current = 0;
    maxAlongRef.current = 0;
    lastRecheckRef.current = { at: Date.now(), along: 0 };
    navRef.current = {
      ...navRef.current,
      mode: "navigate",
      navRoute: previewRoute,
      previousRoute: null,
      isFollowing: true,
      hasArrived: false,
    };
    setPreviousRoute(null);
    setIsWrongWay(false);
    setNavRoute(previewRoute);
    setProgress(trackProgress(previewRoute, geo.position, 0));
    setHasArrived(false);
    setIsFollowing(true);
    setMode("navigate");
    mapRef.current?.follow(geo.position, navigationPadding());
  }

  function endNavigation() {
    setMode("browse");
    setNavRoute(null);
    setPreviousRoute(null);
    setIsWrongWay(false);
    setProgress(undefined);
    setHasArrived(false);
    if (selected) mapRef.current?.focus(selected.coordinate, sheetPadding());
  }

  function switchToPreviousRoute() {
    const nav = navRef.current;
    if (nav.mode !== "navigate" || !nav.previousRoute || !nav.navRoute || !nav.graph || !geo.position) return;
    // Tapping the faded line means "take me that way", so walk to it first if the user is not already on it.
    const chosen = routeVia(nav.graph, geo.position, nav.previousRoute, { avoidStairs: nav.avoidStairs });
    if (!chosen) {
      toast.danger("Could not find a way to that route");
      return;
    }
    const leaving = nav.navRoute;
    const leftAt = trackProgress(leaving, geo.position, progressHintRef.current);
    const next = trackProgress(chosen, geo.position, 0);
    progressHintRef.current = next.segmentIndex;
    maxAlongRef.current = next.distanceAlong;
    offRouteCountRef.current = 0;
    previousHintRef.current = leftAt.segmentIndex;
    previousStartAlongRef.current = leftAt.distanceAlong;
    previousMatchesRef.current = 0;
    lastRecheckRef.current = { at: Date.now(), along: next.distanceAlong };
    navRef.current = { ...nav, navRoute: chosen, previousRoute: leaving };
    setNavRoute(chosen);
    setPreviousRoute({ route: leaving, path: remainingPath(leaving, leftAt) });
    setProgress(next);
    setIsWrongWay(false);
    setRouteNotice("switched");
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setRouteNotice(undefined), NOTICE_MS);
  }

  function recenter() {
    setIsFollowing(true);
    if (geo.position) mapRef.current?.follow(geo.position, navigationPadding());
  }

  const visiblePlaces = useMemo(() => {
    if (mode !== "browse" || filter === "all") return PLACES;
    return PLACES.filter((place) => place.category === filter || place.id === selectedId);
  }, [mode, filter, selectedId]);

  const navPath = useMemo(
    () => (navRoute && progress ? remainingPath(navRoute, progress) : navRoute?.path),
    [navRoute, progress],
  );
  const mapRoute = mode === "navigate" ? navPath : mode === "directions" ? previewRoute?.path : undefined;
  const snappedToRoute = mode === "navigate" && progress && progress.distanceFromRoute <= SNAP_TO_ROUTE_METERS;
  const shownLocation = snappedToRoute ? progress.point : geo.position;
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
    <main className="map-bleed bg-background">
      <CampusMap
        ref={mapRef}
        places={visiblePlaces}
        selectedId={selectedId}
        originId={mode === "directions" ? originPlace?.id : undefined}
        userLocation={shownLocation}
        route={mapRoute}
        people={meetupPeople}
        destinationPin={meetupPin}
        previousRoute={mode === "navigate" ? previousRoute?.path : undefined}
        onPreviousRoutePress={switchToPreviousRoute}
        initialFocus={selected?.coordinate}
        getFocusPadding={meetupSheetOpen || peopleExpanded || scheduleExpanded || accountExpanded || (mode === "directions" && isDirectionsExpanded) ? sheetPadding : hasPeek ? peekPadding : sheetPadding}
        onSelect={selectPlace}
        onUserPan={() => {
          if (mode === "navigate") setIsFollowing(false);
        }}
        onPersonPress={(id) => setActivePersonId((current) => (current === id ? null : id))}
        buildingView={buildingView}
      />

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
                />
              </div>
              {isSearchOpen ? null : (
                <Surface className="flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg">
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
                <Surface className="relative flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg">
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
                <Surface className="flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg">
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
                <Surface className="flex size-[52px] shrink-0 items-center justify-center rounded-3xl shadow-lg">
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
                      className="shrink-0 rounded-full bg-overlay px-3.5 shadow-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
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
                  ? "absolute bottom-[7.25rem] z-10 right-[var(--map-safe-right)] md:bottom-[calc(5.5rem+var(--map-safe-bottom))] md:right-4"
                  : "absolute bottom-[calc(3rem+var(--map-safe-bottom))] z-10 right-[var(--map-safe-right)] md:right-4"
            }>
            <MapViewControls
              buildingView={buildingView}
              locating={geo.status === "locating"}
              located={Boolean(geo.position)}
              onToggleBuildingView={() => setBuildingView((on) => !on)}
              onCampus={() => mapRef.current?.showCampus()}
              onLocate={handleLocate}
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
            geoStatus={geo.status}
            onOriginChange={handleOriginChange}
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
        <div className="absolute bottom-[7.25rem] z-10 right-[var(--map-safe-right)] md:bottom-[calc(5.5rem+var(--map-safe-bottom))] md:right-4">
          <MapViewControls
            buildingView={buildingView}
            locating={geo.status === "locating"}
            located={Boolean(geo.position)}
            onToggleBuildingView={() => setBuildingView((on) => !on)}
            onCampus={() => mapRef.current?.showCampus()}
            onLocate={handleLocate}
          />
        </div>
      ) : null}

      {mode === "navigate" && selected && navRoute ? (
        <NavigationHud
          destination={selected}
          route={navRoute}
          progress={progress}
          isFollowing={isFollowing}
          notice={routeNotice}
          isWrongWay={isWrongWay}
          hasAlternate={previousRoute !== null}
          hasArrived={hasArrived}
          weakSignal={(geo.accuracy ?? 0) > WEAK_ACCURACY_METERS}
          onRecenter={recenter}
          onEnd={endNavigation}
        />
      ) : null}
    </main>
  );
}
