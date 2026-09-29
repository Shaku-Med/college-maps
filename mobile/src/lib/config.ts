// The same servers the web app uses. The API is reached through the website, which forwards /v1 to it.
export const API_ORIGIN = 'https://csimap.vercel.app';
export const REALTIME_ORIGIN = 'https://college-maps-rt.onrender.com';

// Sent on every request so the servers can tell the app from a browser. Browsers always send an Origin,
// and a page on another site cannot add this header, so it stands in for the web's same origin check.
export const APP_CLIENT_HEADERS = { 'X-CSIMap-Client': 'app' } as const;

// Where reports about other people's events go. Apple requires a way to report content and a way to reach
// the developer, so it is set per build in eas.json. Without it, the Report option is hidden.
const supportEmail = (process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '').trim();
export const SUPPORT_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(supportEmail) ? supportEmail : '';
