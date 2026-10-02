import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Padding for floating form sheets. */
export function useSheetInsets() {
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return {
    width: '100%' as const,
    paddingTop: (android ? insets.top : 0) + 20,
    paddingBottom: (android ? insets.bottom : 0) + 28,
  };
}
