import { NativeModule, requireOptionalNativeModule } from 'expo';
import * as Haptics from 'expo-haptics';
import { AppState, Platform } from 'react-native';

declare class PhoneSoundModule extends NativeModule<{ onCallChange(event: { onCall: boolean }): void }> {
  isSilentAsync(): Promise<boolean>;
  isOnCall(): boolean;
  beginPrompt(): Promise<void>;
  endPrompt(): Promise<boolean>;
  vibrate?(): void;
}

// Only in builds made after this module was added; older builds always speak.
const native = requireOptionalNativeModule<PhoneSoundModule>('PhoneSound');
// An answer this recent is trusted, so lines close together don't each wait on a new check.
const FRESH_MS = 3_000;
const CHECK_TIMEOUT_MS = 800;

let silent = false;
let checkedAt = 0;
let checking: Promise<boolean> | null = null;

// An iPhone can only read its ring switch while the app is open, so with the screen locked the last answer stands.
const canReadSwitch = () => Platform.OS !== 'ios' || AppState.currentState === 'active';

function readSilent(): Promise<boolean> {
  if (checking) return checking;
  if (!native || !canReadSwitch() || Date.now() - checkedAt < FRESH_MS) return Promise.resolve(silent);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(silent), CHECK_TIMEOUT_MS));
  checking = Promise.race([native.isSilentAsync(), timeout])
    .then((answer) => {
      silent = answer;
      checkedAt = Date.now();
      return answer;
    })
    .catch(() => silent)
    .finally(() => {
      checking = null;
    });
  return checking;
}

export function isOnCall() {
  try {
    return native?.isOnCall() ?? false;
  } catch {
    return false;
  }
}

/** On silent (or vibrate on Android) or with a call ringing or going; recheck false while a line plays, as the iPhone check changes how sound plays. */
export async function phoneWantsQuiet({ recheck = true } = {}) {
  if (!native) return false;
  if (isOnCall()) return true;
  return recheck ? readSilent() : silent;
}

/** Reads the ring switch again right away, such as when directions start. */
export function checkSilentSwitch() {
  checkedAt = 0;
  void readSilent();
}

export function onCallChange(listener: (onCall: boolean) => void) {
  const subscription = native?.addListener('onCallChange', ({ onCall }) => listener(onCall));
  return () => subscription?.remove();
}

/** Gets the phone ready to say a line, turning other audio down while it plays. */
export async function beginPrompt() {
  await native?.beginPrompt().catch(() => undefined);
}

/** Gives other audio its volume back once nothing is being said; false when the phone was still busy. */
export async function endPrompt() {
  return native ? native.endPrompt().catch(() => false) : true;
}

/** A buzz at a turn in place of speech. */
export function tapForTurn() {
  if (Platform.OS === 'ios' && native?.vibrate) native.vibrate();
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

if (native) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') checkSilentSwitch();
  });
}
