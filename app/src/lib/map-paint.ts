// Paint shared by the web map and the phone app's map, so both look the same.
import { withAlpha } from "@/lib/color-alpha";

/** The heat under places with campus events: one color, the accent, from clear to a soft glow that grows with them. */
export function heatColors(accent: string) {
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    withAlpha(accent, 0),
    0.15,
    withAlpha(accent, 0.1),
    0.4,
    withAlpha(accent, 0.2),
    0.7,
    withAlpha(accent, 0.32),
    1,
    withAlpha(accent, 0.44),
  ];
}
