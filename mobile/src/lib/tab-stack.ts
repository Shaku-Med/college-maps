import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';

// The system large title: clear at the top of the page, with the frosted bar fading in only once content
// scrolls underneath. A transparent header with its own blur would lay the blur over the large title itself.
export const tabStackOptions: ComponentProps<typeof Stack>['screenOptions'] = {
  headerLargeTitle: true,
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
};
