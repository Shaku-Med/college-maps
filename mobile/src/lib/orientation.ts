import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Platform } from 'react-native';

// Tablets turn freely and use the whole screen. Android phones stay upright, the way iPhones already do through
// their Info.plist; Android has no per device setting for that, so it is locked here as the app starts.
if (Platform.OS === 'android' && Device.deviceType === Device.DeviceType.PHONE) {
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
}
