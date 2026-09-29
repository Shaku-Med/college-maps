import * as Speech from 'expo-speech';

// Spoken directions use the iPhone's own speech engine, which starts instantly and works offline. The best
// English voice on the phone is picked, preferring the premium and enhanced ones people can download in
// Settings, Accessibility, Spoken Content.
const PREFERENCE_KEY = 'csimap.voice';
const REPEAT_WINDOW_MS = 8_000;
const MAX_TEXT = 300;

let voiceId: string | undefined;
let chosen = false;
let last = { text: '', at: 0 };

async function pickVoice() {
  if (chosen) return voiceId;
  chosen = true;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const english = voices.filter((voice) => voice.language.toLowerCase().startsWith('en'));
    const rank = (voice: Speech.Voice) =>
      (voice.language === 'en-US' ? 10 : 0) + (voice.quality === Speech.VoiceQuality.Enhanced ? 50 : 0) +
      (/premium/i.test(voice.identifier) ? 40 : 0);
    voiceId = english.sort((a, b) => rank(b) - rank(a))[0]?.identifier;
  } catch {
    voiceId = undefined;
  }
  return voiceId;
}

export function readVoicePreference() {
  try {
    return globalThis.localStorage?.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveVoicePreference(on: boolean) {
  try {
    globalThis.localStorage?.setItem(PREFERENCE_KEY, on ? 'on' : 'off');
  } catch {
    // Kept for this visit only.
  }
}

/** Says a line. Urgent lines, like the turn right now, cut off anything still being said. */
export async function speak(line: string, { urgent = false } = {}) {
  const text = line.trim().slice(0, MAX_TEXT);
  if (!text) return;
  const now = Date.now();
  if (!urgent && last.text === text && now - last.at < REPEAT_WINDOW_MS) return;
  last = { text, at: now };
  const voice = await pickVoice();
  if (urgent) await Speech.stop();
  Speech.speak(text, { voice, language: voice ? undefined : 'en-US', rate: 1.0 });
}

export function stopSpeaking() {
  void Speech.stop();
}

/** Speech for distances, so "80 ft" is read as "80 feet" and long ones are rounded the way people say them. */
export function spokenDistance(meters: number) {
  const feet = meters * 3.28084;
  if (feet < 100) return `${Math.max(10, Math.round(feet / 10) * 10)} feet`;
  if (feet < 1000) return `${Math.round(feet / 50) * 50} feet`;
  const miles = feet / 5280;
  if (miles < 0.35) return 'a quarter mile';
  if (miles < 0.65) return 'half a mile';
  if (miles < 1.15) return '1 mile';
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} miles`;
}
