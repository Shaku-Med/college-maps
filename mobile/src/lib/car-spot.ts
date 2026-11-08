// Shared with the web app, so both remember the car the same way. The hook lives here because the shared file has no React.
import { useSyncExternalStore } from 'react';

import { getCarSpot, subscribeCarSpot } from '../../../app/src/lib/car-spot';

export * from '../../../app/src/lib/car-spot';

/** Where this phone remembers the car is parked, or null. */
export function useCarSpot() {
  return useSyncExternalStore(subscribeCarSpot, getCarSpot, () => null);
}
