"use client";

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

import {
  CAMPUS,
  CAMPUS_CENTER,
  type Coordinate,
  type Place,
} from "@/data/campus";
import { cn } from "@/lib/cn";
import { resolveCssColor } from "@/lib/css-color";
import { distanceMeters, interpolate } from "@/lib/geo";

const STYLE_LIGHT = CAMPUS.map.styles.light;
const STYLE_DARK = CAMPUS.map.styles.dark;
const CAMPUS_ZOOM = CAMPUS.map.zoom;
const { south, west, north, east } = CAMPUS.map.bounds;
const CAMPUS_BOUNDS: [[number, number], [number, number]] = [
  [west, south],
  [east, north],
];
const CAMPUS_MIN_ZOOM = 13;
// Low enough to fit a drive in from another borough.
const STREETS_MIN_ZOOM = 9;
const DARK_QUERY = "(prefers-color-scheme: dark)";
const ROUTE_SOURCE = "route";
const PREVIOUS_SOURCE = "route-previous";
const PREVIOUS_HIT = "route-previous-hit";
const BUILDINGS_3D = "campus-buildings-3d";
const BUILDING_PITCH = 52;
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

export type CampusMapHandle = {
  focus: (coordinate: Coordinate, padding?: Partial<PaddingOptions>) => void;
  follow: (coordinate: Coordinate, padding?: Partial<PaddingOptions>, zoom?: number) => void;
  fitPath: (path: Coordinate[], padding?: Partial<PaddingOptions>) => void;
  showCampus: () => void;
  setHeading: (degrees: number | undefined) => void;
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
  userLocation?: Coordinate;
  people?: readonly MapPerson[];
  destinationPin?: Coordinate;
  route?: Coordinate[];
  previousRoute?: Coordinate[];
  initialFocus?: Coordinate;
  getFocusPadding?: () => Partial<PaddingOptions>;
  onSelect: (place: Place | undefined) => void;
  onUserPan?: () => void;
  onPreviousRoutePress?: () => void;
  onPersonPress?: (id: string) => void;
  buildingView?: boolean;
  /** Lets the camera leave campus, for a street route from somewhere else. */
  unbounded?: boolean;
};

const markerBase =
  "flex h-7 min-w-9 cursor-pointer items-center justify-center rounded-full border px-2.5 text-xs font-semibold shadow-sm transition-[transform,background-color] duration-150 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const markerIdle = "border-border bg-overlay text-overlay-foreground";
const markerActive = "scale-110 border-accent bg-accent text-accent-foreground";
const markerOrigin =
  "scale-105 border-foreground bg-foreground text-background";

function markerLabel(place: Place) {
  return place.label ?? place.id;
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

type RouteLines = { active?: Coordinate[]; previous?: Coordinate[] };

function applyRouteLayers(map: MapLibreMap, { active, previous }: RouteLines) {
  if (!map.isStyleLoaded()) return;

  const activeSource = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (activeSource) {
    activeSource.setData(routeFeature(active));
    map
      .getSource<GeoJSONSource>(PREVIOUS_SOURCE)
      ?.setData(routeFeature(previous));
    return;
  }

  map.addSource(PREVIOUS_SOURCE, {
    type: "geojson",
    data: routeFeature(previous),
  });
  map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeFeature(active) });

  // Draw above every road and path layer but below the first label that follows them.
  const layers = map.getStyle().layers;
  const lastShapeIndex = layers.findLastIndex(
    (layer) => layer.type !== "symbol",
  );
  const beforeLabels = layers
    .slice(lastShapeIndex + 1)
    .find((layer) => layer.type === "symbol")?.id;
  const layout = { "line-cap": "round", "line-join": "round" } as const;
  const casing = resolveCssColor("--overlay", "#ffffff");
  const accent = resolveCssColor("--accent", "#3b82f6");
  const wide = ["interpolate", ["linear"], ["zoom"], 14, 5, 18, 13] as const;
  const narrow = ["interpolate", ["linear"], ["zoom"], 14, 3, 18, 8] as const;

  const add = (id: string, source: string, paint: Record<string, unknown>) =>
    map.addLayer(
      { id, type: "line", source, layout, paint } as Parameters<
        MapLibreMap["addLayer"]
      >[0],
      beforeLabels,
    );

  // The old route stays visible but faded, so the walker can still choose it.
  add(`${PREVIOUS_SOURCE}-casing`, PREVIOUS_SOURCE, {
    "line-color": casing,
    "line-width": wide,
    "line-opacity": 0.45,
  });
  add(`${PREVIOUS_SOURCE}-line`, PREVIOUS_SOURCE, {
    "line-color": accent,
    "line-width": narrow,
    "line-opacity": 0.35,
    "line-dasharray": [1.2, 1.4],
  });
  add(PREVIOUS_HIT, PREVIOUS_SOURCE, {
    "line-color": accent,
    "line-width": 28,
    "line-opacity": 0,
  });
  add(`${ROUTE_SOURCE}-casing`, ROUTE_SOURCE, {
    "line-color": casing,
    "line-width": wide,
  });
  add(`${ROUTE_SOURCE}-line`, ROUTE_SOURCE, {
    "line-color": accent,
    "line-width": narrow,
  });
}

function applyBuildingView(map: MapLibreMap, on: boolean, camera: "ease" | "keep") {
  if (!map.isStyleLoaded() || !map.getSource("openmaptiles")) return;

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

  map.setMaxPitch(60);
  if (on) {
    map.dragRotate.enable();
    map.touchPitch.enable();
    map.touchZoomRotate.enableRotation();
    map.keyboard.enableRotation();
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

  map.dragRotate.disable();
  map.touchPitch.disable();
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  if (camera === "ease" && (map.getPitch() > 0.5 || Math.abs(map.getBearing()) > 0.5)) {
    map.easeTo({ pitch: 0, bearing: 0, duration: 650, essential: true });
  }
}

function createUserMarker() {
  const el = document.createElement("div");
  el.className = "relative size-4";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Your location");

  // A wedge that fans out from the dot toward where the phone is pointing, like Apple Maps.
  const cone = document.createElement("div");
  cone.dataset.headingCone = "";
  cone.className =
    "pointer-events-none absolute bottom-1/2 left-1/2 h-14 w-16 -translate-x-1/2 origin-bottom opacity-0 transition-opacity duration-300 will-change-transform [clip-path:polygon(50%_100%,0_0,100%_0)] bg-[radial-gradient(circle_at_50%_100%,color-mix(in_oklab,var(--accent)_70%,transparent),transparent_72%)]";

  const dot = document.createElement("div");
  dot.className =
    "absolute inset-0 rounded-full border-2 border-white bg-accent shadow-[0_0_0_6px_color-mix(in_oklab,var(--accent)_25%,transparent)]";

  el.append(cone, dot);
  return el;
}

// A friend on the map: a round avatar with a little point underneath, like Apple Maps. Their name
// only appears while you are following them, so a busy map stays readable.
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

// Slides a marker to each new position instead of jumping, easing out so it settles gently. A new
// position mid slide carries on from wherever the marker is, so it never snaps back first.
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
      // A browser can stop handing out frames while the page still counts as visible, as battery
      // saving and some embedded views do. The marker still has to end up where the person is.
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

// Chases the latest compass reading every animation frame. The bigger the gap, the faster it moves:
// a real turn lands in a few frames so the cone feels attached to the phone, while small sensor
// wobble is eased out instead of shaking.
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

export function CampusMap({
  ref,
  places,
  selectedId,
  originId,
  userLocation,
  people,
  destinationPin,
  route,
  previousRoute,
  initialFocus,
  getFocusPadding,
  onSelect,
  onUserPan,
  onPreviousRoutePress,
  onPersonPress,
  buildingView = false,
  unbounded = false,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(
    new Map<string, { marker: Marker; el: HTMLButtonElement }>(),
  );
  const userMarkerRef = useRef<Marker | null>(null);
  const userGlideRef = useRef<Glide | null>(null);
  const peopleMarkersRef = useRef(
    new Map<string, { marker: Marker; el: HTMLElement; glide: Glide }>(),
  );
  const pinMarkerRef = useRef<Marker | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [isReady, setIsReady] = useState(false);

  const onSelectRef = useRef(onSelect);
  const onUserPanRef = useRef(onUserPan);
  const routesRef = useRef<RouteLines>({
    active: route,
    previous: previousRoute,
  });
  const onPreviousRoutePressRef = useRef(onPreviousRoutePress);
  const onPersonPressRef = useRef(onPersonPress);
  const initialFocusRef = useRef(initialFocus);
  const getFocusPaddingRef = useRef(getFocusPadding);
  const buildingViewRef = useRef(buildingView);

  const headingRef = useRef<ReturnType<typeof createHeadingAnimator> | null>(
    null,
  );

  useEffect(() => () => headingRef.current?.stop(), []);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onUserPanRef.current = onUserPan;
    onPreviousRoutePressRef.current = onPreviousRoutePress;
    onPersonPressRef.current = onPersonPress;
    getFocusPaddingRef.current = getFocusPadding;
    buildingViewRef.current = buildingView;
  }, [onSelect, onUserPan, onPreviousRoutePress, onPersonPress, getFocusPadding, buildingView]);

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
      mapRef.current?.easeTo({
        center: toLngLat(coordinate),
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
    let ro: ResizeObserver | null = null;

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
      // A transparent placeholder keeps the console quiet and the area simply renders unpatterned.
      map.setMissingStyleImageResolver((id) => {
        if (!map.hasImage(id))
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
      map.on("dragstart", () => onUserPanRef.current?.());
      map.on("style.load", () => {
        applyRouteLayers(map, routesRef.current);
        applyBuildingView(map, buildingViewRef.current, "keep");
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
      ro = new ResizeObserver(relayout);
      ro.observe(containerRef.current);
      window.visualViewport?.addEventListener("resize", relayout);
      window.addEventListener("orientationchange", relayout);
      window.addEventListener("pageshow", relayout);
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
    if (isReady && map) applyRouteLayers(map, routesRef.current);
  }, [isReady, route, previousRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!isReady || !map) return;
    applyBuildingView(map, buildingView, "ease");
  }, [isReady, buildingView]);

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
      let entry = markers.get(place.id);
      if (!entry) {
        const wrapper = document.createElement("div");
        const el = document.createElement("button");
        el.type = "button";
        el.dataset.placeMarker = place.id;
        el.textContent = markerLabel(place);
        el.setAttribute("aria-label", place.name);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelectRef.current(place);
        });
        wrapper.appendChild(el);
        const marker = new lib.Marker({ element: wrapper, anchor: "center" })
          .setLngLat(toLngLat(place.coordinate))
          .addTo(map);
        entry = { marker, el };
        markers.set(place.id, entry);
      }

      const isSelected = place.id === selectedId;
      const isOrigin = place.id === originId;
      entry.el.className = cn(
        markerBase,
        isSelected ? markerActive : isOrigin ? markerOrigin : markerIdle,
      );
      entry.el.setAttribute("aria-pressed", String(isSelected));
      entry.marker.getElement().style.zIndex =
        isSelected || isOrigin ? "2" : "1";
    }
  }, [isReady, places, selectedId, originId]);

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
        className="h-full w-full"
        role="application"
        aria-label="Campus map"
      />
    </div>
  );
}
