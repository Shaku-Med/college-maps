import { Camera, Map, type CameraRef, type MapRef } from '@maplibre/maplibre-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Button, useThemeColor } from 'heroui-native';
import { useRef, useState } from 'react';
import { Text, View, useColorScheme } from 'react-native';

import { Icon } from '@/components/icon';
import { PlaceMarker } from '@/components/place-marker';
import { CAMPUS, PLACES, contains, type Place } from '@/data/campus';
import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { currentFix } from '@/lib/location';
import { choosePin, useChosenPin } from '@/lib/place-choice';
import { zoomBand, type ZoomBand } from '@/lib/place-marker';

const { center, bounds, styles } = CAMPUS.map;
const PIN_ZOOM = 17.5;
const MAX_BOUNDS: [number, number, number, number] = [bounds.west, bounds.south, bounds.east, bounds.north];

// The map moves under a fixed pin, the way maps apps drop one, so a thumb never covers the spot.
export default function MeetupPinScreen() {
  const scheme = useColorScheme();
  const sheet = useSheetInsets();
  const [accent, background] = useThemeColor(['accent', 'background']);
  const mapRef = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const picked = useChosenPin();
  const [onCampus, setOnCampus] = useState(true);
  const [band, setBand] = useState<ZoomBand>(() => zoomBand(PIN_ZOOM));
  const here = currentFix()?.position;
  const start = picked ?? (here && contains(CAMPUS.map.walkingArea, here) ? here : center);

  async function meetHere() {
    const at = await mapRef.current?.getCenter().catch(() => undefined);
    if (!at || !choosePin({ longitude: at[0], latitude: at[1] })) {
      setOnCampus(false);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.dismiss(2);
  }

  // The basemap has no names, so the campus chips are drawn too; tapping one brings the pin onto it.
  function pinOn(place: Place) {
    camera.current?.easeTo({ center: [place.coordinate.longitude, place.coordinate.latitude], duration: 300 });
  }

  return (
    <View className="flex-1" style={{ backgroundColor: background }}>
      <Map
        ref={mapRef}
        style={{ flex: 1 }}
        mapStyle={scheme === 'dark' ? styles.dark : styles.light}
        logo={false}
        attribution={false}
        compass={false}
        touchPitch={false}
        onRegionDidChange={(event) => {
          const [longitude, latitude] = event.nativeEvent.center;
          setOnCampus(contains(CAMPUS.map.walkingArea, { latitude, longitude }));
          setBand(zoomBand(event.nativeEvent.zoom));
        }}>
        <Camera
          ref={camera}
          initialViewState={{ center: [start.longitude, start.latitude], zoom: PIN_ZOOM }}
          maxBounds={MAX_BOUNDS}
          minZoom={15}
          maxZoom={19.5}
        />
        {PLACES.map((place) => (
          <PlaceMarker key={place.id} place={place} selected={false} band={band} onPress={pinOn} />
        ))}
      </Map>

      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        {/* Lifted by half its height so the tip, not the middle, sits on the centre of the map. */}
        <View className="-mt-9 items-center">
          <Icon name="mappin.circle.fill" size={40} tintColor={accent} />
          <View className="-mt-1 h-3 w-0.5 rounded-full bg-accent" />
        </View>
      </View>

      <View className="absolute inset-x-0 bottom-0 gap-3 px-5 pt-4" style={{ paddingBottom: sheet.paddingBottom }}>
        <View className="rounded-2xl bg-overlay px-4 py-3 shadow-md">
          <Text className="text-sm leading-5 text-foreground">
            {onCampus ? 'Move the map until the pin sits where you want to meet.' : 'Meetups happen on campus. Move the pin back onto it.'}
          </Text>
        </View>
        <Button size="lg" isDisabled={!onCampus} onPress={() => void meetHere()}>
          <Button.Label>Meet here</Button.Label>
        </Button>
      </View>
    </View>
  );
}
