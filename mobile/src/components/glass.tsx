import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { cn } from 'heroui-native';
import type { ReactNode } from 'react';
import { View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import { withUniwind } from 'uniwind';

export const HAS_LIQUID_GLASS = isLiquidGlassAvailable();
// GlassView is a native view, which Tailwind classes do not reach on their own.
const StyledGlassView = withUniwind(GlassView);

type GlassProps = {
  children?: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
  /** Corner radius. The native glass reads it from the style to shape itself. */
  radius?: number;
  /** Colors the glass, like a warning. Without Liquid Glass it becomes a solid fill of that color. */
  tint?: ColorValue;
};

/** Liquid Glass on iOS 26, and a solid floating surface on anything older. */
export function Glass({ children, className, style, interactive = false, radius, tint }: GlassProps) {
  const shape = radius === undefined ? style : [{ borderRadius: radius, overflow: 'hidden' as const }, style];
  if (HAS_LIQUID_GLASS) {
    return (
      <StyledGlassView isInteractive={interactive} tintColor={tint} className={className} style={shape}>
        {children}
      </StyledGlassView>
    );
  }
  return (
    <View
      className={cn('border border-border bg-overlay shadow-md', tint !== undefined && 'border-transparent', className)}
      style={[shape, tint !== undefined ? { backgroundColor: tint } : null]}>
      {children}
    </View>
  );
}
