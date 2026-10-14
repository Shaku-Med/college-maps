import { router, Stack } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { StopRow } from '@/components/stop-row';
import { HEADER_ICONS } from '@/lib/header-icons';
import { useLocation } from '@/lib/location';
import { MAX_STOPS, stopCount, tripPlan } from '@/lib/stops';
import { removeStop, useTrip } from '@/lib/trip';

/** Every stop on the way, when there are more than the directions panel lists. */
export default function StopsSheet() {
  const trip = useTrip();
  const location = useLocation();
  const accent = useThemeColor('accent');
  const destination = trip.destination;
  const plan = destination
    ? tripPlan({ origin: trip.origin, stops: trip.stops, after: trip.after, destination, here: location.fix?.position })
    : null;
  const stops = plan ? plan.targets.filter((_, i) => i !== plan.destinationIndex) : [];
  const later = plan ? plan.targets.length - 1 - plan.destinationIndex : 0;
  const row = (stop: (typeof stops)[number], index: number) => {
    const isStart = stop.id === trip.origin && !trip.stops.includes(stop.id) && !trip.after.includes(stop.id);
    return (
      <StopRow
        key={stop.id}
        stop={stop}
        number={index + 1}
        isStart={isStart}
        note={index >= stops.length - later ? `After ${destination?.name}` : undefined}
        onRemove={removeStop}
      />
    );
  };

  return (
    <>
      <Stack.Toolbar placement="right">
        {stopCount(trip) < MAX_STOPS ? (
          <Stack.Toolbar.Button icon={HEADER_ICONS.add} accessibilityLabel="Add a stop" onPress={() => router.push('/stop')} />
        ) : null}
        <Stack.Toolbar.Button icon={HEADER_ICONS.close} accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-2 px-4 pb-10 pt-2">
        {stops.slice(0, stops.length - later).map(row)}
        {destination ? (
          <View className="flex-row items-center gap-3 px-3.5 py-2.5">
            <Icon name="flag.checkered" size={16} tintColor={accent} />
            <Text className="min-w-0 flex-1 text-sm text-muted" numberOfLines={1}>
              Then on to <Text className="font-semibold text-foreground">{destination.name}</Text>
            </Text>
          </View>
        ) : null}
        {stops.map((stop, index) => (index >= stops.length - later ? row(stop, index) : null))}
        {stops.length === 0 ? <Text className="py-10 text-center text-sm text-muted">No stops on the way</Text> : null}
      </ScrollView>
    </>
  );
}
