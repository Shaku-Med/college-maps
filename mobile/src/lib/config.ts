// The same servers the web app uses. The API is reached through the website, which forwards /v1 to it.
export const API_ORIGIN = 'https://csimap.vercel.app';
export const REALTIME_ORIGIN = 'https://college-maps-rt.onrender.com';

// Stands in for the web's same origin check: a page on another site cannot add this header.
export const APP_CLIENT_HEADERS = { 'X-CSIMap-Client': 'app' } as const;

// Optional contact address for App Review notes.
const supportEmail = (process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '').trim();
export const SUPPORT_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(supportEmail) ? supportEmail : '';
