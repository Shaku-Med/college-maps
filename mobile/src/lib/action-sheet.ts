import { ActionSheetIOS, Alert, Platform } from 'react-native';

export type SheetAction = { label: string; destructive?: boolean; onPress: () => void };

/**
 * A short menu of actions: the native action sheet on iOS, and a native dialog on Android, which holds up to
 * three actions and closes with Back or a tap outside. Menus in this app never need more than three.
 */
export function showActionSheet({ title, message, actions }: { title?: string; message?: string; actions: SheetAction[] }) {
  if (Platform.OS === 'ios') {
    const options = [...actions.map((action) => action.label), 'Cancel'];
    const destructive = actions.flatMap((action, index) => (action.destructive ? [index] : []));
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message, options, destructiveButtonIndex: destructive, cancelButtonIndex: actions.length },
      (index) => actions[index]?.onPress(),
    );
    return;
  }
  Alert.alert(
    title ?? '',
    message,
    actions.slice(0, 3).map((action) => ({
      text: action.label,
      style: action.destructive ? 'destructive' : 'default',
      onPress: action.onPress,
    })),
    { cancelable: true },
  );
}
