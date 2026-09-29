import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useThemeColor } from 'heroui-native';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { useEffect } from 'react';
import { DynamicColorIOS, Platform } from 'react-native';

import { useProfile } from '@/lib/account';
import { useClasses } from '@/lib/classes';
import { updateQuickActions } from '@/lib/quick-actions';
import { useRecentPlaces } from '@/lib/recent-places';
import { useSocial } from '@/lib/social';
import { planTrip, useTrip } from '@/lib/trip';
import { updateUpNextWidget } from '@/lib/up-next-widget';

// The campus accent in both themes. On iOS the tab bar is native glass and takes a native dynamic color, which
// only exists there; Android takes the theme's accent directly.
const iosAccent = Platform.OS === 'ios' ? DynamicColorIOS({ light: '#1268D2', dark: '#83C8EF' }) : undefined;

export default function TabLayout() {
  const trip = useTrip();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const themeAccent = useThemeColor('accent');
  const accent = iosAccent ?? themeAccent;
  const classes = useClasses();
  const recent = useRecentPlaces();

  useEffect(() => updateQuickActions(classes, recent), [classes, recent]);

  // The next class action plans the walk before landing on the map; the rest are plain links.
  useQuickActionRouting((action) => {
    if (action.id !== 'next-class') return false;
    const placeId = typeof action.params?.placeId === 'string' ? action.params.placeId : undefined;
    const room = typeof action.params?.room === 'string' ? action.params.room : undefined;
    if (placeId) planTrip(placeId, room);
    return false;
  });

  // The home screen widget follows the same classes and meetups the app shows.
  useEffect(() => {
    const seen = new Set<string>();
    const meetups = [...social.meetups, ...social.campus].filter((m) => !seen.has(m.id) && seen.add(m.id));
    updateUpNextWidget(classes, meetups);
  }, [classes, social.meetups, social.campus]);

  return (
    // Directions and navigation take the whole screen, so the tab bar steps aside for them.
    <NativeTabs
      tintColor={accent}
      minimizeBehavior="onScrollDown"
      hidden={trip.phase !== 'idle'}
      // Android's bar is a solid Material surface by default. Clear, it sits on the map's fade the way the chips
      // at the top do, and on the page background everywhere else. iOS draws its own Liquid Glass.
      backgroundColor={Platform.OS === 'android' ? 'transparent' : undefined}>
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
