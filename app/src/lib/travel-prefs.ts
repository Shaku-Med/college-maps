import { useSyncExternalStore } from "react";

// Kept in this browser only; the phone app keeps its own copy in its device settings.
const KEY = "csimap.autoTravel";
const listeners = new Set<() => void>();

/** Whether a street trip switches between driving and walking on its own. On unless turned off. */
export function autoTravelOn() {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoTravel(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Kept for this visit only.
  }
  for (const listener of listeners) listener();
}

export function useAutoTravel() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    autoTravelOn,
    () => true,
  );
}
