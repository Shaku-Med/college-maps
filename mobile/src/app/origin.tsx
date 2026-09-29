import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { CloseButton, ListGroup, useThemeColor } from 'heroui-native';
import { Text, View } from 'react-native';

import { PlacePicker } from '@/components/place-picker';
import { MY_LOCATION, setTripOrigin, useTrip } from '@/lib/trip';

export default function OriginSheet() {
  const trip = useTrip();
  const accent = useThemeColor('accent');
  const pick = (origin: string) => {
    setTripOrigin(origin);
    router.back();
  };

  return (
    <View className="flex-1 gap-3 px-4 pt-5">
      <View className="flex-row items-center justify-between px-1">
        <Text className="text-xl font-bold text-foreground">Start from</Text>
        <CloseButton onPress={() => router.back()} />
      </View>
      <PlacePicker
        selectedId={trip.origin}
        onPick={(place) => pick(place.id)}
        header={
          <ListGroup>
            <ListGroup.Item onPress={() => pick(MY_LOCATION)}>
              <ListGroup.ItemPrefix>
                <SymbolView name="location.fill" size={18} tintColor={accent} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>My location</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>Follow along live as you walk</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              {trip.origin === MY_LOCATION ? (
                <ListGroup.ItemSuffix>
                  <SymbolView name="checkmark" size={15} weight="semibold" tintColor={accent} />
                </ListGroup.ItemSuffix>
              ) : null}
            </ListGroup.Item>
          </ListGroup>
        }
      />
    </View>
  );
}
