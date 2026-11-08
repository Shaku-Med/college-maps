import { router } from 'expo-router';
import { ListGroup } from 'heroui-native';

import { ActionRow } from '@/components/action-row';
import { PlacePicker } from '@/components/place-picker';
import { choosePlace, useChosenPlace } from '@/lib/place-choice';

export default function MeetupPlaceScreen() {
  const selected = useChosenPlace();

  return (
    <PlacePicker
      selectedId={selected}
      header={
        <ListGroup>
          <ActionRow
            symbol="mappin.and.ellipse"
            title="Drop a pin"
            description="Anywhere on campus, like a lawn or a corner"
            onPress={() => router.push('/meetup/new/pin')}
          />
        </ListGroup>
      }
      onPick={(place) => {
        choosePlace(place.id);
        router.back();
      }}
    />
  );
}
