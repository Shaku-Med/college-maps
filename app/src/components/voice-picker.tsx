"use client";

import { Button, Spinner, toast } from "@heroui/react";
import { AudioLines, Check, ChevronDown, Play } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import {
  VOICE_OPTIONS,
  idleVoiceStatus,
  previewVoice,
  subscribeVoiceStatus,
  voiceStatus,
  type VoiceId,
  type VoiceStatus,
} from "@/lib/voice";

type VoicePickerProps = {
  voice: VoiceId;
  savedTo: "account" | "device";
  onChoose: (id: VoiceId) => void;
};

function sampleProgress(status: VoiceStatus) {
  if (status.state === "ready") return { text: "Making a sample", percent: null };
  if (status.state === "loading" && status.percent !== null && status.percent < 100) {
    return { text: `Downloading voices, ${status.percent}%`, percent: status.percent };
  }
  return { text: "Starting the voices", percent: null };
}

export function VoicePicker({ voice, savedTo, onChoose }: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<VoiceId | null>(null);
  const status = useSyncExternalStore(subscribeVoiceStatus, voiceStatus, idleVoiceStatus);
  const current = VOICE_OPTIONS.find((option) => option.id === voice) ?? VOICE_OPTIONS[0];

  async function preview(id: VoiceId) {
    setPreviewing(id);
    const result = await previewVoice(id);
    setPreviewing((playing) => (playing === id ? null : playing));
    if (result === "unsupported") {
      toast.danger("That voice can't play on this device", { description: "Your phone's own voice will be used." });
    } else if (result === "failed") {
      toast.danger("That voice didn't load", { description: "Check your connection and try again." });
    }
  }

  return (
    <div className="rounded-2xl border border-separator">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          <AudioLines className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Navigation voice</p>
          <p className="truncate text-sm text-muted">{current.name}</p>
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="animate-fade-in border-t border-separator px-2 pb-2 pt-1.5">
          <ul role="radiogroup" aria-label="Navigation voice" className="flex flex-col gap-0.5">
            {VOICE_OPTIONS.map((option) => {
              const selected = option.id === voice;
              const progress = previewing === option.id && option.id !== "device" ? sampleProgress(status) : null;
              return (
                <li
                  key={option.id}
                  className={cn("flex items-center gap-1 rounded-xl pr-1.5 transition-colors", selected && "bg-accent-soft")}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChoose(option.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{option.name}</span>
                      <span className="block truncate text-xs text-muted">{progress?.text ?? option.description}</span>
                      {progress?.percent != null ? (
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-secondary">
                          <span
                            className="block h-full rounded-full bg-accent transition-[width] duration-300"
                            style={{ width: `${progress.percent}%` }}
                          />
                        </span>
                      ) : null}
                    </span>
                    {selected ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : null}
                  </button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={`Hear ${option.name}`}
                    isDisabled={previewing !== null && previewing !== option.id}
                    onPress={() => void preview(option.id)}>
                    {previewing === option.id ? <Spinner size="sm" /> : <Play aria-hidden />}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="px-3 pb-1 pt-2.5 text-xs leading-relaxed text-muted">
            Voices run on your phone. The first one downloads once, about 90 MB, and each one after that adds very
            little. {savedTo === "account" ? "Saved to your account." : "Saved on this device. Sign in to keep it on every device."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
