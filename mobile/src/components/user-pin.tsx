import type * as GeoJSON from 'geojson';
import { GeoJSONSource, Images, Layer } from '@maplibre/maplibre-react-native';
import { useThemeColor } from 'heroui-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';

import type { Coordinate } from '@/data/campus';
import { distanceMeters } from '@/lib/geo';
import { useCompass, type Fix } from '@/lib/location';

// Drawn by `npm run user-beam` from the campus accent.
const BEAM_IMAGES = {
  light: { 'user-beam': require('../../assets/images/user-beam-light.png') },
  dark: { 'user-beam': require('../../assets/images/user-beam-dark.png') },
};
// Fixes come about once a second; the dot glides between them over about the same time, like the camera.
const GLIDE_MS = 1000;
const FRAME_MS = 33;
// Further than this is a new place, not a step: the dot goes straight there.
const JUMP_METERS = 120;

/** Moves smoothly from where the dot is shown to each new target, easing out like a walk. */
function useGlide(target: Coordinate) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const { latitude, longitude } = target;

  useEffect(() => {
    const start = shownRef.current;
    const end = { latitude, longitude };
    const gap = distanceMeters(start, end);
    if (gap < 0.3 || gap > JUMP_METERS) {
      shownRef.current = end;
      setShown(end);
      return;
    }
    let frame = 0;
    let painted = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / GLIDE_MS);
      const eased = 1 - (1 - t) ** 3;
      const at = {
        latitude: start.latitude + (end.latitude - start.latitude) * eased,
        longitude: start.longitude + (end.longitude - start.longitude) * eased,
      };
      shownRef.current = at;
      if (t === 1 || now - painted >= FRAME_MS) {
        painted = now;
        setShown(at);
      }
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [latitude, longitude]);

  return shown;
}

function pointFeature(longitude: number, latitude: number): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  };
}

/** You on the map: glow, dot, and facing cone, drawn by the map from one source so they move and turn together. */
export function UserPin({ fix, at }: { fix: Fix; at?: Coordinate | null }) {
  const accent = useThemeColor('accent');
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const compass = useCompass();
  // The cone shows where the phone points at any speed; GPS course only stands in while there is no compass.
  const heading = compass ?? fix.heading;
  // During directions the dot sits on the route, or the walkway underfoot, instead of raw GPS.
  const { longitude, latitude } = useGlide(at ?? fix.position);
  const point = useMemo(() => pointFeature(longitude, latitude), [longitude, latitude]);

  return (
    <>
      <Images images={BEAM_IMAGES[scheme]} />
      <GeoJSONSource id="user-location" data={point}>
        <Layer
          id="user-beam"
          type="symbol"
          layout={{
            'icon-image': 'user-beam',
            'icon-rotate': heading ?? 0,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
          paint={{ 'icon-opacity': heading === undefined ? 0 : 1 }}
        />
        <Layer
          id="user-glow"
          type="circle"
          paint={{
            'circle-radius': 18,
            'circle-color': accent,
            'circle-opacity': 0.28,
            'circle-pitch-alignment': 'map',
          }}
        />
        <Layer
          id="user-dot"
          type="circle"
          paint={{
            'circle-radius': 8,
            'circle-color': accent,
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
            'circle-pitch-alignment': 'map',
          }}
        />
      </GeoJSONSource>
    </>
  );
}
