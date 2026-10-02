"use client";

import { toast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import type { AccountState } from "@/hooks/use-account";
import { prepareEverydayLines } from "@/hooks/use-voice-guidance";
import { settingsApi } from "@/lib/api";
import {
  DEFAULT_VOICE,
  isVoiceId,
  readVoiceChoice,
  saveVoiceChoice,
  selectVoice,
  type VoiceId,
} from "@/lib/voice";

/** The navigation voice. */
export function useVoiceChoice(account: AccountState) {
  const [voice, setVoice] = useState<VoiceId>(() => readVoiceChoice() ?? DEFAULT_VOICE);
  const signedIn = account.status === "signed-in";
  const who = account.status === "signed-in" ? account.user.username : null;

  useEffect(() => {
    selectVoice(voice);
  }, [voice]);

  useEffect(() => {
    if (!who) return;
    let cancelled = false;
    settingsApi.get().then((res) => {
      if (cancelled || !res.ok) return;
      if (isVoiceId(res.data.voice)) {
        saveVoiceChoice(res.data.voice);
        setVoice(res.data.voice);
        return;
      }
      const here = readVoiceChoice();
      if (here) void settingsApi.save(here);
    });
    return () => {
      cancelled = true;
    };
  }, [who]);

  const choose = useCallback(
    (next: VoiceId) => {
      setVoice(next);
      saveVoiceChoice(next);
      selectVoice(next);
      prepareEverydayLines();
      if (!signedIn) return;
      void settingsApi.save(next).then((res) => {
        if (!res.ok) toast.danger("Saved on this device, but not to your account", { description: res.message });
      });
    },
    [signedIn],
  );

  return { voice, choose, savedTo: signedIn ? ("account" as const) : ("device" as const) };
}
