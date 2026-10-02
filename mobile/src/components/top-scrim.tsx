import { useThemeColor } from 'heroui-native';
import { View } from 'react-native';

// Theme colors come back as hex or rgb(a).
function withAlpha(color: string, alpha: number, dark: boolean) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  let rgb: [number, number, number] | null = null;
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/(.)/g, '$1$1') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
  } else {
    const parts = /^rgba?\(([^)]+)\)$/i.exec(color)?.[1].split(/[\s,/]+/).map(Number);
    if (parts && parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) rgb = [parts[0], parts[1], parts[2]];
  }
  const [r, g, b] = rgb ?? (dark ? [10, 10, 12] : [245, 245, 245]);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Fades the map edge into the background so the chips, status bar, and tab bar stay readable over it. */
export function EdgeScrim({ edge, height, dark }: { edge: 'top' | 'bottom'; height: number; dark: boolean }) {
  const background = useThemeColor('background');
  const stop = (alpha: number) => withAlpha(background, alpha, dark);
  return (
    <View
      pointerEvents="none"
      className={edge === 'top' ? 'absolute inset-x-0 top-0' : 'absolute inset-x-0 bottom-0'}
      style={{
        height,
        experimental_backgroundImage: `linear-gradient(to ${edge === 'top' ? 'bottom' : 'top'}, ${stop(0.94)} 0%, ${stop(0.82)} 45%, ${stop(0.45)} 75%, ${stop(0)} 100%)`,
      }}
    />
  );
}

export const TopScrim = ({ height, dark }: { height: number; dark: boolean }) => (
  <EdgeScrim edge="top" height={height} dark={dark} />
);
