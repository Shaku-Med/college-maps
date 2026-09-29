import { Stack } from 'expo-router';

import { tabStackOptions } from '@/lib/tab-stack';

export default function Layout() {
  return <Stack screenOptions={tabStackOptions} />;
}
