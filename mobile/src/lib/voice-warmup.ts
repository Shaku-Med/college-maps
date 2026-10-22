import { voiceChoice } from '@/lib/voice';
import { bankClipPath } from '@/lib/voice-bank';
import {
  NATURAL_VOICES_AVAILABLE,
  hasDownloadedVoices,
  holdEngine,
  isWarm,
  loadVoiceBank,
  makeClip,
  markWarm,
  openEngineQuietly,
  protectClips,
} from '@/lib/voice-engine';
import { EVERYDAY_LINES } from '@/lib/voice-lines';
import { PREVIEW_LINE, isNaturalVoice, type NaturalVoiceId } from '@/lib/voice-options';

const LINES = [PREVIEW_LINE, ...EVERYDAY_LINES];
// Changes when an update changes the everyday lines, so each voice makes the new ones once.
const VERSION = `${LINES.length}.${[...LINES.join('|')].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)}`;

const running = new Map<NaturalVoiceId, Promise<void>>();

/** Gets the chosen voice's everyday lines once; quietly never starts the model's first download on mobile data. */
export function prepareEverydayVoice({ quietly }: { quietly: boolean }) {
  const voice = voiceChoice();
  if (!NATURAL_VOICES_AVAILABLE || !isNaturalVoice(voice)) return Promise.resolve();
  const current = running.get(voice);
  if (current) return current;
  const job = warmUp(voice, quietly).finally(() => running.delete(voice));
  running.set(voice, job);
  return job;
}

async function warmUp(voice: NaturalVoiceId, quietly: boolean) {
  await protectClips(voice, LINES);
  if (isWarm(voice, VERSION)) return;
  // Ready made lines are a few kilobytes each, so only the model waits for Wi-Fi.
  const bank = await loadVoiceBank();
  const needsModel = LINES.some((text) => !bankClipPath(bank, voice, text));
  const release = holdEngine();
  try {
    if (needsModel && quietly && !hasDownloadedVoices()) {
      const network = await openEngineQuietly();
      if (!network || network.cellular || network.saveData) return;
    }
    const clips = await Promise.all(LINES.map((text) => makeClip(voice, text, 2)));
    if (clips.every(Boolean)) markWarm(voice, VERSION);
  } finally {
    release();
  }
}
