import { router, Stack } from 'expo-router';
import { ListGroup, useThemeColor } from 'heroui-native';

import { Icon } from '@/components/icon';
import { PlacePicker } from '@/components/place-picker';
import { MY_LOCATION, setTripOrigin, useTrip } from '@/lib/trip';
import { HEADER_ICONS } from '@/lib/header-icons';

export default function OriginModal() {
  const trip = useTrip();
  const accent = useThemeColor('accent');
  const pick = (origin: string) => {
    setTripOrigin(origin);
    router.back();
  };

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={HEADER_ICONS.close} accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <PlacePicker
        selectedId={trip.origin}
        onPick={(place) => pick(place.id)}
        header={
          <ListGroup.Item onPress={() => pick(MY_LOCATION)}>
            <ListGroup.ItemPrefix>
              <Icon name="location.fill" size={18} tintColor={accent} />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>My location</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>Follow along live as you walk</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            {trip.origin === MY_LOCATION ? (
              <ListGroup.ItemSuffix>
                <Icon name="checkmark" size={15} weight="semibold" tintColor={accent} />
              </ListGroup.ItemSuffix>
            ) : null}
          </ListGroup.Item>
        }
      />
    </>
  );
}
