import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

// Builds from before this was added get it as an update without the native side, so rating stays off there.
const CAN_RATE = requireOptionalNativeModule('ExpoStoreReview') !== null;
const WALKS_KEY = 'csimap.rating.walks';
const SINCE_KEY = 'csimap.rating.since';
const ASKED_KEY = 'csimap.rating.asked';
const WALKS_BEFORE_ASKING = 3;
const DAYS_BEFORE_ASKING = 3;
const VERSION = Constants.expoConfig?.version ?? '';
const STORE_PAGE = /^https:\/\/(apps\.apple\.com|play\.google\.com)\//;

const loadStoreReview = () => import('expo-store-review');

function read(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Kept for this visit only.
  }
}

function storePage() {
  const config = Constants.expoConfig;
  const url = Platform.OS === 'ios' ? config?.ios?.appStoreUrl : config?.android?.playStoreUrl;
  return url && STORE_PAGE.test(url) ? url : null;
}

/** Counts a walk that reached its destination, and says whether this is a good moment to ask for a rating. */
export function finishedWalk() {
  if (!CAN_RATE) return false;
  const now = Date.now();
  let since = Number(read(SINCE_KEY));
  if (!(since > 0 && since <= now)) {
    since = now;
    write(SINCE_KEY, String(now));
  }
  const walks = (Number(read(WALKS_KEY)) || 0) + 1;
  write(WALKS_KEY, String(walks));
  const waited = now - since >= DAYS_BEFORE_ASKING * 24 * 60 * 60 * 1000;
  return walks >= WALKS_BEFORE_ASKING && waited && read(ASKED_KEY) !== VERSION;
}

/** Hands the moment to the system rating sheet, which decides by itself whether to show. Once per app version. */
export async function askForRating() {
  if (!CAN_RATE) return;
  write(ASKED_KEY, VERSION);
  try {
    const StoreReview = await loadStoreReview();
    if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview();
  } catch {
    // No rating sheet this time.
  }
}

async function canOpenStorePage() {
  if (!CAN_RATE || !storePage()) return false;
  try {
    // False in TestFlight, where the App Store page is not live yet.
    return await (await loadStoreReview()).isAvailableAsync();
  } catch {
    return false;
  }
}

/** Whether to offer the "Rate CSI Map" link to the store page. */
export function useCanRate() {
  const [canRate, setCanRate] = useState(false);
  useEffect(() => {
    let live = true;
    void canOpenStorePage().then((ok) => {
      if (live) setCanRate(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  return canRate;
}

export async function openStorePage() {
  const page = storePage();
  if (!page) return;
  // The App Store can open straight on the review form; Play opens the app's page with its rating box.
  const url = Platform.OS === 'ios' ? `${page}${page.includes('?') ? '&' : '?'}action=write-review` : page;
  await Linking.openURL(url).catch(() => undefined);
}
