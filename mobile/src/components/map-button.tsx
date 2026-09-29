import type { SFSymbol } from 'expo-symbols';
import { cn, useThemeColor } from 'heroui-native';
import { Text, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';

import { Icon } from '@/components/icon';

type Variant = 'primary' | 'secondary' | 'danger';

const LABEL: Record<Variant, string> = {
  primary: 'text-accent-foreground',
  secondary: 'text-accent-soft-foreground',
  danger: 'text-danger-foreground',
};

type MapButtonProps = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  symbol?: SFSymbol;
  isDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The buttons that float over the map. They look like HeroUI's, but the press is recognised natively by the
 * gesture handler, so a busy JS thread or the map under them cannot cancel a tap on Android.
 */
export function MapButton({ label, onPress, variant = 'primary', size = 'md', symbol, isDisabled = false, style }: MapButtonProps) {
  const colors = useThemeColor(['accent', 'default', 'danger', 'accent-foreground', 'accent-soft-foreground', 'danger-foreground']);
  const [accent, surface, danger, accentForeground, secondaryForeground, dangerForeground] = colors;
  const background = { primary: accent, secondary: surface, danger }[variant];
  const tint = { primary: accentForeground, secondary: secondaryForeground, danger: dangerForeground }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: size === 'lg' ? 56 : 48,
          paddingHorizontal: size === 'lg' ? 20 : 16,
          gap: 8,
          borderRadius: 999,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.98 : 1 }],
        },
        style,
      ]}>
      {symbol ? <Icon name={symbol} size={size === 'lg' ? 16 : 13} weight="bold" tintColor={tint} /> : null}
      <Text className={cn('font-medium', size === 'lg' ? 'text-lg' : 'text-base', LABEL[variant])}>{label}</Text>
    </Pressable>
  );
}
