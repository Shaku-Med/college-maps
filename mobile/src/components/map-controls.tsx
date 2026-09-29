import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useThemeColor } from 'heroui-native';
import { Fragment } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';

import { Glass } from '@/components/glass';

export type MapControl = {
  symbol: SFSymbol;
  label: string;
  onPress: () => void;
  active?: boolean;
};

function tap(onPress: () => void) {
  void Haptics.selectionAsync();
  onPress();
}

// The map's sources, required by OpenStreetMap's license. Tucked behind a small button instead of sitting on
// the map, the way Apple Maps does it.
function showAttribution() {
  Alert.alert('Map data', 'Map tiles by OpenFreeMap. Data © OpenMapTiles and © OpenStreetMap contributors.', [
    { text: 'OpenStreetMap', onPress: () => void Linking.openURL('https://www.openstreetmap.org/copyright') },
    { text: 'OpenFreeMap', onPress: () => void Linking.openURL('https://openfreemap.org') },
    { text: 'Done', style: 'cancel' },
  ]);
}

/** One glass capsule holding the map buttons, like Apple Maps, with the map credits underneath. */
export function MapControls({ controls }: { controls: MapControl[] }) {
  const [foreground, accent, separator, muted] = useThemeColor(['foreground', 'accent', 'separator', 'muted']);

  return (
    <View pointerEvents="box-none" className="items-center gap-2.5">
      <Glass interactive className="w-12 overflow-hidden rounded-3xl">
        {controls.map((control, index) => (
          <Fragment key={control.label}>
            {index > 0 ? <View className="mx-3 h-px" style={{ backgroundColor: separator, opacity: 0.6 }} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={control.label}
              accessibilityState={{ selected: control.active }}
              onPress={() => tap(control.onPress)}
              className="h-12 items-center justify-center active:opacity-60">
              <SymbolView
                name={control.symbol}
                size={19}
                weight="medium"
                tintColor={control.active ? accent : foreground}
              />
            </Pressable>
          </Fragment>
        ))}
      </Glass>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Map data sources"
        hitSlop={8}
        onPress={() => tap(showAttribution)}
        className="active:opacity-60">
        <Glass className="size-7 items-center justify-center rounded-full">
          <SymbolView name="info" size={12} weight="semibold" tintColor={muted} />
        </Glass>
      </Pressable>
    </View>
  );
}
