import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, Line, Path } from 'react-native-svg';

import { useSplashHidden } from '@/lib/splash';

// These match the expo-splash-screen entry in app.json, so the first frame here is the system splash exactly.
const SPLASH_BACKGROUND = '#1268D2';
const SPLASH_IMAGE_WIDTH = 96;

// The icon's pin as splash-icon.png draws it: scaled 2.9 times in a 1024 square, roads cut through.
const PIN = 'M256 70 C 188 70 134 124 134 192 C 134 268 220 334 251 357 C 254 359.3 258 359.3 261 357 C 292 334 378 268 378 192 C 378 124 324 70 256 70 Z';
const PIN_PLACEMENT = 'translate(512 512) scale(2.9) translate(-256 -214)';
// Where the pin's tip sits, as a share of the image: it lands there, the ring starts there, and the map opens from there.
const TIP = 933 / 1024;

const HOLD_MS = 140;
const LIFT_MS = 280;
const DROP_MS = 220;
const LANDED_MS = HOLD_MS + LIFT_MS + DROP_MS;
const LIFT = -10;
const RIPPLE_MS = 600;
const PIN_OUT_MS = 220;
const REVEAL_MS = 560;
const DONE_MS = LANDED_MS + REVEAL_MS + 40;

// The pin rises easing out and falls easing in, like something set down, with no squash or bounce.
const out = Easing.out(Easing.cubic);
const into = Easing.in(Easing.quad);
const soft = Easing.inOut(Easing.quad);
const reveal = Easing.bezier(0.65, 0, 0.35, 1);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Pin() {
  return (
    <Svg width={SPLASH_IMAGE_WIDTH} height={SPLASH_IMAGE_WIDTH} viewBox="0 0 1024 1024">
      <Defs>
        <ClipPath id="launch-pin">
          <Path d={PIN} />
        </ClipPath>
      </Defs>
      <G transform={PIN_PLACEMENT}>
        <Path d={PIN} fill="#FFFFFF" />
        <G clipPath="url(#launch-pin)" fill="none" stroke={SPLASH_BACKGROUND} strokeWidth={14}>
          <Line x1={206} y1={40} x2={206} y2={380} />
          <Line x1={292} y1={40} x2={292} y2={380} />
          <Path d="M206 96 C 250 190 320 250 410 276" />
          <Path d="M206 150 C 246 230 316 286 410 312" />
        </G>
      </G>
    </Svg>
  );
}

/** Takes over from the system splash with the same pin, which is set down on the spot and opens the map from its tip. */
export function LaunchOverlay() {
  const splashHidden = useSplashHidden();
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [done, setDone] = useState(false);

  const lift = useSharedValue(0);
  const ripple = useSharedValue(0);
  const pinOut = useSharedValue(0);
  const hole = useSharedValue(0);
  const fade = useSharedValue(0);

  // The pin's tip, where the map opens from, and how far the opening has to grow to clear every corner.
  const tipX = width / 2;
  const tipY = height / 2 - SPLASH_IMAGE_WIDTH / 2 + SPLASH_IMAGE_WIDTH * TIP;
  const reach = Math.hypot(Math.max(tipX, width - tipX), Math.max(tipY, height - tipY));
  // The brand color is drawn as a ring this wide around the opening, so it covers the screen at any size.
  const band = reach * 2 + 40;

  useEffect(() => {
    if (!splashHidden) return;
    if (reduceMotion) {
      fade.value = withTiming(1, { duration: 260, easing: soft });
      const timer = setTimeout(() => setDone(true), 300);
      return () => clearTimeout(timer);
    }
    lift.value = withDelay(
      HOLD_MS,
      withSequence(withTiming(LIFT, { duration: LIFT_MS, easing: out }), withTiming(0, { duration: DROP_MS, easing: into })),
    );
    ripple.value = withDelay(LANDED_MS, withTiming(1, { duration: RIPPLE_MS, easing: out }));
    pinOut.value = withDelay(LANDED_MS, withTiming(1, { duration: PIN_OUT_MS, easing: into }));
    hole.value = withDelay(LANDED_MS, withTiming(1, { duration: REVEAL_MS, easing: reveal }));
    const timer = setTimeout(() => setDone(true), DONE_MS);
    return () => clearTimeout(timer);
  }, [splashHidden, reduceMotion, lift, ripple, pinOut, hole, fade]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.value }));
  // Solid until the opening starts, so the hand off from the system splash is exact.
  const backdropStyle = useAnimatedStyle(() => ({ opacity: hole.value > 0 ? 0 : 1 }));
  const holeProps = useAnimatedProps(() => ({ r: hole.value * reach + band / 2 }));
  const pinStyle = useAnimatedStyle(() => ({
    opacity: 1 - pinOut.value,
    transform: [{ translateY: lift.value }, { scale: 1 + pinOut.value * 0.08 }],
  }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: ripple.value === 0 ? 0 : 0.5 * (1 - ripple.value),
    transform: [{ scale: 0.4 + ripple.value * 1.2 }],
  }));

  if (done) return null;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}>
      <StatusBar style="light" />
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <AnimatedCircle cx={tipX} cy={tipY} fill="none" stroke={SPLASH_BACKGROUND} strokeWidth={band} animatedProps={holeProps} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <View style={styles.stage}>
        <Animated.View style={[styles.ripple, rippleStyle]} />
        <Animated.View style={[styles.pin, pinStyle]}>
          <Pin />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const RIPPLE_WIDTH = 64;
const RIPPLE_HEIGHT = 20;

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  backdrop: { backgroundColor: SPLASH_BACKGROUND },
  stage: { width: SPLASH_IMAGE_WIDTH, height: SPLASH_IMAGE_WIDTH },
  // Scaling from the tip keeps the pin planted where it landed.
  pin: { transformOrigin: ['50%', `${TIP * 100}%`, 0] },
  ripple: {
    position: 'absolute',
    left: (SPLASH_IMAGE_WIDTH - RIPPLE_WIDTH) / 2,
    top: SPLASH_IMAGE_WIDTH * TIP - RIPPLE_HEIGHT / 2,
    width: RIPPLE_WIDTH,
    height: RIPPLE_HEIGHT,
    borderRadius: RIPPLE_HEIGHT,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
