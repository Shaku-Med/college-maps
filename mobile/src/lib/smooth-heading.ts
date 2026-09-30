/** Shortest signed turn from `from` to `to`, in degrees (−180…180]. */
export function shortestTurn(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Smooths compass/course readings the way the web map does: exponential ease toward the
 * latest heading so the camera never jumps on every noisy reading.
 */
export function createSmoothHeading(opts?: {
  /** Time constant when nearly settled (ms). Higher = calmer. */
  calmMs?: number;
  /** Floor time constant when turning hard (ms). */
  fastMs?: number;
  /** Degrees under which we snap and stop animating. */
  settled?: number;
}) {
  const calmMs = opts?.calmMs ?? 420;
  const fastMs = opts?.fastMs ?? 160;
  const settled = opts?.settled ?? 0.35;

  let target: number | undefined;
  let shown: number | undefined;
  let frame = 0;
  let last = 0;
  let onFrame: ((degrees: number) => void) | null = null;

  const step = (now: number) => {
    if (target === undefined || shown === undefined || !onFrame) {
      frame = 0;
      return;
    }
    const elapsed = Math.min(now - last, 48);
    last = now;
    const delta = shortestTurn(shown, target);
    if (Math.abs(delta) <= settled) {
      shown = ((target % 360) + 360) % 360;
      onFrame(shown);
      frame = 0;
      return;
    }
    const timeConstant = Math.max(fastMs, calmMs - Math.abs(delta) * 3.2);
    shown = (shown + delta * (1 - Math.exp(-elapsed / timeConstant)) + 360) % 360;
    onFrame(shown);
    frame = requestAnimationFrame(step);
  };

  return {
    /** Latest smoothed heading, or undefined if never set. */
    current: () => shown,
    /** Aim the smoother at a new heading. */
    set(degrees: number | undefined, render?: (degrees: number) => void) {
      if (render) onFrame = render;
      target = degrees === undefined ? undefined : ((degrees % 360) + 360) % 360;
      if (target === undefined) {
        cancelAnimationFrame(frame);
        frame = 0;
        shown = undefined;
        return;
      }
      if (shown === undefined) {
        shown = target;
        onFrame?.(shown);
        return;
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

/**
 * What the map camera is doing: the bearing it was last sent to, and until when a move is still playing, so
 * a compass turn never cuts a follow short. Kept behind methods so screens can update it from any handler.
 */
export function createCameraMemory() {
  let bearing = 0;
  let busyUntil = 0;
  let movedAt = 0;
  return {
    bearing: () => bearing,
    setBearing(degrees: number) {
      bearing = degrees;
    },
    /** A move to `degrees` that takes `ms` has just started. */
    moving(degrees: number, ms: number) {
      bearing = degrees;
      movedAt = Date.now();
      busyUntil = movedAt + ms;
    },
    busy: () => Date.now() < busyUntil,
    sinceMove: () => Date.now() - movedAt,
  };
}
