import { router, Stack } from 'expo-router';

import { PlacePicker } from '@/components/place-picker';
import { HEADER_ICONS } from '@/lib/header-icons';
import { addStop, useTrip } from '@/lib/trip';

export default function StopSheet() {
  const trip = useTrip();

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={HEADER_ICONS.close} accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <PlacePicker
        onPick={(place) => {
          addStop(place.id);
          router.back();
        }}
        selectedId={trip.destination?.id}
      />
    </>
  );
}
