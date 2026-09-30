import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { API_ORIGIN } from '@/lib/config';

// Pure JS reachability — no native NetInfo module, so OTA / existing dev builds keep working.
// Any HTTP response (even 404) means the phone can reach the network; a throw means offline.

const PING_MS = 4_000;
const RECHECK_ONLINE_MS = 30_000;
const RECHECK_OFFLINE_MS = 5_000;

let online = true;
const listeners = new Set<() => void>();
let probing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function setOnline(next: boolean) {
  if (next === online) return;
  online = next;
  emit();
  schedule();
}

async function ping(method: 'HEAD' | 'GET') {
  const controller = new AbortController();
  const kill = setTimeout(() => controller.abort(), PING_MS);
  try {
    await fetch(API_ORIGIN, { method, signal: controller.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(kill);
  }
}

async function probe() {
  if (probing) return;
  probing = true;
  try {
    // Some hosts reject HEAD; fall through to GET. Status codes do not matter.
    if (await ping('HEAD')) {
      setOnline(true);
      return;
    }
    setOnline(await ping('GET'));
  } finally {
    probing = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void probe();
  }, online ? RECHECK_ONLINE_MS : RECHECK_OFFLINE_MS);
}

/** Call from API helpers when a request clearly reaches or cannot reach the network. */
export function noteNetworkResult(reached: boolean) {
  setOnline(reached);
}

function subscribe(listener: () => void) {
  const wasEmpty = listeners.size === 0;
  listeners.add(listener);
  if (wasEmpty) {
    void probe();
    schedule();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

AppState.addEventListener('change', (next) => {
  if (next === 'active') void probe();
});

/** Live connection for the phone: can we reach the CSI Map servers. */
export function useOnline() {
  return useSyncExternalStore(subscribe, () => online, () => true);
}
