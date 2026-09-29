import type { SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { Icon } from '@/components/icon';
import type { RouteStep } from '@/lib/routing';

function symbolFor(step: RouteStep): SFSymbol {
  if (step.kind === 'stairs') return 'figure.stairs';
  if (step.kind === 'arrive') return 'flag.checkered';
  if (step.kind === 'depart') return 'arrow.up';
  switch (step.direction) {
    case 'slight-left':
      return 'arrow.up.left';
    case 'left':
    case 'sharp-left':
      return 'arrow.turn.up.left';
    case 'slight-right':
      return 'arrow.up.right';
    case 'right':
    case 'sharp-right':
      return 'arrow.turn.up.right';
    default:
      return 'arrow.up';
  }
}

export function StepIcon({ step, size = 22, color }: { step: RouteStep; size?: number; color: ColorValue }) {
  return <Icon name={symbolFor(step)} size={size} weight="semibold" tintColor={color} />;
}
