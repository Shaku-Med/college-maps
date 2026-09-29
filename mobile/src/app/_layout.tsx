// Gives the shared web code the crypto and localStorage it expects. Must load before anything uses them.
import '@/lib/polyfills';
import 'expo-sqlite/localStorage/install';
import '@/global.css';

import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { HeroUINativeProvider, useThemeColor } from 'heroui-native';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { refreshAccount } from '@/lib/account';
// Registers the background location task at startup, as iOS requires.
import '@/lib/location';

// iOS 26 draws sheets in Liquid Glass when they are see through. Older versions get a solid sheet.
const GLASS_SHEETS = isLiquidGlassAvailable();

function Navigation() {
  const scheme = useColorScheme();
  const [background, foreground, accent, border] = useThemeColor(['background', 'foreground', 'accent', 'border']);
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, background, card: background, text: foreground, primary: accent, border },
  };
  const sheetBackground = { backgroundColor: GLASS_SHEETS ? 'transparent' : background };
  const formSheet = {
    presentation: 'formSheet',
    sheetGrabberVisible: true,
    contentStyle: sheetBackground,
  } as const;

  useEffect(() => {
    void refreshAccount();
    // A session ended on another device is noticed when the app comes back to the front.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshAccount();
    });
    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="place/[id]"
          options={{
            ...formSheet,
            sheetAllowedDetents: [0.45, 0.92],
            // The map stays usable behind the smaller detent, like Apple Maps.
            sheetLargestUndimmedDetentIndex: 0,
          }}
        />
        <Stack.Screen name="origin" options={{ ...formSheet, sheetAllowedDetents: [0.6, 0.95] }} />
        <Stack.Screen name="class/[id]" options={{ ...formSheet, sheetAllowedDetents: [0.92] }} />
        <Stack.Screen name="class-import" options={{ ...formSheet, sheetAllowedDetents: [0.92] }} />
        <Stack.Screen name="profile" options={{ ...formSheet, sheetAllowedDetents: [0.6, 0.92] }} />
        <Stack.Screen name="meetup/[id]" options={{ ...formSheet, sheetAllowedDetents: [0.6, 0.95] }} />
        <Stack.Screen name="meetup/new" options={{ ...formSheet, sheetAllowedDetents: [0.95] }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <Navigation />
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
