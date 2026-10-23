import { Marker } from '@maplibre/maplibre-react-native';
import { cn, useThemeColor } from 'heroui-native';
import { memo } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { Place } from '@/data/campus';
import { CATEGORY_SYMBOLS } from '@/lib/categories';
import { lotNumber, markerKind, markerLabel, type ZoomBand } from '@/lib/place-marker';

type PlaceMarkerProps = {
  place: Place;
  selected: boolean;
  /** Where a route starts, drawn like the web app's starting building. */
  origin?: boolean;
  /** Its number when it is a stop on the way. */
  stop?: number;
  /** How many public campus events are at this place — soft accent ring when busy. */
  activity?: number;
  /** How far the map is zoomed: chips shrink when far, and buildings show what they are when near. */
  band: ZoomBand;
  onPress: (place: Place) => void;
};

type State = 'selected' | 'origin' | 'stop' | 'idle';

const SURFACE: Record<State, string> = {
  idle: 'border-border bg-overlay',
  selected: 'scale-105 border-accent bg-accent',
  origin: 'scale-105 border-foreground bg-foreground',
  stop: 'scale-105 border-accent bg-accent-soft',
};
const TEXT: Record<State, string> = {
  idle: 'text-overlay-foreground',
  selected: 'text-accent-foreground',
  origin: 'text-background',
  stop: 'text-accent-soft-foreground',
};
// The little square or circle that says what a lot or a bus stop is, before its number.
const TILE: Record<State, string> = {
  idle: 'bg-default',
  selected: 'bg-accent-foreground/20',
  origin: 'bg-background/20',
  stop: 'bg-accent/15',
};

// The same chips the web map draws: a building's code, a parking lot's P, or a bus stop, with the name once picked.
export const PlaceMarker = memo(function PlaceMarker({
  place,
  selected,
  origin = false,
  stop,
  activity = 0,
  band,
  onPress,
}: PlaceMarkerProps) {
  const [muted, overlayInk, accentInk, background, softInk] = useThemeColor([
    'muted',
    'overlay-foreground',
    'accent-foreground',
    'background',
    'accent-soft-foreground',
  ]);
  const kind = markerKind(place);
  const state: State = selected ? 'selected' : stop !== undefined ? 'stop' : origin ? 'origin' : 'idle';
  const ink = { idle: overlayInk, selected: accentInk, origin: background, stop: softInk }[state];
  const far = band === 'far';
  const busy = activity > 0 && state === 'idle';
  const textSize = far ? 'text-[11px]' : 'text-xs';
  const shape =
    kind === 'building'
      ? cn('rounded-full', far ? 'px-2' : 'px-2.5')
      : cn(kind === 'lot' ? 'rounded-lg' : 'rounded-full', far ? 'p-0.5' : 'py-0.5 pl-0.5', !far && (kind === 'lot' ? 'pr-2' : 'pr-2.5'));

  return (
    <Marker
      id={place.id}
      lngLat={[place.coordinate.longitude, place.coordinate.latitude]}
      anchor="center"
      onPress={() => onPress(place)}>
      <View className="items-center justify-center">
        <View
          accessibilityRole="button"
          accessibilityLabel={
            stop !== undefined
              ? `Stop ${stop}, ${place.name}`
              : busy
                ? `${place.name}, ${activity} campus ${activity === 1 ? 'event' : 'events'}`
                : place.name
          }
          className={cn('flex-row items-center border shadow-sm', far ? 'h-6' : 'h-7', shape, SURFACE[state], busy && 'border-accent')}>
          {kind === 'lot' ? (
            <View className={cn('size-5 items-center justify-center rounded-md', TILE[state])}>
              <Text className={cn('text-[11px] font-bold', TEXT[state])}>P</Text>
            </View>
          ) : kind === 'stop' ? (
            <View className={cn('size-5 items-center justify-center rounded-full', TILE[state])}>
              <Icon name="bus.fill" size={11} tintColor={ink} />
            </View>
          ) : band === 'near' ? (
            <View className="mr-1">
              <Icon name={CATEGORY_SYMBOLS[place.category]} size={13} tintColor={state === 'idle' ? muted : ink} />
            </View>
          ) : null}
          {kind === 'building' || !far ? (
            <Text className={cn(textSize, 'font-semibold', kind !== 'building' && 'pl-1', TEXT[state])}>
              {kind === 'lot' ? lotNumber(place) : markerLabel(place)}
            </Text>
          ) : null}
          {selected ? (
            <View className="ml-1.5 border-l border-accent-foreground/30 pl-1.5">
              <Text numberOfLines={1} className={cn(textSize, 'max-w-[170px] font-medium', TEXT[state])}>
                {place.name}
              </Text>
            </View>
          ) : null}
          {stop !== undefined && !selected ? (
            <View className="absolute -right-1.5 -top-1.5 size-4 items-center justify-center rounded-full bg-accent">
              <Text className="text-[10px] font-bold text-accent-foreground">{stop}</Text>
            </View>
          ) : busy ? (
            // The heat on the map shows where campus events are; this says how many.
            <View className="absolute -right-2 -top-2 h-4 min-w-4 items-center justify-center rounded-full border-2 border-overlay bg-accent px-1">
              <Text className="text-[10px] font-bold text-accent-foreground">{activity > 9 ? '9+' : activity}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Marker>
  );
});
