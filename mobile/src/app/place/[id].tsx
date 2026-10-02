import { router, useLocalSearchParams } from 'expo-router';
import { Button } from 'heroui-native';
import { ScrollView, Text, View } from 'react-native';

import { PlaceDetails } from '@/components/place-details';
import { getPlace } from '@/data/campus';
import { isValidRoom } from '@/lib/search';

export default function PlaceSheet() {
  const params = useLocalSearchParams<{ id: string; room?: string }>();
  const place = getPlace(params.id);
  const room = isValidRoom(params.room) ? params.room : undefined;

  if (!place) {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-8">
        <Text className="text-lg font-semibold text-foreground">That place isn’t on the map</Text>
        <Button variant="secondary" onPress={() => router.back()}>
          Close
        </Button>
      </View>
    );
  }

  return (
    <ScrollView contentContainerClassName="px-5 pb-10 pt-6" contentContainerStyle={{ width: '100%' }}>
      <PlaceDetails place={place} room={room} onDone={() => router.back()} />
    </ScrollView>
  );
}
