import { handleAppLink } from '@/lib/app-links';

// Every link into the app passes through here first, so csimap://directions/1N can plan the walk before the map
// opens. Anything else routes as it always has.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return handleAppLink(path) ?? path;
  } catch {
    return '/';
  }
}
