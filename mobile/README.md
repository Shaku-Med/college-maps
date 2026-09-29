# CSI Map for iPhone

The native iOS app for CSI Map, built with Expo SDK 57, Expo Router native tabs, HeroUI Native, and MapLibre.

It does what the web app does: room search, in-app turn by turn directions on the campus paths or the street
network with spoken guidance, classes, school email sign in, friends, meetups, and live locations during a meetup.

The campus data, search, routing, directions, motion detection, class schedule, and social API are the web app's own
files in `app/src`, imported directly (see `src/lib/*.ts` and `metro.config.js`), so both apps behave the same. Those
shared files must only import through the `@/` aliases, never a package by name: Metro would resolve it from the web
app's `node_modules`, which EAS never uploads.

Sign in keeps the session token in the iOS keychain and sends it as a bearer token, with `X-CSIMap-Client: app` on
every request, to the same API and realtime server as the web app.

## Run it on your iPhone

The app uses native code (the map), so it runs in its own build, not in Expo Go. Builds happen in the cloud with
EAS, so no Mac is needed.

**TestFlight** (what you share with testers):

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

**Live updates** to TestFlight builds, without a new build:

```bash
npx eas-cli@latest update --channel production --message "What changed"
```

The app downloads it on the next launch and uses it the launch after, or right away from More, Check for updates.
Changes to native code (new native packages, app.json plugins, permissions) need a new build instead.

**Instant reload while coding** (optional): register your phone once with `npx eas-cli@latest device:create`,
build with `npx eas-cli@latest build --platform ios --profile development`, install it, then run `npx expo start`.

## Checks

```bash
npm run typecheck
npm run lint
npm run doctor
```
