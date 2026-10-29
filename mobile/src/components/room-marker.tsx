import { Marker } from '@maplibre/maplibre-react-native';
import { useThemeColor } from 'heroui-native';
import { memo } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { RoomSpot } from '@/lib/building-safety';
import type { ZoomBand } from '@/lib/place-marker';
import { floorLabel } from '@/lib/search';

/** The web map's room chip: the room being looked for, inside its building, with its floor. */
export const RoomMarker = memo(function RoomMarker({ spot, band }: { spot: RoomSpot; band: ZoomBand }) {
  const ink = useThemeColor('accent-foreground');
  if (band === 'far') return null;
  const floor = floorLabel(spot.floor);
  return (
    <Marker id={`room-${spot.name}`} lngLat={[spot.coordinate.longitude, spot.coordinate.latitude]} anchor="center">
      <View
        accessibilityRole="image"
        accessibilityLabel={`Room ${spot.name}${floor ? `, ${floor}` : ''}${spot.landmark ? `, ${spot.landmark}` : ''}`}
        className="h-7 flex-row items-center gap-1 rounded-full border border-accent bg-accent py-0.5 pl-0.5 pr-2.5 shadow-md">
        <View className="size-5 items-center justify-center rounded-full bg-accent-foreground/20">
          <Icon name="door.left.hand.closed" size={11} tintColor={ink} />
        </View>
        <Text className="text-xs font-semibold text-accent-foreground">{spot.name}</Text>
        {floor ? (
          <View className="border-l border-accent-foreground/30 pl-1.5">
            <Text className="text-xs font-medium text-accent-foreground">{floor}</Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
});
