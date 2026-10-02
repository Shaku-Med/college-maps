import type { SFSymbol } from 'expo-symbols';
import { router, usePathname, type Href } from 'expo-router';
import { cn, useThemeColor } from 'heroui-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { RAIL_WIDTH } from '@/hooks/use-layout';

type RailTab = { href: Href; match: string; label: string; symbol: SFSymbol; selectedSymbol: SFSymbol; online?: boolean };

const TABS: RailTab[] = [
  { href: '/', match: '/', label: 'Map', symbol: 'map', selectedSymbol: 'map.fill' },
  { href: '/classes', match: '/classes', label: 'Classes', symbol: 'calendar', selectedSymbol: 'calendar' },
  { href: '/friends', match: '/friends', label: 'Friends', symbol: 'person.2', selectedSymbol: 'person.2.fill', online: true },
  {
    href: '/account',
    match: '/account',
    label: 'Account',
    symbol: 'person.crop.circle',
    selectedSymbol: 'person.crop.circle.fill',
    online: true,
  },
  { href: '/search', match: '/search', label: 'Search', symbol: 'magnifyingglass', selectedSymbol: 'magnifyingglass' },
];

type TabRailProps = { online: boolean; friendsWaiting: number; onOffline: () => void };

/** The tab bar on Android tablets: a Material navigation rail down the left edge instead of a stretched bottom bar. */
export function TabRail({ online, friendsWaiting, onOffline }: TabRailProps) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [foreground, muted, accentSoft, accentSoftForeground, border] = useThemeColor([
    'foreground',
    'muted',
    'accent-soft',
    'accent-soft-foreground',
    'border',
  ]);

  return (
    <View
      accessibilityRole="tablist"
      className="items-center justify-center gap-3 bg-background"
      style={{
        width: RAIL_WIDTH + insets.left,
        paddingLeft: insets.left,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: border,
      }}>
      {TABS.map((tab) => {
        const selected = tab.match === '/' ? pathname === '/' : pathname.startsWith(tab.match);
        const disabled = tab.online === true && !online;
        const badge = tab.match === '/friends' && online && friendsWaiting > 0 ? friendsWaiting : 0;
        return (
          <Pressable
            key={tab.label}
            accessibilityRole="tab"
            accessibilityLabel={disabled ? `${tab.label}, unavailable offline` : tab.label}
            accessibilityState={{ selected, disabled }}
            android_ripple={{ borderless: true, radius: 36 }}
            onPress={() => (disabled ? onOffline() : router.navigate(tab.href))}
            className={cn('w-20 items-center gap-1 py-1', disabled && 'opacity-40')}>
            <View className="h-8 w-14 items-center justify-center">
              {/* Only the opacity changes: Android drops the rounded corners when a background color is swapped. */}
              <View
                style={[StyleSheet.absoluteFill, { borderRadius: 16, backgroundColor: accentSoft, opacity: selected ? 1 : 0 }]}
              />
              <Icon
                name={selected ? tab.selectedSymbol : tab.symbol}
                size={22}
                tintColor={selected ? accentSoftForeground : foreground}
              />
              {badge > 0 ? (
                <View className="absolute -top-0.5 right-2.5 h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1">
                  <Text className="text-[10px] font-bold text-danger-foreground">{badge > 9 ? '9+' : badge}</Text>
                </View>
              ) : null}
            </View>
            <Text
              className={cn('text-xs', selected ? 'font-semibold' : 'font-medium')}
              style={{ color: selected ? foreground : muted }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
