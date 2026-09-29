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
  onPress: (place: Place) => void;
};

// The same pill the web map uses: the building's short code, filled with the accent when selected.
export const PlaceMarker = memo(function PlaceMarker({ place, selected, origin = false, onPress }: PlaceMarkerProps) {
  return (
    <Marker
      id={place.id}
      lngLat={[place.coordinate.longitude, place.coordinate.latitude]}
      anchor="center"
      onPress={() => onPress(place)}>
      <View
        accessibilityRole="button"
        accessibilityLabel={place.name}
        className={cn(
          'h-7 min-w-9 items-center justify-center rounded-full border px-2.5 shadow-sm',
          selected
            ? 'scale-110 border-accent bg-accent'
            : origin
              ? 'scale-105 border-foreground bg-foreground'
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
    </Marker>
  );
});
