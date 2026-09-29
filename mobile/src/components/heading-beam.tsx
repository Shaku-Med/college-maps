import { Marker } from '@maplibre/maplibre-react-native';
import { useThemeColor } from 'heroui-native';
import { View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { useCompass, type Fix } from '@/lib/location';
import { useMapBearing } from '@/lib/map-bearing';

const SIZE = 128;
const HALF = SIZE / 2;

/**
 * The soft beam from the location dot that shows which way someone is facing, like the web map's. The
 * system dot is drawn by the map underneath; this sits on the same spot and turns with the compass.
 */
export function HeadingBeam({ fix }: { fix: Fix }) {
  const accent = useThemeColor('accent');
  const mapBearing = useMapBearing();
  const compass = useCompass();
  // Moving, the phone's course says where someone is going; standing still, the compass says where they face.
  const heading = (fix.speed ?? 0) >= 0.7 && fix.heading !== undefined ? fix.heading : compass;
  if (heading === undefined) return null;
  const position = fix.position;
  const rotation = (((heading - mapBearing) % 360) + 360) % 360;

  return (
    <Marker id="heading-beam" lngLat={[position.longitude, position.latitude]} anchor="center">
      <View pointerEvents="none" style={{ width: SIZE, height: SIZE, transform: [{ rotate: `${rotation}deg` }] }}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            <RadialGradient id="beam" cx={HALF} cy={HALF} r={HALF - 4} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={accent} stopOpacity={0.6} />
              <Stop offset="0.55" stopColor={accent} stopOpacity={0.22} />
              <Stop offset="1" stopColor={accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {/* A wedge about 60 degrees wide, opening away from the dot. */}
          <Path d={`M${HALF} ${HALF} L${HALF - 34} ${6} A${HALF - 4} ${HALF - 4} 0 0 1 ${HALF + 34} ${6} Z`} fill="url(#beam)" />
        </Svg>
      </View>
    </Marker>
  );
}
