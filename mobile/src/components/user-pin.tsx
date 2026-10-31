import type * as GeoJSON from 'geojson';
import { GeoJSONSource, Images, Layer } from '@maplibre/maplibre-react-native';
import { useThemeColor } from 'heroui-native';
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import type { Coordinate } from '@/data/campus';
import { useAlongGlide, useGlide } from '@/hooks/use-glide';
import { useCompass, type Fix } from '@/lib/location';
import { progressAtDistance, type Route } from '@/lib/routing';

// Drawn by `npm run user-beam` from the campus accent.
const BEAM_IMAGES = {
  light: { 'user-beam': require('../../assets/images/user-beam-light.png') },
  dark: { 'user-beam': require('../../assets/images/user-beam-dark.png') },
};

function pointFeature(longitude: number, latitude: number): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  };
}

/** You on the map: glow, dot, and facing cone, drawn by the map from one source so they move and turn together. */
export function UserPin({
  fix,
  at,
  track,
}: {
  fix: Fix;
  at?: Coordinate | null;
  /** On the route during directions: the dot glides along the road by distance, in step with the route line. */
  track?: { route: Route; along: number } | null;
}) {
  const accent = useThemeColor('accent');
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const compass = useCompass();
  // The cone shows where the phone points at any speed; GPS course only stands in while there is no compass.
  const heading = compass ?? fix.heading;
  // During directions the dot sits on the route, or the walkway underfoot, instead of raw GPS.
  // While the dot rides the route, the plain glide only needs to land, not paint every frame.
  const free = useGlide(at ?? fix.position, track ? 1000 : 33);
  const along = useAlongGlide(track?.route ?? null, track?.along ?? null);
  const { longitude, latitude } = track && along !== null ? progressAtDistance(track.route, along).point : free;
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
            // The same ring as the web dot, small enough that the beam reads from close to the dot.
            'circle-radius': 14,
            'circle-color': accent,
            'circle-opacity': 0.25,
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
