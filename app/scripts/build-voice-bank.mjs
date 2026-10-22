// Makes every campus line in every natural voice ahead of time: public/voice-bank/<voice>/<id>.mp3 and manifest.json.
// Run it again after the places in campus.json or the spoken wording change, then commit public/voice-bank.
// Needs ffmpeg on PATH. Clips already made are kept, so a run after a small change only makes the new lines.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { APP_DIR, readCampus } from "./lib/campus.mjs";

const SRC_DIR = join(APP_DIR, "src");
const OUT_DIR = join(APP_DIR, "public", "voice-bank");
// Plenty for speech, and about 6 KB a second.
const BITRATE = "48k";

// The line wording lives in TypeScript shared with both apps, so this script reads it through the same "@/" paths.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    return nextResolve(pathToFileURL(join(SRC_DIR, `${specifier.slice(2)}.ts`)).href, context);
  },
});
const shared = (file) => import(pathToFileURL(join(SRC_DIR, "lib", file)).href);
const [{ bankLines }, { BANK_VERSION, MAX_BANK_CLIP_BYTES, VOICE_MODEL }, { VOICE_OPTIONS, isNaturalVoice }] = await Promise.all([
  shared("voice-lines.ts"),
  shared("voice-bank.ts"),
  shared("voice-options.ts"),
]);

if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg is needed on PATH to encode the clips");

const names = readCampus().places.map((place) => String(place.name).trim()).filter(Boolean);
const lines = bankLines(names);
const voices = VOICE_OPTIONS.map((option) => option.id).filter(isNaturalVoice);
// The model version is part of each name, so a new model never reuses a clip made by the old one.
const clipId = (text) => createHash("sha256").update(`${VOICE_MODEL.id}@${VOICE_MODEL.revision}|${text}`).digest("hex").slice(0, 16);
const ids = new Map(lines.map((text) => [text, clipId(text)]));
if (new Set(ids.values()).size !== ids.size) throw new Error("Two lines share a clip id; lengthen the id");

function encode(audio, rate) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0"]
      .concat(["-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", BITRATE, "-f", "mp3", "pipe:1"]),
    { input: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength), maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  if (result.stdout.length > MAX_BANK_CLIP_BYTES) throw new Error(`A clip came out at ${result.stdout.length} bytes`);
  return result.stdout;
}

let tts = null;
async function model() {
  if (tts) return tts;
  const [{ env }, { KokoroTTS }] = await Promise.all([import("@huggingface/transformers"), import("kokoro-js")]);
  env.remotePathTemplate = `{model}/resolve/${VOICE_MODEL.revision}/`;
  tts = await KokoroTTS.from_pretrained(VOICE_MODEL.id, { dtype: VOICE_MODEL.dtype, device: "cpu" });
  return tts;
}

let made = 0;
let removed = 0;
for (const voice of voices) {
  const folder = join(OUT_DIR, voice);
  mkdirSync(folder, { recursive: true });
  const wanted = new Set([...ids.values()].map((id) => `${id}.mp3`));
  for (const file of readdirSync(folder)) {
    if (wanted.has(file)) continue;
    rmSync(join(folder, file));
    removed++;
  }
  for (const [text, id] of ids) {
    const file = join(folder, `${id}.mp3`);
    if (existsSync(file)) continue;
    const clip = await (await model()).generate(text, { voice });
    writeFileSync(file, encode(clip.audio, clip.sampling_rate));
    made++;
    if (made % 50 === 0) console.log(`${made} clips made, now on ${voice}`);
  }
}

const sorted = Object.fromEntries([...ids].sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify({ version: BANK_VERSION, voices, lines: sorted }, null, 1)}\n`);
console.log(`${lines.length} lines in ${voices.length} voices: ${made} clips made, ${removed} old ones removed`);
