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
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import { MapButton } from '@/components/map-button';
import type { Coordinate } from '@/data/campus';
import { cameraAxes, floorShapes, type FloorShapes, type Vec3 } from '@/lib/floor-arrows';
import { currentDeclination, glideMs } from '@/lib/location';
import { pointAtDistance, type Route } from '@/lib/routing';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// A little of the route behind you keeps the ribbon running under your feet; ahead is enough to see the next turn.
const BEHIND = 4;
const AHEAD = 45;
const METERS_PER_DEGREE = 111_320;
// The compass shakes as you walk, so each reading only moves it part of the way.
const FIELD_SMOOTHING = 0.2;

type Hint = 'finding' | FloorShapes['look'];

const HINTS: Record<Exclude<Hint, null>, string> = {
  finding: 'Finding which way you face',
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
  const field = useSharedValue<Vec3 | null>(null);
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
    shownRoute.current = route;
    camE.set(duration ? withTiming(e, { duration, easing: Easing.linear }) : e);
    camN.set(duration ? withTiming(n, { duration, easing: Easing.linear }) : n);
    const mine = along ?? 0;
    path.set(slice(route, mine - BEHIND, mine + AHEAD).flatMap((point) => toLocal(anchor, point)));
    startAlong.set(Math.max(0, mine - BEHIND));
    camAlong.set(mine);
    finish.set(mine + AHEAD >= route.distance);
    declination.set((currentDeclination() * Math.PI) / 180);
  }, [route, along, at, camE, camN, path, startAlong, camAlong, finish, declination]);

  const shapes = useDerivedValue(() => {
    const compass = field.get();
    const axes = compass ? cameraAxes(gravity.sensor.get(), compass, declination.get()) : null;
    return floorShapes(axes, path.get(), startAlong.get(), camAlong.get(), camE.get(), camN.get(), width, height, finish.get());
  }, [width, height]);

  useAnimatedReaction(
    (): Hint => {
      const now = shapes.get();
      return now.ready ? now.look : 'finding';
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
