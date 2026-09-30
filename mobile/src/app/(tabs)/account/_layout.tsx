import { Stack } from 'expo-router';

import { tabStackOptions } from '@/lib/tab-stack';

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={{ title: 'Account' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', headerLargeTitle: false }} />
    </Stack>
  );
}
