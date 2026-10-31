import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type * as GeoJSON from 'geojson';
import { memo, useMemo } from 'react';

import type { Coordinate } from '@/data/campus';
import { useAlongGlide } from '@/hooks/use-glide';
import { withAlpha } from '@/lib/color-alpha';
import { progressAtDistance, remainingPath, type Route } from '@/lib/routing';

// The line is cut where the dot is drawn about ten times a second: often enough to stay under the dot, rarely enough to stay cheap.
const TRIM_FRAME_MS = 100;

const zoomed = (low: number, high: number) => ['interpolate', ['linear'], ['zoom'], 14, low, 18, high] as ExpressionSpecification;

function line(path: Coordinate[]): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (path.length < 2) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: path.map(({ latitude, longitude }) => [longitude, latitude]) },
  };
}

type RouteLineProps = {
  /** The whole line to draw when the dot is not riding the route, such as a preview or someone off the route. */
  path: Coordinate[];
  /** While the dot rides the route: the route, how far along the dot is, and the legs after this one. */
  track: { route: Route; along: number; after: Coordinate[] } | null;
  color: string;
  casing: string;
};

/** The route ahead: a soft glow, the casing, the line, and chevrons, starting right under the dot as it glides. */
export const RouteLine = memo(function RouteLine({ path, track, color, casing }: RouteLineProps) {
  const along = useAlongGlide(track?.route ?? null, track?.along ?? null, TRIM_FRAME_MS);
  const ahead = useMemo(() => {
    if (!track || along === null) return line(path);
    return line([...remainingPath(track.route, progressAtDistance(track.route, along)), ...track.after]);
  }, [path, track, along]);
  // The chevrons stay on the line cut at each fix: redrawn ten times a second they would slide along with the dot.
  const arrows = useMemo(() => line(path), [path]);
  if (!ahead) return null;

  return (
    <>
      <GeoJSONSource id="route" data={ahead}>
        <Layer
          id="route-glow"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': withAlpha(color, 0.3), 'line-width': zoomed(12, 30), 'line-blur': zoomed(6, 14) }}
        />
        <Layer
          id="route-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': casing, 'line-width': zoomed(6, 15) }}
        />
        <Layer
          id="route-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': color, 'line-width': zoomed(3.5, 9) }}
        />
      </GeoJSONSource>
      {arrows ? (
        <GeoJSONSource id="route-arrows" data={arrows}>
          <Layer
            id="route-chevrons"
            type="symbol"
            minzoom={16}
            layout={{
              'symbol-placement': 'line',
              'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 16, 44, 19, 72] as ExpressionSpecification,
              'icon-image': 'route-chevron',
              // Only close up, sized to sit inside the line like the web map (the image is 64 px, twice the web's 32).
              'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.16, 19, 0.26] as ExpressionSpecification,
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
            paint={{ 'icon-color': casing, 'icon-opacity': 0.9 }}
          />
        </GeoJSONSource>
      ) : null}
    </>
  );
});
