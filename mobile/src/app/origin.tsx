import { router, Stack } from 'expo-router';
import { CloseButton, ListGroup, useThemeColor } from 'heroui-native';
import { Platform } from 'react-native';

import { Icon } from '@/components/icon';
import { PlacePicker } from '@/components/place-picker';
import { MY_LOCATION, setTripOrigin, useTrip } from '@/lib/trip';

export default function OriginModal() {
  const trip = useTrip();
  const accent = useThemeColor('accent');
  const pick = (origin: string) => {
    setTripOrigin(origin);
    router.back();
  };

  return (
    <>
      {/* A real header, so searching uses the system search bar like the rest of the app. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Start from',
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          headerRight: () => <CloseButton accessibilityLabel="Close" onPress={() => router.back()} />,
          ...(Platform.OS === 'ios'
            ? { headerTransparent: true, headerBlurEffect: 'systemChromeMaterial', headerLargeStyle: { backgroundColor: 'transparent' } }
            : { headerShadowVisible: false }),
        }}
      />
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
