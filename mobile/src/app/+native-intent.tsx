import { handleAppLink, isWellFormedLink } from '@/lib/app-links';

// Every link into the app passes through here first, so csimap://directions/1N can plan the walk before the map opens.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (!isWellFormedLink(path)) return '/';
    return handleAppLink(path) ?? path;
  } catch {
    return '/';
  }
}
