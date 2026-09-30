import * as SecureStore from 'expo-secure-store';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

// Spoken directions use the phone's own speech engine, which starts instantly and works offline.
const ON_OFF_KEY = 'csimap.voice';
const VOICE_ID_KEY = 'csimap.voice.id';
const REPEAT_WINDOW_MS = 8_000;
const MAX_TEXT = 300;

let voiceId: string | undefined;
let chosen = false;
let audioReady: Promise<void> | null = null;

function prepareAudio() {
  audioReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
  }).catch(() => undefined);
  return audioReady;
}
let last = { text: '', at: 0 };

const NATURAL_VOICE = 'com.apple.voice.';
const FAMILIAR = /\.(ava|zoe|samantha|evan|nathan|allison|susan|joelle|noelle|tom)$/i;

function rankVoice(voice: Speech.Voice) {
  const id = voice.identifier.toLowerCase();
  const quality = id.includes('.premium.') ? 100 : id.includes('.enhanced.') || voice.quality === Speech.VoiceQuality.Enhanced ? 80 : 10;
  return quality + (voice.language === 'en-US' ? 20 : 0) + (FAMILIAR.test(id) ? 5 : 0);
}

function isEnglish(voice: Speech.Voice) {
  return voice.language.toLowerCase().startsWith('en');
}

function isNaturalIos(voice: Speech.Voice) {
  return voice.identifier.startsWith(NATURAL_VOICE) && isEnglish(voice);
}

async function savedVoiceId() {
  try {
    return (await SecureStore.getItemAsync(VOICE_ID_KEY)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function pickVoice() {
  if (chosen) return voiceId;
  chosen = true;
  try {
    const saved = await savedVoiceId();
    const voices = await Speech.getAvailableVoicesAsync();
    if (saved && voices.some((voice) => voice.identifier === saved)) {
      voiceId = saved;
      return voiceId;
    }
    const natural = voices.filter(isNaturalIos);
    const pool = natural.length > 0 ? natural : voices.filter(isEnglish);
    voiceId = pool.sort((a, b) => rankVoice(b) - rankVoice(a))[0]?.identifier;
  } catch {
    voiceId = undefined;
  }
  return voiceId;
}

/** English voices on this phone that are fit for directions. */
export async function listDirectionVoices() {
  const voices = await Speech.getAvailableVoicesAsync();
  const natural = voices.filter(isNaturalIos);
  const pool = natural.length > 0 ? natural : voices.filter(isEnglish);
  return [...pool].sort((a, b) => rankVoice(b) - rankVoice(a) || a.name.localeCompare(b.name));
}

export async function currentVoiceId() {
  return pickVoice();
}

/** Remembers which system voice to use for directions on this phone. */
export async function setDirectionVoice(id: string | null) {
  chosen = false;
  voiceId = undefined;
  try {
    if (id) await SecureStore.setItemAsync(VOICE_ID_KEY, id);
    else await SecureStore.deleteItemAsync(VOICE_ID_KEY);
  } catch {
    // Kept for this visit only.
  }
  return pickVoice();
}

export async function previewDirectionVoice(id: string) {
  await prepareAudio();
  await Speech.stop();
  Speech.speak('In 100 feet, turn right.', { voice: id, language: undefined, rate: 1.0 });
}

export async function warmUpVoice() {
  const [voice] = await Promise.all([pickVoice(), prepareAudio()]);
  Speech.speak(' ', { voice, language: voice ? undefined : 'en-US', volume: 0 });
}

export function readVoicePreference() {
  try {
    return globalThis.localStorage?.getItem(ON_OFF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveVoicePreference(on: boolean) {
  try {
    globalThis.localStorage?.setItem(ON_OFF_KEY, on ? 'on' : 'off');
  } catch {
    // Kept for this visit only.
  }
}

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
