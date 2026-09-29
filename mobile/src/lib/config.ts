// The same servers the web app uses. The API is reached through the website, which forwards /v1 to it.
export const API_ORIGIN = 'https://csimap.vercel.app';
export const REALTIME_ORIGIN = 'https://college-maps-rt.onrender.com';

// Sent on every request so the servers can tell the app from a browser. Browsers always send an Origin,
// and a page on another site cannot add this header, so it stands in for the web's same origin check.
export const APP_CLIENT_HEADERS = { 'X-CSIMap-Client': 'app' } as const;
