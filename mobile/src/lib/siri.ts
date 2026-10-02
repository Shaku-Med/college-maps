import { router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform, Settings } from 'react-native';

import { handleAppLink } from '@/lib/app-links';
import { getDevicePrefs } from '@/lib/device-prefs';

// Written by the Siri shortcuts (plugins/with-siri-shortcuts.js) into the app's own UserDefaults.
const HANDOFF_KEY = 'csimap.siriLink';

function takeHandoff() {
  const path = Settings.get(HANDOFF_KEY);
  if (typeof path !== 'string' || path.length === 0) return;
  Settings.set({ [HANDOFF_KEY]: '' });
  // With Siri turned off in Account, asking still opens the app, just without starting anything.
  if (!getDevicePrefs().siri) return;
  const next = handleAppLink(path);
  if (next) router.navigate(next as never);
}

/** Picks up what Siri asked for: at launch, when the app comes back to the front, and while it is open. */
export function useSiriHandoff() {
  // Navigating before the root navigator has mounted throws, so nothing is picked up until it has.
  const ready = Boolean(useRootNavigationState()?.key);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !ready) return;
    takeHandoff();
    const watch = Settings.watchKeys(HANDOFF_KEY, takeHandoff);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') takeHandoff();
    });
    return () => {
      Settings.clearWatch(watch);
      sub.remove();
    };
  }, [ready]);
}
