"use client";

import type * as GeoJSON from "geojson";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  PaddingOptions,
} from "maplibre-gl";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { PlaceChip, type ChipState } from "@/components/place-chip";
import {
  CAMPUS,
  CAMPUS_CENTER,
  type Coordinate,
  type Place,
} from "@/data/campus";
import { buildingPolygon } from "@/lib/buildings";
import { cn } from "@/lib/cn";
import { withAlpha } from "@/lib/color-alpha";
import { resolveCssColor } from "@/lib/css-color";
import { distanceMeters, interpolate } from "@/lib/geo";
import { heatColors } from "@/lib/map-paint";
import { zoomBand } from "@/lib/place-marker";

const STYLE_LIGHT = CAMPUS.map.styles.light;
const STYLE_DARK = CAMPUS.map.styles.dark;
const CAMPUS_ZOOM = CAMPUS.map.zoom;
const { south, west, north, east } = CAMPUS.map.bounds;
const CAMPUS_BOUNDS: [[number, number], [number, number]] = [
  [west, south],
  [east, north],
];
const CAMPUS_MIN_ZOOM = 13;
// Small compass wobble is ignored and turns are spaced out, so the map glides instead of twitching.
const HEADING_UP_MIN_DEGREES = 4;
const HEADING_UP_GAP_MS = 450;
const HEADING_UP_MS = 500;
// Low enough to fit a drive in from another borough.
const STREETS_MIN_ZOOM = 9;
const DARK_QUERY = "(prefers-color-scheme: dark)";
const ROUTE_SOURCE = "route";
const PREVIOUS_SOURCE = "route-previous";
const PREVIOUS_HIT = "route-previous-hit";
const BUILDINGS_3D = "campus-buildings-3d";
const ACTIVITY_SOURCE = "campus-activity";
const ACTIVITY_HEAT = "campus-activity-heat";
const OUTLINE_SOURCE = "place-outline";
const ROUTE_END = "route-end";
const ROUTE_CHEVRON = "route-chevron";
const ROUTE_REVEAL_MS = 650;
const BUILDING_PITCH = 52;
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

export type CampusMapHandle = {
  focus: (coordinate: Coordinate, padding?: Partial<PaddingOptions>) => void;
  follow: (coordinate: Coordinate, padding?: Partial<PaddingOptions>, zoom?: number) => void;
  fitPath: (path: Coordinate[], padding?: Partial<PaddingOptions>) => void;
  showCampus: () => void;
  /** The cone on the dot: where the phone points. */
  setHeading: (degrees: number | undefined) => void;
  /** Where heading up turns the map. */
  setFacing: (degrees: number) => void;
  resetNorth: () => void;
};

// A friend sharing their location during a meetup, or the spot everyone is heading to.
export type MapPerson = {
  id: string;
  label: string;
  name: string;
  coordinate: Coordinate;
  isDestination?: boolean;
  // Only the person you are following, or the one you tapped, spells out their name.
  isActive?: boolean;
};

type CampusMapProps = {
  ref?: Ref<CampusMapHandle>;
  places: readonly Place[];
  selectedId?: string;
  originId?: string;
  /** Stops on the way, numbered in the order they are visited. */
  stopNumbers?: Readonly<Record<string, number>>;
  userLocation?: Coordinate;
  people?: readonly MapPerson[];
  destinationPin?: Coordinate;
  route?: Coordinate[];
  previousRoute?: Coordinate[];
  initialFocus?: Coordinate;
  getFocusPadding?: () => Partial<PaddingOptions>;
  onSelect: (place: Place | undefined) => void;
  /** The style and first tiles have drawn. */
  onLoad?: () => void;
  /** The person started moving the map themselves: drag, pinch, twist, or scroll. */
  onUserPan?: () => void;
  /** The map came to rest after the person moved it, including any glide after letting go. */
  onUserSettle?: () => void;
  onRotatedChange?: (rotated: boolean) => void;
  onPreviousRoutePress?: () => void;
  onPersonPress?: (id: string) => void;
  buildingView?: boolean;
  /** Lets the camera leave campus, for a street route from somewhere else. */
  unbounded?: boolean;
  /** Lets the person turn the map, such as to line it up with the street in front of them. */
  rotatable?: boolean;
  /** Turns the map so the way the person is facing is up, the way navigation apps do. */
  headingUp?: boolean;
  /** Public events per place id — soft heat under busy buildings when signed in and online. */
  activityByPlace?: Readonly<Record<string, number>>;
};

type Outlined = { id: string; kind: "selected" | "hover" };

function outlineFeatures(outlined: Outlined[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const { id, kind } of outlined) {
    const geometry = buildingPolygon(id);
    if (geometry) features.push({ type: "Feature", properties: { kind }, geometry });
  }
  return { type: "FeatureCollection", features };
}

// The picked building's real footprint lights up under its chip; the one pointed at gets a fainter outline.
function applyOutlineLayers(map: MapLibreMap, outlined: Outlined[]) {
  const source = map.getSource<GeoJSONSource>(OUTLINE_SOURCE);
  if (source) {
    source.setData(outlineFeatures(outlined));
    return;
  }
  // isStyleLoaded() stays false while tiles load, so a building picked on page load would never light up.
  if (!map.getSource("openmaptiles")) return;
  map.addSource(OUTLINE_SOURCE, { type: "geojson", data: outlineFeatures(outlined) });
  const layers = map.getStyle().layers;
  // Under any route, which is drawn above the roads but below the labels.
  const before = map.getLayer(`${PREVIOUS_SOURCE}-casing`)
    ? `${PREVIOUS_SOURCE}-casing`
    : layers.slice(layers.findLastIndex((layer) => layer.type !== "symbol") + 1).find((layer) => layer.type === "symbol")?.id;
  const accent = resolveCssColor("--accent", "#3b82f6");
  const selected = ["==", ["get", "kind"], "selected"] as const;
  const add = (layer: Record<string, unknown>) => map.addLayer({ source: OUTLINE_SOURCE, ...layer } as Parameters<MapLibreMap["addLayer"]>[0], before);
  add({ id: `${OUTLINE_SOURCE}-fill`, type: "fill", paint: { "fill-color": accent, "fill-opacity": ["case", selected, 0.2, 0.08] } });
  add({
    id: `${OUTLINE_SOURCE}-glow`,
    type: "line",
    filter: selected,
    layout: { "line-join": "round" },
    paint: { "line-color": accent, "line-width": 7, "line-blur": 5, "line-opacity": 0.35 },
  });
  add({
    id: `${OUTLINE_SOURCE}-edge`,
    type: "line",
    layout: { "line-join": "round" },
    paint: {
      "line-color": accent,
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 18, 2.25],
      "line-opacity": ["case", selected, 0.95, 0.55],
    },
  });
}

function toLngLat({ latitude, longitude }: Coordinate): [number, number] {
  return [longitude, latitude];
}

function routeFeature(
  path: Coordinate[] | undefined,
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: (path ?? []).map(toLngLat) },
  };
}

function routeEnd(path: Coordinate[] | undefined): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const end = path && path.length > 1 ? path[path.length - 1] : undefined;
  return {
    type: "FeatureCollection",
    features: end ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: toLngLat(end) } }] : [],
  };
}

type RouteLines = { active?: Coordinate[]; previous?: Coordinate[] };

// The glow, casing and line share one gradient, so the route can draw itself in from where it starts.
const ROUTE_DRAWN = [`${ROUTE_SOURCE}-glow`, `${ROUTE_SOURCE}-casing`, `${ROUTE_SOURCE}-line`] as const;

function routeColors() {
  const accent = resolveCssColor("--accent", "#3b82f6");
  return {
    accent,
    // The color made to sit on the accent, so the casing and chevrons read in both themes.
    onAccent: resolveCssColor("--accent-foreground", "#ffffff"),
    glow: withAlpha(accent, 0.3),
  };
}

function drawnUpTo(color: string, progress: number): ExpressionSpecification {
  return progress >= 1
    ? ["interpolate", ["linear"], ["line-progress"], 0, color, 1, color]
    : ["step", ["line-progress"], color, Math.max(progress, 0.0001), "rgba(0, 0, 0, 0)"];
}

/** Shows the route drawn up to this share of its length, and its chevrons and end once it is all there. */
function setRouteDrawn(map: MapLibreMap, progress: number, colors = routeColors()) {
  if (!map.getLayer(ROUTE_DRAWN[2])) return;
  const { accent, onAccent, glow } = colors;
  [glow, onAccent, accent].forEach((color, i) => map.setPaintProperty(ROUTE_DRAWN[i], "line-gradient", drawnUpTo(color, progress)));
  const shown = progress >= 1 ? 1 : 0;
  map.setPaintProperty(`${ROUTE_SOURCE}-chevrons`, "icon-opacity", 0.9 * shown);
  map.setPaintProperty(`${ROUTE_END}-dot`, "circle-opacity", shown);
  map.setPaintProperty(`${ROUTE_END}-dot`, "circle-stroke-opacity", shown);
}

let chevron: Promise<ImageBitmap | HTMLImageElement | ImageData | null> | null = null;

// A signed distance field, so it takes the theme's color at any size (scripts/build-route-chevron.mjs).
function addChevron(map: MapLibreMap) {
  chevron ??= map
    .loadImage("/icons/route-chevron.png")
    .then((image) => image.data)
    .catch(() => {
      chevron = null;
      return null;
    });
  void chevron.then((image) => {
    if (!image || map.hasImage(ROUTE_CHEVRON)) return;
    map.addImage(ROUTE_CHEVRON, image, { sdf: true, pixelRatio: 2 });
  });
}

function applyRouteLayers(map: MapLibreMap, { active, previous }: RouteLines) {
  const activeSource = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (activeSource) {
    activeSource.setData(routeFeature(active));
    map.getSource<GeoJSONSource>(PREVIOUS_SOURCE)?.setData(routeFeature(previous));
    map.getSource<GeoJSONSource>(ROUTE_END)?.setData(routeEnd(active));
    return;
  }
  // isStyleLoaded() stays false while tiles load; the style's own source is there as soon as the style is.
  if (!map.getSource("openmaptiles")) return;

  map.addSource(PREVIOUS_SOURCE, { type: "geojson", data: routeFeature(previous) });
  map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeFeature(active), lineMetrics: true });
  map.addSource(ROUTE_END, { type: "geojson", data: routeEnd(active) });
  addChevron(map);

  // Draw above every road and path layer but below the first label that follows them.
  const layers = map.getStyle().layers;
  const lastShapeIndex = layers.findLastIndex((layer) => layer.type !== "symbol");
  const beforeLabels = layers.slice(lastShapeIndex + 1).find((layer) => layer.type === "symbol")?.id;
  const layout = { "line-cap": "round", "line-join": "round" } as const;
  const { accent, onAccent, glow } = routeColors();
  const zoomed = (low: number, high: number) => ["interpolate", ["linear"], ["zoom"], 14, low, 18, high] as const;

  const add = (layer: Record<string, unknown>) => map.addLayer(layer as Parameters<MapLibreMap["addLayer"]>[0], beforeLabels);
  const line = (id: string, source: string, paint: Record<string, unknown>) => add({ id, type: "line", source, layout, paint });

  // The old route stays visible but faded, so the walker can still choose it.
  line(`${PREVIOUS_SOURCE}-casing`, PREVIOUS_SOURCE, { "line-color": onAccent, "line-width": zoomed(5, 13), "line-opacity": 0.4 });
  line(`${PREVIOUS_SOURCE}-line`, PREVIOUS_SOURCE, {
    "line-color": accent,
    "line-width": zoomed(3, 8),
    "line-opacity": 0.35,
    "line-dasharray": [1.2, 1.4],
  });
  line(PREVIOUS_HIT, PREVIOUS_SOURCE, { "line-color": accent, "line-width": 28, "line-opacity": 0 });

  line(ROUTE_DRAWN[0], ROUTE_SOURCE, { "line-gradient": drawnUpTo(glow, 1), "line-width": zoomed(12, 30), "line-blur": zoomed(6, 14) });
  line(ROUTE_DRAWN[1], ROUTE_SOURCE, { "line-gradient": drawnUpTo(onAccent, 1), "line-width": zoomed(6, 15) });
  line(ROUTE_DRAWN[2], ROUTE_SOURCE, { "line-gradient": drawnUpTo(accent, 1), "line-width": zoomed(3.5, 9) });
  // Small chevrons along the line point the way, the way the route runs.
  add({
    id: `${ROUTE_SOURCE}-chevrons`,
    type: "symbol",
    source: ROUTE_SOURCE,
    // Only close up, and sized to sit inside the line; any bigger and they read as gaps in it.
    minzoom: 16,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 16, 44, 19, 72],
      "icon-image": ROUTE_CHEVRON,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 16, 0.32, 19, 0.52],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-color": onAccent, "icon-opacity": 0.9 },
  });
  add({
    id: `${ROUTE_END}-dot`,
    type: "circle",
    source: ROUTE_END,
    paint: {
      "circle-radius": zoomed(4.5, 7.5),
      "circle-color": accent,
      "circle-stroke-color": onAccent,
      "circle-stroke-width": zoomed(2, 3),
    },
  });
}

// The route draws itself from start to end when it first appears, unless motion is turned down.
function revealRoute(map: MapLibreMap, frame: { current: number | null }) {
  if (frame.current !== null) cancelAnimationFrame(frame.current);
  frame.current = null;
  const colors = routeColors();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setRouteDrawn(map, 1, colors);
    return;
  }
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / ROUTE_REVEAL_MS);
    setRouteDrawn(map, 1 - (1 - t) ** 3, colors);
    frame.current = t < 1 ? requestAnimationFrame(step) : null;
  };
  setRouteDrawn(map, 0, colors);
  frame.current = requestAnimationFrame(step);
}

// Turning is allowed in building view and while getting directions. Anywhere else the map faces north.
function applyBuildingView(map: MapLibreMap, on: boolean, camera: "ease" | "keep", rotatable: boolean) {
  applyViewCamera(map, on, camera, rotatable);
  // The style's sources exist once it has loaded; before that the style.load handler applies this.
  if (!map.getSource("openmaptiles")) return;

  const dark = window.matchMedia(DARK_QUERY).matches;
  if (map.getLayer("building")) {
    map.setPaintProperty("building", "fill-opacity", on ? 0 : 1);
  }

  const height: ExpressionSpecification = [
    "case",
    [">", ["to-number", ["get", "render_height"]], 0],
    ["to-number", ["get", "render_height"]],
    [">", ["to-number", ["get", "height"]], 0],
    ["to-number", ["get", "height"]],
    14,
  ];

  if (on && !map.getLayer(BUILDINGS_3D)) {
    const layers = map.getStyle().layers ?? [];
    const routeCasing = `${ROUTE_SOURCE}-casing`;
    const before = map.getLayer(routeCasing)
      ? routeCasing
      : layers.find((layer) => layer.type === "symbol")?.id;
    map.addLayer(
      {
        id: BUILDINGS_3D,
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": dark ? "#3a3a3a" : "#ddd9d2",
          "fill-extrusion-opacity": 0.94,
          "fill-extrusion-vertical-gradient": true,
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.6, height],
          "fill-extrusion-base": ["to-number", ["get", "render_min_height"]],
        },
      },
      before,
    );
  }

  if (!on && map.getLayer(BUILDINGS_3D)) {
    map.removeLayer(BUILDINGS_3D);
  }
}

// Gestures and camera moves work whether or not the style has loaded.
function applyViewCamera(map: MapLibreMap, on: boolean, camera: "ease" | "keep", rotatable: boolean) {
  map.setMaxPitch(60);
  if (on || rotatable) {
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.keyboard.enableRotation();
  } else {
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
  }
  if (on) {
    map.touchPitch.enable();
    if (camera === "ease" && (map.getPitch() < BUILDING_PITCH - 1 || map.getZoom() < 16)) {
      map.easeTo({
        pitch: BUILDING_PITCH,
        zoom: Math.max(map.getZoom(), 16),
        duration: 650,
        essential: true,
      });
    }
    return;
  }

  map.touchPitch.disable();
  // One ease for both, so flattening and turning back north never cut each other off halfway.
  const tilted = map.getPitch() > 0.5;
  const turned = !rotatable && Math.abs(map.getBearing()) > 0.5;
  if (camera === "ease" && (tilted || turned)) {
    const settle = () => map.easeTo({ pitch: 0, ...(rotatable ? {} : { bearing: 0 }), duration: 650, essential: true });
    // Only one camera move runs at a time.
    if (map.isMoving()) map.once("moveend", settle);
    else settle();
  }
}

function createUserMarker() {
  const el = document.createElement("div");
  el.className = "relative size-4";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Your location");

  // A soft beam toward where the phone points, like a flashlight: it fades out to both sides and toward its end,
  // the same as the phone app's (mobile/scripts/build-user-beam.mjs).
  const cone = document.createElement("div");
  cone.dataset.headingCone = "";
  cone.className =
    "pointer-events-none absolute bottom-1/2 left-1/2 h-12 w-24 -translate-x-1/2 origin-bottom opacity-0 transition-opacity duration-300 will-change-transform bg-[radial-gradient(circle_48px_at_50%_100%,color-mix(in_oklab,var(--accent)_55%,transparent),color-mix(in_oklab,var(--accent)_45%,transparent)_20%,color-mix(in_oklab,var(--accent)_16%,transparent)_60%,transparent)] [mask-image:conic-gradient(from_-38deg_at_50%_100%,transparent,black_14deg,black_62deg,transparent_76deg,transparent)]";

  const dot = document.createElement("div");
  dot.className =
    "absolute inset-0 rounded-full border-2 border-white bg-accent shadow-[0_0_0_6px_color-mix(in_oklab,var(--accent)_25%,transparent)]";

  el.append(cone, dot);
  return el;
}

// A friend on the map: a round avatar with a little point underneath, like Apple Maps.
function createPersonMarker() {
  const el = document.createElement("button");
  el.type = "button";
  el.dataset.personMarker = "";
  el.className =
    "flex cursor-pointer flex-col items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus";

  const pill = document.createElement("span");
  pill.dataset.personPill = "";

  const badge = document.createElement("span");
  badge.dataset.personBadge = "";

  const name = document.createElement("span");
  name.dataset.personName = "";

  const tail = document.createElement("span");
  tail.dataset.personTail = "";

  pill.append(badge, name);
  el.append(pill, tail);
  return el;
}

function paintPersonMarker(el: HTMLElement, person: MapPerson) {
  const pill = el.querySelector<HTMLElement>("[data-person-pill]");
  const badge = el.querySelector<HTMLElement>("[data-person-badge]");
  const name = el.querySelector<HTMLElement>("[data-person-name]");
  const tail = el.querySelector<HTMLElement>("[data-person-tail]");
  if (!pill || !badge || !name || !tail) return;

  pill.className = cn(
    "flex items-center rounded-full bg-overlay shadow-[0_2px_8px_rgba(15,23,42,0.35)] ring-2 transition-[padding] duration-150",
    person.isActive ? "gap-1.5 p-1 pr-3" : "p-[3px]",
    person.isDestination ? "ring-accent" : "ring-overlay",
  );
  tail.className = cn(
    "-mt-[5px] size-3 rotate-45 rounded-[3px] bg-overlay shadow-[0_2px_6px_rgba(15,23,42,0.28)]",
    person.isDestination ? "ring-2 ring-accent" : "",
  );
  badge.className = cn(
    "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
    person.isDestination
      ? "bg-accent text-accent-foreground"
      : "bg-accent-soft text-accent-soft-foreground",
  );
  badge.textContent = person.label;
  name.className = cn(
    "max-w-[8rem] truncate text-xs font-semibold text-overlay-foreground",
    person.isActive ? "" : "hidden",
  );
  name.textContent = person.name;
  el.setAttribute("aria-label", person.name);
}

// The spot a meetup is heading to, drawn as a pin with a short label.
function createPinMarker(label: string) {
  const el = document.createElement("div");
  el.className = "flex flex-col items-center";
  el.setAttribute("aria-label", label);
  el.innerHTML =
    '<span class="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground shadow-lg"></span>' +
    '<span class="-mt-[3px] size-2.5 rotate-45 rounded-[2px] bg-accent"></span>';
  el.firstElementChild!.textContent = label;
  return el;
}

function applyHeading(marker: Marker | null, degrees: number | undefined) {
  const cone = marker
    ?.getElement()
    .querySelector<HTMLElement>("[data-heading-cone]");
  if (!cone) return;
  if (degrees === undefined) {
    cone.style.opacity = "0";
    return;
  }
  cone.style.opacity = "1";
  cone.style.transform = `rotate(${degrees}deg)`;
}

// Matches the camera's follow ease, so the dot and the map arrive together.
const USER_GLIDE_MS = 600;
// Friends report every few seconds, so their pins take longer to cover the gap.
const PERSON_GLIDE_MS = 1000;
// Anything farther is a first fix or a corrected signal, where sliding across campus would be wrong.
const GLIDE_MAX_METERS = 120;

type Glide = { to: (coordinate: Coordinate) => void; stop: () => void };

// Slides a marker to each new position instead of jumping, easing out so it settles gently.
function createGlide(marker: Marker, duration: number): Glide {
  let frame = 0;
  let landing: ReturnType<typeof setTimeout> | undefined;
  const halt = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(landing);
    landing = undefined;
  };
  return {
    to(coordinate) {
      halt();
      const current = marker.getLngLat();
      const from = { latitude: current.lat, longitude: current.lng };
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced || document.hidden || distanceMeters(from, coordinate) > GLIDE_MAX_METERS) {
        marker.setLngLat(toLngLat(coordinate));
        return;
      }
      const began = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - began) / duration);
        marker.setLngLat(toLngLat(interpolate(from, coordinate, 1 - (1 - t) ** 3)));
        if (t < 1) frame = requestAnimationFrame(step);
        else halt();
      };
      frame = requestAnimationFrame(step);
      // Some browsers stop frames while visible, and the marker still has to land where the person is.
      landing = setTimeout(() => {
        halt();
        marker.setLngLat(toLngLat(coordinate));
      }, duration + 150);
    },
    stop: halt,
  };
}

const FASTEST_MS = 20;
const CALMEST_MS = 90;
const SETTLED_DEGREES = 0.2;

// Chases the latest compass reading every animation frame.
function createHeadingAnimator(render: (degrees: number | undefined) => void) {
  let target: number | undefined;
  let shown: number | undefined;
  let frame = 0;
  let last = 0;

  const step = (now: number) => {
    if (target === undefined || shown === undefined) {
      frame = 0;
      return;
    }
    const elapsed = Math.min(now - last, 100);
    last = now;
    const delta = ((target - shown + 540) % 360) - 180;
    if (Math.abs(delta) <= SETTLED_DEGREES) {
      shown = target;
      render(shown);
      frame = 0;
      return;
    }
    const timeConstant = Math.max(
      FASTEST_MS,
      CALMEST_MS - Math.abs(delta) * 3.5,
    );
    shown =
      (shown + delta * (1 - Math.exp(-elapsed / timeConstant)) + 360) % 360;
    render(shown);
    frame = requestAnimationFrame(step);
  };

  return {
    set(degrees: number | undefined) {
      target = degrees;
      if (degrees === undefined || shown === undefined || document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        shown = degrees;
        render(degrees);
        return;
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    },
    current: () => shown,
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

function applyActivityHeat(
  map: MapLibreMap,
  places: readonly Place[],
  activityByPlace: Readonly<Record<string, number>> | undefined,
) {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  if (activityByPlace) {
    for (const place of places) {
      const weight = activityByPlace[place.id] ?? 0;
      if (weight < 1) continue;
      features.push({
        type: "Feature",
        properties: { weight: Math.min(weight, 6) },
        geometry: { type: "Point", coordinates: toLngLat(place.coordinate) },
      });
    }
  }
  const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  const existing = map.getSource<GeoJSONSource>(ACTIVITY_SOURCE);
  if (existing) {
    existing.setData(data);
    return;
  }
  if (features.length === 0 || !map.getSource("openmaptiles")) return;

  map.addSource(ACTIVITY_SOURCE, { type: "geojson", data });
  // Under the picked building's outline and any route, so both stay crisp on top of it.
  const before =
    [`${OUTLINE_SOURCE}-fill`, `${PREVIOUS_SOURCE}-casing`].find((id) => map.getLayer(id)) ??
    map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: ACTIVITY_HEAT,
      type: "heatmap",
      source: ACTIVITY_SOURCE,
      maxzoom: 19,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 1, 0.6, 6, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 14, 0.8, 18, 1.4],
        "heatmap-color": heatColors(resolveCssColor("--accent", "#3b82f6")) as ExpressionSpecification,
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 14, 30, 18, 96],
      },
    },
    before,
  );
}

export function CampusMap({
  ref,
  places,
  selectedId,
  originId,
  stopNumbers,
  userLocation,
  people,
  destinationPin,
  route,
  previousRoute,
  initialFocus,
  getFocusPadding,
  onSelect,
  onLoad,
  onUserPan,
  onUserSettle,
  onRotatedChange,
  onPreviousRoutePress,
  onPersonPress,
  buildingView = false,
  unbounded = false,
  rotatable = false,
  headingUp = false,
  activityByPlace,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, { marker: Marker; host: HTMLElement }>());
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map());
  const [hovered, setHovered] = useState<string | null>(null);
  const outlinedRef = useRef<Outlined[]>([]);
  const revealFrameRef = useRef<number | null>(null);
  const drawnEndRef = useRef<string | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const userGlideRef = useRef<Glide | null>(null);
  const peopleMarkersRef = useRef(
    new Map<string, { marker: Marker; el: HTMLElement; glide: Glide }>(),
  );
  const pinMarkerRef = useRef<Marker | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [isReady, setIsReady] = useState(false);

  const onSelectRef = useRef(onSelect);
  const onLoadRef = useRef(onLoad);
  // A turn the map was asked to finish, such as back to north.
  const bearingGoalRef = useRef<number | null>(null);
  const onUserPanRef = useRef(onUserPan);
  const onUserSettleRef = useRef(onUserSettle);
  const onRotatedChangeRef = useRef(onRotatedChange);
  const rotatableRef = useRef(rotatable);
  const headingUpRef = useRef(headingUp);
  // The heading the map is being turned to. Null while the map is not following anyone's heading.
  const facingRef = useRef<number | null>(null);
  const turnedAtRef = useRef(0);
  const routesRef = useRef<RouteLines>({
    active: route,
    previous: previousRoute,
  });
  const onPreviousRoutePressRef = useRef(onPreviousRoutePress);
  const onPersonPressRef = useRef(onPersonPress);
  const initialFocusRef = useRef(initialFocus);
  const getFocusPaddingRef = useRef(getFocusPadding);
  const buildingViewRef = useRef(buildingView);
  const placesRef = useRef(places);
  const activityRef = useRef(activityByPlace);

  const headingRef = useRef<ReturnType<typeof createHeadingAnimator> | null>(
    null,
  );

  useEffect(() => () => headingRef.current?.stop(), []);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onLoadRef.current = onLoad;
    onUserPanRef.current = onUserPan;
    onUserSettleRef.current = onUserSettle;
    onRotatedChangeRef.current = onRotatedChange;
    rotatableRef.current = rotatable;
    headingUpRef.current = headingUp;
    if (!headingUp) facingRef.current = null;
    onPreviousRoutePressRef.current = onPreviousRoutePress;
    onPersonPressRef.current = onPersonPress;
    getFocusPaddingRef.current = getFocusPadding;
    buildingViewRef.current = buildingView;
    placesRef.current = places;
    activityRef.current = activityByPlace;
  }, [
    onSelect,
    onLoad,
    onUserPan,
    onUserSettle,
    onRotatedChange,
    onPreviousRoutePress,
    onPersonPress,
    getFocusPadding,
    buildingView,
    rotatable,
    headingUp,
    places,
    activityByPlace,
  ]);

  // Eases the map round to the way the person faces.
  const turnMapToFacing = () => {
    const map = mapRef.current;
    const facing = facingRef.current;
    if (!map || facing === null || !headingUpRef.current || map.isMoving()) return;
    const now = performance.now();
    if (now - turnedAtRef.current < HEADING_UP_GAP_MS) return;
    if (Math.abs(((facing - map.getBearing() + 540) % 360) - 180) < HEADING_UP_MIN_DEGREES) return;
    turnedAtRef.current = now;
    map.easeTo({ bearing: facing, duration: HEADING_UP_MS, essential: true });
  };

  useImperativeHandle(ref, () => ({
    focus(coordinate, padding) {
      mapRef.current?.flyTo({
        center: toLngLat(coordinate),
        zoom: Math.max(mapRef.current.getZoom(), 17),
        padding: { ...NO_PADDING, ...padding },
        duration: 700,
        essential: true,
      });
    },
    follow(coordinate, padding, zoom) {
      // Moving and turning go in one camera move, or each would cut the other short.
      const goal = headingUpRef.current ? facingRef.current : bearingGoalRef.current;
      mapRef.current?.easeTo({
        center: toLngLat(coordinate),
        ...(goal === null ? {} : { bearing: goal }),
        zoom: zoom ?? Math.max(mapRef.current.getZoom(), 17.5),
        padding: { ...NO_PADDING, ...padding },
        duration: 600,
        essential: true,
      });
    },
    fitPath(path, padding) {
      const lib = libRef.current;
      const map = mapRef.current;
      if (!lib || !map || path.length === 0) return;
      const bounds = new lib.LngLatBounds(toLngLat(path[0]), toLngLat(path[0]));
      for (const point of path) bounds.extend(toLngLat(point));
      // fitBounds stacks its padding on top of padding left behind by earlier camera moves.
      map.setPadding(NO_PADDING);
      map.fitBounds(bounds, {
        padding: { ...NO_PADDING, ...padding },
        maxZoom: 18,
        duration: 700,
        essential: true,
      });
    },
    setFacing(degrees) {
      if (!headingUpRef.current) return;
      facingRef.current = degrees;
      turnMapToFacing();
    },
    setHeading(degrees) {
      headingRef.current ??= createHeadingAnimator((shown) => {
        // The map never rotates today, but subtracting the bearing keeps the cone true if it ever does.
        const bearing = mapRef.current?.getBearing() ?? 0;
        applyHeading(
          userMarkerRef.current,
          shown === undefined ? undefined : shown - bearing,
        );
      });
      headingRef.current.set(degrees);
    },
    resetNorth() {
      bearingGoalRef.current = 0;
      mapRef.current?.easeTo({ bearing: 0, duration: 500, essential: true });
    },
    showCampus() {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({
        center: toLngLat(CAMPUS_CENTER),
        zoom: CAMPUS_ZOOM,
        padding: NO_PADDING,
        duration: 700,
        essential: true,
        pitch: buildingViewRef.current ? Math.max(map.getPitch(), BUILDING_PITCH) : 0,
        bearing: buildingViewRef.current ? map.getBearing() : 0,
      });
    },
  }));

  useEffect(() => {
    let cancelled = false;
    const markers = markersRef.current;
    const peopleMarkers = peopleMarkersRef.current;
    const media = window.matchMedia(DARK_QUERY);
    const styleFor = (dark: boolean) => (dark ? STYLE_DARK : STYLE_LIGHT);
    const handleScheme = (event: MediaQueryListEvent) =>
      mapRef.current?.setStyle(styleFor(event.matches));
    const relayout = () => mapRef.current?.resize();
    const relayoutWhenShown = () => document.visibilityState === "visible" && relayout();
    let ro: ResizeObserver | null = null;
    let settleTimer: number | undefined;

    (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;

      lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      libRef.current = lib;

      const map = new lib.Map({
        container: containerRef.current,
        style: styleFor(media.matches),
        center: toLngLat(CAMPUS_CENTER),
        zoom: CAMPUS_ZOOM,
        minZoom: CAMPUS_MIN_ZOOM,
        maxZoom: 19.5,
        maxBounds: CAMPUS_BOUNDS,
        dragRotate: false,
        pitchWithRotate: true,
        touchPitch: false,
        attributionControl: { compact: true },
      });
      if (initialFocusRef.current) {
        map.jumpTo({
          center: toLngLat(initialFocusRef.current),
          zoom: 17,
          padding: { ...NO_PADDING, ...getFocusPaddingRef.current?.() },
        });
      }
      // OpenFreeMap styles reference a few patterns (like wood-pattern) their sprite does not ship.
      map.setMissingStyleImageResolver((id) => {
        // The chevron is our own and arrives a moment later; a blank stand-in would block it.
        if (id !== ROUTE_CHEVRON && !map.hasImage(id))
          map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.on("click", (event) => {
        const target = event.originalEvent.target as HTMLElement;
        if (
          !target.closest("[data-place-marker]") &&
          !target.closest("[data-person-marker]")
        ) {
          onSelectRef.current(undefined);
        }
      });
      // A camera change the person makes carries the input event behind it.
      let handling = false;
      map.on("movestart", (event) => {
        if (!event.originalEvent) return;
        // The person turning the map themselves overrides any turn it was still finishing.
        bearingGoalRef.current = null;
        handling = true;
        onUserPanRef.current?.();
      });
      map.on("moveend", () => {
        if (!handling) return;
        handling = false;
        onUserSettleRef.current?.();
      });
      let rotated = false;
      map.on("rotate", () => {
        // The heading cone is drawn relative to the screen, so it turns back as the map turns.
        const shown = headingRef.current?.current();
        applyHeading(userMarkerRef.current, shown === undefined ? undefined : shown - map.getBearing());
        const goal = bearingGoalRef.current;
        if (goal !== null && Math.abs(map.getBearing() - goal) < 0.5) bearingGoalRef.current = null;
        const nowRotated = Math.abs(map.getBearing()) > 1;
        if (nowRotated !== rotated) {
          rotated = nowRotated;
          onRotatedChangeRef.current?.(nowRotated);
        }
      });
      // Chips size themselves from this, in CSS, so zooming never re-renders them.
      const markZoom = () => {
        const band = zoomBand(map.getZoom());
        if (containerRef.current && containerRef.current.dataset.zoom !== band) containerRef.current.dataset.zoom = band;
      };
      markZoom();
      map.on("zoom", markZoom);
      map.on("style.load", () => {
        // The outline goes first, so the route is drawn over it.
        applyOutlineLayers(map, outlinedRef.current);
        applyRouteLayers(map, routesRef.current);
        applyBuildingView(map, buildingViewRef.current, "keep", rotatableRef.current);
        applyActivityHeat(map, placesRef.current, activityRef.current);
      });
      map.on("click", PREVIOUS_HIT, (event) => {
        event.preventDefault();
        onPreviousRoutePressRef.current?.();
      });
      map.on("mouseenter", PREVIOUS_HIT, () => {
        if (onPreviousRoutePressRef.current)
          map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", PREVIOUS_HIT, () => {
        map.getCanvas().style.cursor = "";
      });

      if (cancelled) {
        map.remove();
        return;
      }
      mapRef.current = map;
      map.on("load", relayout);
      map.once("load", () => onLoadRef.current?.());
      ro = new ResizeObserver(relayout);
      ro.observe(containerRef.current);
      window.visualViewport?.addEventListener("resize", relayout);
      window.addEventListener("orientationchange", relayout);
      window.addEventListener("pageshow", relayout);
      document.addEventListener("visibilitychange", relayoutWhenShown);
      // The first frame can be lost, leaving the base map black under the labels until the first touch.
      settleTimer = window.setTimeout(relayout, 1200);
      media.addEventListener("change", handleScheme);
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      media.removeEventListener("change", handleScheme);
      window.visualViewport?.removeEventListener("resize", relayout);
      window.removeEventListener("orientationchange", relayout);
      window.removeEventListener("pageshow", relayout);
      document.removeEventListener("visibilitychange", relayoutWhenShown);
      window.clearTimeout(settleTimer);
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      userGlideRef.current?.stop();
      userGlideRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      peopleMarkers.forEach(({ glide }) => glide.stop());
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    routesRef.current = { active: route, previous: previousRoute };
    const map = mapRef.current;
    if (!isReady || !map) return;
    applyRouteLayers(map, routesRef.current);
    // A new route, or one to somewhere else, draws itself in; walking along it or a reroute does not.
    const end = route && route.length > 1 ? route[route.length - 1] : undefined;
    const drawn = end ? `${end.latitude.toFixed(5)},${end.longitude.toFixed(5)}` : null;
    if (drawn && drawn !== drawnEndRef.current) revealRoute(map, revealFrameRef);
    drawnEndRef.current = drawn;
  }, [isReady, route, previousRoute]);

  useEffect(() => {
    const frame = revealFrameRef;
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!isReady || !map) return;
    applyBuildingView(map, buildingView, "ease", rotatable);
  }, [isReady, buildingView, rotatable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isReady || !map) return;
    applyActivityHeat(map, places, activityByPlace);
  }, [isReady, places, activityByPlace]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isReady || !map) return;
    // Back on campus the camera is pulled inside the campus again on its own.
    map.setMaxBounds(unbounded ? null : CAMPUS_BOUNDS);
    map.setMinZoom(unbounded ? STREETS_MIN_ZOOM : CAMPUS_MIN_ZOOM);
  }, [isReady, unbounded]);

  useEffect(() => {
    const lib = libRef.current;
    const map = mapRef.current;
    if (!isReady || !lib || !map) return;

    const markers = markersRef.current;
    const visible = new Set(places.map((place) => place.id));

    for (const [id, { marker }] of markers) {
      if (!visible.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    for (const place of places) {
      if (markers.has(place.id)) continue;
      // MapLibre positions this element; React draws the chip inside it through a portal.
      const host = document.createElement("div");
      const marker = new lib.Marker({ element: host, anchor: "center" })
        .setLngLat(toLngLat(place.coordinate))
        .addTo(map);
      markers.set(place.id, { marker, host });
    }
    setHosts(new Map([...markers].map(([id, { host }]) => [id, host])));
  }, [isReady, places]);

  useEffect(() => {
    const markers = markersRef.current;
    for (const [id, { marker }] of markers) {
      const raised = id === selectedId || id === originId || stopNumbers?.[id] !== undefined || (activityByPlace?.[id] ?? 0) > 0;
      // The chip pointed at grows to show its name, so it rises above its neighbours.
      marker.getElement().style.zIndex = id === hovered ? "5" : raised ? "2" : "1";
    }
  }, [hosts, selectedId, originId, stopNumbers, activityByPlace, hovered]);

  useEffect(() => {
    const outlined: Outlined[] = [];
    if (selectedId) outlined.push({ id: selectedId, kind: "selected" });
    if (hovered && hovered !== selectedId) outlined.push({ id: hovered, kind: "hover" });
    outlinedRef.current = outlined;
    const map = mapRef.current;
    if (isReady && map) applyOutlineLayers(map, outlined);
  }, [isReady, selectedId, hovered]);

  const chipState = (id: string): ChipState =>
    id === selectedId ? "selected" : stopNumbers?.[id] !== undefined ? "stop" : id === originId ? "origin" : "idle";
  const placesById = new Map(places.map((place) => [place.id, place]));

  useEffect(() => {
    const lib = libRef.current;
    const map = mapRef.current;
    if (!isReady || !lib || !map) return;

    if (!userLocation) {
      userGlideRef.current?.stop();
      userGlideRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    if (!userMarkerRef.current) {
      // The first fix places the dot; every one after that glides it along.
      userMarkerRef.current = new lib.Marker({
        element: createUserMarker(),
        anchor: "center",
      })
        .setLngLat(toLngLat(userLocation))
        .addTo(map);
      userMarkerRef.current.getElement().style.zIndex = "3";
      userGlideRef.current = createGlide(userMarkerRef.current, USER_GLIDE_MS);
      applyHeading(userMarkerRef.current, headingRef.current?.current());
      return;
    }
    userGlideRef.current?.to(userLocation);
  }, [isReady, userLocation]);

  useEffect(() => {
    const lib = libRef.current;
    const map = mapRef.current;
    if (!isReady || !lib || !map) return;

    const markers = peopleMarkersRef.current;
    const shown = new Set(people?.map((person) => person.id));
    for (const [id, entry] of markers) {
      if (!shown.has(id)) {
        entry.glide.stop();
        entry.marker.remove();
        markers.delete(id);
      }
    }
    for (const person of people ?? []) {
      let entry = markers.get(person.id);
      if (!entry) {
        const el = createPersonMarker();
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          onPersonPressRef.current?.(person.id);
        });
        // The marker needs a position before it joins the map, or MapLibre reads an empty one.
        const marker = new lib.Marker({
          element: el,
          anchor: "bottom",
          offset: [0, 4],
        })
          .setLngLat(toLngLat(person.coordinate))
          .addTo(map);
        entry = { marker, el, glide: createGlide(marker, PERSON_GLIDE_MS) };
        markers.set(person.id, entry);
      } else {
        entry.glide.to(person.coordinate);
      }
      paintPersonMarker(entry.el, person);
      entry.marker.getElement().style.zIndex = person.isDestination ? "4" : "3";
    }
  }, [isReady, people]);

  useEffect(() => {
    const lib = libRef.current;
    const map = mapRef.current;
    if (!isReady || !lib || !map) return;
    if (!destinationPin) {
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = null;
      return;
    }
    pinMarkerRef.current ??= new lib.Marker({
      element: createPinMarker("Meet here"),
      anchor: "bottom",
      offset: [0, 4],
    });
    pinMarkerRef.current.setLngLat(toLngLat(destinationPin)).addTo(map);
  }, [isReady, destinationPin]);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="group/map h-full w-full"
        role="application"
        aria-label="Campus map"
      />
      {[...hosts].map(([id, host]) => {
        const place = placesById.get(id);
        if (!place) return null;
        return createPortal(
          <PlaceChip
            place={place}
            state={chipState(id)}
            stop={id === selectedId ? undefined : stopNumbers?.[id]}
            activity={activityByPlace?.[id] ?? 0}
            onPress={(picked) => onSelectRef.current(picked)}
            onHover={setHovered}
          />,
          host,
          id,
        );
      })}
    </div>
  );
}
