import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';

// Large titles over a blurred header: clear at the top, frosted once content scrolls underneath.
export const tabStackOptions: ComponentProps<typeof Stack>['screenOptions'] = {
  headerLargeTitle: true,
  headerTransparent: true,
  headerBlurEffect: 'systemChromeMaterial',
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
};
