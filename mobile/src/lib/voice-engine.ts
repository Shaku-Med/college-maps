import type { DomWebViewRef } from '@expo/dom-webview';
import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { WEB_ORIGIN } from '@/lib/links';
import type { NaturalVoiceId } from '@/lib/voice-options';

// The natural voices run on the website's voice engine page inside a hidden web view; the clips it makes are kept as files.
const devOrigin = __DEV__ ? (process.env.EXPO_PUBLIC_VOICE_ENGINE_ORIGIN ?? '') : '';
export const ENGINE_URL = `${/^https?:\/\/[\w.-]+(:\d+)?$/.test(devOrigin) ? devOrigin : WEB_ORIGIN}/voice-engine`;

// A build without the web view's native code would crash drawing it, so it keeps the phone's voice instead.
export const NATURAL_VOICES_AVAILABLE = requireOptionalNativeModule('ExpoDomWebViewModule') !== null;

// The model and its version are part of the folder, so a new model never replays clips made by the old one.
const CLIP_ROOT = ['voice-clips', 'kokoro-82m-q8'];
const MAX_CLIPS_PER_VOICE = 300;
const DOWNLOADED_KEY = 'csimap.voice.downloaded';
const MAX_WAV_BASE64 = 3_000_000;
// A busy engine silent this long is stuck, and is reloaded instead of holding up every line.
const STALL_MS = 60_000;
const MAX_RELOADS = 3;

type Priority = 0 | 1 | 2;
export type EngineState = 'off' | 'loading' | 'ready' | 'failed';
export type EngineStatus = { state: EngineState; percent: number | null };
type Host = { wanted: boolean; generation: number };

let status: EngineStatus = { state: 'off', percent: null };
let host: Host = { wanted: false, generation: 0 };
const listeners = new Set<() => void>();

let view: DomWebViewRef | null = null;
let pageReady = false;
let outbox: object[] = [];
let nextId = 1;
let lastHeard = 0;
let reloads = 0;
let watchdog: ReturnType<typeof setInterval> | undefined;
let writes = 0;

const waiting = new Map<number, { voice: NaturalVoiceId; text: string; resolve: (uri: string | null) => void }>();
const inflight = new Map<string, { job: Promise<string | null>; id?: number; priority: Priority }>();
const known = new Map<string, string>();

function notify() {
  for (const listener of listeners) listener();
}

function setStatus(state: EngineState, percent: number | null = null) {
  if (status.state === state && status.percent === percent) return;
  status = { state, percent };
  notify();
}

function setHost(next: Partial<Host>) {
  host = { ...host, ...next };
  notify();
}

function rememberDownload(on: boolean) {
  try {
    if (on) globalThis.localStorage?.setItem(DOWNLOADED_KEY, '1');
    else globalThis.localStorage?.removeItem(DOWNLOADED_KEY);
  } catch {
    // Only decides whether Remove is offered.
  }
}

/** Whether the model was downloaded on this phone, so it can be offered for removal. */
export function hasDownloadedVoices() {
  try {
    return globalThis.localStorage?.getItem(DOWNLOADED_KEY) === '1';
  } catch {
    return false;
  }
}

export function subscribeEngine(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const engineStatus = () => status;
export const engineHost = () => host;

function send(message: object) {
  if (!view || !pageReady) {
    outbox.push(message);
    return;
  }
  const json = JSON.stringify(JSON.stringify(message));
  view.injectJavaScript(`window.csimapVoice && window.csimapVoice(JSON.parse(${json})); true;`);
}

const busy = () => status.state === 'loading' || waiting.size > 0;

function watch() {
  if (!busy()) lastHeard = Date.now();
  watchdog ??= setInterval(() => {
    if (!busy()) {
      clearInterval(watchdog);
      watchdog = undefined;
    } else if (Date.now() - lastHeard > STALL_MS) {
      engineGone();
    }
  }, 5_000);
}

/** Mounts the hidden engine and starts loading the model, about 90 MB the first time and kept by the web view after. */
export function startEngine() {
  if (!NATURAL_VOICES_AVAILABLE) {
    setStatus('failed');
    return;
  }
  if (status.state === 'failed' && reloads < MAX_RELOADS) setStatus('off');
  if (status.state === 'failed') return;
  if (!host.wanted) setHost({ wanted: true });
  if (status.state === 'off') {
    setStatus('loading');
    watch();
    send({ type: 'load' });
  }
}

/** After a failed download, starts over from a fresh web view. */
export function retryEngine() {
  if (!NATURAL_VOICES_AVAILABLE) return;
  reloads = 0;
  pageReady = false;
  outbox = [];
  setStatus('off');
  setHost({ wanted: true, generation: host.generation + 1 });
  startEngine();
}

export function registerEngine(ref: DomWebViewRef | null) {
  view = ref;
  if (!ref) pageReady = false;
}

// The phone stopped the web view to free memory, or it hung: start it again, a few times at most.
export function engineGone() {
  pageReady = false;
  outbox = [];
  for (const entry of waiting.values()) entry.resolve(null);
  waiting.clear();
  reloads++;
  setStatus(reloads >= MAX_RELOADS ? 'failed' : 'off');
  if (host.wanted && reloads < MAX_RELOADS) setHost({ generation: host.generation + 1 });
}

export function handleEngineMessage(data: string) {
  let message: { type?: unknown; id?: unknown; wav?: unknown; percent?: unknown };
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }
  lastHeard = Date.now();
  switch (message.type) {
    case 'engine': {
      if (pageReady) return;
      pageReady = true;
      const queued = outbox;
      outbox = [];
      for (const item of queued) send(item);
      return;
    }
    case 'progress':
      if (status.state === 'loading' && typeof message.percent === 'number') {
        setStatus('loading', Math.max(0, Math.min(100, Math.round(message.percent))));
      }
      return;
    case 'ready':
      reloads = 0;
      rememberDownload(true);
      setStatus('ready');
      return;
    case 'failed':
      engineGone();
      return;
    case 'forgotten':
      onForgotten?.();
      return;
    case 'audio':
    case 'error': {
      if (typeof message.id !== 'number') return;
      const entry = waiting.get(message.id);
      if (!entry) return;
      waiting.delete(message.id);
      const wav = message.type === 'audio' && typeof message.wav === 'string' && message.wav.length <= MAX_WAV_BASE64 ? message.wav : null;
      if (!wav) {
        entry.resolve(null);
        return;
      }
      void saveClip(entry.voice, entry.text, wav).then(entry.resolve, () => entry.resolve(null));
    }
  }
}

const clipKey = (voice: NaturalVoiceId, text: string) => `${voice}|${text}`;
const voiceFolder = (voice: NaturalVoiceId) => new Directory(Paths.document, ...CLIP_ROOT, voice);

async function clipFile(voice: NaturalVoiceId, text: string) {
  const name = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, clipKey(voice, text));
  return new File(voiceFolder(voice), `${name}.wav`);
}

async function saveClip(voice: NaturalVoiceId, text: string, wav: string) {
  const folder = voiceFolder(voice);
  if (!folder.exists) folder.create({ intermediates: true });
  const file = await clipFile(voice, text);
  if (!file.exists) file.create();
  file.write(wav, { encoding: 'base64' });
  known.set(clipKey(voice, text), file.uri);
  if (++writes % 25 === 0) prune(folder);
  return file.uri;
}

// Oldest clips go first once a voice has made more than it needs.
function prune(folder: Directory) {
  try {
    const files = folder.list().filter((entry): entry is File => entry instanceof File);
    const extra = files.length - MAX_CLIPS_PER_VOICE;
    if (extra <= 0) return;
    files.sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
    for (const file of files.slice(0, extra)) {
      for (const [key, uri] of known) if (uri === file.uri) known.delete(key);
      file.delete();
    }
  } catch {
    // Pruning only saves space; a failure here never affects speaking.
  }
}

/** A clip already made for this line, from memory or from the phone's storage. */
export async function storedClip(voice: NaturalVoiceId, text: string) {
  const key = clipKey(voice, text);
  const remembered = known.get(key);
  if (remembered) return remembered;
  try {
    const file = await clipFile(voice, text);
    if (!file.exists) return null;
    known.set(key, file.uri);
    return file.uri;
  } catch {
    return null;
  }
}

/** Makes a clip, or finds the one already made. 0 is a line said right now, 1 the route being walked, 2 the background. */
export function makeClip(voice: NaturalVoiceId, text: string, priority: Priority): Promise<string | null> {
  const key = clipKey(voice, text);
  const pending = inflight.get(key);
  if (pending) {
    if (priority < pending.priority) {
      pending.priority = priority;
      if (pending.id !== undefined) send({ type: 'promote', id: pending.id, priority });
    }
    return pending.job;
  }
  const entry: { job: Promise<string | null>; id?: number; priority: Priority } = { job: Promise.resolve(null), priority };
  entry.job = (async () => {
    const stored = await storedClip(voice, text);
    if (stored) return stored;
    startEngine();
    if (status.state === 'failed') return null;
    const id = nextId++;
    entry.id = id;
    return new Promise<string | null>((resolve) => {
      watch();
      waiting.set(id, { voice, text, resolve });
      send({ type: 'speak', id, text, voice, priority: entry.priority });
    });
  })().finally(() => inflight.delete(key));
  inflight.set(key, entry);
  return entry.job;
}

/** Drops route lines still waiting to be made, such as the rest of a route that was just replaced. */
export function clearQueuedClips() {
  send({ type: 'clear' });
}

/** Drops everything queued for the old voice after switching. */
export function resetQueuedClips() {
  send({ type: 'reset' });
}

let onForgotten: (() => void) | null = null;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deletes the downloaded model and every clip, and stops the engine. The engine page holds the model, so it is opened if needed. */
export async function forgetNaturalVoices() {
  if (!host.wanted && NATURAL_VOICES_AVAILABLE) setHost({ wanted: true });
  for (let waited = 0; !pageReady && waited < 10_000; waited += 250) await wait(250);
  if (pageReady) {
    await Promise.race([
      new Promise<void>((resolve) => {
        onForgotten = resolve;
        send({ type: 'forget' });
      }),
      wait(5_000),
    ]);
    onForgotten = null;
  }
  known.clear();
  try {
    const root = new Directory(Paths.document, CLIP_ROOT[0]);
    if (root.exists) root.delete();
  } catch {
    // Nothing kept, or already gone.
  }
  for (const entry of waiting.values()) entry.resolve(null);
  waiting.clear();
  pageReady = false;
  outbox = [];
  reloads = 0;
  rememberDownload(false);
  setStatus('off');
  setHost({ wanted: false, generation: host.generation + 1 });
}
