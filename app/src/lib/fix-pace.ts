// The dot and the camera glide to each new fix over about the time until the next one, a touch longer so motion never pauses.
const DEFAULT_MS = 1000;
const MIN_MS = 500;
const MAX_MS = 2000;
const STRETCH = 1.1;
const SAMPLES = 5;

/** Learns how often location fixes arrive, so the dot and the map can glide between them at an even pace. */
export function createFixPace() {
  let gaps: number[] = [];
  let last = 0;
  return {
    note(now: number) {
      const gap = now - last;
      if (last && gap > 0 && gap < MAX_MS * 2) gaps = [...gaps.slice(1 - SAMPLES), gap];
      last = now;
    },
    glideMs() {
      if (gaps.length === 0) return DEFAULT_MS;
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      return Math.min(MAX_MS, Math.max(MIN_MS, median * STRETCH));
    },
  };
}
