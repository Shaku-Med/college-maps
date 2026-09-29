import * as SplashScreen from 'expo-splash-screen';

// The splash stays up until the account is known and the map has drawn, so the app opens on a finished screen
// instead of a blank one. A slow network never holds it longer than the cap.
const MAX_WAIT_MS = 5000;

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 350, fade: true });

const waiting = new Set<'account' | 'map'>(['account', 'map']);
let hidden = false;

function hide() {
  if (hidden) return;
  hidden = true;
  void SplashScreen.hideAsync().catch(() => undefined);
}

setTimeout(hide, MAX_WAIT_MS);

export function markReady(part: 'account' | 'map') {
  waiting.delete(part);
  if (waiting.size === 0) hide();
}
