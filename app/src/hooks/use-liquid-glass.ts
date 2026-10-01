"use client";

import { useSyncExternalStore } from "react";

import { GLASS_EVENT, GLASS_KEY } from "@/lib/appearance";

type GlassState = "unavailable" | "off" | "on";

function readGlass(): GlassState {
  const root = document.documentElement;
  if (!root.hasAttribute("data-liquid")) return "unavailable";
  return root.hasAttribute("data-glass") ? "on" : "off";
}

function subscribe(onChange: () => void) {
  window.addEventListener(GLASS_EVENT, onChange);
  return () => window.removeEventListener(GLASS_EVENT, onChange);
}

/** Liquid Glass is off unless the person turns it on, and is only offered on iOS 26 and later. */
export function useLiquidGlass() {
  const state = useSyncExternalStore(subscribe, readGlass, () => "unavailable" as const);

  function setOn(on: boolean) {
    const root = document.documentElement;
    if (!root.hasAttribute("data-liquid")) return;
    root.toggleAttribute("data-glass", on);
    try {
      if (on) localStorage.setItem(GLASS_KEY, "on");
      else localStorage.removeItem(GLASS_KEY);
    } catch {
      // Private browsing can block storage. The choice still holds until the page closes.
    }
    window.dispatchEvent(new Event(GLASS_EVENT));
  }

  return { available: state !== "unavailable", on: state === "on", setOn };
}
