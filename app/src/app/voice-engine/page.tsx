import type { Metadata } from "next";

import { VoiceEngine } from "@/components/voice-engine";

export const metadata: Metadata = {
  title: "Voice engine",
  robots: { index: false, follow: false },
};

export default function VoiceEnginePage() {
  return <VoiceEngine />;
}
