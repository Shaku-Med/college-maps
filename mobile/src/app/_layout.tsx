// Gives the shared web code the crypto and localStorage it expects. Must load before anything uses them.
import '@/lib/polyfills';
import 'expo-sqlite/localStorage/install';
import '@/global.css';
import { markReady } from '@/lib/splash';

import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { HeroUINativeProvider, useThemeColor } from 'heroui-native';
import { useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { refreshAccount } from '@/lib/account';
import { useNotificationTaps } from '@/lib/notifications';
// Registers the background location task at startup, as iOS requires.
import '@/lib/location';
import { OfflineBanner } from '@/components/offline-banner';
import { updateUpNextWidget } from '@/lib/up-next-widget';

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

  // Floating bottom sheets (place, meetup, class, account forms) — side margins on iPad, grabber, detents.
  const formSheet = {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    contentStyle: sheetBackground,
  };
  const sheetMedium = { ...formSheet, sheetAllowedDetents: [0.55, 0.92] as number[] };
  const sheetTall = { ...formSheet, sheetAllowedDetents: [0.7, 0.95] as number[] };
  const sheetCompact = { ...formSheet, sheetAllowedDetents: [0.45, 0.85] as number[] };

  // Nested stack inside a sheet works on iOS; Android form sheets do not host nested navigators.
  const pageSheet = { presentation: 'modal' as const, contentStyle: { backgroundColor: background } };
  const nestedFormSheet = Platform.OS === 'ios' ? sheetTall : pageSheet;

  const pickerSheet = {
    // A page sheet: full width, swipe down to close, and it does not squeeze the list on iPad the way
    // the floating form sheets do. Its header carries the title and the system search bar.
    ...pageSheet,
    headerShown: true,
    headerLargeTitle: true,
    headerLargeTitleShadowVisible: false,
    ...(Platform.OS === 'ios'
      ? {
          headerTransparent: true,
          headerBlurEffect: 'systemChromeMaterial' as const,
          headerLargeStyle: { backgroundColor: 'transparent' },
        }
      : { headerShadowVisible: false }),
  };

  useNotificationTaps();

  useEffect(() => {
    // Paint an empty Up Next right away so a freshly added widget is not a blank square.
    updateUpNextWidget([], []);
    void refreshAccount().finally(() => markReady('account'));
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
            sheetAllowedDetents: [0.42, 0.88],
            // The map stays usable behind the smaller detent, like Apple Maps.
            sheetLargestUndimmedDetentIndex: 0,
          }}
        />
        <Stack.Screen name="origin" options={{ ...pickerSheet, title: 'Start from' }} />
        <Stack.Screen name="stop" options={{ ...pickerSheet, title: 'Add a stop' }} />
        <Stack.Screen name="class/[id]" options={sheetTall} />
        <Stack.Screen name="class-import" options={sheetTall} />
        <Stack.Screen name="profile" options={sheetMedium} />
        <Stack.Screen name="download-data" options={sheetMedium} />
        <Stack.Screen name="voice" options={sheetMedium} />
        <Stack.Screen name="delete-account" options={sheetMedium} />
        <Stack.Screen name="report-reason" options={sheetCompact} />
        <Stack.Screen name="report" options={sheetTall} />
        <Stack.Screen name="meetup/[id]" options={{ ...formSheet, sheetAllowedDetents: [0.55, 0.92] }} />
        <Stack.Screen name="meetup/new" options={nestedFormSheet} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <Navigation />
        <OfflineBanner />
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
