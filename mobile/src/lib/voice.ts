import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

// Spoken directions use the iPhone's own speech engine, which starts instantly and works offline. The best
// English voice on the phone is picked, preferring the premium and enhanced ones people can download in
// Settings, Accessibility, Spoken Content.
const PREFERENCE_KEY = 'csimap.voice';
const REPEAT_WINDOW_MS = 8_000;
const MAX_TEXT = 300;

let voiceId: string | undefined;
let chosen = false;
let audioReady: Promise<void> | null = null;

// Directions keep talking with the screen locked or another app open, even on silent, the way navigation
// apps do. Music playing at the time is lowered under each line rather than stopped.
function prepareAudio() {
  audioReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
  }).catch(() => undefined);
  return audioReady;
}
let last = { text: '', at: 0 };

// Apple's natural voices all have identifiers starting with this. iOS also lists novelty voices (Bad News,
// Cellos, Wobble, Bubbles...) that warble or sound like crying, and the robotic Eloquence ones, which must never
// be picked for directions.
const NATURAL_VOICE = 'com.apple.voice.';
// Voices people know from Siri and Apple Maps, as a tiebreak within the same quality.
const FAMILIAR = /\.(ava|zoe|samantha|evan|nathan|allison|susan|joelle|noelle|tom)$/i;

async function pickVoice() {
  if (chosen) return voiceId;
  chosen = true;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const rank = (voice: Speech.Voice) => {
      const id = voice.identifier.toLowerCase();
      const quality = id.includes('.premium.') ? 100 : id.includes('.enhanced.') || voice.quality === Speech.VoiceQuality.Enhanced ? 80 : 10;
      return quality + (voice.language === 'en-US' ? 20 : 0) + (FAMILIAR.test(id) ? 5 : 0);
    };
    const natural = voices.filter(
      (voice) => voice.identifier.startsWith(NATURAL_VOICE) && voice.language.toLowerCase().startsWith('en'),
    );
    // Without a natural voice, the system default for US English is still a real one.
    voiceId = natural.sort((a, b) => rank(b) - rank(a))[0]?.identifier;
  } catch {
    voiceId = undefined;
  }
  return voiceId;
}

/**
 * Loads the voice before the first real line, the way Apple Maps is ready the moment you tap Go: the voice is
 * picked, the audio session set up, and a silent line spoken so iOS has the voice in memory.
 */
export async function warmUpVoice() {
  const [voice] = await Promise.all([pickVoice(), prepareAudio()]);
  Speech.speak(' ', { voice, language: voice ? undefined : 'en-US', volume: 0 });
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
  const [voice] = await Promise.all([pickVoice(), prepareAudio()]);
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
