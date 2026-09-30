import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

// Past this width (an iPad, a tablet, or a big phone on its side) the map's panels sit in a column on the
// left, like the web app, and pages keep their text at a readable width instead of stretching.
const WIDE_AT = 700;
/** Short enough that a left-column directions card would crush its content (phone landscape). */
const SHORT_AT = 520;

/** Width of the map's left chrome column on wide layouts. Matches the web app. */
export const PANEL_WIDTH = 440;

/** Comfortable reading width for lists and forms on tablets. */
export const READABLE_MAX = 720;

/**
 * Centers full-bleed tab pages on tablets with side gutters.
 * Do NOT use inside form sheets — sheets are already narrow; window gutters crush their content.
 */
export function useReadableStyle(): ViewStyle {
  const { width } = useWindowDimensions();
  const side = Math.max(0, (width - READABLE_MAX) / 2);
  return side > 0 ? { width: '100%', paddingHorizontal: side } : { width: '100%' };
}

/** @deprecated Use useReadableStyle() — kept for a few non-hook call sites. */
export const readable = { width: '100%', maxWidth: READABLE_MAX, alignSelf: 'center' } as const;

export function useWide() {
  return useWindowDimensions().width >= WIDE_AT;
}

/** True in landscape phones / squat windows where a tall left panel would squash its content. */
export function useShortViewport() {
  return useWindowDimensions().height < SHORT_AT;
}

/**
 * Map draws under the native tab bar on phones. On wide iPad with sidebarAdaptable tabs, navigation
 * sits in a side sidebar instead — only clear the home indicator, not a phone-sized bottom bar.
 */
export function useMapChromeBottom(tabBarShown: boolean): number {
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const bottomInset = Math.max(
    insets.bottom,
    Platform.OS === 'android' ? (initialWindowMetrics?.insets.bottom ?? 0) : 0,
  );
  if (!tabBarShown) return bottomInset + 6;
  // Wide iOS: sidebar (or floating bar already in the bottom inset) — don't stack a second tab height.
  if (wide && Platform.OS === 'ios') return bottomInset + 16;
  const tabBar = Platform.OS === 'android' ? 80 : 49;
  return bottomInset + tabBar + 10;
}

export type CameraPadding = { top: number; bottom: number; left: number; right: number };

/**
 * Camera padding so routes and pins stay clear of the left column on tablets.
 * `bottomChrome` is the space taken by the tab bar and any bottom HUD.
 */
export function mapCameraPadding(
  wide: boolean,
  kind: 'preview' | 'follow' | 'step' | 'meetup' | 'place',
  insets: { top: number; bottom: number },
  opts?: { height?: number; bottomChrome?: number },
): CameraPadding {
  const left = wide ? PANEL_WIDTH + 16 : 0;
  const bottomChrome = opts?.bottomChrome ?? 0;
  switch (kind) {
    case 'preview':
      return wide
        ? { top: insets.top + 40, bottom: 100, left: left + 32, right: 80 }
        : { top: insets.top + 40, bottom: 380, left: 48, right: 48 };
    case 'follow':
      return {
        top: insets.top + 170,
        bottom: insets.bottom + 150,
        left,
        right: wide ? 40 : 0,
      };
    case 'step':
      return {
        top: insets.top + 170,
        bottom: insets.bottom + 200,
        left,
        right: wide ? 40 : 0,
      };
    case 'meetup':
      return wide
        ? { top: insets.top + 40, bottom: bottomChrome + 80, left: left + 24, right: 56 }
        : { top: insets.top + 130, bottom: bottomChrome + 120, left: 56, right: 56 };
    case 'place':
      return wide
        ? { top: insets.top + 60, bottom: 120, left: left + 24, right: 40 }
        : { top: insets.top + 60, bottom: (opts?.height ?? 0) * 0.45, left: 0, right: 0 };
  }
}
