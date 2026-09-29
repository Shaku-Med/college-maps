import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  NativeUserLocation,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useThemeColor, useToast } from 'heroui-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Text, useColorScheme, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryBar, type MapFilter } from '@/components/category-bar';
import { DirectionsPanel } from '@/components/directions-panel';
import { MapControls, type MapControl } from '@/components/map-controls';
import { NavigationBanner, NavigationFooter } from '@/components/navigation-hud';
import { PlaceMarker } from '@/components/place-marker';
import { TopScrim } from '@/components/top-scrim';
import { CAMPUS, PLACES, contains, getPlace, type Coordinate, type Place } from '@/data/campus';
import { useMeetupLive } from '@/hooks/use-meetup-live';
import { useNavigation, type FollowTarget } from '@/hooks/use-navigation';
import { useRoutePreview } from '@/hooks/use-route-preview';
import { useVoiceGuidance } from '@/hooks/use-voice-guidance';
import { useProfile } from '@/lib/account';
import { useFocusedPlace } from '@/lib/focus';
import { currentFix, useLocation } from '@/lib/location';
import { useShownMeetup } from '@/lib/meetup-focus';
import { remainingPath } from '@/lib/routing';
import { useSocial } from '@/lib/social';
import { MY_LOCATION, closeTrip, startNavigating, useTrip } from '@/lib/trip';

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
// The place sheet opens at 45% of the screen, so a focused place sits in the space above it.
const SHEET_SHARE = 0.45;

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
  const { toast } = useToast();
  const camera = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [buildingView, setBuildingView] = useState(false);
  const focused = useFocusedPlace();
  const trip = useTrip();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const shownMeetupId = useShownMeetup();
  const [filter, setFilter] = useState<MapFilter>('all');
  const [facingUp, setFacingUp] = useState(true);
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [accent, danger, background] = useThemeColor(['accent', 'danger', 'background']);
  const casing = scheme === 'dark' ? '#0b1a33' : '#ffffff';

  const meetup =
    social.meetups.find((m) => m.id === shownMeetupId && m.active && m.yourStatus === 'joined') ?? null;
  const planning = trip.phase === 'preview';
  const navigating = trip.phase === 'navigate';
  const location = useLocation({ watching: trip.phase !== 'idle' || meetup !== null, navigation: navigating });
  const located = permission?.granted ?? false;

  const follow = useCallback(
    ({ point, zoom: level, bearing }: FollowTarget) => {
      camera.current?.easeTo({
        center: toLngLat(point),
        zoom: level,
        bearing: bearing ?? 0,
        pitch: 40,
        duration: 900,
        padding: { top: insets.top + 170, bottom: insets.bottom + 150, left: 0, right: 0 },
      });
    },
    [insets.bottom, insets.top],
  );

  const navigation = useNavigation({
    destination: trip.destination,
    avoidStairs: trip.avoidStairs,
    follow,
    facingUp,
  });
  const preview = useRoutePreview(trip, location.fix?.position, location.status, navigation.travelHeading);
  const voice = useVoiceGuidance({
    route: navigating ? navigation.route : null,
    progress: navigation.progress,
    destinationName: trip.destination?.name,
    isWrongWay: navigation.isWrongWay,
    hasArrived: navigation.hasArrived,
    notice: navigation.notice,
    paused: navigation.isRiding,
    speed: navigation.speed,
  });
  const live = meetup ? meetup.id : null;
  const people = useMeetupLive(live, meetup ? location.fix : null);

  // The screen stays on while guiding, like any navigation app.
  useEffect(() => {
    if (!navigating) return;
    void activateKeepAwakeAsync('navigation');
    return () => void deactivateKeepAwake('navigation');
  }, [navigating]);

  useEffect(() => {
    if (!focused || trip.phase !== 'idle') return;
    camera.current?.flyTo({
      center: toLngLat(focused.coordinate),
      zoom: PLACE_ZOOM,
      duration: 700,
      padding: { top: insets.top + 60, bottom: height * SHEET_SHARE, left: 0, right: 0 },
    });
  }, [focused, trip.phase, insets.top, height]);

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
      padding: { top: insets.top + 40, bottom: 380, left: 48, right: 48 },
      bearing: 0,
      pitch: 0,
      duration: 700,
    });
  }, [previewRoute, insets.top]);

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

  const liveStart = trip.origin === MY_LOCATION && location.fix !== null;

  function start() {
    if (!preview.route) return;
    const from = liveStart ? (location.fix?.position ?? null) : null;
    voice.begin(preview.route, navigation.facing());
    navigation.start(preview.route, from);
    startNavigating();
    if (!from && trip.destination) {
      camera.current?.flyTo({ center: toLngLat(preview.route.path[0]), zoom: PLACE_ZOOM, duration: 700, padding: NO_PADDING });
    }
  }

  function end() {
    const destination = trip.destination;
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

  function step(index: number) {
    const shown = navigation.showStep(index);
    const route = navigation.route;
    if (!shown || !route) return;
    voice.announceStep(route, shown.index);
    camera.current?.flyTo({
      center: toLngLat(shown.point),
      zoom: 18,
      duration: 600,
      padding: { top: insets.top + 170, bottom: insets.bottom + 200, left: 0, right: 0 },
    });
  }

  const routePath = navigating
    ? navigation.route && navigation.progress
      ? remainingPath(navigation.route, navigation.progress)
      : navigation.route?.path
    : previewRoute?.path;
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
  const meetupPin =
    meetup?.destination?.kind === 'pin' && meetup.destination.lat !== undefined && meetup.destination.lng !== undefined
      ? { latitude: meetup.destination.lat, longitude: meetup.destination.lng }
      : undefined;

  const controls: MapControl[] = navigating
    ? [
        {
          symbol: facingUp ? 'location.north.line.fill' : 'safari',
          label: facingUp ? 'Show north up' : 'Turn the map the way you face',
          active: facingUp,
          onPress: () => {
            setFacingUp((value) => !value);
            navigation.recenter();
          },
        },
        ...(navigation.isFollowing
          ? []
          : [{ symbol: 'location.fill' as const, label: 'Follow me again', onPress: navigation.recenter }]),
      ]
    : [
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

  const tabBarShown = trip.phase === 'idle';

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
        onRegionWillChange={(event) => {
          if (navigating && event.nativeEvent.userInteraction) navigation.pauseFollowing();
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
            <Layer
              id="previous-route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#8e8e93', 'line-width': 6, 'line-opacity': 0.55 }}
            />
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

        {located ? <NativeUserLocation mode={navigating ? 'course' : 'heading'} /> : null}

        {places.map((place) => (
          <PlaceMarker
            key={place.id}
            place={place}
            selected={place.id === destinationId}
            origin={place.id === originPlace?.id}
            onPress={openPlace}
          />
        ))}

        {meetupPin ? (
          <Marker id="meetup-pin" lngLat={toLngLat(meetupPin)} anchor="bottom">
            <View className="items-center">
              <SymbolView name="mappin.circle.fill" size={34} tintColor={accent} />
            </View>
          </Marker>
        ) : null}

        {others.map((position) => {
          const member = meetup?.members.find((m) => m.liveId === position.member);
          const name = member?.displayName || position.name;
          return (
            <Marker key={position.member} id={`person-${position.member}`} lngLat={toLngLat(position.coordinate)} anchor="center">
              <View
                accessibilityLabel={name}
                className="size-9 items-center justify-center rounded-full border-2 border-background bg-accent shadow-md">
                <Text className="text-xs font-bold text-accent-foreground">{initials(name, member?.username ?? '?')}</Text>
              </View>
            </Marker>
          );
        })}
      </Map>

      {navigating ? null : <TopScrim height={insets.top + 96} dark={scheme === 'dark'} />}

      <View pointerEvents="box-none" className="absolute inset-x-0" style={{ top: insets.top + 8 }}>
        {navigating && navigation.route && trip.destination ? (
          <NavigationBanner
            route={navigation.route}
            progress={navigation.progress}
            destinationName={trip.destination.name}
            isWrongWay={navigation.isWrongWay}
            hasArrived={navigation.hasArrived}
            isRiding={navigation.isRiding}
            notice={navigation.notice}
            hasAlternate={navigation.previousPath !== null}
            onUseAlternate={() => {
              if (!navigation.switchToPrevious()) toast.show({ variant: 'danger', label: 'Could not find a way to that route' });
            }}
          />
        ) : trip.phase === 'idle' ? (
          <CategoryBar value={filter} onChange={setFilter} />
        ) : null}
      </View>

      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 gap-3"
        style={{ bottom: tabBarShown ? insets.bottom + 54 : insets.bottom + 6 }}>
        <View pointerEvents="box-none" className="items-end px-4">
          <MapControls controls={controls} />
        </View>
        {planning ? (
          <View className="px-3">
            <DirectionsPanel
              trip={trip}
              route={preview.route}
              issue={preview.issue}
              isOffCampus={preview.isOffCampus}
              live={liveStart}
              onStart={start}
              onClose={closeTrip}
              onPickOrigin={() => router.push('/origin')}
            />
          </View>
        ) : null}
        {navigating && navigation.route ? (
          <NavigationFooter
            route={navigation.route}
            progress={navigation.progress}
            hasArrived={navigation.hasArrived}
            voiceOn={voice.enabled}
            manualStep={navigation.manualStep}
            onToggleVoice={voice.toggle}
            onStep={step}
            onEnd={end}
          />
        ) : null}
      </View>
    </View>
  );
}
