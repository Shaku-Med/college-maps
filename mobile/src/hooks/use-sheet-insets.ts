import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Padding for the form screens. iOS shows them as a page sheet that already starts below the status bar; on
 * Android they fill the screen edge to edge, so the status bar height and the gesture bar come on top.
 */
export function useSheetInsets() {
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return { paddingTop: (android ? insets.top : 0) + 20, paddingBottom: (android ? insets.bottom : 0) + 48 };
}
