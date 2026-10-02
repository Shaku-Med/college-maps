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

## Directions in the background

During directions the location comes from a background task (`src/lib/location.ts`), so guidance and speech
carry on with the app in the background or the phone locked. iOS shows its blue location pill, Android an
ongoing notification, and the Lock Screen and Dynamic Island show a Live Activity (`src/widgets`). It uses the
while in use permission only: background updates start from the tap on Start, never on their own.

## App Store review

Before submitting:

1. Set `EXPO_PUBLIC_SUPPORT_EMAIL` in each build profile's `env` in `eas.json`, so people can report other
   students' events. Apple requires a report option and a way to reach you when users can post content.
2. On the API host, set `REVIEW_EMAIL` (a school address that is nobody's real inbox), `REVIEW_CODE`
   (8 digits, new for every submission) and `REVIEW_UNTIL` (a date a few weeks out), then redeploy. The code
   stops working on its own after that date. Use the same account details in Play Console under App access.
3. In App Store Connect, give the privacy policy URL `https://csimap.vercel.app/privacy`, and paste this into
   App Review notes:

   > Sign in is only needed for friends and meetups; the map, search, classes, and directions work without it.
   > Accounts are limited to College of Staten Island emails, so please use the review account: enter
   > REVIEW_EMAIL, tap Email me a code, then enter REVIEW_CODE.
   >
   > Location is used while in use to show where you are and to guide turn by turn directions. During
   > directions it continues in the background, with the blue indicator and a Live Activity, and speaks each
   > turn, which is why the app uses the location and audio background modes. Background updates only start
   > when the user taps Start and stop when directions end. Nothing is tracked or shared outside a meetup the
   > user joins.
   >
   > Siri and Shortcuts (iOS 17 and later): open the app once, then say "Directions to Physics and Astronomy
   > in CSI Map", "Take me to class with CSI Map" (add a class in the Classes tab first), or "Show my classes
   > in CSI Map". Each opens the app with that screen ready; nothing runs without opening it. The same
   > shortcuts are listed in the Shortcuts app, and Account > Directions with Siri turns them off inside the
   > app. The Up Next widget and the Live Activity show the user's own classes and current walk only.
   >
   > The off campus driving and cycling routes come from OpenStreetMap data. This is an unofficial student
   > project and is not affiliated with the College of Staten Island.

4. App Privacy answers: email address and user id (linked to the user, for app functionality), precise
   location (not stored, used for app functionality and shared live only inside meetups), other user content
   (event titles and notes). No tracking. Siri requests stay on the phone and send nothing to the server.

5. On the App Store page, the "Supports" details come from the build on their own. Say what Siri can do in the
   description, so people know to ask:

   > Ask Siri. "Directions to the library in CSI Map" opens walking directions, "Take me to class with
   > CSI Map" heads to your next class, and "Show my classes in CSI Map" opens your schedule. They are in the
   > Shortcuts app too, ready for the Action button or a Home Screen shortcut.

   One screenshot of the Siri request is worth adding, since that is where most people first see it.

## Google Play review

1. App access: the same `REVIEW_EMAIL` and `REVIEW_CODE` as the App Store, with the steps from the review note.
2. Foreground service declaration (App content > Foreground service permissions). Play asks why each type is
   used and wants a short video of it in action:
   - Location: turn by turn walking directions keep following the route with the screen off, from Start until
     the walk ends, with the ongoing notification showing.
   - Media playback: the turn by turn voice keeps speaking each turn with the screen off during directions.
3. Location permission: only while in use (fine and coarse). There is no background location permission, so
   the background location declaration does not apply.
4. Data safety: the same answers as App Privacy above. Data is encrypted in transit, and people can delete
   their account and data in the app (Account > Delete account) or ask by email.
5. The app drops Android's draw over other apps and old storage permissions in `app.json`
   (`blockedPermissions`), since it uses neither and Play treats the first as sensitive.
6. Google Assistant has been replaced by Gemini, which does not run actions in other apps yet, so there is
   nothing to declare for it. Links like `csimap://directions/1N` and the Home Screen shortcuts work on their own.
