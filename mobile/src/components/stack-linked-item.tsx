import { cn, ListGroup, useThemeColor } from 'heroui-native';
import type { ComponentProps, ReactNode } from 'react';
import { Animated, Platform } from 'react-native';

import { useLinkedRowOpacity } from '@/hooks/use-linked-row-opacity';

type ItemProps = ComponentProps<typeof ListGroup.Item>;

type StackLinkedItemProps = Omit<ItemProps, 'children'> & {
  /** True while this row's destination screen is open. */
  linked: boolean;
  /**
   * iOS stack push: fade selection with interactive pop (1 → 0).
   * Sheets/modals: solid fill only — root presentations have no stack progress.
   */
  gestureSync?: boolean;
  children: ReactNode;
};

/**
 * List row with a selected fill while its destination is open.
 * Reuse this everywhere a list row pushes or sheets a detail screen.
 */
export function StackLinkedItem({
  linked,
  gestureSync = true,
  children,
  className,
  style,
  ...rest
}: StackLinkedItemProps) {
  const opacity = useLinkedRowOpacity(linked, gestureSync);
  const fill = useThemeColor('default');
  const animate = Platform.OS === 'ios' && gestureSync;

  return (
    <ListGroup.Item
      {...rest}
      accessibilityState={{ ...(rest.accessibilityState ?? {}), selected: linked }}
      className={cn(!animate && linked && 'bg-default', className)}
      style={style}>
      {animate && linked ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: fill,
            opacity,
          }}
        />
      ) : null}
      {children}
    </ListGroup.Item>
  );
}
