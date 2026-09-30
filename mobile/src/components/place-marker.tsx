import { Marker } from '@maplibre/maplibre-react-native';
import { cn } from 'heroui-native';
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { Place } from '@/data/campus';

type PlaceMarkerProps = {
  place: Place;
  selected: boolean;
  /** Where a route starts, drawn like the web app's starting building. */
  origin?: boolean;
  /** How many public campus events are at this place — soft accent ring when busy. */
  activity?: number;
  onPress: (place: Place) => void;
};

// The same pill the web map uses: the building's short code, filled with the accent when selected.
export const PlaceMarker = memo(function PlaceMarker({
  place,
  selected,
  origin = false,
  activity = 0,
  onPress,
}: PlaceMarkerProps) {
  const busy = activity > 0 && !selected && !origin;
  return (
    <Marker
      id={place.id}
      lngLat={[place.coordinate.longitude, place.coordinate.latitude]}
      anchor="center"
      onPress={() => onPress(place)}>
      <View className="items-center justify-center">
        {busy ? (
          <View
            className="absolute rounded-full bg-accent/25"
            style={{ width: 28 + Math.min(activity, 4) * 6, height: 28 + Math.min(activity, 4) * 6 }}
          />
        ) : null}
        <View
          accessibilityRole="button"
          accessibilityLabel={busy ? `${place.name}, ${activity} campus events` : place.name}
          className={cn(
            'h-7 min-w-9 items-center justify-center rounded-full border px-2.5 shadow-sm',
            selected
              ? 'scale-110 border-accent bg-accent'
              : origin
                ? 'scale-105 border-foreground bg-foreground'
                : busy
                  ? 'border-accent bg-overlay'
                  : 'border-border bg-overlay',
          )}>
          <Text
            className={cn(
              'text-xs font-semibold',
              selected ? 'text-accent-foreground' : origin ? 'text-background' : 'text-overlay-foreground',
            )}>
            {place.label ?? place.id}
          </Text>
        </View>
      </View>
    </Marker>
  );
});
