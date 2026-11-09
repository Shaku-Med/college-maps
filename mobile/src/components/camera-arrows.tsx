import { CameraView, useCameraPermissions } from 'expo-camera';
import { Magnetometer } from 'expo-sensors';
import { useThemeColor } from 'heroui-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  SensorType,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedSensor,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import { MapButton } from '@/components/map-button';
import type { Coordinate } from '@/data/campus';
import { cameraAxes, floorShapes, LOCK_SETTLED, NO_LOCK, stepLock, stepNorth, type FloorShapes, type Lock, type Vec3 } from '@/lib/floor-arrows';
import { bearingDegrees, distanceMeters, turnAngle } from '@/lib/geo';
import { currentDeclination, currentFix, glideMs } from '@/lib/location';
import { pointAtDistance, type Route } from '@/lib/routing';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// A little of the route behind you keeps the ribbon running under your feet; ahead is enough to see the next turn.
const BEHIND = 4;
const AHEAD = 45;
const METERS_PER_DEGREE = 111_320;
// The compass shakes as you walk, so each reading only moves it part of the way.
const FIELD_SMOOTHING = 0.2;
// GPS wobbles by more than a stride, so walking only counts over a few seconds of progress.
const WALK_WINDOW_MS = 2500;
const WALK_MIN_GAIN = 1.5;
const WALK_MIN_PACE = 0.5;
const WALK_MIN_SPEED = 0.6;
const LOCK_EVERY_MS = 700;
const ON_ROUTE_METERS = 3;
const STRAIGHT_BEHIND = 3;
const STRAIGHT_STEP = 5;
const STRAIGHT_DEGREES = 20;
const NUDGE_MS = 8000;
// Beyond this you really are facing elsewhere, however far off the compass is.
const UNSURE_TURN = (70 * Math.PI) / 180;

type Hint = 'finding' | 'align' | FloorShapes['look'];

const HINTS: Record<Exclude<Hint, null>, string> = {
  finding: 'Finding which way you face',
  align: 'Walk a few steps to line up the arrows',
  left: 'The way is to your left',
  right: 'The way is to your right',
  down: 'Tilt the phone down to see the way',
  up: 'Raise the phone a little to see the way',
};

function toLocal(anchor: Coordinate, point: Coordinate): [number, number] {
  return [
    (point.longitude - anchor.longitude) * METERS_PER_DEGREE * Math.cos((anchor.latitude * Math.PI) / 180),
    (point.latitude - anchor.latitude) * METERS_PER_DEGREE,
  ];
}

function slice(route: Route, from: number, to: number): Coordinate[] {
  const start = Math.max(0, from);
  const end = Math.min(route.distance, to);
  const points = [pointAtDistance(route.path, route.cumulative, start)];
  route.path.forEach((point, i) => {
    if (route.cumulative[i] > start && route.cumulative[i] < end) points.push(point);
  });
  points.push(pointAtDistance(route.path, route.cumulative, end));
  return points;
}

/** The direction of the route here in degrees, or null when it bends close by and so can't say which way you are walking. */
function straightHeading(route: Route, along: number): number | null {
  if (along + STRAIGHT_STEP * 2 > route.distance) return null;
  const point = (distance: number) => pointAtDistance(route.path, route.cumulative, distance);
  const behind = point(Math.max(0, along - STRAIGHT_BEHIND));
  const here = point(along);
  const near = point(along + STRAIGHT_STEP);
  const far = point(along + STRAIGHT_STEP * 2);
  const ahead = bearingDegrees(here, near);
  if (Math.abs(turnAngle(ahead, bearingDegrees(near, far))) > STRAIGHT_DEGREES) return null;
  if (along >= 1 && Math.abs(turnAngle(bearingDegrees(behind, here), ahead)) > STRAIGHT_DEGREES) return null;
  return bearingDegrees(behind, far);
}

type Step = { time: number; along: number };

function walkingForward(trail: Step[], now: number, speed: number | undefined) {
  const seconds = (now - trail[0].time) / 1000;
  const gained = trail[trail.length - 1].along - trail[0].along;
  if (seconds * 1000 < WALK_WINDOW_MS || gained < WALK_MIN_GAIN || gained / seconds < WALK_MIN_PACE) return false;
  // Android reports 0 when it has no speed at all, so only a real but slow reading counts against walking.
  return !speed || speed >= WALK_MIN_SPEED;
}

type Props = {
  route: Route;
  /** How far along the route you are. */
  along?: number;
  /** Where you are, on the route while you follow it. */
  at: Coordinate | null;
};

function Notice({ text, side }: { text: string; side?: 'left' | 'right' }) {
  const [foreground] = useThemeColor(['foreground']);
  return (
    <Animated.View entering={FadeIn.duration(180)} pointerEvents="none" className="absolute inset-x-0 top-1/2 items-center px-6">
      <Glass radius={999} className="flex-row items-center gap-2 px-4 py-2.5">
        {side === 'left' ? <Icon name="chevron.left" size={15} tintColor={foreground} /> : null}
        <Text className="text-base font-semibold text-foreground">{text}</Text>
        {side === 'right' ? <Icon name="chevron.right" size={15} tintColor={foreground} /> : null}
      </Glass>
    </Animated.View>
  );
}

function Floor({ route, along, at }: Props) {
  const { width, height } = useWindowDimensions();
  const [accent, accentForeground] = useThemeColor(['accent', 'accent-foreground']);
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto', adjustToInterfaceOrientation: false });
  const gyroscope = useAnimatedSensor(SensorType.GYROSCOPE, { interval: 'auto', adjustToInterfaceOrientation: false });
  const field = useSharedValue<Vec3 | null>(null);
  const north = useSharedValue<Vec3 | null>(null);
  const lock = useSharedValue<Lock>(NO_LOCK);
  const nudging = useSharedValue(true);
  const declination = useSharedValue(0);
  const path = useSharedValue<number[]>([]);
  const startAlong = useSharedValue(0);
  const camAlong = useSharedValue(0);
  const camE = useSharedValue(0);
  const camN = useSharedValue(0);
  const finish = useSharedValue(false);
  const [hint, setHint] = useState<Hint>('finding');
  const sentHint = useSharedValue<Hint>('finding');
  const [hasCompass, setHasCompass] = useState(true);
  const shownRoute = useRef<Route | null>(null);
  const trail = useRef<Step[]>([]);
  const lockedAt = useRef(0);

  useFrameCallback((frame) => {
    'worklet';
    const seconds = Math.min(0.1, (frame.timeSincePreviousFrame ?? 16) / 1000);
    north.set(stepNorth(north.get(), gravity.sensor.get(), field.get(), gyroscope.sensor.get(), seconds));
  });

  useEffect(() => {
    const timer = setTimeout(() => nudging.set(false), NUDGE_MS);
    return () => clearTimeout(timer);
  }, [nudging]);

  useEffect(() => {
    let live = true;
    let smoothed: Vec3 | null = null;
    Magnetometer.setUpdateInterval(40);
    const subscription = Magnetometer.addListener(({ x, y, z }) => {
      smoothed = smoothed
        ? {
            x: smoothed.x + (x - smoothed.x) * FIELD_SMOOTHING,
            y: smoothed.y + (y - smoothed.y) * FIELD_SMOOTHING,
            z: smoothed.z + (z - smoothed.z) * FIELD_SMOOTHING,
          }
        : { x, y, z };
      field.set(smoothed);
    });
    void Magnetometer.isAvailableAsync().then((available) => {
      if (live && !available) setHasCompass(false);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, [field]);

  useEffect(() => {
    if (!at) return;
    const anchor = route.path[0];
    const [e, n] = toLocal(anchor, at);
    // Along one route the camera glides between fixes like the dot on the map; a new route starts fresh.
    const duration = shownRoute.current === route ? glideMs() : 0;
    if (shownRoute.current !== route) trail.current = [];
    shownRoute.current = route;
    camE.set(duration ? withTiming(e, { duration, easing: Easing.linear }) : e);
    camN.set(duration ? withTiming(n, { duration, easing: Easing.linear }) : n);
    const mine = along ?? 0;
    path.set(slice(route, mine - BEHIND, mine + AHEAD).flatMap((point) => toLocal(anchor, point)));
    startAlong.set(Math.max(0, mine - BEHIND));
    camAlong.set(mine);
    finish.set(mine + AHEAD >= route.distance);
    declination.set((currentDeclination() * Math.PI) / 180);

    const now = Date.now();
    trail.current.push({ time: now, along: mine });
    while (trail.current.length > 1 && now - trail.current[1].time >= WALK_WINDOW_MS) trail.current.shift();
    const onRoute = distanceMeters(at, pointAtDistance(route.path, route.cumulative, mine)) <= ON_ROUTE_METERS;
    if (!onRoute || now - lockedAt.current < LOCK_EVERY_MS || !walkingForward(trail.current, now, currentFix()?.speed)) return;
    const heading = straightHeading(route, mine);
    if (heading === null) return;
    lockedAt.current = now;
    scheduleOnUI((routeHeading: number) => {
      'worklet';
      const facing = north.get();
      const axes = facing ? cameraAxes(gravity.sensor.get(), facing, declination.get() + lock.get().offset) : null;
      if (axes) lock.set(stepLock(lock.get(), axes, routeHeading));
    }, (heading * Math.PI) / 180);
  }, [route, along, at, camE, camN, path, startAlong, camAlong, finish, declination, north, gravity, lock]);

  const shapes = useDerivedValue(() => {
    const facing = north.get();
    const axes = facing ? cameraAxes(gravity.sensor.get(), facing, declination.get() + lock.get().offset) : null;
    return floorShapes(axes, path.get(), startAlong.get(), camAlong.get(), camE.get(), camN.get(), width, height, finish.get());
  }, [width, height]);

  useAnimatedReaction(
    (): Hint => {
      const now = shapes.get();
      if (!now.ready) return 'finding';
      // Until walking has lined it up the compass may be well off, so a near miss gets the honest answer rather than a direction.
      const unsure = lock.get().samples < LOCK_SETTLED && Math.abs(now.turn) < UNSURE_TURN;
      if (unsure && (nudging.get() || now.look === 'left' || now.look === 'right')) return 'align';
      return now.look;
    },
    (next) => {
      if (next === sentHint.get()) return;
      sentHint.set(next);
      scheduleOnRN(setHint, next);
    },
  );

  const ribbonProps = useAnimatedProps(() => ({ d: shapes.get().ribbon || 'M0 0' }));
  const chevronProps = useAnimatedProps(() => ({ d: shapes.get().chevrons || 'M0 0' }));
  const finishProps = useAnimatedProps(() => ({ d: shapes.get().finish || 'M0 0' }));

  const notice = !hasCompass ? "This phone has no compass, so the arrows can't be lined up" : hint ? HINTS[hint] : null;
  return (
    <>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <AnimatedPath animatedProps={ribbonProps} fill={accent} fillOpacity={0.3} />
        <AnimatedPath animatedProps={finishProps} fill={accent} fillOpacity={0.25} stroke={accent} strokeWidth={4} />
        <AnimatedPath animatedProps={chevronProps} fill={accent} stroke={accentForeground} strokeWidth={1.5} strokeLinejoin="round" />
      </Svg>
      {notice ? <Notice key={notice} text={notice} side={hint === 'left' || hint === 'right' ? hint : undefined} /> : null}
    </>
  );
}

/** The camera in place of the map, with the route laid on the ground ahead. Turns, rerouting and voice carry on as before. */
export function CameraArrows(props: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const { width, height } = useWindowDimensions();
  const [background, foreground] = useThemeColor(['background', 'foreground']);

  if (!permission?.granted) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]} className="items-center justify-center px-6">
        {permission ? (
          <Glass radius={28} className="w-full max-w-sm items-center gap-3 p-6">
            <Icon name="camera.viewfinder" size={28} tintColor={foreground} />
            <Text className="text-center text-lg font-semibold text-foreground">See the way on the ground</Text>
            <Text className="text-center text-base leading-6 text-muted">
              Hold the phone up as you walk and arrows on the ground show where to go. The picture stays on your phone and is never saved or
              sent.
            </Text>
            <MapButton
              label={permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
              onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
            />
          </Glass>
        ) : null}
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} accessibilityLabel="Camera view with arrows on the ground">
      <CameraView style={StyleSheet.absoluteFill} facing="back" animateShutter={false} />
      {height >= width ? <Floor {...props} /> : <Notice text="Hold the phone upright to see the arrows" />}
    </View>
  );
}
