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

// SOS phones show once the map is zoomed in a little; benches, trash cans, and the rest only close up, so campus stays clear.
export const SOS_MIN_ZOOM = 17;
export const AMENITY_MIN_ZOOM = 18.3;
const AMENITY_FULL_ZOOM = 19.5;

/** The two amenity icon layers, SOS phones above the rest. `scale` is 1 on the web, where icons are drawn at half size. */
export function amenityLayers(scale: number, { sos, other, halo }: { sos: string; other: string; halo: string }) {
  const layer = (kind: "sos" | "other", minZoom: number, [small, large]: [number, number], color: string) => ({
    id: `campus-amenities-${kind}`,
    minzoom: minZoom,
    filter: [kind === "sos" ? "==" : "!=", ["get", "kind"], "sos"],
    layout: {
      "icon-image": ["concat", "amenity-", ["get", "kind"]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], minZoom, small * scale, AMENITY_FULL_ZOOM, large * scale],
    },
    paint: {
      "icon-color": color,
      "icon-halo-color": halo,
      "icon-halo-width": 1.5,
      // They fade in over the first bit of zoom instead of popping in.
      "icon-opacity": ["interpolate", ["linear"], ["zoom"], minZoom, 0, minZoom + 0.4, 1],
    },
  });
  return [layer("other", AMENITY_MIN_ZOOM, [0.45, 0.55], other), layer("sos", SOS_MIN_ZOOM, [0.58, 0.68], sos)];
}
