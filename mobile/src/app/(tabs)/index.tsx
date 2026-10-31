import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FilterSpecification,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type * as GeoJSON from 'geojson';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect, usePathname } from 'expo-router';
import { useThemeColor, useToast } from 'heroui-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, useColorScheme, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { CategoryBar, type MapFilter } from '@/components/category-bar';
import { Glass } from '@/components/glass';
import { DirectionsPanel } from '@/components/directions-panel';
import { MeetupBar } from '@/components/meetup-bar';
import { RouteLine } from '@/components/route-line';
import { PersonCard, PersonPin } from '@/components/person-pin';
import { MapControls, type MapControl } from '@/components/map-controls';
import { MapButton } from '@/components/map-button';
import { BreakCard, NavigationBanner, NavigationFooter, ParkingCard } from '@/components/navigation-hud';
import { PlaceDetails } from '@/components/place-details';
import { PlaceMarker } from '@/components/place-marker';
import { RoomMarker } from '@/components/room-marker';
import { SafetyMarker } from '@/components/safety-marker';
import { EdgeScrim, TopScrim } from '@/components/top-scrim';
import { UserPin } from '@/components/user-pin';
import { AMENITY_POINTS, isAmenity, placeCalled, type AmenityKind } from '@/data/amenities';
import { CAMPUS, PLACES, contains, getPlace, type Coordinate, type Place } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import { useMeetupLive } from '@/hooks/use-meetup-live';
import { useNow } from '@/hooks/use-now';
import { mapCameraPadding, PANEL_WIDTH, useMapChromeBottom, useShortViewport, useTabRail, useWide } from '@/hooks/use-layout';
import { useNavigation, type FollowTarget } from '@/hooks/use-navigation';
import { useRoutePreview } from '@/hooks/use-route-preview';
import { useVoiceGuidance } from '@/hooks/use-voice-guidance';
import { holdVoice } from '@/lib/voice';
import { useProfile } from '@/lib/account';
import { campusActivityByPlace, eventsAtPlace } from '@/lib/campus-activity';
import { useDevicePrefs } from '@/lib/device-prefs';
import { useFocusedPlace } from '@/lib/focus';
import { showPlace } from '@/lib/links';
import { closePlacePanel, usePlacePanel } from '@/lib/place-panel';
import { formatRouteTime } from '@/lib/directions';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { stepText } from '@/lib/instructions';
import { endTrip, showTrip } from '@/lib/live-activity';
import { currentCompass, currentFix, glideMs, onFix, subscribeCompass, useLocation } from '@/lib/location';
import { amenityWhere, nearestAmenity } from '@/lib/amenity-search';
import { arriveChoices, breakArrivalNote, classStartAt, findBreak, type BreakOffer } from '@/lib/breaks';
import { useClasses } from '@/lib/classes';
import { parkingSpoken } from '@/lib/parking';
import { watchSteps } from '@/lib/steps';
import { roomSpot, safetyBuildingHere, safetyBuildings, safetyFor, type SafetySpot } from '@/lib/building-safety';
import { buildingPolygon } from '@/lib/buildings';
import {
  BUILDING_PITCH,
  BUILDING_ZOOM,
  amenityLayers,
  buildingColor,
  buildingLight,
  buildingWallShade,
  heatColors,
} from '@/lib/map-paint';
import { compactSafetySpots, placeChipSize, roomChipSize, sameIds, type Obstacle } from '@/lib/declutter';
import { markerLabel, zoomBand, type ZoomBand } from '@/lib/place-marker';
import { canSwitchTravel } from '@/lib/travel-switch';
import { TRAVEL_SWITCH_LINES, lowerFirst } from '@/lib/voice-lines';
import { askForRating, finishedWalk } from '@/lib/rating';
import { floorLabel, roomDirections } from '@/lib/search';
import { legSeconds, stopsStart } from '@/lib/stops';
import { createCameraMemory, createSmoothHeading, shortestTurn } from '@/lib/smooth-heading';
import { markReady } from '@/lib/splash';
import { showMeetupOnMap, useShownMeetup } from '@/lib/meetup-focus';
import { findRoute, remainingPath } from '@/lib/routing';
import { useSocial } from '@/lib/social';
import {
  MY_LOCATION,
  closeTrip,
  insertStopNow,
  nextLeg,
  onStopNow,
  pickArrive,
  planTrip,
  removeStop,
  setAvoidStairs,
  setStopsContext,
  setTravelMode,
  startNavigating,
  useTrip,
} from '@/lib/trip';

const { center, zoom, bounds, styles } = CAMPUS.map;
const CAMPUS_CENTER: [number, number] = [center.longitude, center.latitude];
const MAX_BOUNDS: [number, number, number, number] = [bounds.west - 0.3, bounds.south - 0.3, bounds.east + 0.3, bounds.north + 0.3];
const PLACE_ZOOM = 17;
// MapLibre keeps the last padding it was given, so every camera move says its own.
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };
// Facing-up: ignore tiny wobble, and never cut a camera ease short with another.
const HEADING_UP_MIN_DEGREES = 2;
// Short gaps so a GPS follow every second cannot glue the map's turn in place.
const HEADING_UP_GAP_MS = 90;
const HEADING_UP_MS = 260;
// MapLibre on iOS often marks our own easeTo as a user pan; ignore those until the move is done.
const PROGRAMMATIC_GRACE_MS = 180;
// Drawing a new route line also fires fake pans; hold longer so a reroute cannot freeze the compass.
const REROUTE_HOLD_MS = 2_000;
// Lets the map settle on the building before the rating sheet can appear.
const RATING_DELAY_MS = 2_000;

const toLngLat = ({ latitude, longitude }: Coordinate): [number, number] => [longitude, latitude];
// Map sizes that grow from the campus overview to close up, the same steps as the web map.
const zoomed = (low: number, high: number) => ['interpolate', ['linear'], ['zoom'], 14, low, 18, high] as ExpressionSpecification;
// Made once, since a new light on every render makes the map apply it again each time.
const BUILDING_LIGHTS = { light: buildingLight(false), dark: buildingLight(true) };
// Drawn by app/scripts/build-route-chevron.mjs and build-map-icons.mjs, tinted with the theme on the map.
const MAP_ICONS = {
  'route-chevron': { source: require('@/assets/images/route-chevron.png'), sdf: true },
  'amenity-sos': { source: require('@/assets/images/amenity-sos.png'), sdf: true },
  'amenity-bench': { source: require('@/assets/images/amenity-bench.png'), sdf: true },
  'amenity-trash': { source: require('@/assets/images/amenity-trash.png'), sdf: true },
  'amenity-picnic': { source: require('@/assets/images/amenity-picnic.png'), sdf: true },
  'amenity-bikes': { source: require('@/assets/images/amenity-bikes.png'), sdf: true },
};

function line(path: Coordinate[] | undefined | null): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!path || path.length < 2) return null;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path.map(toLngLat) } };
}

function initials(name: string, fallback: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return letters || fallback.slice(0, 2).toUpperCase();
}

// Place chips farther than this from every safety chip cannot meet one on screen close up.
const OBSTACLE_METERS = 150;

// The break check runs only while the walker is on the route, and the offer lapses this far past the seat.
const BREAK_ON_ROUTE_METERS = 12;
const BREAK_PASSED_METERS = 20;

export default function MapScreen() {
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const wide = useWide();
  const short = useShortViewport();
  // Left column only when there is room vertically; landscape phones stay full-width bottom chrome.
  const columnChrome = wide && !short;
  const { toast } = useToast();
  const camera = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [cameraMemory] = useState(createCameraMemory);
  const [smoothHeading] = useState(() => createSmoothHeading({ calmMs: 200, fastMs: 75, settled: 0.55 }));
  const facingUpRef = useRef(true);
  // Where and how close the camera last followed, so a turn to match the compass keeps both.
  const lastFollow = useRef<{ point: Coordinate; zoom: number } | null>(null);
  // Until this time, region-change "userInteraction" is our own camera move, not a finger pan.
  const programmaticUntil = useRef(0);
  const noteProgrammatic = (ms: number) => {
    programmaticUntil.current = Date.now() + ms + PROGRAMMATIC_GRACE_MS;
  };
  const isProgrammaticCamera = () => Date.now() < programmaticUntil.current;
  const [buildingView, setBuildingView] = useState(false);
  const focused = useFocusedPlace();
  const trip = useTrip();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const shownMeetupId = useShownMeetup();
  const [filter, setFilter] = useState<MapFilter>('all');
  const [band, setBand] = useState<ZoomBand>(() => zoomBand(zoom));
  const [facingUp, setFacingUp] = useState(true);
  // The turn list at the top and the trip panel at the bottom: one open at a time, so the map stays in view.
  const [hudPanel, setHudPanel] = useState<'steps' | 'trip' | null>(null);
  // An offer to rest is made at most once a walk, and only when there is a time to be there by.
  const breakRef = useRef<{ asked: boolean; startedAt: number; arriveBy: number | null }>({ asked: true, startedAt: 0, arriveBy: null });
  const [breakOffer, setBreakOffer] = useState<BreakOffer | null>(null);
  const [breakStop, setBreakStop] = useState<{ id: string; leaveBy: number } | null>(null);
  const [isRotated, setIsRotated] = useState(false);
  const [activePerson, setActivePerson] = useState<string | null>(null);
  const [ratingDue, setRatingDue] = useState(false);
  const [permission, requestPermission] = Location.useForegroundPermissions();
  // The color made to sit on the accent: the route's casing and chevrons, the same as the web map.
  const [accent, danger, background, casing, muted, overlay, surface, edge] = useThemeColor([
    'accent',
    'danger',
    'background',
    'accent-foreground',
    'muted',
    'overlay',
    'default',
    'border',
  ]);
  const amenities = useMemo(() => amenityLayers(0.5, { sos: danger, other: muted, halo: overlay }), [danger, muted, overlay]);
  // Kept between renders, so the map is not handed the 3D paint again on every location fix.
  const buildingsPaint = useMemo(
    () =>
      ({
        'fill-extrusion-color': buildingColor(scheme === 'dark', { surface, edge, muted, accent }),
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': buildingWallShade(scheme === 'dark'),
        // Rises from flat as the map zooms in, to the building's mapped height, or 14 m when unknown.
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          15.6,
          [
            'case',
            ['>', ['to-number', ['get', 'render_height']], 0],
            ['to-number', ['get', 'render_height']],
            ['>', ['to-number', ['get', 'height']], 0],
            ['to-number', ['get', 'height']],
            14,
          ],
        ],
        'fill-extrusion-base': ['to-number', ['get', 'render_min_height']],
      }) as FillExtrusionLayerSpecification['paint'],
    [scheme, surface, edge, muted, accent],
  );

  const meetup =
    social.meetups.find((m) => m.id === shownMeetupId && m.active && m.yourStatus === 'joined') ?? null;
  const activityCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of campusActivityByPlace(social.campus)) map[row.placeId] = row.count;
    return map;
  }, [social.campus]);
  const activityHeat = useMemo((): GeoJSON.FeatureCollection<GeoJSON.Point> => {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const place of PLACES) {
      const count = activityCounts[place.id] ?? 0;
      if (count < 1) continue;
      features.push({ type: 'Feature', properties: { weight: Math.min(count, 6) }, geometry: { type: 'Point', coordinates: toLngLat(place.coordinate) } });
    }
    return { type: 'FeatureCollection', features };
  }, [activityCounts]);
  const tripEvents = useMemo(
    () => (trip.destination ? eventsAtPlace(social.campus, trip.destination.id) : []),
    [social.campus, trip.destination],
  );
  const planning = trip.phase === 'preview';
  const navigating = trip.phase === 'navigate';
  const pathname = usePathname();
  const pickingOrigin = pathname.endsWith('/origin');
  const located = permission?.granted ?? false;
  const [onScreen, setOnScreen] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setOnScreen(true);
      return () => setOnScreen(false);
    }, []),
  );
  // The location runs while the map is on screen, for the heading beam, and all through a trip or meetup.
  const location = useLocation({
    watching: (located && onScreen) || trip.phase !== 'idle' || meetup !== null,
    navigation: navigating,
  });

  const follow = useCallback(
    ({ point, zoom: level, bearing }: FollowTarget) => {
      // A failed camera move, which some Android builds do while the style loads, must never stop guidance.
      try {
        // Prefer the smoothed facing heading so follow and compass turns do not fight.
        const smoothed = facingUpRef.current ? smoothHeading.current() : undefined;
        const nextBearing =
          smoothed !== undefined
            ? smoothed
            : Number.isFinite(bearing)
              ? (bearing as number)
              : cameraMemory.bearing();
        if (Number.isFinite(bearing)) smoothHeading.set(bearing as number);
        // An even pace over the time until the next fix, so the map never moves and then stops between fixes.
        const duration = glideMs();
        // Mark as a follow so compass turns can still run; a long busy lock was freezing the heading at speed.
        cameraMemory.moving(nextBearing, duration, 'follow');
        noteProgrammatic(duration);
        lastFollow.current = { point, zoom: level };
        camera.current?.easeTo({
          center: toLngLat(point),
          zoom: level,
          bearing: nextBearing,
          pitch: 40,
          duration,
          easing: 'linear',
          padding: mapCameraPadding(wide, 'follow', insets),
        });
      } catch {
        // Tried again on the next fix.
      }
    },
    [cameraMemory, insets, smoothHeading, wide],
  );

  // While guiding, the place being walked to now: the next stop, or the destination after the last one.
  const target = navigating ? (getPlace(trip.legs[trip.leg]) ?? trip.destination) : trip.destination;
  const nextTarget = navigating ? getPlace(trip.legs[trip.leg + 1]) : undefined;
  const arrivalNote =
    breakStop && target?.id === breakStop.id
      ? breakArrivalNote(breakStop.leaveBy)
      : trip.room && target?.id === trip.destination?.id
        ? roomDirections(trip.room, trip.avoidStairs, trip.destination?.id)
        : undefined;
  const room = useMemo(() => roomSpot(trip.destination?.id, trip.room), [trip.destination?.id, trip.room]);

  const navigation = useNavigation({
    destination: target,
    avoidStairs: trip.avoidStairs,
    follow,
    facingUp,
  });
  useEffect(() => {
    facingUpRef.current = facingUp;
  }, [facingUp]);

  // The building someone is in, carried from fix to fix so its exits do not flicker at the door.
  const [safetyHere, setSafetyHere] = useState<string | null>(null);
  const nextSafetyHere = safetyBuildingHere(location.fix?.position, location.fix?.accuracy, safetyHere);
  if (nextSafetyHere !== safetyHere) setSafetyHere(nextSafetyHere);
  const safetyGoingTo = navigating ? target?.id : undefined;
  const safety = useMemo(() => {
    const spots: SafetySpot[] = [];
    const exits = new Set<string>();
    for (const id of safetyBuildings(safetyGoingTo, safetyHere)) {
      const pin = getPlace(id)?.coordinate;
      const found = pin ? safetyFor(id, pin) : null;
      if (!found) continue;
      spots.push(...found.spots);
      if (found.exitAtPin) exits.add(id);
    }
    return { spots, exits };
  }, [safetyGoingTo, safetyHere]);

  // After a reroute, the new blue line makes MapLibre report a finger pan. Ignore it and pull follow back.
  useEffect(() => {
    if (!navigating) return;
    const notice = navigation.notice;
    if (notice !== 'rerouted' && notice !== 'switched' && notice !== 'faster') return;
    noteProgrammatic(REROUTE_HOLD_MS);
    if (!navigation.isFollowing && navigation.manualStep === null && !navigation.hasArrived) {
      navigation.recenter();
    }
    // Only the notice flip should run this; recenter is stable enough for the recovery path.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: react to route-change notices
  }, [navigating, navigation.notice]);

  // Ease the camera only once the heading settles and nothing else moves it, like the web's turnMapToFacing.
  useEffect(() => {
    if (!navigating || !facingUp || !navigation.isFollowing || navigation.manualStep !== null) {
      return;
    }
    // Read on each fix and each compass turn without redrawing this whole screen for every degree.
    const courseHeading = () => {
      const fix = currentFix();
      if (fix && (fix.speed ?? 0) >= 0.7 && fix.heading !== undefined) return fix.heading;
      return undefined;
    };
    const turnToFacing = (shown: number) => {
      if (!facingUpRef.current) return;
      // Following the blue dot must not glue the map; only a heading ease blocks the next one.
      if (cameraMemory.blocksHeading()) return;
      if (cameraMemory.sinceMove() < HEADING_UP_GAP_MS) return;
      const delta = Math.abs(shortestTurn(cameraMemory.bearing(), shown));
      if (delta < HEADING_UP_MIN_DEGREES) return;
      const at = lastFollow.current;
      if (!at) return;
      const following = cameraMemory.followLeft();
      const duration = Math.max(HEADING_UP_MS, following);
      cameraMemory.moving(shown, duration, 'heading');
      noteProgrammatic(duration);
      try {
        // The same center, zoom, and padding as following, or each turn would shift the view.
        camera.current?.easeTo({
          center: toLngLat(at.point),
          zoom: at.zoom,
          bearing: shown,
          pitch: 40,
          duration,
          easing: following > 0 ? 'linear' : undefined,
          padding: mapCameraPadding(wide, 'follow', insets),
        });
      } catch {
        // Map may still be loading.
      }
    };
    const aim = () => {
      // Compass first at every speed; GPS course only when the compass is quiet (matches the cone).
      const raw = currentCompass() ?? courseHeading();
      if (raw !== undefined) smoothHeading.set(raw, turnToFacing);
    };
    aim();
    return subscribeCompass(aim);
  }, [cameraMemory, facingUp, insets, location.fix, navigating, navigation.isFollowing, navigation.manualStep, smoothHeading, wide]);

  useEffect(() => {
    if (facingUp) return;
    smoothHeading.stop();
  }, [facingUp, smoothHeading]);

  useEffect(() => () => smoothHeading.stop(), [smoothHeading]);
  const preview = useRoutePreview(trip, location.fix?.position, location.status, navigation.travelHeading);
  const livePosition = location.fix?.position;
  useEffect(() => {
    const route = preview.route;
    const fromStreets = preview.isOffCampus && route && livePosition && !preview.plan?.startPlace;
    setStopsContext({
      from: stopsStart(preview.plan, route),
      streets: fromStreets ? { here: livePosition, travel: trip.travelMode, toFirst: legSeconds(route) } : null,
    });
  }, [preview.plan, preview.route, preview.isOffCampus, livePosition, trip.travelMode]);
  const voice = useVoiceGuidance({
    route: navigating ? navigation.route : null,
    progress: navigation.progress,
    destinationName: target ? placeCalled(target) : undefined,
    arrivalNote,
    isWrongWay: navigation.isWrongWay,
    hasArrived: navigation.hasArrived,
    notice: navigation.notice,
    paused: navigation.isRiding,
    speed: navigation.speed,
  });
  const sayLine = voice.say;
  const askLine = voice.ask;

  // Read on each fix without redrawing for it: the walk so far and who to greet.
  const breakInputs = useRef({
    route: navigation.route,
    progress: navigation.progress,
    arrived: navigation.hasArrived,
    manual: navigation.manualStep !== null,
    name: profile?.displayName,
  });
  useEffect(() => {
    breakInputs.current = {
      route: navigation.route,
      progress: navigation.progress,
      arrived: navigation.hasArrived,
      manual: navigation.manualStep !== null,
      name: profile?.displayName,
    };
  }, [navigation.route, navigation.progress, navigation.hasArrived, navigation.manualStep, profile?.displayName]);
  useEffect(
    () =>
      onFix(() => {
        const walk = breakRef.current;
        const { route, progress, arrived, manual, name } = breakInputs.current;
        if (walk.asked || walk.arriveBy === null || !route || !progress || arrived || manual) return;
        if (progress.distanceFromRoute > BREAK_ON_ROUTE_METERS) return;
        const now = Date.now();
        const offer = findBreak({ route, progress, arriveBy: walk.arriveBy, now, walkedSeconds: (now - walk.startedAt) / 1000, displayName: name });
        if (!offer) return;
        walk.asked = true;
        setBreakOffer(offer);
        askLine(offer.line);
      }),
    [askLine],
  );
  // The offer lapses once the seat is behind them: walking on is a no, and it is not asked again.
  const shownBreak =
    breakOffer && navigating && !navigation.hasArrived && navigation.progress && navigation.progress.distanceAlong <= breakOffer.along + BREAK_PASSED_METERS
      ? breakOffer
      : null;

  const classes = useClasses();
  const nowTick = useNow(60_000);
  const classStart = useMemo(
    () => (trip.destination ? classStartAt(trip.destination.id, classes, nowTick) : undefined),
    [trip.destination, classes, nowTick],
  );
  const arriveOptions = useMemo(() => arriveChoices(nowTick, classStart), [nowTick, classStart]);
  // Walking to a class picks its start time; anything picked by hand holds until another place is chosen.
  const arrive =
    trip.arrivePick && trip.arrivePick.placeId === trip.destination?.id
      ? trip.arrivePick
      : classStart
        ? { id: 'class', at: classStart.at }
        : { id: 'none', at: null };
  // Each parking card is read out once, as it appears.
  useEffect(() => {
    if (navigation.parking) sayLine(parkingSpoken(navigation.parking));
  }, [navigation.parking, sayLine]);
  const live = meetup ? meetup.id : null;
  const people = useMeetupLive(live, meetup ? location.fix : null);

  // The Lock Screen and Dynamic Island follow the trip, including with the app in the background.
  const destinationName = target?.name;
  useEffect(() => {
    const route = navigation.route;
    if (!navigating || !route || !destinationName) return;
    const progress = navigation.progress;
    const index = Math.min((progress?.stepIndex ?? 0) + 1, route.steps.length - 1);
    const step = route.steps[index];
    const remaining = progress?.remaining ?? route.distance;
    showTrip({
      instruction: stepText(step, destinationName),
      distance: formatDistance(Math.max(0, step.startDistance - (progress?.distanceAlong ?? 0))),
      destination: destinationName,
      remaining: formatRouteTime(route, remaining),
      remainingSeconds:
        route.duration !== undefined && route.distance > 0 ? route.duration * (remaining / route.distance) : remaining / 1.3,
      progress: route.distance > 0 ? 1 - remaining / route.distance : 0,
      step,
      wrongWay: navigation.isWrongWay,
      arrived: navigation.hasArrived,
    });
  }, [navigating, navigation.route, navigation.progress, navigation.isWrongWay, navigation.hasArrived, destinationName]);

  useEffect(() => () => endTrip(), []);

  // The voice warms up as soon as directions open, and starts on the route's lines well before Start.
  const prepareVoice = voice.prepare;
  const primeVoice = voice.prime;
  const routeToPrime = preview.route;
  useEffect(() => {
    if (!planning) return;
    prepareVoice();
    if (routeToPrime) primeVoice(routeToPrime);
  }, [planning, routeToPrime, prepareVoice, primeVoice]);
  // The natural voice stays loaded only while directions are open, then unloads to free memory.
  const directionsOpen = planning || navigating;
  useEffect(() => (directionsOpen ? holdVoice() : undefined), [directionsOpen]);

  // The screen stays on while guiding when the user leaves Keep awake on (Account → Directions).
  const { keepAwake, autoTravel } = useDevicePrefs();

  // Steps are only counted on a street trip with the driving and walking switch on, which is when they matter.
  const streetTrip = navigating && canSwitchTravel(navigation.route?.travel);
  useEffect(() => (streetTrip && autoTravel ? watchSteps() : undefined), [streetTrip, autoTravel]);

  const travelSwitched = navigation.travelSwitched;
  const undoTravelSwitch = navigation.undoTravelSwitch;
  const announcedSwitch = useRef(0);
  useEffect(() => {
    if (!travelSwitched || announcedSwitch.current === travelSwitched.at) return;
    announcedSwitch.current = travelSwitched.at;
    const walking = travelSwitched.to === 'walk';
    setTravelMode(travelSwitched.to);
    sayLine(TRAVEL_SWITCH_LINES[travelSwitched.to]);
    toast.show({
      label: walking ? 'Switched to walking' : 'Switched to driving',
      description: walking ? 'Looks like you got out and are on foot.' : 'Looks like you are in a vehicle now.',
      duration: 10_000,
      actionLabel: 'Undo',
      onActionPress: ({ hide }) => {
        hide();
        const back = undoTravelSwitch();
        if (back) setTravelMode(back);
      },
    });
  }, [travelSwitched, undoTravelSwitch, sayLine, toast]);
  useEffect(() => {
    if (!navigating || !keepAwake) return;
    void activateKeepAwakeAsync('navigation');
    return () => void deactivateKeepAwake('navigation');
  }, [navigating, keepAwake]);

  useEffect(() => {
    if (!focused || trip.phase !== 'idle') return;
    camera.current?.flyTo({
      center: toLngLat(focused.coordinate),
      zoom: PLACE_ZOOM,
      duration: 700,
      padding: mapCameraPadding(wide, 'place', insets, { height }),
    });
  }, [focused, trip.phase, insets, height, wide]);

  // A new preview route is fitted into the space above the directions panel.
  const previewRoute = planning ? preview.route : null;
  useEffect(() => {
    if (!previewRoute) return;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const { latitude, longitude } of previewRoute.path) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
    camera.current?.fitBounds([west, south, east, north], {
      padding: mapCameraPadding(wide, 'preview', insets),
      bearing: 0,
      pitch: 0,
      duration: 700,
    });
  }, [previewRoute, insets, wide]);

  const places = useMemo(() => {
    const shown = trip.phase !== 'idle' || filter === 'all' ? PLACES : PLACES.filter((place) => place.category === filter);
    const picked = trip.phase !== 'idle' ? trip.destination : focused;
    // An SOS phone or bench is not a map place of its own, so it shows only while it is the one picked.
    return picked && isAmenity(picked) ? [...shown, picked] : shown;
  }, [filter, trip.phase, trip.destination, focused]);

  const openPlace = useCallback(
    (place: Place) => {
      if (trip.phase === 'idle') showPlace(place);
    },
    [trip.phase],
  );

  const toggleBuildings = useCallback(async () => {
    const next = !buildingView;
    setBuildingView(next);
    if (next) {
      const level = (await mapRef.current?.getZoom().catch(() => zoom)) ?? zoom;
      camera.current?.zoomTo(Math.max(level, BUILDING_ZOOM), { pitch: BUILDING_PITCH, duration: 650, padding: NO_PADDING });
    } else {
      const level = (await mapRef.current?.getZoom().catch(() => zoom)) ?? zoom;
      camera.current?.zoomTo(level, { pitch: 0, bearing: 0, duration: 650, padding: NO_PADDING });
    }
  }, [buildingView]);

  const showCampus = useCallback(() => {
    camera.current?.flyTo({ center: CAMPUS_CENTER, zoom, bearing: 0, pitch: 0, duration: 700, padding: NO_PADDING });
  }, []);

  const showMe = useCallback(async () => {
    const answer = located ? permission : await requestPermission();
    if (!answer?.granted) {
      toast.show({
        variant: 'warning',
        label: 'Location is off',
        description: 'Allow CSI Map to use your location in Settings to see where you are.',
        actionLabel: 'Settings',
        onActionPress: ({ hide }) => {
          hide();
          void Linking.openSettings();
        },
      });
      return;
    }
    const fix =
      currentFix()?.position ??
      (await Location.getLastKnownPositionAsync({ maxAge: 60_000 }))?.coords ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })).coords;
    const here = { latitude: fix.latitude, longitude: fix.longitude };
    if (!contains(bounds, here)) {
      toast.show({ label: "You're not near campus", description: 'Pick a place and tap Directions to get here.' });
      showCampus();
      return;
    }
    camera.current?.flyTo({ center: toLngLat(here), zoom: PLACE_ZOOM, duration: 700, padding: NO_PADDING });
  }, [located, permission, requestPermission, showCampus, toast]);

  // Live from here, or by hand from a starting building when there is no location yet.
  const liveStart = preview.plan?.live ?? false;

  function start() {
    const route = preview.route;
    if (!route) return;
    const from = liveStart ? (location.fix?.position ?? null) : null;
    // Voice and camera are extras that may fail; starting must always reach guidance.
    try {
      voice.begin(route, navigation.facing());
    } catch {
      // Guidance still shows the turns.
    }
    const walking = !route.travel || route.travel === 'walk';
    breakRef.current = { asked: false, startedAt: Date.now(), arriveBy: walking ? arrive.at : null };
    setBreakOffer(null);
    setBreakStop(null);
    try {
      navigation.start(route, from);
      startNavigating(preview.plan?.targets.map((place) => place.id) ?? (trip.destination ? [trip.destination.id] : []));
    } catch (error) {
      toast.show({
        variant: 'danger',
        label: "Couldn't start directions",
        description: error instanceof Error ? error.message.slice(0, 120) : 'Try again in a moment.',
      });
      return;
    }
    if (!from && trip.destination) {
      try {
        camera.current?.flyTo({ center: toLngLat(route.path[0]), zoom: PLACE_ZOOM, duration: 700, padding: NO_PADDING });
      } catch {
        // The map stays where it is.
      }
    }
  }

  // Arrived at a stop: on to the next place, from wherever the traveller is now.
  function continueTrip() {
    const next = nextTarget;
    if (!next || !target) return;
    const here = location.fix?.position;
    const route = findRoute(walkGraph(), here ?? target.coordinate, next.coordinate, { avoidStairs: trip.avoidStairs });
    if (!route) {
      toast.show({ variant: 'danger', label: `Could not find a way to ${next.name}` });
      return;
    }
    setHudPanel(null);
    nextLeg();
    try {
      voice.begin(route, navigation.facing());
    } catch {
      // Guidance still shows the turns.
    }
    navigation.start(route, here ?? null);
  }

  // A stop added mid walk is the very next place, walked to from here; the rest of the trip carries on after it.
  function addStopNow(place: Place) {
    if (!navigating || !target) return;
    const here = location.fix?.position;
    const from = here ?? navigation.progress?.point ?? target.coordinate;
    const route = findRoute(walkGraph(), from, place.coordinate, { avoidStairs: trip.avoidStairs });
    if (!route) {
      toast.show({ variant: 'danger', label: `Could not find a way to ${placeCalled(place)}` });
      return;
    }
    insertStopNow(place.id, navigation.hasArrived);
    setHudPanel(null);
    setBreakOffer(null);
    try {
      voice.begin(route, navigation.facing());
    } catch {
      // Guidance still shows the turns.
    }
    navigation.start(route, here ?? null);
    toast.show({
      variant: 'success',
      label: 'Stop added',
      description: isAmenity(place) ? `${place.name}, ${lowerFirst(amenityWhere(place))}` : place.name,
    });
  }

  function addStopKind(kind: AmenityKind) {
    const from = location.fix?.position ?? navigation.progress?.point ?? target?.coordinate;
    const match = from ? nearestAmenity(kind, from) : undefined;
    if (match) addStopNow(match.place);
  }

  function takeBreak() {
    const offer = breakOffer;
    setBreakOffer(null);
    if (!offer) return;
    setBreakStop({ id: offer.spot.id, leaveBy: Date.now() + offer.toSeat * 1000 + offer.minutes * 60_000 });
    addStopNow(offer.spot);
  }

  // A place picked on the search sheet mid walk comes back here to be walked to.
  const addStopNowRef = useRef(addStopNow);
  useEffect(() => {
    addStopNowRef.current = addStopNow;
  });
  useEffect(
    () =>
      onStopNow((id) => {
        const place = getPlace(id);
        if (place) addStopNowRef.current(place);
      }),
    [],
  );

  // Changing stairs mid walk finds the way again from here; if there is no step free way, the walk stays as is.
  function changeAvoidStairs(avoid: boolean) {
    if (!navigation.changeAvoidStairs(avoid)) {
      toast.show({ variant: 'warning', label: 'No step-free way from here', description: 'Your route stays the same for now.' });
      return;
    }
    setAvoidStairs(avoid);
  }

  function end() {
    breakRef.current.asked = true;
    setBreakOffer(null);
    setBreakStop(null);
    const destination = trip.destination;
    const reachedDestination = navigation.hasArrived && !nextTarget;
    // A compass turn landing after End would otherwise swing the camera back to the last followed spot.
    lastFollow.current = null;
    setHudPanel(null);
    setFacingUp(true);
    setIsRotated(false);
    smoothHeading.stop();
    endTrip();
    navigation.end();
    closeTrip();
    if (destination) {
      camera.current?.flyTo({
        center: toLngLat(destination.coordinate),
        zoom: PLACE_ZOOM,
        bearing: 0,
        pitch: 0,
        duration: 700,
        padding: NO_PADDING,
      });
    }
    if (reachedDestination && finishedWalk()) setRatingDue(true);
  }

  // Only once the walk is over and no new one has started; the system decides whether the sheet shows.
  useEffect(() => {
    if (!ratingDue || trip.phase !== 'idle') return;
    const timer = setTimeout(() => {
      setRatingDue(false);
      void askForRating();
    }, RATING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ratingDue, trip.phase]);

  const pointNorth = useCallback(() => {
    void (async () => {
      const center = await mapRef.current?.getCenter().catch(() => undefined);
      if (!center) return;
      smoothHeading.set(0);
      cameraMemory.moving(0, 500, 'heading');
      noteProgrammatic(500);
      camera.current?.easeTo({ center, bearing: 0, duration: 500, padding: NO_PADDING });
      setIsRotated(false);
    })();
  }, [cameraMemory, smoothHeading]);

  function toggleFacing() {
    const next = !facingUp;
    setFacingUp(next);
    if (next) navigation.recenter();
    else pointNorth();
  }

  function noteBearing(bearing: number) {
    cameraMemory.setBearing(bearing);
    const turned = ((bearing % 360) + 360) % 360;
    setIsRotated(turned > 1 && turned < 359);
  }

  function step(index: number) {
    const shown = navigation.showStep(index);
    const route = navigation.route;
    if (!shown || !route) return;
    voice.announceStep(route, shown.index);
    camera.current?.flyTo({
      center: toLngLat(shown.point),
      zoom: 18,
      duration: 600,
      padding: mapCameraPadding(wide, 'step', insets),
    });
  }

  // While guiding, the walks between the stops still ahead stay on the map, not just the one being walked now.
  const legsAhead = useMemo(() => {
    if (!navigating) return [];
    const ahead = [];
    for (let i = trip.leg; i < trip.legs.length - 1; i++) {
      const from = getPlace(trip.legs[i]);
      const to = getPlace(trip.legs[i + 1]);
      const route = from && to ? findRoute(walkGraph(), from.coordinate, to.coordinate, { avoidStairs: trip.avoidStairs }) : null;
      if (route) ahead.push(route);
    }
    return ahead;
  }, [navigating, trip.legs, trip.leg, trip.avoidStairs]);

  // Stops keep their number from the plan, so stop 2 is still stop 2 after stop 1 is done.
  const stopNumbers = useMemo(() => {
    const numbers: Record<string, number> = {};
    const visits = navigating ? trip.legs : (preview.plan?.targets.map((place) => place.id) ?? []);
    let number = 0;
    visits.forEach((id, index) => {
      if (id === trip.destination?.id) return;
      number += 1;
      if (!navigating || index >= trip.leg) numbers[id] = number;
    });
    return numbers;
  }, [navigating, trip.legs, trip.leg, trip.destination, preview.plan]);
  const stopCount = navigating ? trip.legs.length - 1 : 0;

  const currentPath = navigating
    ? navigation.route && navigation.progress
      ? remainingPath(navigation.route, navigation.progress)
      : navigation.route?.path
    : undefined;
  const routePath = navigating
    ? currentPath && [...currentPath, ...legsAhead.flatMap((leg) => leg.path)]
    : previewRoute
      ? [...previewRoute.path, ...preview.later.flatMap((leg) => leg.path)]
      : undefined;
  const routeEnd = routePath && routePath.length >= 2 ? toLngLat(routePath[routePath.length - 1]) : null;
  // On the route, the dot and the line glide along it together between fixes instead of jumping at each one.
  const routeTrack = useMemo(
    () =>
      navigating && navigation.route && navigation.shownAlong !== null
        ? { route: navigation.route, along: navigation.shownAlong, after: legsAhead.flatMap((leg) => leg.path) }
        : null,
    [navigating, navigation.route, navigation.shownAlong, legsAhead],
  );
  const routeColor = navigation.isWrongWay && navigating ? danger : accent;
  const previousLine = navigating ? line(navigation.previousPath) : null;
  const originPlace = planning && trip.origin !== MY_LOCATION ? getPlace(trip.origin) : undefined;
  const destinationId = trip.phase !== 'idle' ? trip.destination?.id : focused?.id;

  // Close up, a safety chip that would land on another chip keeps one icon; worked out again whenever the camera stops.
  const [compactSafety, setCompactSafety] = useState<ReadonlySet<string>>(() => new Set());
  const layoutRun = useRef(0);
  const layoutSafety = useCallback(
    async (level: ZoomBand) => {
      const run = ++layoutRun.current;
      const map = mapRef.current;
      if (!map || level !== 'near' || safety.spots.length === 0) {
        setCompactSafety((current) => (current.size ? new Set() : current));
        return;
      }
      const nearby = places.filter((place) =>
        safety.spots.some((spot) => distanceMeters(spot.coordinate, place.coordinate) <= OBSTACLE_METERS),
      );
      const at = async ({ latitude, longitude }: Coordinate) => {
        const [x, y] = await map.project([longitude, latitude]);
        return { x, y };
      };
      try {
        const [spotPoints, placePoints, roomPoint] = await Promise.all([
          Promise.all(safety.spots.map((spot) => at(spot.coordinate))),
          Promise.all(nearby.map((place) => at(place.coordinate))),
          room ? at(room.coordinate) : null,
        ]);
        if (run !== layoutRun.current) return;
        const obstacles: Obstacle[] = nearby.map((place, i) => ({
          ...placePoints[i],
          ...placeChipSize(markerLabel(place), place.id === destinationId ? place.name : undefined),
        }));
        if (room && roomPoint) obstacles.push({ ...roomPoint, ...roomChipSize(room.name, floorLabel(room.floor)) });
        const next = compactSafetySpots(
          safety.spots.map((spot, i) => ({ ...spot, at: spotPoints[i] })),
          obstacles,
        );
        setCompactSafety((current) => (sameIds(current, next) ? current : next));
      } catch {
        // A map still loading its style cannot place points yet; the next camera stop tries again.
      }
    },
    [safety, places, room, destinationId],
  );
  useEffect(() => {
    void layoutSafety(band);
  }, [layoutSafety, band]);
  // The picked building's real footprint lights up under its chip.
  const outline = destinationId ? buildingPolygon(destinationId) : null;

  const others = meetup
    ? people.positions.filter((position) => {
        if (position.member === meetup.yourLiveId) return false;
        const member = meetup.members.find((m) => m.liveId === position.member);
        return !member || member.username !== profile?.username;
      })
    : [];
  const shownPerson = activePerson ? others.find((position) => position.member === activePerson) : undefined;
  const shownPersonMember = shownPerson ? meetup?.members.find((m) => m.liveId === shownPerson.member) : undefined;
  const meetupPlace = meetup?.destination?.kind === 'place' ? getPlace(meetup.destination.placeId) : undefined;
  const meetupPin =
    meetup?.destination?.kind === 'pin' && meetup.destination.lat !== undefined && meetup.destination.lng !== undefined
      ? { latitude: meetup.destination.lat, longitude: meetup.destination.lng }
      : undefined;
  const meetupHost =
    meetup?.destination?.kind === 'member' ? meetup.members.find((m) => m.username === meetup.destination?.username) : undefined;
  const meetupSpot = meetupPlace?.coordinate ?? meetupPin;
  const meetupWhere = meetupPlace?.name ?? (meetupHost ? `Wherever ${meetupHost.displayName} is` : 'A pin on the map');

  // Android can report no bottom inset inside a tab, though the map runs under the tab and system bars.
  const rail = useTabRail();
  const panelPlace = usePlacePanel();
  const tabBarShown = trip.phase === 'idle' && !rail;
  const chromeBottom = useMapChromeBottom(tabBarShown);

  // Frames everyone in the meetup as people appear, but not on every move, so the map can still pan.
  const framed = useRef<{ id: string; count: number } | null>(null);
  const framePoints = meetup
    ? [
        ...(location.fix ? [location.fix.position] : []),
        ...(meetupSpot ? [meetupSpot] : []),
        ...others.map((position) => position.coordinate),
      ]
    : [];
  useEffect(() => {
    if (!meetup || trip.phase !== 'idle' || framePoints.length === 0) {
      if (!meetup) framed.current = null;
      return;
    }
    const last = framed.current;
    if (last && last.id === meetup.id && last.count >= framePoints.length) return;
    framed.current = { id: meetup.id, count: framePoints.length };
    const padding = mapCameraPadding(wide, 'meetup', insets, {
      bottomChrome: chromeBottom,
    });
    if (framePoints.length === 1) {
      camera.current?.flyTo({ center: toLngLat(framePoints[0]), zoom: PLACE_ZOOM, duration: 700, padding });
      return;
    }
    const lngs = framePoints.map((p) => p.longitude);
    const lats = framePoints.map((p) => p.latitude);
    camera.current?.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], {
      padding,
      bearing: 0,
      pitch: 0,
      duration: 700,
    });
  });

  const stepping = navigation.manualStep !== null;
  const navChrome = navigating && !navigation.hasArrived && !stepping;

  // Browse / planning keep the vertical capsule. During navigation the web-style row sits above the footer.
  const controls: MapControl[] = navigating
    ? []
    : [
        ...(isRotated
          ? [{ symbol: 'location.north.fill' as const, label: 'Point north', onPress: pointNorth }]
          : []),
        {
          symbol: buildingView ? 'view.2d' : 'view.3d',
          label: buildingView ? 'Flat map' : '3D buildings',
          active: buildingView,
          onPress: () => void toggleBuildings(),
        },
        { symbol: 'building.2', label: 'Show the whole campus', onPress: showCampus },
        {
          symbol: located ? 'location.fill' : 'location',
          label: 'Show my location',
          active: located,
          onPress: () => void showMe(),
        },
      ];

  const navControls = navChrome ? (
    <View pointerEvents="box-none" className="flex-row items-center justify-end gap-2 px-3">
      {!facingUp && isRotated ? (
        <MapButton iconOnly variant="secondary" symbol="location.north.fill" label="Point north" onPress={pointNorth} />
      ) : null}
      <MapButton
        iconOnly
        variant={facingUp ? 'primary' : 'secondary'}
        symbol={facingUp ? 'location.north.line.fill' : 'safari'}
        label={facingUp ? 'Keep north up' : 'Turn the map the way you face'}
        onPress={toggleFacing}
      />
      {!navigation.isFollowing ? (
        <MapButton variant="secondary" symbol="location.fill" label="Recenter" onPress={navigation.recenter} />
      ) : null}
    </View>
  ) : null;

  return (
    <View className="flex-1" style={{ backgroundColor: background }}>
      <Map
        ref={mapRef}
        style={{ flex: 1 }}
        mapStyle={scheme === 'dark' ? styles.dark : styles.light}
        logo={false}
        attribution={false}
        compass={false}
        touchPitch={navigating || buildingView}
        light={BUILDING_LIGHTS[scheme === 'dark' ? 'dark' : 'light']}
        onDidFinishLoadingMap={() => markReady('map')}
        onRegionWillChange={(event) => {
          // Our own follow/heading easeTo is often flagged as a finger pan on iOS; that was freezing the trip.
          if (navigating && event.nativeEvent.userInteraction && !isProgrammaticCamera()) {
            navigation.pauseFollowing();
          }
        }}
        onRegionIsChanging={(event) => {
          noteBearing(event.nativeEvent.bearing);
          setBand(zoomBand(event.nativeEvent.zoom));
        }}
        onRegionDidChange={(event) => {
          noteBearing(event.nativeEvent.bearing);
          setBand(zoomBand(event.nativeEvent.zoom));
          void layoutSafety(zoomBand(event.nativeEvent.zoom));
          if (navigating && event.nativeEvent.userInteraction && !isProgrammaticCamera()) {
            navigation.scheduleFollowAgain();
          }
        }}>
        {buildingView ? (
          <Layer
            id="buildings-3d"
            type="fill-extrusion"
            source="openmaptiles"
            source-layer="building"
            minzoom={14}
            // Over the roads and the flat buildings: the light style draws buildings under its labels, the dark one over its first.
            {...(scheme === 'dark' ? { afterId: 'building' } : { beforeId: 'waterway_line_label' })}
            paint={buildingsPaint}
          />
        ) : null}

        <Camera ref={camera} initialViewState={{ center: CAMPUS_CENTER, zoom }} maxBounds={MAX_BOUNDS} minZoom={10} maxZoom={19.5} />
        <Images images={MAP_ICONS} />

        {activityHeat.features.length > 0 ? (
          <GeoJSONSource id="campus-activity" data={activityHeat}>
            {/* Campus events glow in the accent under their buildings; the badge on each chip says how many. */}
            <Layer
              id="campus-activity-heat"
              type="heatmap"
              afterId="building"
              maxzoom={19}
              paint={{
                'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 1, 0.6, 6, 1],
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 1.4],
                'heatmap-color': heatColors(accent) as ExpressionSpecification,
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 14, 30, 18, 96],
              }}
            />
          </GeoJSONSource>
        ) : null}

        {outline ? (
          <GeoJSONSource id="place-outline" data={{ type: 'Feature', properties: {}, geometry: outline }}>
            {/* Right above the style's own buildings, which in the dark style sit above its first label. */}
            <Layer id="place-outline-fill" type="fill" afterId="building" paint={{ 'fill-color': accent, 'fill-opacity': 0.2 }} />
            <Layer
              id="place-outline-glow"
              type="line"
              afterId="place-outline-fill"
              layout={{ 'line-join': 'round' }}
              paint={{ 'line-color': accent, 'line-width': 7, 'line-blur': 5, 'line-opacity': 0.35 }}
            />
            <Layer
              id="place-outline-edge"
              type="line"
              afterId="place-outline-glow"
              layout={{ 'line-join': 'round' }}
              paint={{
                'line-color': accent,
                'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 18, 2.25],
                'line-opacity': 0.95,
              }}
            />
          </GeoJSONSource>
        ) : null}

        <GeoJSONSource id="campus-amenities" data={AMENITY_POINTS}>
          {/* SOS phones from a little way in, and the benches, trash cans, and the rest only close up, as on the web. */}
          {amenities.map((layer) => (
            <Layer
              key={layer.id}
              id={layer.id}
              type="symbol"
              minzoom={layer.minzoom}
              filter={layer.filter as FilterSpecification}
              layout={layer.layout as SymbolLayerSpecification['layout']}
              paint={layer.paint as SymbolLayerSpecification['paint']}
            />
          ))}
        </GeoJSONSource>

        {previousLine ? (
          <GeoJSONSource
            id="previous-route"
            data={previousLine}
            onPress={() => {
              if (!navigation.switchToPrevious()) toast.show({ variant: 'danger', label: 'Could not find a way to that route' });
            }}>
            {/* The route left behind stays as a faded dashed line, like the web, and tapping it goes back to it. */}
            <Layer
              id="previous-route-casing"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': casing, 'line-width': 9, 'line-opacity': 0.4 }}
            />
            <Layer
              id="previous-route-line"
              type="line"
              layout={{ 'line-join': 'round' }}
              paint={{ 'line-color': accent, 'line-width': 5, 'line-opacity': 0.6, 'line-dasharray': [1.2, 1.4] }}
            />
            <Layer id="previous-route-hit" type="line" paint={{ 'line-color': accent, 'line-width': 28, 'line-opacity': 0 }} />
          </GeoJSONSource>
        ) : null}

        {routePath && routePath.length >= 2 ? (
          <RouteLine path={routePath} track={routeTrack} color={routeColor} casing={casing} />
        ) : null}

        {routeEnd ? (
          <GeoJSONSource id="route-end" data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: routeEnd } }}>
            <Layer
              id="route-end-dot"
              type="circle"
              paint={{
                'circle-radius': zoomed(4.5, 7.5),
                'circle-color': routeColor,
                'circle-stroke-width': zoomed(2, 3),
                'circle-stroke-color': casing,
              }}
            />
          </GeoJSONSource>
        ) : null}

        {location.fix ? <UserPin fix={location.fix} at={navigating ? navigation.shownAt : null} track={routeTrack} /> : null}

        {/* Before the place chips, so the building's own pin stays on top. */}
        {safety.spots.map((spot) => (
          <SafetyMarker key={spot.id} spot={spot} band={band} compact={compactSafety.has(spot.id)} />
        ))}
        {room ? <RoomMarker spot={room} band={band} /> : null}

        {places.map((place) => (
          <PlaceMarker
            key={place.id}
            place={place}
            selected={place.id === destinationId}
            origin={place.id === originPlace?.id}
            stop={stopNumbers[place.id]}
            activity={activityCounts[place.id] ?? 0}
            band={band}
            exit={safety.exits.has(place.id)}
            onPress={openPlace}
          />
        ))}

        {meetupSpot ? (
          <Marker id="meetup-pin" lngLat={toLngLat(meetupSpot)} anchor="bottom">
            <View className="items-center">
              <Icon name="mappin.circle.fill" size={34} tintColor={accent} />
            </View>
          </Marker>
        ) : null}

        {others.map((position) => {
          const member = meetup?.members.find((m) => m.liveId === position.member);
          const name = member?.displayName || position.name;
          return (
            <Marker key={position.member} id={`person-${position.member}`} lngLat={toLngLat(position.coordinate)} anchor="bottom">
              <PersonPin
                label={initials(name, member?.username ?? '?')}
                name={name}
                isMeetingPoint={meetup?.destination?.kind === 'member' && meetup.destination.liveId === position.member}
                isActive={activePerson === position.member}
                onPress={() => setActivePerson((current) => (current === position.member ? null : position.member))}
              />
            </Marker>
          );
        })}
      </Map>

      {navigating ? null : <TopScrim height={insets.top + 96} dark={scheme === 'dark'} />}
      {/* Android's tab bar is see through, so the map fades behind it to keep labels readable. */}
      {Platform.OS === 'android' && tabBarShown ? (
        <EdgeScrim edge="bottom" height={chromeBottom + 90} dark={scheme === 'dark'} />
      ) : null}

      {/* Category chips go full width on tablets so labels like Student Life are not clipped in the left column. */}
      {wide && trip.phase === 'idle' && !meetup ? (
        <View pointerEvents="box-none" className="absolute left-0 right-0" style={{ top: insets.top + 8 }}>
          <CategoryBar value={filter} onChange={setFilter} />
        </View>
      ) : null}

      {/* Top chrome: left column on tall wide layouts; full width on phones and landscape. */}
      <View
        pointerEvents="box-none"
        className="absolute"
        style={{
          top: insets.top + 8,
          left: 0,
          ...(columnChrome ? { width: PANEL_WIDTH, maxWidth: '100%' } : { right: 0 }),
        }}>
        {navigating && navigation.route && trip.destination ? (
          <NavigationBanner
            route={navigation.route}
            progress={navigation.progress}
            destinationName={target?.name ?? trip.destination.name}
            nextStopName={nextTarget?.name}
            arrivalNote={arrivalNote}
            isWrongWay={navigation.isWrongWay}
            hasArrived={navigation.hasArrived}
            isRiding={navigation.isRiding}
            notice={navigation.notice}
            hasAlternate={navigation.previousPath !== null}
            weakSignal={(location.fix?.accuracy ?? 0) > 60}
            expanded={hudPanel === 'steps'}
            onExpandedChange={(open) => setHudPanel(open ? 'steps' : null)}
            onUseAlternate={() => {
              if (!navigation.switchToPrevious()) toast.show({ variant: 'danger', label: 'Could not find a way to that route' });
            }}
          />
        ) : trip.phase === 'idle' && meetup ? (
          <MeetupBar
            meetup={meetup}
            where={meetupWhere}
            sharing={others.length}
            state={people.state}
            elsewhere={people.elsewhere}
            onTakeOver={people.takeOver}
            onOpen={() => router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } })}
            onDirections={meetupPlace ? () => planTrip(meetupPlace.id) : undefined}
            onStop={() => showMeetupOnMap(null)}
          />
        ) : null}
        {trip.phase === 'idle' && meetup && shownPerson ? (
          <View className="pt-2">
            <PersonCard
              name={shownPersonMember?.displayName || shownPerson.name}
              username={shownPersonMember?.username}
              isHost={shownPersonMember?.role === 'host'}
              isMeetingPoint={meetup.destination?.kind === 'member' && meetup.destination.liveId === shownPerson.member}
              coordinate={shownPerson.coordinate}
              accuracy={shownPerson.accuracy}
              at={shownPerson.at}
              youAt={location.fix?.position}
              onCenter={() =>
                camera.current?.flyTo({ center: toLngLat(shownPerson.coordinate), zoom: 18, duration: 600, padding: NO_PADDING })
              }
              onClose={() => setActivePerson(null)}
            />
          </View>
        ) : trip.phase === 'idle' && !meetup && !wide ? (
          <CategoryBar value={filter} onChange={setFilter} />
        ) : null}
      </View>

      {/* Browse map buttons stay on the right. */}
      {wide && !navigating ? (
        <View
          pointerEvents="box-none"
          className="absolute items-end px-4"
          style={{ right: 0, bottom: chromeBottom }}>
          <MapControls controls={controls} />
        </View>
      ) : null}

      {/* Bottom chrome: left column on tall tablets; full width on phones and landscape so directions are not crushed. */}
      <View
        pointerEvents="box-none"
        className="absolute gap-3"
        style={{
          bottom: chromeBottom,
          left: 0,
          ...(columnChrome ? { width: PANEL_WIDTH, maxWidth: '100%' } : { right: 0 }),
        }}>
        {columnChrome ? null : !navigating ? (
          <View pointerEvents="box-none" className="items-end px-4">
            <MapControls controls={controls} />
          </View>
        ) : null}
        {navControls}
        {panelPlace && trip.phase === 'idle' ? (
          <View className="px-3" style={wide && !columnChrome ? { alignItems: 'center' } : undefined}>
            <Glass className="w-full overflow-hidden rounded-[28px]" style={{ width: '100%', maxWidth: PANEL_WIDTH }}>
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: height - insets.top - chromeBottom - 96 }}
                contentContainerClassName="p-5">
                <PlaceDetails place={panelPlace.place} room={panelPlace.room} onDone={closePlacePanel} />
              </ScrollView>
            </Glass>
          </View>
        ) : null}
        {planning && !pickingOrigin ? (
          <View className="px-3" style={wide && !columnChrome ? { alignItems: 'center' } : undefined}>
            <View style={{ width: '100%', maxWidth: PANEL_WIDTH }}>
              <DirectionsPanel
                arrive={
                  !preview.isOffCampus || trip.travelMode === 'walk'
                    ? {
                        choices: arriveOptions,
                        selected: arrive.id,
                        onChange: (id) => {
                          const choice = arriveOptions.find((option) => option.id === id);
                          if (choice && trip.destination) pickArrive(trip.destination.id, id, choice.at);
                        },
                      }
                    : undefined
                }
                trip={trip}
                route={preview.route}
                issue={preview.issue}
                isOffCampus={preview.isOffCampus}
                later={preview.later}
                plan={preview.plan}
                live={liveStart}
                events={tripEvents}
                onOpenEvent={(meetup) => router.push(`/meetup/${meetup.id}`)}
                onStart={start}
                onClose={closeTrip}
                onPickOrigin={() => router.push('/origin')}
                onAddStop={() => router.push('/stop')}
                onSeeAllStops={() => router.push('/stops')}
                onRemoveStop={removeStop}
              />
            </View>
          </View>
        ) : null}
        {navigating && navigation.parking ? (
          <ParkingCard
            prompt={navigation.parking}
            onPrimary={navigation.parking.kind === 'arrived' ? navigation.parkAfterArriving : navigation.keepParking}
            onSecondary={() => {
              const prompt = navigation.parking;
              if (prompt?.kind === 'offer') navigation.driveCloser();
              else if (prompt?.kind === 'missed') navigation.parkInstead(prompt.missedId);
              else navigation.keepParking();
            }}
          />
        ) : null}
        {shownBreak && !navigation.parking ? (
          <BreakCard offer={shownBreak} onTake={takeBreak} onSkip={() => setBreakOffer(null)} />
        ) : null}
        {navigating && navigation.route ? (
          <NavigationFooter
            route={navigation.route}
            progress={navigation.progress}
            hasArrived={navigation.hasArrived}
            voiceOn={voice.enabled}
            manualStep={navigation.manualStep}
            expanded={hudPanel === 'trip'}
            onExpandedChange={(open) => setHudPanel(open ? 'trip' : null)}
            avoidStairs={trip.avoidStairs}
            canAvoidStairs={!navigation.route.travel || navigation.route.travel === 'walk'}
            facingUp={facingUp}
            onAvoidStairs={changeAvoidStairs}
            onFacingUp={(next) => {
              if (next !== facingUp) toggleFacing();
            }}
            onToggleVoice={voice.toggle}
            stopLabel={stopNumbers[trip.legs[trip.leg]] ? `Stop ${stopNumbers[trip.legs[trip.leg]]} of ${stopCount}` : undefined}
            nextStopName={nextTarget?.name}
            onContinue={continueTrip}
            onStep={step}
            onEnd={end}
            canAddStop={!navigation.route.travel && navigation.manualStep === null}
            onAddStopKind={addStopKind}
            onAnotherStop={() => router.push({ pathname: '/stop', params: { now: '1' } })}
          />
        ) : null}
      </View>
    </View>
  );
}
