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
const VOICES = new Set(["af_heart", "am_michael"]);

type Voice = Parameters<KokoroTTS["generate"]>[1] extends { voice?: infer V } ? V : never;

type Request =
  | { type: "load" }
  | { type: "clear" }
  | { type: "promote"; id: number }
  | { type: "speak"; id: number; text: string; voice: string; soon?: boolean };

type Job = { id: number; text: string; voice: string; soon: boolean };

let model: Promise<KokoroTTS> | null = null;

// The smaller quantized model: about 90 MB, and it runs on any phone's CPU through WebAssembly.
function load() {
  model ??= KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm" }).catch((err: unknown) => {
    model = null;
    throw err;
  });
  return model;
}

// One line at a time. Lines for the route being walked go ahead of background ones, because making
// speech is slower than walking on a phone and only the next turn really matters.
const jobs: Job[] = [];
let busy = false;

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
    // A background line that the route now needs moves up with the other route lines.
    const index = jobs.findIndex((job) => job.id === message.id);
    if (index === -1 || jobs[index].soon) return;
    const [job] = jobs.splice(index, 1);
    job.soon = true;
    const at = jobs.findIndex((queued) => !queued.soon);
    if (at === -1) jobs.push(job);
    else jobs.splice(at, 0, job);
    return;
  }
  if (message?.type === "clear") {
    // A new route makes queued lines for the old one pointless. The page is told so it stops waiting.
    for (const job of jobs.splice(0)) self.postMessage({ type: "error", id: job.id });
    return;
  }
  if (
    message?.type !== "speak" ||
    !Number.isInteger(message.id) ||
    typeof message.text !== "string" ||
    !VOICES.has(message.voice)
  ) {
    return;
  }
  const job = { id: message.id, text: message.text.slice(0, MAX_TEXT), voice: message.voice, soon: message.soon === true };
  // Route lines keep the order they were asked in, ahead of every background line.
  const at = job.soon ? jobs.findIndex((queued) => !queued.soon) : -1;
  if (at === -1) jobs.push(job);
  else jobs.splice(at, 0, job);
  while (jobs.length > MAX_JOBS) {
    const dropped = jobs.pop();
    if (dropped) self.postMessage({ type: "error", id: dropped.id });
  }
  void work();
};
