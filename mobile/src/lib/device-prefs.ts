import { useSyncExternalStore } from 'react';

/**
 * Choices that stay on this phone (not the account server): keep-awake during turn-by-turn, etc.
 * Defaults match the previous always-on navigation behavior.
 */
export type DevicePrefs = { keepAwake: boolean; siri: boolean };

const KEY = 'csimap.device';
const DEFAULTS: DevicePrefs = { keepAwake: true, siri: true };
const listeners = new Set<() => void>();

function load(): DevicePrefs {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Record<keyof DevicePrefs, unknown>>;
    return {
      keepAwake: typeof saved.keepAwake === 'boolean' ? saved.keepAwake : DEFAULTS.keepAwake,
      siri: typeof saved.siri === 'boolean' ? saved.siri : DEFAULTS.siri,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = load();

export const getDevicePrefs = () => prefs;

export function setDevicePref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]) {
  prefs = { ...prefs, [key]: value };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Kept for this visit only.
  }
  for (const listener of listeners) listener();
}

export function useDevicePrefs() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => prefs,
    () => prefs,
  );
}
