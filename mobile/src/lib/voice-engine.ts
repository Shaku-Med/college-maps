import type { DomWebViewRef } from '@expo/dom-webview';
import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { WEB_ORIGIN } from '@/lib/links';
import { BANK_MANIFEST_PATH, MAX_BANK_CLIP_BYTES, bankClipPath, parseBankManifest, type VoiceBank } from '@/lib/voice-bank';
import { VOICE_OPTIONS, isNaturalVoice, type NaturalVoiceId } from '@/lib/voice-options';

// The natural voices run on the website's voice engine page inside a hidden web view; the clips it makes are kept as files.
// The campus lines come ready made from the same site.
const devOrigin = __DEV__ ? (process.env.EXPO_PUBLIC_VOICE_ENGINE_ORIGIN ?? '') : '';
const VOICE_ORIGIN = /^https?:\/\/[\w.-]+(:\d+)?$/.test(devOrigin) ? devOrigin : WEB_ORIGIN;
export const ENGINE_URL = `${VOICE_ORIGIN}/voice-engine`;

// A build without the web view's native code would crash drawing it, so it keeps the phone's voice instead.
export const NATURAL_VOICES_AVAILABLE = requireOptionalNativeModule('ExpoDomWebViewModule') !== null;

// The model and its version are part of the folder, so a new model never replays clips made by the old one.
const CLIP_ROOT = ['voice-clips', 'kokoro-82m-q8'];
const MAX_CLIPS_PER_VOICE = 300;
const DOWNLOADED_KEY = 'csimap.voice.downloaded';
const MAX_WAV_BASE64 = 3_000_000;
// A busy engine silent this long is stuck, and is reloaded instead of holding up every line.
const STALL_MS = 60_000;
// A page that has not said hello by now is the wrong page or never loaded, such as with no connection.
const HELLO_MS = 20_000;
const MAX_RELOADS = 3;
// A missing manifest is asked for again after this long, not on every line.
const BANK_RETRY_MS = 30_000;
const MAX_MANIFEST_CHARS = 500_000;

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
let helloTimer: ReturnType<typeof setTimeout> | undefined;
let writes = 0;
// Things using the engine right now, such as directions being planned or followed. With none, it unloads.
let holders = 0;

export type Network = { cellular: boolean; saveData: boolean };
let network: Network | null = null;
let helloWaiters: ((info: Network | null) => void)[] = [];
const protectedNames = new Set<string>();

const waiting = new Map<number, { voice: NaturalVoiceId; text: string; priority: Priority; resolve: (uri: string | null) => void }>();
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
    expectHello();
    send({ type: 'load' });
  }
}

function expectHello() {
  clearTimeout(helloTimer);
  helloTimer = setTimeout(() => {
    if (!pageReady && host.wanted) engineGone();
  }, HELLO_MS);
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

/** Keeps the engine loaded while something needs it, and returns the function that lets go. */
export function holdEngine() {
  holders++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders--;
    // Lines queued for a trip nobody is on any more are dropped; a line someone is waiting to hear is kept.
    if (holders === 0 && waiting.size > 0) send({ type: 'reset' });
    releaseIfIdle();
  };
}

// Nothing needs the engine, so it unloads and the model stops taking memory until the next trip.
function releaseIfIdle() {
  if (holders > 0 || waiting.size > 0 || !host.wanted) return;
  clearTimeout(helloTimer);
  pageReady = false;
  outbox = [];
  for (const resolve of helloWaiters) resolve(null);
  helloWaiters = [];
  if (status.state !== 'failed') setStatus('off');
  setHost({ wanted: false });
}

/** Opens the engine page without loading the model, to learn about the connection before any download. */
export function openEngineQuietly(): Promise<Network | null> {
  if (!NATURAL_VOICES_AVAILABLE) return Promise.resolve(null);
  if (pageReady) return Promise.resolve(network);
  if (!host.wanted) setHost({ wanted: true });
  return new Promise((resolve) => {
    const answer = (info: Network | null) => {
      clearTimeout(timer);
      resolve(info);
    };
    const timer = setTimeout(() => {
      helloWaiters = helloWaiters.filter((waiter) => waiter !== answer);
      resolve(null);
    }, HELLO_MS);
    helloWaiters.push(answer);
  });
}

// The page never loaded, the phone stopped the web view to free memory, or it hung: start it again, a few times at most.
export function engineGone() {
  pageReady = false;
  outbox = [];
  clearTimeout(helloTimer);
  reloads++;
  const needed = host.wanted && (holders > 0 || waiting.size > 0);
  if (reloads >= MAX_RELOADS || !needed) {
    for (const entry of waiting.values()) entry.resolve(null);
    waiting.clear();
    setStatus(needed ? 'failed' : 'off');
    setHost({ wanted: false });
    return;
  }
  // A fresh web view is asked again for every line still waiting, so nobody is told it failed while it retries.
  setStatus('loading');
  lastHeard = Date.now();
  send({ type: 'load' });
  for (const [id, entry] of waiting) send({ type: 'speak', id, text: entry.text, voice: entry.voice, priority: entry.priority });
  expectHello();
  setHost({ generation: host.generation + 1 });
}

export function handleEngineMessage(data: string) {
  let message: { type?: unknown; id?: unknown; wav?: unknown; percent?: unknown; cellular?: unknown; saveData?: unknown };
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
      clearTimeout(helloTimer);
      network = { cellular: message.cellular === true, saveData: message.saveData === true };
      for (const resolve of helloWaiters) resolve(network);
      helloWaiters = [];
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
      if (wav) void saveClip(entry.voice, entry.text, wav).then(entry.resolve, () => entry.resolve(null));
      else entry.resolve(null);
      releaseIfIdle();
    }
  }
}

const clipKey = (voice: NaturalVoiceId, text: string) => `${voice}|${text}`;
const voiceFolder = (voice: NaturalVoiceId) => new Directory(Paths.document, ...CLIP_ROOT, voice);
const clipName = (voice: NaturalVoiceId, text: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, clipKey(voice, text));

// Lines the engine makes are WAV files; ready made ones from the site are MP3.
async function clipFile(voice: NaturalVoiceId, text: string, kind: 'wav' | 'mp3' = 'wav') {
  return new File(voiceFolder(voice), `${await clipName(voice, text)}.${kind}`);
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

/** Keeps these lines through pruning, such as the stand ins every trip falls back on. */
export async function protectClips(voice: NaturalVoiceId, texts: readonly string[]) {
  for (const text of texts) {
    try {
      const name = await clipName(voice, text);
      protectedNames.add(`${name}.wav`).add(`${name}.mp3`);
    } catch {
      // Unprotected lines can still be made again if pruned.
    }
  }
}

const warmKey = (voice: NaturalVoiceId) => `csimap.voice.warm.${voice}`;

/** Whether this voice already made its everyday lines, so opening the app has nothing left to do. */
export function isWarm(voice: NaturalVoiceId, version: string) {
  try {
    return globalThis.localStorage?.getItem(warmKey(voice)) === version;
  } catch {
    return false;
  }
}

export function markWarm(voice: NaturalVoiceId, version: string) {
  try {
    globalThis.localStorage?.setItem(warmKey(voice), version);
  } catch {
    // Checked again next launch, which only finds the clips already made.
  }
}

// Oldest clips go first once a voice has made more than it needs; protected lines always stay.
function prune(folder: Directory) {
  try {
    const files = folder.list().filter((entry): entry is File => entry instanceof File && !protectedNames.has(entry.name));
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
    const name = await clipName(voice, text);
    const file = [new File(voiceFolder(voice), `${name}.wav`), new File(voiceFolder(voice), `${name}.mp3`)].find((kept) => kept.exists);
    if (!file) return null;
    known.set(key, file.uri);
    return file.uri;
  } catch {
    return null;
  }
}

// ---- Ready made campus lines ------------------------------------------------------------------------

let bank: VoiceBank | null = null;
let bankLoading: Promise<VoiceBank | null> | null = null;
let bankFresh = false;
let bankFailedAt = Number.NEGATIVE_INFINITY;
const bankCopy = () => new File(Paths.document, ...CLIP_ROOT, 'bank-manifest.json');

function readBankCopy() {
  try {
    const copy = bankCopy();
    return copy.exists ? parseBankManifest(JSON.parse(copy.textSync())) : null;
  } catch {
    return null;
  }
}

// Asked for once a launch; the copy kept from last time works offline in the meantime.
function refreshBank() {
  if (bankLoading || bankFresh || Date.now() - bankFailedAt < BANK_RETRY_MS) return bankLoading;
  bankLoading = fetch(`${VOICE_ORIGIN}${BANK_MANIFEST_PATH}`, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.text() : null))
    .then((text) => {
      const fresh = text && text.length <= MAX_MANIFEST_CHARS ? parseBankManifest(JSON.parse(text)) : null;
      if (!fresh || !text) throw new Error('No usable manifest');
      bank = fresh;
      bankFresh = true;
      const copy = bankCopy();
      if (!copy.parentDirectory.exists) copy.parentDirectory.create({ intermediates: true });
      if (!copy.exists) copy.create();
      copy.write(text);
      return fresh;
    })
    .catch(() => {
      bankFailedAt = Date.now();
      return bank;
    })
    .finally(() => {
      bankLoading = null;
    });
  return bankLoading;
}

/** The list of ready made campus lines, from the copy kept on the phone or the site. */
export function loadVoiceBank(): Promise<VoiceBank | null> {
  bank ??= readBankCopy();
  const fresh = refreshBank();
  return bank ? Promise.resolve(bank) : (fresh ?? Promise.resolve(null));
}

export const isBanked = (voice: NaturalVoiceId, text: string) => bankClipPath(bank, voice, text) !== null;

// Saved beside the clips the engine makes, so it plays offline from then on.
async function fetchBankClip(voice: NaturalVoiceId, text: string) {
  const path = bankClipPath(await loadVoiceBank(), voice, text);
  if (!path) return null;
  try {
    const response = await fetch(`${VOICE_ORIGIN}${path}`);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BANK_CLIP_BYTES) return null;
    const folder = voiceFolder(voice);
    if (!folder.exists) folder.create({ intermediates: true });
    const file = await clipFile(voice, text, 'mp3');
    if (!file.exists) file.create();
    file.write(bytes);
    known.set(clipKey(voice, text), file.uri);
    if (++writes % 25 === 0) prune(folder);
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
      if (pending.id !== undefined) {
        const queued = waiting.get(pending.id);
        if (queued) queued.priority = priority;
        send({ type: 'promote', id: pending.id, priority });
      }
    }
    return pending.job;
  }
  const entry: { job: Promise<string | null>; id?: number; priority: Priority } = { job: Promise.resolve(null), priority };
  entry.job = (async () => {
    const stored = (await storedClip(voice, text)) ?? (await fetchBankClip(voice, text));
    if (stored) return stored;
    startEngine();
    if (status.state === 'failed') return null;
    const id = nextId++;
    entry.id = id;
    return new Promise<string | null>((resolve) => {
      watch();
      waiting.set(id, { voice, text, priority: entry.priority, resolve });
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
  for (const option of VOICE_OPTIONS) {
    try {
      if (isNaturalVoice(option.id)) globalThis.localStorage?.removeItem(warmKey(option.id));
    } catch {
      // A stale mark only skips the quiet warm up; the lines are still made on the next trip.
    }
  }
  setStatus('off');
  setHost({ wanted: false, generation: host.generation + 1 });
}
