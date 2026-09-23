// Spoken directions. The voice is Kokoro, a small neural model that runs on the device in a worker, so
// it sounds like a person and nothing said is sent anywhere. Making a line takes a moment on a phone,
// so lines are prepared before they are needed and kept between trips. Whenever a line is not ready in
// time, the device's own speech engine says it instead, because late directions are worse than plain ones.

const STORAGE_KEY = "csimap.voice";
const VOICE = "af_heart";
const MAX_TEXT = 300;
// How long a heads up may wait for its own clip. Heads ups come about ten seconds before a turn, so there is
// room to wait, and past this a natural stand in, or failing that the device voice, says it instead.
const WAIT_FOR_CLIP_MS = 4_000;
const MAX_CLIPS_IN_MEMORY = 160;
const MAX_CLIPS_STORED = 250;
// The same heads up twice in a row, as happens right after a reroute, is said once.
const REPEAT_WINDOW_MS = 8_000;
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

// ---- The natural voice ------------------------------------------------------------------------------

let worker: Worker | null = null;
let modelState: ModelState = "idle";
let nextRequest = 1;
const clips = new Map<string, Clip>();
const pending = new Map<string, { job: Promise<Clip | null>; id?: number; priority: Priority }>();
const waiting = new Map<number, (clip: Clip | null) => void>();

function neuralAllowed() {
  if (typeof window === "undefined" || typeof Worker === "undefined" || typeof AudioContext === "undefined") return false;
  // The model is a large download, so a phone asking to save data keeps the device voice.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !connection?.saveData;
}

function ensureWorker() {
  if (worker || modelState === "failed" || !neuralAllowed()) return worker;
  try {
    worker = new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" });
  } catch {
    modelState = "failed";
    return null;
  }
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as { type?: string; id?: number; samples?: unknown; rate?: unknown };
    if (message.type === "ready") modelState = "ready";
    else if (message.type === "failed") giveUp();
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

// A device that cannot run the model keeps using its own voice for the rest of the visit.
function giveUp() {
  modelState = "failed";
  worker?.terminate();
  worker = null;
  for (const resolve of waiting.values()) resolve(null);
  waiting.clear();
}

/** Starts downloading the model, about 90 MB the first time and cached by the browser after that. */
export function warmUpVoice() {
  if (modelState !== "idle") return;
  const w = ensureWorker();
  if (!w) return;
  modelState = "loading";
  w.postMessage({ type: "load" });
}

function remember(text: string, clip: Clip) {
  clips.delete(text);
  clips.set(text, clip);
  if (clips.size > MAX_CLIPS_IN_MEMORY) clips.delete(clips.keys().next().value as string);
}

function synthesize(text: string, priority: Priority): Promise<Clip | null> {
  const cached = clips.get(text);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(text);
  if (inflight) {
    if (priority < inflight.priority) {
      inflight.priority = priority;
      if (inflight.id !== undefined) worker?.postMessage({ type: "promote", id: inflight.id, priority });
    }
    return inflight.job;
  }

  const entry: { job: Promise<Clip | null>; id?: number; priority: Priority } = { job: Promise.resolve(null), priority };
  entry.job = (async () => {
    const stored = await readStoredClip(text);
    if (stored) {
      remember(text, stored);
      return stored;
    }
    const w = ensureWorker();
    if (!w) return null;
    warmUpVoice();
    const id = nextRequest++;
    entry.id = id;
    const clip = await new Promise<Clip | null>((resolve) => {
      waiting.set(id, resolve);
      w.postMessage({ type: "speak", id, text, voice: VOICE, priority: entry.priority });
    });
    if (clip) {
      remember(text, clip);
      void storeClip(text, clip);
    }
    return clip;
  })().finally(() => pending.delete(text));

  pending.set(text, entry);
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

  const ready = clips.get(text);
  if (ready && play(ready)) return;

  const standIn = () => {
    const clip = fallback ? clips.get(clean(fallback)) : undefined;
    return clip !== undefined && play(clip);
  };

  const modelComing = modelState === "loading" || modelState === "ready";
  if (urgent || !modelComing || !neuralAllowed()) {
    if (!standIn()) speakWithDevice(text);
    // Made now, so the same line is ready in the natural voice the next time it comes up.
    if (modelComing) void synthesize(text, 1);
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
const clipKey = (text: string) => `kokoro-82m-q8|${VOICE}|${text}`;

async function readStoredClip(text: string): Promise<Clip | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(DB_STORE).objectStore(DB_STORE).get(clipKey(text));
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
async function storeClip(text: string, clip: Clip) {
  const db = await openDatabase();
  if (!db) return;
  try {
    const pcm = new Int16Array(clip.samples.length);
    for (let i = 0; i < clip.samples.length; i++) {
      pcm[i] = Math.max(-32_768, Math.min(32_767, Math.round(clip.samples[i] * 32_768)));
    }
    const store = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE);
    store.put({ pcm, rate: clip.rate, at: Date.now() }, clipKey(text));
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
