import { Marker } from '@maplibre/maplibre-react-native';
import type { SFSymbol } from 'expo-symbols';
import { cn, useThemeColor } from 'heroui-native';
import { memo, useState } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { SafetyKind, SafetySpot } from '@/lib/building-safety';
import type { ZoomBand } from '@/lib/place-marker';

const SYMBOLS: Record<SafetyKind, SFSymbol> = {
  exit: 'door.left.hand.open',
  aed: 'bolt.heart.fill',
  stairs: 'figure.stairs',
  elevator: 'arrow.up.arrow.down',
  restroom: 'toilet',
  chair: 'figure.roll',
  assembly: 'person.3.fill',
};

// Exits and AEDs keep the colors of the signs on the walls; the rest stay quiet.
const TILES: Record<SafetyKind, string> = {
  exit: 'bg-success',
  aed: 'bg-danger',
  stairs: 'bg-default',
  elevator: 'bg-default',
  restroom: 'bg-default',
  chair: 'bg-default',
  assembly: 'bg-success/15',
};

/** The web map's safety chips: one icon zoomed out, every icon and a name close up or once tapped. */
export const SafetyMarker = memo(function SafetyMarker({ spot, band }: { spot: SafetySpot; band: ZoomBand }) {
  const [open, setOpen] = useState(false);
  const [successInk, dangerInk, defaultInk, success] = useThemeColor([
    'success-foreground',
    'danger-foreground',
    'default-foreground',
    'success',
  ]);
  if (band === 'far') return null;
  const near = band === 'near';
  const full = near || open;
  const ink: Record<SafetyKind, string> = {
    exit: successInk,
    aed: dangerInk,
    stairs: defaultInk,
    elevator: defaultInk,
    restroom: defaultInk,
    chair: defaultInk,
    assembly: success,
  };

  return (
    <Marker
      id={`safety-${spot.id}`}
      lngLat={[spot.coordinate.longitude, spot.coordinate.latitude]}
      anchor="center"
      onPress={() => setOpen((value) => !value)}>
      <View
        accessibilityRole="button"
        accessibilityLabel={spot.description}
        accessibilityState={{ expanded: full }}
        className={cn('flex-row items-center gap-0.5 rounded-full border border-border bg-overlay p-0.5 shadow-sm', near ? 'h-7' : 'h-6')}>
        {(full ? spot.kinds : spot.kinds.slice(0, 1)).map((kind) => (
          <View key={kind} className={cn('items-center justify-center rounded-full', near ? 'size-5' : 'size-[18px]', TILES[kind])}>
            <Icon name={SYMBOLS[kind]} size={11} tintColor={ink[kind]} />
          </View>
        ))}
        {full ? (
          <Text className={cn('pl-1 pr-1.5 font-semibold text-overlay-foreground', near ? 'text-xs' : 'text-[11px]')}>{spot.label}</Text>
        ) : null}
      </View>
    </Marker>
  );
});
