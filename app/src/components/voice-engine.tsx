"use client";

import { useEffect } from "react";

import { isNaturalVoice } from "@/lib/voice-options";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
    csimapVoice?: (message: unknown) => void;
  }
}

const MAX_TEXT = 300;
// Where transformers.js keeps the model and kokoro-js keeps each voice.
const MODEL_CACHES = ["transformers-cache", "kokoro-voices"];

type Command =
  | { type: "load" }
  | { type: "clear" }
  | { type: "reset" }
  | { type: "forget" }
  | { type: "promote"; id: number; priority: 0 | 1 | 2 }
  | { type: "speak"; id: number; text: string; voice: string; priority: 0 | 1 | 2 };

const isPriority = (value: unknown): value is 0 | 1 | 2 => value === 0 || value === 1 || value === 2;
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function parseCommand(raw: unknown): Command | null {
  if (typeof raw !== "object" || raw === null) return null;
  const message = raw as Record<string, unknown>;
  switch (message.type) {
    case "load":
    case "clear":
    case "reset":
    case "forget":
      return { type: message.type };
    case "promote":
      return isId(message.id) && isPriority(message.priority) ? { type: "promote", id: message.id, priority: message.priority } : null;
    case "speak":
      if (!isId(message.id) || !isPriority(message.priority) || !isNaturalVoice(message.voice)) return null;
      if (typeof message.text !== "string" || !message.text.trim()) return null;
      return { type: "speak", id: message.id, text: message.text.slice(0, MAX_TEXT), voice: message.voice, priority: message.priority };
    default:
      return null;
  }
}

// 16 bit mono WAV: what phones play natively, half the size of float audio and no audible difference for speech.
function wavBase64(samples: Float32Array, rate: number) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-32_768, Math.min(32_767, Math.round(samples[i] * 32_768))), true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Some web views attach the app's bridge a moment after the page's own scripts start.
const BRIDGE_WAIT_MS = 10_000;
const BRIDGE_POLL_MS = 250;

type Bridge = NonNullable<Window["ReactNativeWebView"]>;

function runEngine(bridge: Bridge) {
  const send = (message: object) => bridge.postMessage(JSON.stringify(message));

  let worker: Worker;
  try {
    worker = new Worker(new URL("../lib/voice.worker.ts", import.meta.url), { type: "module" });
  } catch {
    send({ type: "failed" });
    return () => undefined;
  }
  worker.onerror = () => send({ type: "failed" });
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as { type?: unknown; id?: unknown; samples?: unknown; rate?: unknown; percent?: unknown };
    if (message.type === "audio" && isId(message.id) && message.samples instanceof Float32Array) {
      const rate = Number.isInteger(message.rate) && (message.rate as number) >= 8_000 && (message.rate as number) <= 48_000 ? (message.rate as number) : 24_000;
      send({ type: "audio", id: message.id, wav: wavBase64(message.samples, rate) });
    } else if (message.type === "error" && isId(message.id)) {
      send({ type: "error", id: message.id });
    } else if (message.type === "progress" && typeof message.percent === "number") {
      send({ type: "progress", percent: Math.max(0, Math.min(100, Math.round(message.percent))) });
    } else if (message.type === "ready" || message.type === "failed") {
      send({ type: message.type });
    }
  };

  window.csimapVoice = (raw) => {
    const command = parseCommand(raw);
    if (!command) return;
    if (command.type !== "forget") {
      worker.postMessage(command);
      return;
    }
    void (async () => {
      try {
        await Promise.all(MODEL_CACHES.map((name) => caches.delete(name)));
      } catch {
        // No Cache Storage here, so there was nothing kept.
      }
      send({ type: "forgotten" });
    })();
  };
  // The app only starts the first download quietly when the phone is not on mobile data or saving data.
  const connection = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  send({ type: "engine", cellular: connection?.type === "cellular", saveData: connection?.saveData === true });

  return () => {
    worker.terminate();
    delete window.csimapVoice;
  };
}

/** Runs the voice model for the phone app, which shows this page in a hidden web view and keeps the clips it makes. */
export function VoiceEngine() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    const attach = () => {
      const bridge = window.ReactNativeWebView;
      if (bridge) stop = runEngine(bridge);
      return Boolean(bridge);
    };
    if (attach()) return () => stop?.();
    let waited = 0;
    const timer = setInterval(() => {
      waited += BRIDGE_POLL_MS;
      if (attach() || waited >= BRIDGE_WAIT_MS) clearInterval(timer);
    }, BRIDGE_POLL_MS);
    return () => {
      clearInterval(timer);
      stop?.();
    };
  }, []);

  return <main className="p-6 text-sm text-muted">CSI Map voice engine. This page only works inside the CSI Map app.</main>;
}
