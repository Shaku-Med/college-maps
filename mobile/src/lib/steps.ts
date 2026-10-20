import { requireOptionalNativeModule } from 'expo';
import { AppState } from 'react-native';

// Builds from before this was added get it as an update without the native side, so steps stay off there.
const HAS_PEDOMETER = requireOptionalNativeModule('ExponentPedometer') !== null;

let steps: number | undefined;

/** Counts steps while a street trip runs, so getting off a bus reads as walking. Returns the function that stops it. */
export function watchSteps(): () => void {
  let stopped = false;
  let subscription: { remove(): void } | null = null;
  steps = undefined;
  if (!HAS_PEDOMETER) return () => undefined;
  // The pedometer goes quiet in the background, so a locked phone goes by speed until fresh steps arrive.
  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active') steps = undefined;
  });
  void (async () => {
    try {
      const { Pedometer } = await import('expo-sensors');
      if (stopped || !(await Pedometer.isAvailableAsync())) return;
      const permission = await Pedometer.requestPermissionsAsync();
      if (stopped || !permission.granted) return;
      if (AppState.currentState === 'active') steps = 0;
      subscription = Pedometer.watchStepCount((result) => {
        if (AppState.currentState === 'active') steps = result.steps;
      });
    } catch {
      // No step count: the switch goes by speed alone.
    }
  })();
  return () => {
    stopped = true;
    appState.remove();
    subscription?.remove();
    subscription = null;
    steps = undefined;
  };
}

/** Steps since watching began, or undefined while the phone is not counting them. */
export const currentSteps = () => steps;
