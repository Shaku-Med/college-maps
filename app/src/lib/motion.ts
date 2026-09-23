import type { Coordinate } from "@/data/campus";
import { distanceMeters } from "@/lib/geo";

// How someone is moving, judged from their speed. In metres per second: a brisk walk is about 1.8, a jog 3,
// a hard run 5 to 6. Nobody on foot keeps up more than about 6 for long, so anything steadily faster is a
// bike, a bus, or a car, and past 12 it is certainly a vehicle.
export type Motion = "still" | "walking" | "running" | "riding" | "vehicle";

/** Faster than anyone keeps up on foot. */
export const ON_FOOT_MAX_MPS = 6;
/** Faster than a bike ridden by a person, so certainly a vehicle. */
export const RIDING_MAX_MPS = 12;

const LIMITS: ReadonlyArray<readonly [Motion, number]> = [
  ["still", 0.4],
  ["walking", 2.3],
  ["running", ON_FOOT_MAX_MPS],
  ["riding", RIDING_MAX_MPS],
];

// Speed is averaged over a few seconds, so one jumpy fix does not look like a sprint.
const SMOOTHING_S = 6;
// Faster than this between two fixes is the GPS jumping, not the person moving.
const MAX_BELIEVABLE_MPS = 70;
const MAX_ACCURACY_M = 50;

export type MotionState = { speed: number; motion: Motion };

export function classifySpeed(speed: number): Motion {
  for (const [kind, below] of LIMITS) if (speed < below) return kind;
  return "vehicle";
}

export const isOnFoot = (motion: Motion) => motion === "still" || motion === "walking" || motion === "running";

// How long a new kind of movement has to hold before it is believed. Getting on something is quick to
// notice. Getting off needs more: a bus waiting at a light is standing still, so only a long stop counts,
// while actually walking away from the stop counts sooner.
function settleSeconds(from: Motion, to: Motion) {
  if (isOnFoot(from) || !isOnFoot(to)) return 8;
  return to === "still" ? 90 : 20;
}

export function createMotionTracker() {
  let lastFix: { position: Coordinate; at: number } | null = null;
  let lastUpdate = 0;
  let speed = 0;
  let hasSpeed = false;
  let motion: Motion = "still";
  let candidate: Motion = "still";
  let candidateSince = 0;

  return {
    update(fix: { position: Coordinate; accuracy: number; speed?: number }, at: number): MotionState {
      const trusted = fix.accuracy <= MAX_ACCURACY_M;
      let sample: number | undefined;
      // The phone's own speed comes from the satellite signal and is far steadier than distance over time.
      if (fix.speed !== undefined && fix.speed >= 0) sample = fix.speed;
      else if (lastFix && trusted) {
        const seconds = (at - lastFix.at) / 1000;
        if (seconds >= 1) sample = distanceMeters(lastFix.position, fix.position) / seconds;
      }
      if (trusted) lastFix = { position: fix.position, at };

      if (sample !== undefined && sample <= MAX_BELIEVABLE_MPS) {
        if (!hasSpeed) {
          speed = sample;
          hasSpeed = true;
        } else {
          const seconds = Math.max(0, (at - lastUpdate) / 1000);
          speed += (sample - speed) * (1 - Math.exp(-seconds / SMOOTHING_S));
        }
        lastUpdate = at;
      }

      const now = classifySpeed(speed);
      if (now !== candidate) {
        candidate = now;
        candidateSince = at;
      }
      if (candidate !== motion && at - candidateSince >= settleSeconds(motion, candidate) * 1000) motion = candidate;
      return { speed, motion };
    },
    reset() {
      lastFix = null;
      lastUpdate = 0;
      speed = 0;
      hasSpeed = false;
      motion = "still";
      candidate = "still";
      candidateSince = 0;
    },
  };
}
