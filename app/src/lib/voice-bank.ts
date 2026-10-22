// Ready made clips of the campus lines in every natural voice, made by scripts/build-voice-bank.mjs and served by this site.
import { isNaturalVoice, type NaturalVoiceId } from "@/lib/voice-options";

/** The model every voice clip comes from, on the phone, in the browser, and in the bank. */
export const VOICE_MODEL = {
  id: "onnx-community/Kokoro-82M-v1.0-ONNX",
  // Pinned to one model version, so a change to that repository cannot change what devices download.
  revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
  dtype: "q8",
} as const;

export const BANK_VERSION = 1;
export const BANK_MANIFEST_PATH = "/voice-bank/manifest.json";
// A bank clip is a few seconds of speech, a few kilobytes; anything far bigger is not one.
export const MAX_BANK_CLIP_BYTES = 200_000;
const MAX_LINES = 2_000;
const MAX_TEXT = 300;
const CLIP_ID = /^[0-9a-f]{16}$/;

export type VoiceBank = { voices: ReadonlySet<NaturalVoiceId>; lines: ReadonlyMap<string, string> };

/** Checks a downloaded manifest strictly, so nothing from the network can name a file outside the bank. */
export function parseBankManifest(value: unknown): VoiceBank | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { version, voices, lines } = value as { version?: unknown; voices?: unknown; lines?: unknown };
  if (version !== BANK_VERSION || !Array.isArray(voices) || !lines || typeof lines !== "object" || Array.isArray(lines)) return null;
  if (!voices.every(isNaturalVoice)) return null;
  const entries = Object.entries(lines);
  if (entries.length > MAX_LINES) return null;
  const map = new Map<string, string>();
  for (const [text, id] of entries) {
    if (typeof id !== "string" || !CLIP_ID.test(id) || text.length === 0 || text.length > MAX_TEXT) return null;
    map.set(text, id);
  }
  return { voices: new Set(voices), lines: map };
}

/** The clip for this line in this voice, when the bank has one. */
export function bankClipPath(bank: VoiceBank | null, voice: NaturalVoiceId, text: string) {
  const id = bank?.voices.has(voice) ? bank.lines.get(text) : undefined;
  return id ? `/voice-bank/${voice}/${id}.mp3` : null;
}
