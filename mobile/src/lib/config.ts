// The same servers the web app uses. The API is reached through the website, which forwards /v1 to it.
export const API_ORIGIN = 'https://csimap.app';
export const REALTIME_ORIGIN = 'https://live.csimap.app';

// Stands in for the web's same origin check: a page on another site cannot add this header.
export const APP_CLIENT_HEADERS = { 'X-CSIMap-Client': 'app' } as const;
