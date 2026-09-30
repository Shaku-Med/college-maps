import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import type { ReactNode } from 'react';
import { View } from 'react-native';

export type NativeMenuAction = {
  id: string;
  title: string;
  destructive?: boolean;
  onPress: () => void;
};

type NativeMenuProps = {
  label: string;
  actions: NativeMenuAction[];
  children: ReactNode;
};

/** Native dropdown menu: SwiftUI Menu on iOS, Material dropdown on Android. */
export function NativeMenu({ label, actions, children }: NativeMenuProps) {
  const items: MenuAction[] = actions.map((action) => ({
    id: action.id,
    title: action.title,
    attributes: action.destructive ? { destructive: true } : undefined,
  }));

  return (
    <MenuView
      title={label}
      actions={items}
      shouldOpenOnLongPress={false}
      onPressAction={({ nativeEvent }) => {
        actions.find((action) => action.id === nativeEvent.event)?.onPress();
      }}>
      <View accessibilityRole="button" accessibilityLabel={label} collapsable={false}>
        {children}
      </View>
    </MenuView>
  );
}
