// The voices on offer, best first. Shared with the phone app, which runs the same model.
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
export type NaturalVoiceId = Exclude<VoiceId, "device">;

export const DEFAULT_VOICE: VoiceId = "af_heart";
export const PREVIEW_LINE = "In 100 feet, turn right.";

export const isVoiceId = (value: unknown): value is VoiceId =>
  typeof value === "string" && VOICE_OPTIONS.some((option) => option.id === value);

export const isNaturalVoice = (value: unknown): value is NaturalVoiceId => isVoiceId(value) && value !== "device";
