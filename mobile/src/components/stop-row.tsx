import * as Haptics from 'expo-haptics';
import { useThemeColor } from 'heroui-native';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { Place } from '@/data/campus';

/** How many stops the directions panel lists before sending the rest to their own page. */
export const STOPS_SHOWN = 2;

type StopRowProps = {
  stop: Place;
  number: number;
  /** A starting building the traveller is not at yet. It comes first on its own and is changed with From. */
  isStart: boolean;
  onRemove: (id: string) => void;
};

export function StopRow({ stop, number, isStart, onRemove }: StopRowProps) {
  const muted = useThemeColor('muted');
  return (
    <View className="flex-row items-center gap-3 rounded-2xl bg-default px-3.5 py-2.5">
      <View className="size-6 items-center justify-center rounded-full bg-accent">
        <Text className="text-xs font-bold text-accent-foreground">{number}</Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {stop.name}
        </Text>
        {isStart ? <Text className="text-xs text-muted">On the way, since you are not there yet</Text> : null}
      </View>
      {isStart ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove the stop at ${stop.name}`}
          hitSlop={8}
          onPress={() => {
            void Haptics.selectionAsync();
            onRemove(stop.id);
          }}
          className="size-7 items-center justify-center rounded-full active:opacity-60">
          <Icon name="xmark" size={12} weight="semibold" tintColor={muted} />
        </Pressable>
      )}
    </View>
  );
}
