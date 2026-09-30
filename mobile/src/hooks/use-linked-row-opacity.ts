import { usePathname } from 'expo-router';
import { useMemo } from 'react';
import { Animated, Platform } from 'react-native';
import { useTransitionProgress } from 'react-native-screens';

const STATIC_ONE = new Animated.Value(1);
const STATIC_ZERO = new Animated.Value(0);

/**
 * Opacity for a list row selected under a pushed stack screen.
 * Full (1) while the child is open; fades to 0 in sync with interactive pop.
 * Sheets/modals pass `gestureSync: false` for a solid fill (no stack progress).
 */
export function useLinkedRowOpacity(
  active: boolean,
  gestureSync = true,
): Animated.Value | Animated.AnimatedInterpolation<number> {
  const ios = Platform.OS === 'ios';
  const { progress } = useTransitionProgress();

  return useMemo(() => {
    if (!active) return STATIC_ZERO;
    if (!ios || !gestureSync) return STATIC_ONE;
    // progress 0 = covered by child → selected at full opacity
    // progress 1 = hub revealed (swipe back) → selection gone
    return progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });
  }, [active, gestureSync, ios, progress]);
}

/** Current path suffix match for linked rows (shared by every list hub). */
export function useLinkedSuffix(...suffixes: string[]): string | null {
  const pathname = usePathname();
  for (const suffix of suffixes) {
    if (pathname.endsWith(suffix)) return suffix;
  }
  return null;
}

/** Capture a path segment (e.g. meetup / class / place id) for linked rows. */
export function useLinkedParam(pattern: RegExp): string | null {
  const pathname = usePathname();
  return pattern.exec(pathname)?.[1] ?? null;
}
