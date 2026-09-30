import { Stack } from 'expo-router';

import { tabStackOptions } from '@/lib/tab-stack';

export default function Layout() {
  return (
    <Stack screenOptions={tabStackOptions}>
      <Stack.Screen name="index" options={{ title: 'Friends' }} />
      <Stack.Screen name="list" options={{ title: 'Your friends', headerLargeTitle: false }} />
      <Stack.Screen name="sent" options={{ title: 'Sent', headerLargeTitle: false }} />
      <Stack.Screen name="blocked" options={{ title: 'Blocked', headerLargeTitle: false }} />
    </Stack>
  );
}
