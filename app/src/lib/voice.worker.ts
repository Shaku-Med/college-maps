// Runs the Kokoro voice model away from the page, so making speech never stutters the map.
import { env as transformers } from "@huggingface/transformers";
import { KokoroTTS, env } from "kokoro-js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
// One exact version of the model files. A later change to that repository, by accident or by someone who
// took it over, cannot change what devices download. Update it deliberately after listening to the result.
const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";

// Served from this site by scripts/copy-onnx-runtime.mjs instead of the CDN transformers.js defaults to.
env.wasmPaths = "/ort/";
transformers.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
const MAX_TEXT = 300;
const MAX_JOBS = 60;
const VOICES = new Set(["af_heart", "af_bella", "af_nicole", "bf_emma", "am_michael", "am_fenrir", "bm_george"]);

type Voice = Parameters<KokoroTTS["generate"]>[1] extends { voice?: infer V } ? V : never;

// 0 is a line being said right now, 1 a line for the route being walked, 2 a phrase made in the background.
type Priority = 0 | 1 | 2;

type Request =
  | { type: "load" }
  | { type: "clear" }
  | { type: "reset" }
  | { type: "promote"; id: number; priority: Priority }
  | { type: "speak"; id: number; text: string; voice: string; priority: Priority };

type Job = { id: number; text: string; voice: string; priority: Priority };

const isPriority = (value: unknown): value is Priority => value === 0 || value === 1 || value === 2;

let model: Promise<KokoroTTS> | null = null;

// The smaller quantized model: about 90 MB, and it runs on any phone's CPU through WebAssembly.
function load() {
  model ??= KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm" }).catch((err: unknown) => {
    model = null;
    throw err;
  });
  return model;
}

// One line at a time, most urgent first and in the order asked within each priority, because making speech
// is slower than walking on a phone and only the next thing to say really matters.
const jobs: Job[] = [];
let busy = false;

function enqueue(job: Job) {
  const at = jobs.findIndex((queued) => queued.priority > job.priority);
  if (at === -1) jobs.push(job);
  else jobs.splice(at, 0, job);
}

async function work() {
  if (busy) return;
  const job = jobs.shift();
  if (!job) return;
  busy = true;
  try {
    const tts = await load();
    const clip = await tts.generate(job.text, { voice: job.voice as Voice });
    const samples = clip.audio as Float32Array<ArrayBuffer>;
    self.postMessage({ type: "audio", id: job.id, samples, rate: clip.sampling_rate }, { transfer: [samples.buffer] });
  } catch {
    self.postMessage({ type: "error", id: job.id });
  } finally {
    busy = false;
    void work();
  }
}

self.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message?.type === "load") {
    load().then(
      () => self.postMessage({ type: "ready" }),
      () => self.postMessage({ type: "failed" }),
    );
    return;
  }
  if (message?.type === "promote") {
    // A line that is suddenly needed sooner moves up to where it now belongs.
    const index = jobs.findIndex((job) => job.id === message.id);
    if (index === -1 || !isPriority(message.priority) || jobs[index].priority <= message.priority) return;
    const [job] = jobs.splice(index, 1);
    job.priority = message.priority;
    enqueue(job);
    return;
  }
  if (message?.type === "reset") {
    // The voice changed, so lines queued for the old one are not wanted any more. Lines asked for right now,
    // like a sample someone is waiting to hear, are kept.
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].priority === 0) continue;
      const [job] = jobs.splice(i, 1);
      self.postMessage({ type: "error", id: job.id });
    }
    return;
  }
  if (message?.type === "clear") {
    // A new route makes the old route's queued lines pointless. Lines being said right now and background
    // phrases are kept: dropping them is how a reroute used to lose its own "Route updated".
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].priority !== 1) continue;
      const [job] = jobs.splice(i, 1);
      self.postMessage({ type: "error", id: job.id });
    }
    return;
  }
  if (message?.type !== "speak" || !Number.isInteger(message.id)) return;
  if (typeof message.text !== "string" || !VOICES.has(message.voice) || !isPriority(message.priority)) {
    // Answered, so the page is not left waiting on a line that will never come.
    self.postMessage({ type: "error", id: message.id });
    return;
  }
  enqueue({ id: message.id, text: message.text.slice(0, MAX_TEXT), voice: message.voice, priority: message.priority });
  while (jobs.length > MAX_JOBS) {
    const dropped = jobs.pop();
    if (dropped) self.postMessage({ type: "error", id: dropped.id });
  }
  void work();
};
