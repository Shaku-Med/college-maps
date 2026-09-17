// Spoken directions through the browser's own speech engine: free, on the device, and nothing is sent
// anywhere. How natural it sounds depends on the voices the phone ships with, so the best one is picked.

const STORAGE_KEY = "csimap.voice";

let chosen: SpeechSynthesisVoice | null | undefined;

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

// Neural and premium voices sound close to a person; the small offline ones sound robotic.
function score(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  let points = 0;
  if (!voice.lang.toLowerCase().startsWith("en")) return -1;
  if (voice.lang === "en-US") points += 10;
  if (/natural|neural/.test(name)) points += 50;
  if (/premium/.test(name)) points += 45;
  if (/enhanced/.test(name)) points += 40;
  if (/siri/.test(name)) points += 35;
  if (/google us english/.test(name)) points += 30;
  if (/samantha|ava|allison|zoe|evan|nathan|aria|jenny|guy/.test(name)) points += 20;
  if (/compact|espeak|robot/.test(name)) points -= 40;
  if (voice.default) points += 2;
  return points;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const points = score(voice);
    if (points > bestScore) {
      best = voice;
      bestScore = points;
    }
  }
  return best;
}

function voice() {
  // Some browsers fill the voice list a moment after the page loads.
  if (!chosen) chosen = pickVoice();
  return chosen;
}

if (voiceSupported()) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    chosen = pickVoice();
  });
}

/**
 * Says a line. Urgent lines, like the turn right now, cut off whatever is still being said so the
 * instruction never arrives late.
 */
export function speak(text: string, { urgent = false } = {}) {
  if (!voiceSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  if (urgent) synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 300));
  const picked = voice();
  if (picked) {
    utterance.voice = picked;
    utterance.lang = picked.lang;
  } else {
    utterance.lang = "en-US";
  }
  utterance.rate = 1;
  utterance.pitch = 1;
  synth.speak(utterance);
}

export function stopSpeaking() {
  if (voiceSupported()) window.speechSynthesis.cancel();
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
