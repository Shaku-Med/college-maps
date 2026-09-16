import type { Coordinate } from "@/data/campus";
import { REALTIME_ORIGIN, apiOriginFor } from "@/lib/api";
import { socialApi } from "@/lib/social-api";

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
  onState: (state: "connecting" | "live" | "offline") => void;
};

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 20_000;
// Passes last 10 minutes, so a new one well before that keeps the stream from dropping.
const RENEW_BEFORE_MS = 90_000;

function readPosition(raw: unknown): LivePosition | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p.member !== "string" || typeof p.lat !== "number" || typeof p.lng !== "number") return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return {
    member: p.member,
    name: typeof p.name === "string" ? p.name : "",
    coordinate: { latitude: p.lat, longitude: p.lng },
    accuracy: typeof p.accuracy === "number" && Number.isFinite(p.accuracy) ? p.accuracy : 0,
    heading: typeof p.heading === "number" && Number.isFinite(p.heading) ? p.heading : undefined,
    at: typeof p.at === "number" && Number.isFinite(p.at) ? p.at : Date.now(),
  };
}

function parseEventData(raw: string): unknown {
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

/**
 * Keeps one meetup's live positions flowing: it streams everyone else's positions and sends yours,
 * swapping in a fresh pass before the old one runs out. Nothing is stored anywhere; closing the
 * connection stops the sharing.
 */
export function joinMeetupLive(meetupId: string, { onPositions, onState }: Handlers) {
  const origin = apiOriginFor(window.location.hostname, REALTIME_ORIGIN);
  if (!origin) {
    onState("offline");
    return { send: async () => {}, close: () => {} };
  }

  const positions = new Map<string, LivePosition>();
  let stream: EventSource | null = null;
  let pass: { token: string; expiresAt: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;
  let connecting = false;
  let sending = false;

  const publish = () => onPositions([...positions.values()]);

  const detach = () => {
    const src = stream;
    stream = null;
    if (!src) return;
    src.close();
  };

  const renewPass = async () => {
    if (pass && Number.isFinite(pass.expiresAt) && pass.expiresAt - Date.now() > RENEW_BEFORE_MS) return pass.token;
    const res = await socialApi.livePass(meetupId);
    if (!res.ok) return null;
    const expiresAt = Date.parse(res.data.expiresAt);
    if (!Number.isFinite(expiresAt)) return null;
    pass = { token: res.data.token, expiresAt };
    return pass.token;
  };

  const retry = () => {
    if (closed) return;
    onState("connecting");
    clearTimeout(timer);
    const wait = document.hidden ? Math.max(retryDelay(attempt), 8_000) : retryDelay(attempt);
    attempt += 1;
    timer = setTimeout(() => void connect(), wait);
  };

  async function connect() {
    if (closed || connecting) return;
    connecting = true;
    const token = await renewPass();
    connecting = false;
    if (closed) return;
    if (!token) {
      onState("offline");
      retry();
      return;
    }

    detach();
    const src = new EventSource(`${origin}/v1/stream?ticket=${encodeURIComponent(token)}`);
    stream = src;

    const fromThisStream = () => !closed && stream === src;

    src.addEventListener("open", () => {
      if (!fromThisStream()) return;
      attempt = 0;
      onState("live");
    });
    src.addEventListener("snapshot", (event) => {
      if (!fromThisStream()) return;
      const data = parseEventData((event as MessageEvent).data) as { positions?: unknown[] } | null;
      positions.clear();
      for (const raw of data?.positions ?? []) {
        const position = readPosition(raw);
        if (position) positions.set(position.member, position);
      }
      publish();
    });
    src.addEventListener("position", (event) => {
      if (!fromThisStream()) return;
      const position = readPosition(parseEventData((event as MessageEvent).data));
      if (!position) return;
      positions.set(position.member, position);
      publish();
    });
    src.addEventListener("leave", (event) => {
      if (!fromThisStream()) return;
      const data = parseEventData((event as MessageEvent).data) as { member?: string } | null;
      if (data?.member && positions.delete(data.member)) publish();
    });
    src.addEventListener("expired", () => {
      if (!fromThisStream()) return;
      pass = null;
      detach();
      retry();
    });
    src.addEventListener("error", () => {
      if (!fromThisStream()) return;
      detach();
      retry();
    });
  }

  void connect();

  const onVisible = () => {
    if (closed || document.hidden) return;
    if (stream && stream.readyState !== EventSource.CLOSED) return;
    clearTimeout(timer);
    void connect();
  };
  document.addEventListener("visibilitychange", onVisible);

  return {
    async send({ position, accuracy, heading }: { position: Coordinate; accuracy: number; heading?: number }) {
      if (sending || closed) return;
      sending = true;
      try {
        const token = await renewPass();
        if (!token || closed) return;
        await fetch(`${origin}/v1/position`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            lat: position.latitude,
            lng: position.longitude,
            accuracy: Math.min(Math.max(Math.round(accuracy), 0), 5000),
            heading: heading === undefined ? undefined : ((Math.round(heading) % 360) + 360) % 360,
          }),
        }).catch(() => {});
      } finally {
        sending = false;
      }
    },
    close() {
      closed = true;
      connecting = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      detach();
      if (pass && pass.expiresAt > Date.now()) {
        fetch(`${origin}/v1/leave`, {
          method: "POST",
          headers: { Authorization: `Bearer ${pass.token}` },
          keepalive: true,
        }).catch(() => {});
      }
      pass = null;
    },
  };
}
