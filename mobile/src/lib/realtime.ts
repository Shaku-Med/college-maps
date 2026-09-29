import { fetch as streamingFetch } from 'expo/fetch';
import { AppState } from 'react-native';

import type { Coordinate } from '@/data/campus';
import { APP_CLIENT_HEADERS, REALTIME_ORIGIN } from '@/lib/config';
import { socialApi } from '@/lib/social-api';

export type LivePosition = {
  member: string;
  name: string;
  coordinate: Coordinate;
  accuracy: number;
  heading?: number;
  at: number;
};

type Handlers = {
  onPositions: (positions: LivePosition[]) => void;
  onState: (state: 'connecting' | 'live' | 'offline') => void;
  /** True while this account is sharing from another phone or browser instead of this one. */
  onElsewhere?: (elsewhere: boolean) => void;
};

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 20_000;
// Passes last 10 minutes, so a new one well before that keeps the stream from dropping.
const RENEW_BEFORE_MS = 90_000;
// One event is a few hundred bytes. Anything far bigger is not from the realtime server.
const MAX_BUFFER = 64_000;

function readPosition(raw: unknown): LivePosition | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p.member !== 'string' || typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return {
    member: p.member,
    name: typeof p.name === 'string' ? p.name.slice(0, 60) : '',
    coordinate: { latitude: p.lat, longitude: p.lng },
    accuracy: typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) ? p.accuracy : 0,
    heading: typeof p.heading === 'number' && Number.isFinite(p.heading) ? p.heading : undefined,
    at: typeof p.at === 'number' && Number.isFinite(p.at) ? p.at : Date.now(),
  };
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function retryDelay(attempt: number) {
  const wait = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(attempt, 6));
  return wait * (0.5 + Math.random());
}

// A random id for this phone or browser, so one account signed in on two of them shares its location from
// one place at a time instead of jumping between both.
const DEVICE_KEY = 'csimap.device';
const DEVICE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
let sessionDevice: string | null = null;

function deviceId() {
  try {
    const saved = globalThis.localStorage?.getItem(DEVICE_KEY);
    if (saved && DEVICE_PATTERN.test(saved)) return saved;
    const made = crypto.randomUUID();
    globalThis.localStorage?.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    sessionDevice ??= crypto.randomUUID();
    return sessionDevice;
  }
}

/**
 * The phone's version of the web app's live meetup connection: it streams everyone else's positions and sends
 * yours, renewing the pass before it runs out. React Native has no EventSource, so the event stream is read
 * from a streaming fetch. Nothing is stored anywhere; closing it stops the sharing.
 */
export function joinMeetupLive(meetupId: string, { onPositions, onState, onElsewhere }: Handlers) {
  const positions = new Map<string, LivePosition>();
  let controller: AbortController | null = null;
  let pass: { token: string; expiresAt: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;
  let connecting = false;
  let sending = false;
  // Opening the meetup here claims sharing for this device; after that it only keeps it.
  let claim = true;
  let elsewhere = false;
  const setElsewhere = (next: boolean) => {
    if (next === elsewhere) return;
    elsewhere = next;
    onElsewhere?.(next);
  };

  const publish = () => onPositions([...positions.values()]);

  const renewPass = async () => {
    if (pass && pass.expiresAt - Date.now() > RENEW_BEFORE_MS) return pass.token;
    const res = await socialApi.livePass(meetupId);
    if (!res.ok) return null;
    const expiresAt = Date.parse(res.data.expiresAt);
    if (!Number.isFinite(expiresAt)) return null;
    pass = { token: res.data.token, expiresAt };
    return pass.token;
  };

  const detach = () => {
    controller?.abort();
    controller = null;
  };

  const retry = () => {
    if (closed) return;
    onState('connecting');
    clearTimeout(timer);
    const background = AppState.currentState !== 'active';
    const wait = background ? Math.max(retryDelay(attempt), 8_000) : retryDelay(attempt);
    attempt += 1;
    timer = setTimeout(() => void connect(), wait);
  };

  const handle = (event: string, data: string) => {
    if (event === 'snapshot') {
      const body = parse(data) as { positions?: unknown[] } | null;
      positions.clear();
      for (const raw of body?.positions ?? []) {
        const position = readPosition(raw);
        if (position) positions.set(position.member, position);
      }
      publish();
    } else if (event === 'position') {
      const position = readPosition(parse(data));
      if (!position) return;
      positions.set(position.member, position);
      publish();
    } else if (event === 'leave') {
      const body = parse(data) as { member?: string } | null;
      if (body?.member && positions.delete(body.member)) publish();
    } else if (event === 'expired') {
      pass = null;
      detach();
      retry();
    }
  };

  async function connect() {
    if (closed || connecting) return;
    connecting = true;
    const token = await renewPass();
    connecting = false;
    if (closed) return;
    if (!token) {
      onState('offline');
      retry();
      return;
    }

    detach();
    const mine = new AbortController();
    controller = mine;
    try {
      const response = await streamingFetch(`${REALTIME_ORIGIN}/v1/stream?ticket=${encodeURIComponent(token)}`, {
        headers: { ...APP_CLIENT_HEADERS, Accept: 'text/event-stream' },
        signal: mine.signal,
      });
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
      attempt = 0;
      onState('live');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = 'message';
      let data = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done || controller !== mine) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > MAX_BUFFER) throw new Error('event too large');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line === '') {
            if (data) handle(event, data);
            event = 'message';
            data = '';
          } else if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            data += (data ? '\n' : '') + line.slice(5).trimStart();
          }
        }
      }
      if (controller === mine) {
        detach();
        retry();
      }
    } catch {
      if (controller !== mine || closed) return;
      detach();
      retry();
    }
  }

  void connect();

  // Coming back to the app reconnects right away instead of waiting out a long background retry.
  const sub = AppState.addEventListener('change', (next) => {
    if (next !== 'active' || closed || controller) return;
    clearTimeout(timer);
    void connect();
  });

  return {
    async send({ position, accuracy, heading }: { position: Coordinate; accuracy: number; heading?: number }) {
      if (sending || closed || (elsewhere && !claim)) return;
      sending = true;
      try {
        const token = await renewPass();
        if (!token || closed) return;
        const res = await fetch(`${REALTIME_ORIGIN}/v1/position`, {
          method: 'POST',
          headers: { ...APP_CLIENT_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            lat: position.latitude,
            lng: position.longitude,
            accuracy: Math.min(Math.max(Math.round(accuracy), 0), 5000),
            heading: heading === undefined ? undefined : ((Math.round(heading) % 360) + 360) % 360,
            device: deviceId(),
            claim,
          }),
        }).catch(() => null);
        if (res?.status === 409) {
          setElsewhere(true);
        } else if (res?.ok) {
          claim = false;
          setElsewhere(false);
        }

      } finally {
        sending = false;
      }
    },
    /** Moves sharing to this device from the account's other phone or browser. */
    takeOver() {
      claim = true;
      setElsewhere(false);
    },
    close() {
      closed = true;
      connecting = false;
      clearTimeout(timer);
      sub.remove();
      detach();
      if (pass && pass.expiresAt > Date.now()) {
        void fetch(`${REALTIME_ORIGIN}/v1/leave`, {
          method: 'POST',
          headers: { ...APP_CLIENT_HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${pass.token}` },
          body: JSON.stringify({ device: deviceId() }),
        }).catch(() => undefined);
      }
      pass = null;
    },
  };
}
