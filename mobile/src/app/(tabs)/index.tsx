import type * as GeoJSON from 'geojson';
import {
  Camera,
  GeoJSONSource,
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
import { Linking, Platform, useColorScheme, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { CategoryBar, type MapFilter } from '@/components/category-bar';
import { DirectionsPanel } from '@/components/directions-panel';
import { MeetupBar } from '@/components/meetup-bar';
import { PersonCard, PersonPin } from '@/components/person-pin';
import { MapControls, type MapControl } from '@/components/map-controls';
import { MapButton } from '@/components/map-button';
import { NavigationBanner, NavigationFooter } from '@/components/navigation-hud';
import { PlaceMarker } from '@/components/place-marker';
import { EdgeScrim, TopScrim } from '@/components/top-scrim';
import { UserPin } from '@/components/user-pin';
import { CAMPUS, PLACES, contains, getPlace, type Coordinate, type Place } from '@/data/campus';
import { walkGraph } from '@/data/walk-graph';
import { useMeetupLive } from '@/hooks/use-meetup-live';
import { mapCameraPadding, PANEL_WIDTH, useMapChromeBottom, useShortViewport, useWide } from '@/hooks/use-layout';
import { useNavigation, type FollowTarget } from '@/hooks/use-navigation';
import { useRoutePreview } from '@/hooks/use-route-preview';
import { useVoiceGuidance } from '@/hooks/use-voice-guidance';
import { useProfile } from '@/lib/account';
import { campusActivityByPlace, eventsAtPlace } from '@/lib/campus-activity';
import { useDevicePrefs } from '@/lib/device-prefs';
import { useFocusedPlace } from '@/lib/focus';
import { formatRouteTime } from '@/lib/directions';
import { formatDistance } from '@/lib/geo';
import { stepText } from '@/lib/instructions';
import { endTrip, showTrip } from '@/lib/live-activity';
import { currentFix, useCompass, useLocation } from '@/lib/location';
import { setMapBearing } from '@/lib/map-bearing';
import { createCameraMemory, createSmoothHeading, shortestTurn } from '@/lib/smooth-heading';
import { markReady } from '@/lib/splash';
import { showMeetupOnMap, useShownMeetup } from '@/lib/meetup-focus';
import { findRoute, remainingPath } from '@/lib/routing';
import { useSocial } from '@/lib/social';
import {
  MY_LOCATION,
  closeTrip,
  nextLeg,
  planTrip,
  removeStop,
  setAvoidStairs,
  startNavigating,
  useTrip,
} from '@/lib/trip';

const { center, zoom, bounds, styles } = CAMPUS.map;
const CAMPUS_CENTER: [number, number] = [center.longitude, center.latitude];
const MAX_BOUNDS: [number, number, number, number] = [bounds.west - 0.3, bounds.south - 0.3, bounds.east + 0.3, bounds.north + 0.3];
const PLACE_ZOOM = 17;
// The web app's building view: the same tilt, colours, and heights.
const BUILDING_PITCH = 52;
// The first label layer in each OpenFreeMap style, so buildings rise under the street and place names.
const FIRST_LABEL = { light: 'waterway_line_label', dark: 'water_name' } as const;
// MapLibre keeps the last padding it was given, so every camera move says its own.
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };
// Facing-up: ignore tiny wobble, and never cut a camera ease short with another.
const HEADING_UP_MIN_DEGREES = 3;
const HEADING_UP_GAP_MS = 520;
const HEADING_UP_MS = 780;
const FOLLOW_MS = 1100;

const toLngLat = ({ latitude, longitude }: Coordinate): [number, number] => [longitude, latitude];

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
  const [smoothHeading] = useState(createSmoothHeading);
  const facingUpRef = useRef(true);
  // Where and how close the camera last followed, so a turn to match the compass keeps both.
  const lastFollow = useRef<{ point: Coordinate; zoom: number } | null>(null);
  const [buildingView, setBuildingView] = useState(false);
  const focused = useFocusedPlace();
  const trip = useTrip();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const shownMeetupId = useShownMeetup();
  const [filter, setFilter] = useState<MapFilter>('all');
  const [facingUp, setFacingUp] = useState(true);
  // The turn list at the top and the trip panel at the bottom: one open at a time, so the map stays in view.
  const [hudPanel, setHudPanel] = useState<'steps' | 'trip' | null>(null);
  const [isRotated, setIsRotated] = useState(false);
  const [activePerson, setActivePerson] = useState<string | null>(null);
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [accent, danger, background] = useThemeColor(['accent', 'danger', 'background']);
  const casing = scheme === 'dark' ? '#0b1a33' : '#ffffff';

  const meetup =
    social.meetups.find((m) => m.id === shownMeetupId && m.active && m.yourStatus === 'joined') ?? null;
  const activityCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of campusActivityByPlace(social.campus)) map[row.placeId] = row.count;
    return map;
  }, [social.campus]);
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
      // A camera move that fails, which some Android map builds do while a style is still loading, must never
      // stop guidance itself. The next fix moves the camera again.
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
        cameraMemory.moving(nextBearing, FOLLOW_MS);
        lastFollow.current = { point, zoom: level };
        camera.current?.easeTo({
          center: toLngLat(point),
          zoom: level,
          bearing: nextBearing,
          pitch: 40,
          duration: FOLLOW_MS,
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

  const navigation = useNavigation({
    destination: target,
    avoidStairs: trip.avoidStairs,
    follow,
    facingUp,
  });
  const compass = useCompass();
  useEffect(() => {
    facingUpRef.current = facingUp;
  }, [facingUp]);

  // Feed the smoother every compass/course reading; only ease the camera when it has settled enough
  // and nothing else is already moving it (same idea as the web map's turnMapToFacing).
  useEffect(() => {
    if (!navigating || !facingUp || !navigation.isFollowing || navigation.manualStep !== null) {
      return;
    }
    const fix = location.fix;
    const raw =
      fix && (fix.speed ?? 0) >= 0.7 && fix.heading !== undefined ? fix.heading : compass;
    if (raw === undefined) return;

    smoothHeading.set(raw, (shown) => {
      if (!facingUpRef.current) return;
      if (cameraMemory.busy()) return;
      if (cameraMemory.sinceMove() < HEADING_UP_GAP_MS) return;
      const delta = Math.abs(shortestTurn(cameraMemory.bearing(), shown));
      if (delta < HEADING_UP_MIN_DEGREES) return;
      const at = lastFollow.current;
      if (!at) return;
      cameraMemory.moving(shown, HEADING_UP_MS);
      try {
        // The same center, zoom, and padding as following, or each turn would shift the view.
        camera.current?.easeTo({
          center: toLngLat(at.point),
          zoom: at.zoom,
          bearing: shown,
          pitch: 40,
          duration: HEADING_UP_MS,
          padding: mapCameraPadding(wide, 'follow', insets),
        });
      } catch {
        // Map may still be loading.
      }
    });
  }, [cameraMemory, compass, facingUp, insets, location.fix, navigating, navigation.isFollowing, navigation.manualStep, smoothHeading, wide]);

  useEffect(() => {
    if (facingUp) return;
    smoothHeading.stop();
  }, [facingUp, smoothHeading]);

  useEffect(() => () => smoothHeading.stop(), [smoothHeading]);
  const preview = useRoutePreview(trip, location.fix?.position, location.status, navigation.travelHeading);
  const voice = useVoiceGuidance({
    route: navigating ? navigation.route : null,
    progress: navigation.progress,
    destinationName: target?.name,
    isWrongWay: navigation.isWrongWay,
    hasArrived: navigation.hasArrived,
    notice: navigation.notice,
    paused: navigation.isRiding,
    speed: navigation.speed,
  });
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

  // The voice warms up as soon as directions open, well before Start.
  const prepareVoice = voice.prepare;
  useEffect(() => {
    if (planning) prepareVoice();
  }, [planning, prepareVoice]);

  // The screen stays on while guiding when the user leaves Keep awake on (Account → Directions).
  const keepAwake = useDevicePrefs().keepAwake;
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
    if (trip.phase !== 'idle' || filter === 'all') return PLACES;
    return PLACES.filter((place) => place.category === filter);
  }, [filter, trip.phase]);

  const openPlace = useCallback(
    (place: Place) => {
      if (trip.phase !== 'idle') return;
      router.push({ pathname: '/place/[id]', params: { id: place.id } });
    },
    [trip.phase],
  );

  const toggleBuildings = useCallback(async () => {
    const next = !buildingView;
    setBuildingView(next);
    if (next) {
      const level = (await mapRef.current?.getZoom().catch(() => zoom)) ?? zoom;
      camera.current?.zoomTo(Math.max(level, 16), { pitch: BUILDING_PITCH, duration: 650, padding: NO_PADDING });
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
    // Starting must always get as far as guidance, so the first spoken line and the camera move are extras that
    // can fail on their own without stopping it.
    try {
      voice.begin(route, navigation.facing());
    } catch {
      // Guidance still shows the turns.
    }
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

  // Changing stairs mid walk finds the way again from here; if there is no step free way, the walk stays as is.
  function changeAvoidStairs(avoid: boolean) {
    if (!navigation.changeAvoidStairs(avoid)) {
      toast.show({ variant: 'warning', label: 'No step-free way from here', description: 'Your route stays the same for now.' });
      return;
    }
    setAvoidStairs(avoid);
  }

  function end() {
    const destination = trip.destination;
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
  }

  const pointNorth = useCallback(() => {
    void (async () => {
      const center = await mapRef.current?.getCenter().catch(() => undefined);
      if (!center) return;
      smoothHeading.set(0);
      cameraMemory.moving(0, 500);
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
    setMapBearing(bearing);
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

  const routePath = navigating
    ? navigation.route && navigation.progress
      ? remainingPath(navigation.route, navigation.progress)
      : navigation.route?.path
    : previewRoute
      ? [...previewRoute.path, ...preview.later.flatMap((leg) => leg.path)]
      : undefined;
  const routeLine = line(routePath);
  const previousLine = navigating ? line(navigation.previousPath) : null;
  const originPlace = planning && trip.origin !== MY_LOCATION ? getPlace(trip.origin) : undefined;
  const destinationId = trip.phase !== 'idle' ? trip.destination?.id : focused?.id;

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

  // Inside a tab, Android can report no bottom inset because the tab bar takes it, even though the map runs
  // under both the bar and the system navigation. Chrome bottom clears the tab bar when it is showing.
  const tabBarShown = trip.phase === 'idle';
  const chromeBottom = useMapChromeBottom(tabBarShown);

  // Showing a meetup frames everyone in it and the place you meet, and frames again as more people appear,
  // but not on every move, so the map is still free to pan.
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
        onDidFinishLoadingMap={() => markReady('map')}
        onRegionWillChange={(event) => {
          if (navigating && event.nativeEvent.userInteraction) navigation.pauseFollowing();
        }}
        onRegionIsChanging={(event) => noteBearing(event.nativeEvent.bearing)}
        onRegionDidChange={(event) => {
          noteBearing(event.nativeEvent.bearing);
          if (navigating && event.nativeEvent.userInteraction) navigation.scheduleFollowAgain();
        }}>
        {buildingView ? (
          <Layer
            id="buildings-3d"
            type="fill-extrusion"
            source="openmaptiles"
            source-layer="building"
            minzoom={14}
            beforeId={scheme === 'dark' ? FIRST_LABEL.dark : FIRST_LABEL.light}
            paint={{
              'fill-extrusion-color': scheme === 'dark' ? '#3a3a3a' : '#ddd9d2',
              'fill-extrusion-opacity': 0.94,
              'fill-extrusion-vertical-gradient': true,
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
            }}
          />
        ) : null}

        <Camera ref={camera} initialViewState={{ center: CAMPUS_CENTER, zoom }} maxBounds={MAX_BOUNDS} minZoom={10} maxZoom={19.5} />

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
              paint={{ 'line-color': casing, 'line-width': 9, 'line-opacity': 0.45 }}
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

        {routeLine ? (
          <GeoJSONSource id="route" data={routeLine}>
            <Layer
              id="route-casing"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': casing, 'line-width': 11 }}
            />
            <Layer
              id="route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': navigation.isWrongWay && navigating ? danger : accent, 'line-width': 7 }}
            />
          </GeoJSONSource>
        ) : null}

        {trip.destination && trip.phase !== 'idle' ? (
          <GeoJSONSource
            id="destination-point"
            data={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Point',
                coordinates: [trip.destination.coordinate.longitude, trip.destination.coordinate.latitude],
              },
            }}>
            <Layer
              id="destination-glow"
              type="circle"
              paint={{ 'circle-radius': 16, 'circle-color': accent, 'circle-opacity': 0.22 }}
            />
            <Layer
              id="destination-dot"
              type="circle"
              paint={{
                'circle-radius': 7,
                'circle-color': accent,
                'circle-stroke-width': 3,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </GeoJSONSource>
        ) : null}

        {location.fix ? <UserPin fix={location.fix} at={navigating ? navigation.shownAt : null} /> : null}

        {places.map((place) => (
          <PlaceMarker
            key={place.id}
            place={place}
            selected={place.id === destinationId}
            origin={place.id === originPlace?.id}
            activity={activityCounts[place.id] ?? 0}
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
      {/* Android's tab bar is see through, so the map fades out behind it the same way it does under the chips,
          keeping the tab labels and the buttons above them readable. */}
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

      {/* Browse map buttons stay on the right. During navigation, Point north / facing / Recenter sit in a
          horizontal row above the footer, like the web app. */}
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
        {planning && !pickingOrigin ? (
          <View className="px-3" style={wide && !columnChrome ? { alignItems: 'center' } : undefined}>
            <View style={{ width: '100%', maxWidth: PANEL_WIDTH }}>
              <DirectionsPanel
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
                onRemoveStop={removeStop}
              />
            </View>
          </View>
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
            nextStopName={nextTarget?.name}
            onContinue={continueTrip}
            onStep={step}
            onEnd={end}
          />
        ) : null}
      </View>
    </View>
  );
}
