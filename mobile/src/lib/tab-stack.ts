import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';
import { Platform } from 'react-native';

/** Shared options for each tab's Stack. */
export const tabStackOptions: ComponentProps<typeof Stack>['screenOptions'] = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
  // Hub screens stay live under a pushed child so the selected row paints during swipe-back.
  freezeOnBlur: false,
  ...(Platform.OS === 'ios'
    ? {
        // Large title over a frosted bar; each page's scroll view must be outermost with automatic insets.
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
