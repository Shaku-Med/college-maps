import { router, Stack, useLocalSearchParams } from 'expo-router';

import { PlacePicker } from '@/components/place-picker';
import { HEADER_ICONS } from '@/lib/header-icons';
import { addStop, requestStopNow, useTrip } from '@/lib/trip';

export default function StopSheet() {
  const trip = useTrip();
  // Opened mid walk, the pick becomes the next place right away instead of joining the plan.
  const { now } = useLocalSearchParams<{ now?: string }>();

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={HEADER_ICONS.close} accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <PlacePicker
        onPick={(place) => {
          if (now === '1') requestStopNow(place.id);
          else addStop(place.id);
          router.back();
        }}
        selectedId={trip.destination?.id}
      />
    </>
  );
}
