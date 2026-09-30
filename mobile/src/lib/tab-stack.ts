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
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  // Hub screens stay live under a pushed child so the selected row paints during swipe-back.
  freezeOnBlur: false,
  ...(Platform.OS === 'ios'
    ? {
        gestureEnabled: true,
        animationMatchesGesture: true,
        fullScreenGestureShadowEnabled: true,
      }
    : {}),
};
