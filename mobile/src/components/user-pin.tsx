import type * as GeoJSON from 'geojson';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { useThemeColor } from 'heroui-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import type { Coordinate } from '@/data/campus';
import { distanceMeters } from '@/lib/geo';
import { useCompass, type Fix } from '@/lib/location';
import { useMapBearing } from '@/lib/map-bearing';

const BEAM = 140;
const HALF = BEAM / 2;
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

/** You on the map: accent glow + facing flashlight, like Apple Maps / the web app. */
export function UserPin({ fix, at }: { fix: Fix; at?: Coordinate | null }) {
  const accent = useThemeColor('accent');
  const mapBearing = useMapBearing();
  const compass = useCompass();
  // The cone shows where the phone points at any speed; GPS course only stands in on a phone without a compass.
  const heading = compass ?? fix.heading;
  // During directions the dot sits on the route, or the walkway underfoot, instead of raw GPS.
  const { longitude, latitude } = useGlide(at ?? fix.position);

  const point = useMemo(() => pointFeature(longitude, latitude), [longitude, latitude]);
  const rotation = heading === undefined ? 0 : (((heading - mapBearing) % 360) + 360) % 360;

  return (
    <>
      <GeoJSONSource id="user-location" data={point}>
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

      {heading !== undefined ? (
        <Marker id="user-beam" lngLat={[longitude, latitude]} anchor="center">
          <View
            pointerEvents="none"
            style={{
              width: BEAM,
              height: BEAM,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ rotate: `${rotation}deg` }],
            }}>
            <Svg width={BEAM} height={BEAM}>
              <Defs>
                <RadialGradient id="user-beam-fill" cx={HALF} cy={HALF} r={HALF - 4} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={accent} stopOpacity={0.7} />
                  <Stop offset="0.45" stopColor={accent} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={accent} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Path
                d={`M${HALF} ${HALF} L${HALF - 40} ${8} A${HALF - 6} ${HALF - 6} 0 0 1 ${HALF + 40} ${8} Z`}
                fill="url(#user-beam-fill)"
              />
            </Svg>
          </View>
        </Marker>
      ) : null}
    </>
  );
}
