import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useThemeColor } from 'heroui-native';
import { DynamicColorIOS, Platform } from 'react-native';

import { useProfile } from '@/lib/account';
import { useSocial } from '@/lib/social';
import { useTrip } from '@/lib/trip';

// The campus accent in both themes. On iOS the tab bar is native glass and takes a native dynamic color, which
// only exists there; Android takes the theme's accent directly.
const iosAccent = Platform.OS === 'ios' ? DynamicColorIOS({ light: '#1268D2', dark: '#83C8EF' }) : undefined;

export default function TabLayout() {
  const trip = useTrip();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const themeAccent = useThemeColor('accent');
  const accent = iosAccent ?? themeAccent;

  return (
    // Directions and navigation take the whole screen, so the tab bar steps aside for them.
    <NativeTabs tintColor={accent} minimizeBehavior="onScrollDown" hidden={trip.phase !== 'idle'}>
      {/* The map fills the whole screen, under the tab bar. */}
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="classes">
        <NativeTabs.Trigger.Label>Classes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="friends">
        <NativeTabs.Trigger.Label>Friends</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
        {social.waiting > 0 ? <NativeTabs.Trigger.Badge>{String(social.waiting)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
