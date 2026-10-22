import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';

import {
  NATURAL_VOICES_AVAILABLE,
  clearQueuedClips,
  engineStatus,
  holdEngine,
  isBanked,
  loadVoiceBank,
  makeClip,
  resetQueuedClips,
  startEngine,
  storedClip,
} from '@/lib/voice-engine';
import { PREVIEW_LINE, isNaturalVoice, isVoiceId, type NaturalVoiceId, type VoiceId } from '@/lib/voice-options';

// Spoken directions use a natural voice made on the phone when one is picked, and the phone's own speech engine otherwise.
const ON_OFF_KEY = 'csimap.voice';
const CHOICE_KEY = 'csimap.voiceName';
const VOICE_ID_KEY = 'csimap.voice.id';
const REPEAT_WINDOW_MS = 8_000;
const MAX_TEXT = 300;
// How long a heads up may wait for its own clip before a stand in or the phone's voice says it,
// and how long a line said right now waits for its ready made clip.
const WAIT_FOR_CLIP_MS = 4_000;
const WAIT_FOR_BANK_MS = 1_500;
// Until a clip reports its length, the longest it may hold up the next one.
const CLIP_TIMEOUT_MS = 30_000;

let voiceId: string | undefined;
let chosen = false;
// A phone whose speech engine is missing or not ready fails inside expo-speech where nothing can catch it, so it waits.
let canSpeak = true;
let audioReady: Promise<void> | null = null;

function prepareAudio() {
  audioReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
  }).catch(() => undefined);
  return audioReady;
}

const clean = (text: string) => text.trim().slice(0, MAX_TEXT);

// ---- Which voice ----------------------------------------------------------------------------------

function readChoice(): VoiceId {
  try {
    const saved = globalThis.localStorage?.getItem(CHOICE_KEY);
    return isVoiceId(saved) ? saved : 'device';
  } catch {
    return 'device';
  }
}

let choice: VoiceId = readChoice();
const choiceListeners = new Set<() => void>();

export const voiceChoice = () => choice;
export function subscribeVoiceChoice(listener: () => void) {
  choiceListeners.add(listener);
  return () => void choiceListeners.delete(listener);
}

/** Switches the voice everything is said in. A natural voice starts downloading the model right away. */
export function chooseVoice(id: VoiceId) {
  if (!isVoiceId(id) || id === choice) return;
  choice = id;
  try {
    globalThis.localStorage?.setItem(CHOICE_KEY, id);
  } catch {
    // Kept for this visit only.
  }
  resetQueuedClips();
  if (isNaturalVoice(id)) startEngine();
  for (const listener of choiceListeners) listener();
}

// Clips already made play even when the engine cannot run, such as offline; only making new ones needs it.
const naturalVoice = (): NaturalVoiceId | null => (NATURAL_VOICES_AVAILABLE && isNaturalVoice(choice) ? choice : null);
const canMakeClips = () => engineStatus().state !== 'failed';

// ---- The phone's own voice -------------------------------------------------------------------------

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
    canSpeak = true;
    if (saved && voices.some((voice) => voice.identifier === saved)) {
      voiceId = saved;
      return voiceId;
    }
    const natural = voices.filter(isNaturalIos);
    const pool = natural.length > 0 ? natural : voices.filter(isEnglish);
    voiceId = pool.sort((a, b) => rankVoice(b) - rankVoice(a))[0]?.identifier;
  } catch {
    voiceId = undefined;
    canSpeak = false;
    // The engine may still be starting, so the next line asks again.
    chosen = false;
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

let deviceSpeaking = false;

async function speakWithDevice(text: string) {
  const [voice] = await Promise.all([pickVoice(), prepareAudio()]);
  if (!canSpeak) return;
  deviceSpeaking = true;
  const done = () => {
    deviceSpeaking = false;
  };
  Speech.speak(text, { voice, language: voice ? undefined : 'en-US', rate: 1.0, onDone: done, onStopped: done, onError: done });
}

export async function previewDirectionVoice(id: string) {
  silenceAll();
  await Promise.all([pickVoice(), prepareAudio()]);
  if (!canSpeak) return;
  Speech.speak(PREVIEW_LINE, { voice: id, language: undefined, rate: 1.0 });
}

// ---- Playing natural clips -------------------------------------------------------------------------

let player: AudioPlayer | null = null;
const queue: string[] = [];
// Bumped by anything that should silence lines still on their way, like an urgent turn or muting.
let epoch = 0;

function finishClip(done: AudioPlayer) {
  if (player !== done) return;
  player = null;
  try {
    done.remove();
  } catch {
    // Already released.
  }
  playNext();
}

function playNext() {
  if (player || queue.length === 0) return;
  // Waits for a phone voice line that is still talking rather than speaking over it.
  if (deviceSpeaking) {
    setTimeout(playNext, 200);
    return;
  }
  const uri = queue.shift() as string;
  let next: AudioPlayer;
  try {
    next = createAudioPlayer({ uri });
  } catch {
    playNext();
    return;
  }
  player = next;
  let timed = false;
  // A call or the system can stop audio mid clip, and then the finish event never comes.
  const fallback = setTimeout(() => finishClip(next), CLIP_TIMEOUT_MS);
  next.addListener('playbackStatusUpdate', (state) => {
    if (state.didJustFinish) {
      clearTimeout(fallback);
      finishClip(next);
    } else if (!timed && state.isLoaded && state.duration > 0) {
      timed = true;
      clearTimeout(fallback);
      setTimeout(() => finishClip(next), state.duration * 1000 + 1_500);
    }
  });
  next.play();
}

async function play(uri: string) {
  await prepareAudio();
  queue.push(uri);
  playNext();
}

function silenceAll() {
  epoch++;
  queue.length = 0;
  const current = player;
  player = null;
  if (current) {
    try {
      current.pause();
      current.remove();
    } catch {
      // Already finished.
    }
  }
  deviceSpeaking = false;
  void Speech.stop();
}

// ---- Speaking ----------------------------------------------------------------------------------------

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

let last = { text: '', at: 0 };

/** Says a line. A fallback is a plainer line already made in the natural voice, said when this one is late. */
export async function speak(line: string, { urgent = false, fallback }: { urgent?: boolean; fallback?: string } = {}) {
  const text = clean(line);
  if (!text) return;
  const now = Date.now();
  if (!urgent && last.text === text && now - last.at < REPEAT_WINDOW_MS) return;
  last = { text, at: now };
  if (urgent) silenceAll();

  const voice = naturalVoice();
  if (!voice) {
    await speakWithDevice(text);
    return;
  }
  const asked = epoch;
  const ready = await storedClip(voice, text);
  if (asked !== epoch) return;
  if (ready) {
    await play(ready);
    return;
  }

  const standInOrDevice = async () => {
    const clip = fallback ? await storedClip(voice, clean(fallback)) : null;
    if (asked !== epoch) return;
    if (clip) await play(clip);
    else await speakWithDevice(text);
  };

  // A ready made line is a quick download, worth a short wait even at the turn.
  const banked = isBanked(voice, text);
  const state = engineStatus().state;
  if ((urgent && !banked) || (!banked && state !== 'loading' && state !== 'ready')) {
    await standInOrDevice();
    // Made now, so the same line is ready in the natural voice the next time it comes up.
    if (canMakeClips() || banked) void makeClip(voice, text, 1);
    return;
  }

  let spoken = false;
  const late = setTimeout(
    () => {
      if (spoken || asked !== epoch) return;
      spoken = true;
      void standInOrDevice();
    },
    urgent ? WAIT_FOR_BANK_MS : WAIT_FOR_CLIP_MS,
  );
  const clip = await makeClip(voice, text, 0);
  if (spoken || asked !== epoch) return;
  spoken = true;
  clearTimeout(late);
  if (clip) await play(clip);
  else await standInOrDevice();
}

/** Gets lines ready ahead of time, so they play in the natural voice the moment they are needed. */
export function prepareSpeech(lines: readonly string[], { later = false } = {}) {
  const voice = naturalVoice();
  if (!voice) return;
  for (const line of lines) {
    const text = clean(line);
    // Ready made lines still download when the engine cannot run.
    if (text && (canMakeClips() || isBanked(voice, text))) void makeClip(voice, text, later ? 2 : 1);
  }
}

/** Drops route lines still waiting to be made, such as the rest of a route that was just replaced. */
export function clearPreparedSpeech() {
  if (naturalVoice()) clearQueuedClips();
}

/** Plays a short sample of a natural voice, a ready made clip that needs no model. */
export async function previewNaturalVoice(id: NaturalVoiceId): Promise<'played' | 'failed'> {
  silenceAll();
  const asked = epoch;
  const making = makeClip(id, PREVIEW_LINE, 0);
  await prepareAudio();
  const clip = await making;
  if (!clip) return 'failed';
  if (asked === epoch) await play(clip);
  return 'played';
}

/** Keeps the natural voice loaded while directions are open, and returns the function that lets it unload. */
export function holdVoice() {
  return naturalVoice() ? holdEngine() : () => undefined;
}

// The model only loads for a line the bank does not have, so a walk on campus never waits for it.
export async function warmUpVoice() {
  if (naturalVoice()) void loadVoiceBank();
  const [voice] = await Promise.all([pickVoice(), prepareAudio()]);
  if (!canSpeak) return;
  Speech.speak(' ', { voice, language: voice ? undefined : 'en-US', volume: 0 });
}

export function stopSpeaking() {
  silenceAll();
}
