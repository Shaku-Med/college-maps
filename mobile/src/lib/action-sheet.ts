import { ActionSheetIOS, Alert, Platform } from 'react-native';

export type SheetAction = { label: string; destructive?: boolean; onPress: () => void };

/** A short native action menu: an action sheet on iOS, a dialog on Android, which allows up to three. */
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
