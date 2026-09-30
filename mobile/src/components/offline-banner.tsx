import { useThemeColor } from 'heroui-native';
import { Platform, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import { useOnline } from '@/lib/online';

/** Persistent chip while the phone has no internet. Map, classes, and search still work offline. */
export function OfflineBanner() {
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const muted = useThemeColor('muted');
  // Sit just above the tab bar (or home indicator when the bar is hidden during navigation).
  const bottom = insets.bottom + (Platform.OS === 'android' ? 88 : 58);

  if (online) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      className="absolute left-0 right-0 z-50 items-center px-4"
      style={{ bottom }}>
      <Animated.View entering={FadeInUp.duration(220)} exiting={FadeOutDown.duration(160)}>
        <Glass className="flex-row items-center gap-2 rounded-full px-3.5 py-2" radius={999}>
          <Icon name="wifi.slash" size={14} weight="semibold" tintColor={muted} />
          <Text className="text-xs font-medium text-foreground">No internet. Map and classes still work.</Text>
        </Glass>
      </Animated.View>
    </View>
  );
}
