import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Padding for floating form sheets. Fill the sheet width — never apply window-based
 * tablet gutters here (those crush Directions/Share inside an already-narrow iPad sheet).
 */
export function useSheetInsets() {
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return {
    width: '100%' as const,
    paddingTop: (android ? insets.top : 0) + 20,
    paddingBottom: (android ? insets.bottom : 0) + 28,
  };
}
