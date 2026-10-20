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
  /** Steps counted since watching began, when the phone is counting them right now. */
  steps?: number;
};

// Walking is about 1.6 to 2 steps a second and a jog about 2.7; someone seated in a car or bus takes none.
const WALKING_STEPS_PER_S = 0.8;
const SEATED_STEPS_PER_S = 0.3;
// A jog stays under this, so steps at a higher speed are not someone on foot.
const ON_FOOT_MAX_MPS = 4.5;
// Nobody keeps this pace up on foot, so it is a vehicle.
const VEHICLE_MIN_MPS = 8;
// With no step count, only a steady walking pace counts as walking, since a crawl in traffic stops and starts.
const WALKING_PACE = { min: 0.6, max: 2.2 };
const STEP_WINDOW_MS = 15_000;
const MIN_STEP_SPAN_MS = 5_000;
// How long the evidence has to hold before the trip switches; speed alone is weaker evidence, so it waits longer.
const HOLD_MS: Record<"steps" | "speed", Record<SwitchableTravel, number>> = {
  steps: { walk: 15_000, drive: 20_000 },
  speed: { walk: 60_000, drive: 30_000 },
};
// A stop at a light right after getting off must not flip the trip straight back.
const COOLDOWN_MS = 60_000;

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

const looksOnFoot = (speed: number, rate: number | undefined) =>
  rate !== undefined ? rate >= WALKING_STEPS_PER_S && speed <= ON_FOOT_MAX_MPS : speed >= WALKING_PACE.min && speed <= WALKING_PACE.max;

const looksInVehicle = (speed: number, rate: number | undefined) =>
  speed >= VEHICLE_MIN_MPS && (rate === undefined || rate < SEATED_STEPS_PER_S);

/** Watches a street trip for someone getting out of a vehicle and walking on, or getting picked up mid walk. */
export function createTravelSwitch() {
  let samples: TravelSample[] = [];
  let since: number | null = null;
  let lastSwitch = Number.NEGATIVE_INFINITY;

  return {
    /** Feeds one fix; returns the way of travel to switch to once the evidence has held long enough. */
    update(sample: TravelSample, current: SwitchableTravel): SwitchableTravel | null {
      samples = [...samples.filter((kept) => sample.at - kept.at <= STEP_WINDOW_MS), sample];
      if (sample.at - lastSwitch < COOLDOWN_MS) {
        since = null;
        return null;
      }
      const rate = stepRate(samples);
      const next: SwitchableTravel = current === "drive" ? "walk" : "drive";
      const evidence = next === "walk" ? looksOnFoot(sample.speed, rate) : looksInVehicle(sample.speed, rate);
      if (!evidence) {
        since = null;
        return null;
      }
      since ??= sample.at;
      if (sample.at - since < HOLD_MS[rate === undefined ? "speed" : "steps"][next]) return null;
      since = null;
      lastSwitch = sample.at;
      return next;
    },
    reset() {
      samples = [];
      since = null;
      lastSwitch = Number.NEGATIVE_INFINITY;
    },
  };
}
