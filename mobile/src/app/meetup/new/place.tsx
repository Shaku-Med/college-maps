import { router } from 'expo-router';

import { PlacePicker } from '@/components/place-picker';
import { choosePlace, useChosenPlace } from '@/lib/place-choice';

export default function MeetupPlaceScreen() {
  const selected = useChosenPlace();

  return (
    <PlacePicker
      selectedId={selected}
      onPick={(place) => {
        choosePlace(place.id);
        router.back();
      }}
    />
  );
}
