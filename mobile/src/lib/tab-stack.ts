import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';
import { Platform } from 'react-native';

/**
 * Shared options for each tab's Stack.
 * On iOS, `animationMatchesGesture` keeps the interactive swipe in sync with the system
 * push animation (including the previous screen's opacity) — iPhone and iPad.
 * Android keeps the platform default; these flags are iOS-only.
 */
export const tabStackOptions: ComponentProps<typeof Stack>['screenOptions'] = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
  // Hub screens stay live under a pushed child so the selected row paints during swipe-back.
  freezeOnBlur: false,
  ...(Platform.OS === 'ios'
    ? {
        // Apple's large title header: clear behind the big title, then the page slides under a frosted bar
        // with a hairline once it collapses. The material follows light and dark mode by itself. This needs
        // every page's scroll view to be its outermost view with contentInsetAdjustmentBehavior="automatic",
        // or the title would sit on top of the content.
        headerTransparent: true,
        headerBlurEffect: 'systemChromeMaterial',
        headerLargeStyle: { backgroundColor: 'transparent' },
        headerShadowVisible: true,
        gestureEnabled: true,
        animationMatchesGesture: true,
        fullScreenGestureShadowEnabled: true,
      }
    : { headerShadowVisible: false }),
};
