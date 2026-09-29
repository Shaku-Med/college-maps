import { Stack } from 'expo-router';

// The form and its "Where" page share one sheet, so picking a place is a real push with the system back button.
export default function NewMeetupLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="place" options={{ title: 'Where' }} />
    </Stack>
  );
}
