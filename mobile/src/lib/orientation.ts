import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Platform } from 'react-native';

// Tablets turn freely and use the whole screen.
if (Platform.OS === 'android' && Device.deviceType === Device.DeviceType.PHONE) {
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
}
