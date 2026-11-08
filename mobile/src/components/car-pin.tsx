import { useThemeColor } from 'heroui-native';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icon';

/** Where the car was left, shaped like a friend's pin so it reads as something personal, not a campus place. */
export function CarPin({ onPress }: { onPress: () => void }) {
  const accentForeground = useThemeColor('accent-foreground');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Your car" hitSlop={8} onPress={onPress} className="items-center">
      <View className="rounded-full border-2 border-overlay bg-overlay p-0.5 shadow-md">
        <View className="size-7 items-center justify-center rounded-full bg-accent">
          <Icon name="car.fill" size={14} tintColor={accentForeground} />
        </View>
      </View>
      <View className="-mt-1.5 size-3 rotate-45 rounded-[3px] bg-overlay" />
    </Pressable>
  );
}
