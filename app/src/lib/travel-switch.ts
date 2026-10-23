import { ON_FOOT_MAX_MPS, isOnFoot, type Motion } from "@/lib/motion";
import type { TravelMode } from "@/lib/routing";

/** The two ways of travel a street trip can switch between on its own. */
export type SwitchableTravel = Extract<TravelMode, "drive" | "walk">;

export const canSwitchTravel = (travel: TravelMode | undefined): travel is SwitchableTravel =>
  travel === "drive" || travel === "walk";

export type TravelSample = {
  /** When the fix came in, in milliseconds. */
  at: number;
  /** Smoothed speed in meters a second, from the motion tracker. */
  speed: number;
  /** The motion tracker's settled reading, the same one guidance uses to tell walking from riding. */
  motion: Motion;
  /** The speed the phone reported for this fix before smoothing, when it gives one. */
  reported?: number;
  /** Steps counted since watching began, when the phone is counting them right now. */
  steps?: number;
};

// Walking is about 1.6 to 2 steps a second and a jog about 2.7; someone seated in a car or bus takes none.
const WALKING_STEPS_PER_S = 0.8;
const SEATED_STEPS_PER_S = 0.3;
// A jog stays under this, so steps at a higher speed are not someone on foot.
const JOG_MAX_MPS = 4.5;
// With no step count, walking has to stay under a brisk walk the whole time, since a car in traffic keeps
// speeding past it between stops.
const WALK_PACE_MPS = { min: 0.6, max: 2.6 };
const STEP_WINDOW_MS = 15_000;
const MIN_STEP_SPAN_MS = 5_000;
// How long the evidence has to hold before the trip switches; speed alone is weaker evidence, so it waits longer.
const HOLD_MS: Record<"steps" | "speed", Record<SwitchableTravel, number>> = {
  steps: { walk: 15_000, drive: 20_000 },
  speed: { walk: 90_000, drive: 30_000 },
};
// Without steps, two thirds of that wait has to be spent walking, so waiting at a crossing does not start it over.
const WALKING_SHARE = 2 / 3;
const MAX_GAP_MS = 5_000;
// Right after switching to driving, a crawl in traffic must not flip the trip straight back on foot.
const COOLDOWN_MS = 60_000;
// Riding again soon after switching to walking means that switch was wrong, so it goes straight back.
const RECOVERY_MS = 5 * 60_000;

function stepRate(samples: TravelSample[]): number | undefined {
  // Only the latest unbroken run counts, since steps missed in between (like the app in the background) read as none.
  let start = samples.length;
  while (start > 0 && samples[start - 1].steps !== undefined) start--;
  const counted = samples.slice(start);
  if (counted.length < 2) return undefined;
  const first = counted[0];
  const last = counted[counted.length - 1];
  const span = last.at - first.at;
  if (span < MIN_STEP_SPAN_MS) return undefined;
  return Math.max(0, (last.steps as number) - (first.steps as number)) / (span / 1000);
}

/** Watches a street trip for someone getting out of a vehicle and walking on, or getting picked up mid walk. */
export function createTravelSwitch() {
  let samples: TravelSample[] = [];
  let since: number | null = null;
  let walked = 0;
  let basis: "steps" | "speed" | null = null;
  let previous: number | null = null;
  let last: { to: SwitchableTravel; at: number } | null = null;

  const restart = () => {
    since = null;
    walked = 0;
  };

  return {
    /** Feeds one fix; returns the way of travel to switch to once the evidence has held long enough. */
    update(sample: TravelSample, current: SwitchableTravel): SwitchableTravel | null {
      const gap = previous === null ? 0 : Math.min(Math.max(0, sample.at - previous), MAX_GAP_MS);
      previous = sample.at;
      samples = [...samples.filter((kept) => sample.at - kept.at <= STEP_WINDOW_MS), sample];
      const rate = stepRate(samples);
      const next: SwitchableTravel = current === "drive" ? "walk" : "drive";
      const decide = () => {
        restart();
        last = { to: next, at: sample.at };
        return next;
      };

      // Evidence from steps and from speed alone are held to different waits, so a change of basis starts over.
      const nowBasis = rate === undefined ? "speed" : "steps";
      if (nowBasis !== basis) {
        basis = nowBasis;
        restart();
      }

      // The wait runs while the motion tracker settles; the switch itself only happens once it agrees.
      if (next === "drive") {
        if (sample.speed < ON_FOOT_MAX_MPS || (rate !== undefined && rate >= SEATED_STEPS_PER_S)) {
          restart();
          return null;
        }
        since ??= sample.at;
        if (isOnFoot(sample.motion)) return null;
        if (last?.to === "walk" && sample.at - last.at < RECOVERY_MS) return decide();
        return sample.at - since >= HOLD_MS[nowBasis].drive ? decide() : null;
      }

      if (last?.to === "drive" && sample.at - last.at < COOLDOWN_MS) {
        restart();
        return null;
      }
      if (rate !== undefined) {
        if (rate < WALKING_STEPS_PER_S || sample.speed > JOG_MAX_MPS) {
          restart();
          return null;
        }
        since ??= sample.at;
        return sample.at - since >= HOLD_MS.steps.walk && isOnFoot(sample.motion) ? decide() : null;
      }
      if (Math.max(sample.speed, sample.reported ?? 0) > WALK_PACE_MPS.max) {
        restart();
        return null;
      }
      if (since === null) since = sample.at;
      else if (sample.speed >= WALK_PACE_MPS.min) walked += gap;
      const held = sample.at - since >= HOLD_MS.speed.walk && walked >= HOLD_MS.speed.walk * WALKING_SHARE;
      return held && isOnFoot(sample.motion) ? decide() : null;
    },
    reset() {
      samples = [];
      basis = null;
      previous = null;
      last = null;
      restart();
    },
  };
}
