import { router } from 'expo-router';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlacePicker } from '@/components/place-picker';
import { choosePlace, useChosenPlace } from '@/lib/place-choice';

export default function MeetupPlaceScreen() {
  const insets = useSafeAreaInsets();
  const selected = useChosenPlace();

  return (
    <View
      className="flex-1 px-4 pt-3"
      style={{ width: '100%', paddingBottom: Platform.OS === 'android' ? insets.bottom : 0 }}>
      <PlacePicker
        selectedId={selected}
        onPick={(place) => {
          choosePlace(place.id);
          router.back();
        }}
      />
    </View>
  );
}
