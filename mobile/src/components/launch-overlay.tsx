import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, Line, Path } from 'react-native-svg';

import { useSplashHidden } from '@/lib/splash';

// These match the expo-splash-screen entry in app.json, so the first frame here is the system splash exactly.
const SPLASH_BACKGROUND = '#1268D2';
const SPLASH_IMAGE_WIDTH = 96;

// The icon's pin as splash-icon.png draws it: scaled 2.9 times in a 1024 square, roads cut through.
const PIN = 'M256 70 C 188 70 134 124 134 192 C 134 268 220 334 251 357 C 254 359.3 258 359.3 261 357 C 292 334 378 268 378 192 C 378 124 324 70 256 70 Z';
const PIN_PLACEMENT = 'translate(512 512) scale(2.9) translate(-256 -214)';
// Where the pin's tip sits, as a share of the image, for the squash to plant on and the ripple to start from.
const TIP = 933 / 1024;

const HOLD_MS = 140;
const DIP_MS = 140;
const RISE_MS = 260;
const FALL_MS = 220;
const LANDED_MS = HOLD_MS + DIP_MS + RISE_MS + FALL_MS;
const RIPPLE_MS = 560;
const EXIT_DELAY_MS = LANDED_MS + 120;
const EXIT_MS = 380;

const out = Easing.out(Easing.cubic);
const into = Easing.in(Easing.quad);
const soft = Easing.inOut(Easing.quad);

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

/** Takes over from the system splash with the same pin, which hops, pings, and fades into the map. */
export function LaunchOverlay() {
  const splashHidden = useSplashHidden();
  const reduceMotion = useReducedMotion();
  const [done, setDone] = useState(false);

  const lift = useSharedValue(0);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);
  const ripple = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    if (!splashHidden) return;
    if (reduceMotion) {
      exit.value = withTiming(1, { duration: 260, easing: soft });
      const timer = setTimeout(() => setDone(true), 300);
      return () => clearTimeout(timer);
    }
    lift.value = withDelay(
      HOLD_MS,
      withSequence(
        withTiming(3, { duration: DIP_MS, easing: soft }),
        withTiming(-16, { duration: RISE_MS, easing: out }),
        withTiming(0, { duration: FALL_MS, easing: into }),
      ),
    );
    squashY.value = withDelay(
      HOLD_MS,
      withSequence(
        withTiming(0.92, { duration: DIP_MS, easing: soft }),
        withTiming(1.04, { duration: RISE_MS, easing: out }),
        withTiming(1, { duration: FALL_MS, easing: into }),
        withTiming(0.95, { duration: 90, easing: out }),
        withTiming(1, { duration: 180, easing: soft }),
      ),
    );
    squashX.value = withDelay(
      HOLD_MS,
      withSequence(
        withTiming(1.05, { duration: DIP_MS, easing: soft }),
        withTiming(0.97, { duration: RISE_MS, easing: out }),
        withTiming(1, { duration: FALL_MS, easing: into }),
        withTiming(1.04, { duration: 90, easing: out }),
        withTiming(1, { duration: 180, easing: soft }),
      ),
    );
    ripple.value = withDelay(LANDED_MS, withTiming(1, { duration: RIPPLE_MS, easing: out }));
    exit.value = withDelay(EXIT_DELAY_MS, withTiming(1, { duration: EXIT_MS, easing: soft }));
    const timer = setTimeout(() => setDone(true), EXIT_DELAY_MS + EXIT_MS + 40);
    return () => clearTimeout(timer);
  }, [splashHidden, reduceMotion, lift, squashX, squashY, ripple, exit]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const pinStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [
      { translateY: lift.value },
      { scaleX: squashX.value * (1 + exit.value * 0.18) },
      { scaleY: squashY.value * (1 + exit.value * 0.18) },
    ],
  }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: ripple.value === 0 ? 0 : 0.55 * (1 - ripple.value),
    transform: [{ scale: 0.35 + ripple.value * 1.15 }],
  }));

  if (done) return null;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
      <StatusBar style="light" />
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
  backdrop: { backgroundColor: SPLASH_BACKGROUND, alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  stage: { width: SPLASH_IMAGE_WIDTH, height: SPLASH_IMAGE_WIDTH },
  // The squash plants on the tip, so the pin presses into the ground instead of shrinking toward its middle.
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
