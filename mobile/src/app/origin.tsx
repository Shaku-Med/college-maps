import { router } from 'expo-router';
import { CloseButton, ListGroup, useThemeColor } from 'heroui-native';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PlacePicker } from '@/components/place-picker';
import { MY_LOCATION, setTripOrigin, useTrip } from '@/lib/trip';

export default function OriginModal() {
  const insets = useSafeAreaInsets();
  const trip = useTrip();
  const [accent, background] = useThemeColor(['accent', 'background']);
  const pick = (origin: string) => {
    setTripOrigin(origin);
    router.back();
  };

  return (
    <View
      className="flex-1 px-5"
      style={{
        backgroundColor: background,
        paddingTop: insets.top + 12,
        paddingBottom: Math.max(insets.bottom, 16),
      }}>
      <View className="mb-4 flex-row items-center justify-between">
        <View className="min-w-0 flex-1 pr-3">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Directions</Text>
          <Text className="text-2xl font-bold text-foreground">Start from</Text>
        </View>
        <CloseButton onPress={() => router.back()} />
      </View>
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
    </View>
  );
}
