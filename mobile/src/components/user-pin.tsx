import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { useThemeColor } from 'heroui-native';
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { useCompass, type Fix } from '@/lib/location';
import { useMapBearing } from '@/lib/map-bearing';

const BEAM = 140;
const HALF = BEAM / 2;

function pointFeature(longitude: number, latitude: number): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  };
}

/**
 * You on the map: accent glow + facing flashlight, like Apple Maps / the web app.
 * The dot is a map layer (always visible). The beam is a fixed-size screen cone so it stays
 * readable at any zoom, not a tiny 70 m wedge on a city-wide preview.
 */
export function UserPin({ fix }: { fix: Fix }) {
  const accent = useThemeColor('accent');
  const mapBearing = useMapBearing();
  const compass = useCompass();
  // Moving, the phone's course says where someone is going; standing still, the compass (or last course).
  const heading =
    (fix.speed ?? 0) >= 0.7 && fix.heading !== undefined ? fix.heading : (compass ?? fix.heading);
  const { longitude, latitude } = fix.position;

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
