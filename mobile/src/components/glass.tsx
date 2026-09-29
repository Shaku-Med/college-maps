import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { cn } from 'heroui-native';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

const LIQUID_GLASS = isLiquidGlassAvailable();

type GlassProps = {
  children?: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
};

/** Liquid Glass on iOS 26, and a solid floating surface on anything older. */
export function Glass({ children, className, style, interactive = false }: GlassProps) {
  if (LIQUID_GLASS) {
    return (
      <GlassView isInteractive={interactive} className={className} style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <View className={cn('border border-border bg-overlay shadow-md', className)} style={style}>
      {children}
    </View>
  );
}
