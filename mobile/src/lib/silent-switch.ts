import { requireOptionalNativeModule } from 'expo';
import { AppState, Platform } from 'react-native';

// Only in builds made after this module was added; older builds and Android always speak.
const native =
  Platform.OS === 'ios' ? requireOptionalNativeModule<{ isSilentAsync(): Promise<boolean> }>('SilentSwitch') : null;
// Checked again this often while the app is open. The check plays a silent system sound, which only works in the foreground,
// so with the screen locked the last answer from the foreground stands.
const CHECK_MS = 10_000;

let silent = false;
let checkedAt = 0;

/** Checks the ring switch again soon, such as when directions start. */
export function checkSilentSwitch(force = false) {
  if (!native || AppState.currentState !== 'active') return;
  if (!force && Date.now() - checkedAt < CHECK_MS) return;
  checkedAt = Date.now();
  native
    .isSilentAsync()
    .then((answer) => {
      silent = answer;
    })
    .catch(() => undefined);
}

/** Whether the iPhone is set to silent, as last checked; asking also refreshes it for next time. */
export function phoneIsSilent() {
  checkSilentSwitch();
  return silent;
}

if (native) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') checkSilentSwitch(true);
  });
}
