// Spoken directions. The voice is Kokoro, a small neural model that runs on the device in a worker, so
// it sounds like a person and nothing said is sent anywhere. Making a line takes a moment on a phone,
// so lines are prepared before they are needed and kept between trips. Whenever a line is not ready in
// time, the device's own speech engine says it instead, because late directions are worse than plain ones.

const STORAGE_KEY = "csimap.voice";
const CHOICE_KEY = "csimap.voiceName";

// The voices on offer, best first. The Kokoro ones run on the phone; "device" is the phone's own speech
// engine, for anyone who would rather not download a voice. The account API accepts exactly these ids.
export const VOICE_OPTIONS = [
  { id: "af_heart", name: "Heart", description: "Warm, American" },
  { id: "af_bella", name: "Bella", description: "Bright, American" },
  { id: "af_nicole", name: "Nicole", description: "Soft, American" },
  { id: "bf_emma", name: "Emma", description: "British" },
  { id: "am_michael", name: "Michael", description: "Calm, American" },
  { id: "am_fenrir", name: "Fenrir", description: "Deep, American" },
  { id: "bm_george", name: "George", description: "British" },
  { id: "device", name: "Your phone's voice", description: "Nothing to download, but more robotic" },
] as const;

export type VoiceId = (typeof VOICE_OPTIONS)[number]["id"];
export const DEFAULT_VOICE: VoiceId = "af_heart";
const PREVIEW_LINE = "In 100 feet, turn right.";

export const isVoiceId = (value: unknown): value is VoiceId =>
  typeof value === "string" && VOICE_OPTIONS.some((option) => option.id === value);

let voice: VoiceId = DEFAULT_VOICE;
const MAX_TEXT = 300;
// How long a heads up may wait for its own clip. Heads ups come about ten seconds before a turn, so there is
// room to wait, and past this a natural stand in, or failing that the device voice, says it instead.
const WAIT_FOR_CLIP_MS = 4_000;
const MAX_CLIPS_IN_MEMORY = 160;
const MAX_CLIPS_STORED = 250;
// The same heads up twice in a row, as happens right after a reroute, is said once.
const REPEAT_WINDOW_MS = 8_000;
// Loading the model again after it failed is only worth a few tries: a download cut off by a weak signal
// may work later, a phone without the memory for it never will.
const MAX_LOAD_ATTEMPTS = 3;
// A voice engine that is busy but has said nothing for this long is stuck, like a download that stopped
// partway, and is restarted instead of leaving every line waiting on it.
const STALL_MS = 60_000;
const DB_NAME = "csimap-voice";
const DB_STORE = "clips";

type Clip = { samples: Float32Array<ArrayBuffer>; rate: number };
// 0 is a line being said right now, 1 a line for the route being walked, 2 a phrase made in the background.
type Priority = 0 | 1 | 2;
type ModelState = "idle" | "loading" | "ready" | "failed";

export function voiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function readVoicePreference() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveVoicePreference(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private windows can refuse storage. Voice still follows the toggle for this visit.
  }
}

/** The voice chosen on this device, or undefined when none has been picked here. */
export function readVoiceChoice(): VoiceId | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const saved = window.localStorage.getItem(CHOICE_KEY);
    return isVoiceId(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

export function saveVoiceChoice(id: VoiceId) {
  try {
    window.localStorage.setItem(CHOICE_KEY, id);
  } catch {
    // Kept for this visit only.
  }
}

/** Switches the voice everything is said in. Lines made for the old one stay saved for switching back. */
export function selectVoice(id: VoiceId) {
  if (!isVoiceId(id) || id === voice) return;
  voice = id;
  // Queued lines are for the old voice; the new one makes its own as they are needed.
  worker?.postMessage({ type: "reset" });
}

/** Speech for distances, so "80 ft" is read as "80 feet" and long ones are rounded the way people say them. */
export function spokenDistance(meters: number) {
  const feet = meters * 3.28084;
  if (feet < 100) return `${Math.max(10, Math.round(feet / 10) * 10)} feet`;
  if (feet < 1000) return `${Math.round(feet / 50) * 50} feet`;
  const miles = feet / 5280;
  if (miles < 0.35) return "a quarter mile";
  if (miles < 0.65) return "half a mile";
  if (miles < 1.15) return "1 mile";
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} miles`;
}

const clean = (text: string) => text.trim().slice(0, MAX_TEXT);
// Clips are kept per voice, so switching voices never plays a line in the wrong one.
const clipId = (text: string, speaker: VoiceId = voice) => `${speaker}|${text}`;

// ---- The natural voice ------------------------------------------------------------------------------

let worker: Worker | null = null;
let modelState: ModelState = "idle";
let loadAttempts = 0;
let lastHeard = 0;
let watchdog: ReturnType<typeof setInterval> | undefined;
let nextRequest = 1;
const clips = new Map<string, Clip>();
const pending = new Map<string, { job: Promise<Clip | null>; id?: number; priority: Priority }>();
const waiting = new Map<number, (clip: Clip | null) => void>();

export type VoiceStatus = { state: ModelState; percent: number | null };
const IDLE_STATUS: VoiceStatus = { state: "idle", percent: null };
let status = IDLE_STATUS;
const statusListeners = new Set<() => void>();

function setModelState(state: ModelState, percent: number | null = null) {
  modelState = state;
  if (status.state === state && status.percent === percent) return;
  status = { state, percent };
  for (const listener of statusListeners) listener();
}

/** What the voice engine is doing, such as how much of the model has downloaded. For useSyncExternalStore. */
export function subscribeVoiceStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => void statusListeners.delete(listener);
}
export const voiceStatus = () => status;
export const idleVoiceStatus = () => IDLE_STATUS;

const engineBusy = () => modelState === "loading" || waiting.size > 0;

// Call just before giving the engine something to do.
function watchEngine() {
  if (!engineBusy()) lastHeard = Date.now();
  watchdog ??= setInterval(() => {
    if (!engineBusy()) {
      clearInterval(watchdog);
      watchdog = undefined;
    } else if (Date.now() - lastHeard > STALL_MS) {
      giveUp();
    }
  }, 5_000);
}

// Whether this device can run the natural voices at all, whichever voice is chosen right now.
function modelAllowed() {
  if (typeof window === "undefined" || typeof Worker === "undefined" || typeof AudioContext === "undefined") return false;
  // The model is a large download, so a phone asking to save data keeps the device voice.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !connection?.saveData;
}

// Whether directions are said in a natural voice.
const neuralAllowed = () => voice !== "device" && modelAllowed();

// A tap asking for a natural voice tries the model again after it failed, a few times per visit at most.
function retryModel() {
  if (modelState === "failed" && loadAttempts < MAX_LOAD_ATTEMPTS) setModelState("idle");
}

function ensureWorker() {
  if (worker || modelState === "failed" || !modelAllowed()) return worker;
  try {
    worker = new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" });
  } catch {
    setModelState("failed");
    return null;
  }
  worker.onmessage = (event: MessageEvent) => {
    lastHeard = Date.now();
    const message = event.data as { type?: string; id?: number; samples?: unknown; rate?: unknown; percent?: unknown };
    if (message.type === "ready") setModelState("ready");
    else if (message.type === "failed") giveUp();
    else if (message.type === "progress" && typeof message.percent === "number" && modelState === "loading") {
      setModelState("loading", Math.max(0, Math.min(100, Math.round(message.percent))));
    }
    else if ((message.type === "audio" || message.type === "error") && typeof message.id === "number") {
      const resolve = waiting.get(message.id);
      waiting.delete(message.id);
      const valid = message.type === "audio" && message.samples instanceof Float32Array && typeof message.rate === "number";
      resolve?.(valid ? { samples: message.samples as Float32Array<ArrayBuffer>, rate: message.rate as number } : null);
    }
  };
  worker.onerror = giveUp;
  return worker;
}

// A device that cannot run the model uses its own voice until a tap tries again.
function giveUp() {
  setModelState("failed");
  worker?.terminate();
  worker = null;
  for (const resolve of waiting.values()) resolve(null);
  waiting.clear();
}

/** Starts downloading the model, about 90 MB the first time and cached by the browser after that. */
export function warmUpVoice() {
  if (neuralAllowed()) loadModel();
}

function loadModel() {
  if (modelState !== "idle") return;
  const w = ensureWorker();
  if (!w) return;
  watchEngine();
  setModelState("loading");
  loadAttempts++;
  w.postMessage({ type: "load" });
}

function remember(id: string, clip: Clip) {
  clips.delete(id);
  clips.set(id, clip);
  if (clips.size > MAX_CLIPS_IN_MEMORY) clips.delete(clips.keys().next().value as string);
}

function synthesize(text: string, priority: Priority, speaker: VoiceId = voice): Promise<Clip | null> {
  if (speaker === "device") return Promise.resolve(null);
  const id = clipId(text, speaker);
  const cached = clips.get(id);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(id);
  if (inflight) {
    if (priority < inflight.priority) {
      inflight.priority = priority;
      if (inflight.id !== undefined) worker?.postMessage({ type: "promote", id: inflight.id, priority });
    }
    return inflight.job;
  }

  const entry: { job: Promise<Clip | null>; id?: number; priority: Priority } = { job: Promise.resolve(null), priority };
  entry.job = (async () => {
    const stored = await readStoredClip(text, speaker);
    if (stored) {
      remember(id, stored);
      return stored;
    }
    const w = ensureWorker();
    if (!w) return null;
    loadModel();
    const request = nextRequest++;
    entry.id = request;
    const clip = await new Promise<Clip | null>((resolve) => {
      watchEngine();
      waiting.set(request, resolve);
      w.postMessage({ type: "speak", id: request, text, voice: speaker, priority: entry.priority });
    });
    if (clip) {
      remember(id, clip);
      void storeClip(text, clip, speaker);
    }
    return clip;
  })().finally(() => pending.delete(id));

  pending.set(id, entry);
  return entry.job;
}

/**
 * Gets lines ready ahead of time, so they play in the natural voice the moment they are needed. Lines
 * for the route being walked are made first; `later` lines wait until those are done.
 */
export function prepareSpeech(lines: readonly string[], { later = false } = {}) {
  if (!neuralAllowed()) return;
  for (const line of lines) {
    const text = clean(line);
    if (text) void synthesize(text, later ? 2 : 1);
  }
}

/** Drops route lines still waiting to be made, such as the rest of a route that was just replaced. */
export function clearPreparedSpeech() {
  worker?.postMessage({ type: "clear" });
}

// ---- Playback ---------------------------------------------------------------------------------------

let context: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;
const queue: Clip[] = [];
// Bumped by anything that should silence lines still on their way, like an urgent turn or muting.
let epoch = 0;

/** Call from a tap. iPhones only let audio start inside one, and once started it keeps working. */
export function unlockAudio() {
  if (!neuralAllowed()) return;
  retryModel();
  startAudio();
}

function startAudio() {
  try {
    context ??= new AudioContext();
    void context.resume();
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, 22_050);
    silence.connect(context.destination);
    silence.start();
  } catch {
    context = null;
  }
}

function playNext() {
  if (current || !context) return;
  const clip = queue.shift();
  if (!clip) return;
  // Wait for a device voice line that is still talking rather than speaking over it.
  if (voiceSupported() && window.speechSynthesis.speaking) {
    queue.unshift(clip);
    setTimeout(playNext, 200);
    return;
  }
  const buffer = context.createBuffer(1, clip.samples.length, clip.rate);
  buffer.copyToChannel(clip.samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const finish = () => {
    if (current !== source) return;
    current = null;
    playNext();
  };
  source.onended = finish;
  // A phone call or the system can pause audio mid clip, and then "ended" never comes. Without this the
  // rest of the trip would queue up behind a clip that is not playing.
  setTimeout(finish, buffer.duration * 1000 + 1_000);
  current = source;
  source.start();
}

function play(clip: Clip) {
  if (!context) {
    try {
      context = new AudioContext();
    } catch {
      return false;
    }
  }
  // Audio that was never allowed to start would play into nothing, so the device voice says it instead.
  if (context.state !== "running") {
    void context.resume();
    return false;
  }
  queue.push(clip);
  playNext();
  return true;
}

function silenceAll() {
  epoch++;
  queue.length = 0;
  if (current) {
    const playing = current;
    current = null;
    try {
      playing.stop();
    } catch {
      // Already finished.
    }
  }
  if (voiceSupported()) window.speechSynthesis.cancel();
}

// ---- The device's own voice, as the fallback --------------------------------------------------------

let systemVoice: SpeechSynthesisVoice | null | undefined;

// Of the voices the device has, neural and premium ones sound the least robotic.
function score(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  if (!voice.lang.toLowerCase().startsWith("en")) return -1;
  let points = voice.lang === "en-US" ? 10 : 0;
  if (/natural|neural/.test(name)) points += 50;
  if (/premium/.test(name)) points += 45;
  if (/enhanced/.test(name)) points += 40;
  if (/siri/.test(name)) points += 35;
  if (/google us english/.test(name)) points += 30;
  if (/samantha|ava|allison|zoe|evan|nathan|aria|jenny|guy/.test(name)) points += 20;
  if (/compact|espeak|robot/.test(name)) points -= 40;
  return points + (voice.default ? 2 : 0);
}

function pickSystemVoice() {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of window.speechSynthesis.getVoices()) {
    const points = score(voice);
    if (points > bestScore) {
      best = voice;
      bestScore = points;
    }
  }
  return best;
}

if (voiceSupported()) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    systemVoice = pickSystemVoice();
  });
}

function speakWithDevice(text: string) {
  if (!voiceSupported()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  systemVoice ??= pickSystemVoice();
  if (systemVoice) {
    utterance.voice = systemVoice;
    utterance.lang = systemVoice.lang;
  } else {
    utterance.lang = "en-US";
  }
  window.speechSynthesis.speak(utterance);
}

// ---- Speaking ---------------------------------------------------------------------------------------

/**
 * Says a line. Urgent lines, like the turn right now, cut off anything still playing and never wait. When
 * the exact line is not ready yet, the `fallback` line is said instead if it already exists in the natural
 * voice, such as "Turn right." for "Turn right onto Fort Place.", so the voice does not switch mid trip. The
 * device voice only speaks when neither is ready.
 */
let lastSpoken = { text: "", at: 0 };

export function speak(line: string, { urgent = false, fallback }: { urgent?: boolean; fallback?: string } = {}) {
  const text = clean(line);
  if (!text) return;
  const now = Date.now();
  if (!urgent && lastSpoken.text === text && now - lastSpoken.at < REPEAT_WINDOW_MS) return;
  lastSpoken = { text, at: now };
  if (urgent) silenceAll();

  const ready = clips.get(clipId(text));
  if (ready && play(ready)) return;

  const standIn = () => {
    const clip = fallback ? clips.get(clipId(clean(fallback))) : undefined;
    return clip !== undefined && play(clip);
  };

  const modelComing = modelState === "loading" || modelState === "ready";
  if (urgent || !modelComing || !neuralAllowed()) {
    if (!standIn()) speakWithDevice(text);
    // Made now, so the same line is ready in the natural voice the next time it comes up.
    if (modelComing && neuralAllowed()) void synthesize(text, 1);
    return;
  }

  const asked = epoch;
  let spoken = false;
  const giveUp = setTimeout(() => {
    if (spoken || asked !== epoch) return;
    spoken = true;
    if (!standIn()) speakWithDevice(text);
  }, WAIT_FOR_CLIP_MS);
  void synthesize(text, 0).then((clip) => {
    if (spoken || asked !== epoch) return;
    spoken = true;
    clearTimeout(giveUp);
    if (!(clip && play(clip)) && !standIn()) speakWithDevice(text);
  });
}

export function stopSpeaking() {
  silenceAll();
}

/**
 * Plays a short sample of a voice. Call it from a tap, so a phone lets the sound start. The first sample of
 * a Kokoro voice waits for the model to download and the line to be made, so it can take a while.
 */
export async function previewVoice(id: VoiceId): Promise<"played" | "unsupported" | "failed"> {
  silenceAll();
  if (id === "device") {
    if (!voiceSupported()) return "unsupported";
    speakWithDevice(PREVIEW_LINE);
    return "played";
  }
  // Any voice can be heard, not just the chosen one, including while the phone's own voice is chosen.
  if (!modelAllowed()) return "unsupported";
  startAudio();
  retryModel();
  const clip = await synthesize(PREVIEW_LINE, 0, id);
  return clip && play(clip) ? "played" : "failed";
}

// ---- Keeping clips between trips --------------------------------------------------------------------

let database: Promise<IDBDatabase | null> | null = null;

function openDatabase() {
  database ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE).createIndex("at", "at");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

// The model and voice are part of the key, so changing either never replays a clip made by the old one.
const clipKey = (text: string, speaker: VoiceId) => `kokoro-82m-q8|${speaker}|${text}`;

async function readStoredClip(text: string, speaker: VoiceId): Promise<Clip | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(DB_STORE).objectStore(DB_STORE).get(clipKey(text, speaker));
      request.onsuccess = () => {
        const value = request.result as { pcm?: unknown; rate?: unknown } | undefined;
        if (!(value?.pcm instanceof Int16Array) || typeof value.rate !== "number") return resolve(null);
        const samples = new Float32Array(value.pcm.length);
        for (let i = 0; i < value.pcm.length; i++) samples[i] = value.pcm[i] / 32_768;
        resolve({ samples, rate: value.rate });
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Stored as 16 bit samples, half the size of the float audio and no audible difference for speech.
async function storeClip(text: string, clip: Clip, speaker: VoiceId) {
  const db = await openDatabase();
  if (!db) return;
  try {
    const pcm = new Int16Array(clip.samples.length);
    for (let i = 0; i < clip.samples.length; i++) {
      pcm[i] = Math.max(-32_768, Math.min(32_767, Math.round(clip.samples[i] * 32_768)));
    }
    const store = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE);
    store.put({ pcm, rate: clip.rate, at: Date.now() }, clipKey(text, speaker));
    const count = store.count();
    count.onsuccess = () => {
      let extra = count.result - MAX_CLIPS_STORED;
      if (extra <= 0) return;
      // Oldest clips go first.
      store.index("at").openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor || extra <= 0) return;
        cursor.delete();
        extra--;
        cursor.continue();
      };
    };
  } catch {
    // Storage full or unavailable: the clip still plays, it just is not kept.
  }
}
