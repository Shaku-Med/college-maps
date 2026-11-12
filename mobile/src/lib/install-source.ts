import { requireOptionalNativeModule } from 'expo';

type InstallSourceModule = { installSource(): 'store' | 'testflight' | 'other' };

const native = requireOptionalNativeModule<InstallSourceModule>('InstallSource');

function read() {
  try {
    return native?.installSource() ?? 'store';
  } catch {
    return 'store';
  }
}

// Builds from before this module count as store installs, so update controls never leak into a store build.
export const IS_TEST_BUILD = read() !== 'store';
