import type { Stack } from 'expo-router';
import { Platform, type ImageSourcePropType } from 'react-native';
import type { ComponentProps } from 'react';

type HeaderIcon = ComponentProps<typeof Stack.Toolbar.Button>['icon'];
type SymbolName = Extract<NonNullable<HeaderIcon>, string>;

// Header buttons and menus are native on both platforms: iOS draws SF Symbols, while Android's header only
// takes image sources and skips a button without one, so it gets Material vector drawables instead.
const pick = (symbol: SymbolName, drawable: ImageSourcePropType): HeaderIcon => (Platform.OS === 'ios' ? symbol : drawable);

export const HEADER_ICONS = {
  close: pick('xmark', require('../../assets/icons/close.xml')),
  add: pick('plus', require('../../assets/icons/add.xml')),
  notifications: pick('bell', require('../../assets/icons/notifications.xml')),
  recent: pick('clock.arrow.circlepath', require('../../assets/icons/history.xml')),
};
