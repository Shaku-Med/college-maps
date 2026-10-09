# Contributing to CSI Map
## ℹ️ The CSI map name is what I call it, but you can rename it to your own college, make sure to put all your college data in to it properly.

Thanks for wanting to help. CSI Map is an unofficial campus map for the College of Staten Island, built by a student, for students. It is also built so other colleges can reuse it, so improvements that help every campus are especially welcome.

## Before you start

- **Small fixes** like a typo, a wrong building name, or a broken link can go straight to a pull request.
- **Anything bigger**, like a new feature, a new dependency, or a change to how directions work, needs an issue first so we can agree on the approach before you spend time on it.
- **Wrong or missing walking paths** usually come from OpenStreetMap. Fixing them there helps everyone. Then run `npm run campus:paths` in `app` to rebuild the path graph.

## How the project is laid out

```
app/       Next.js web app (HeroUI, MapLibre)
mobile/    Expo app for iPhone and Android
backend/
  bkapp/   Go API: places, sign in, accounts
  rtapp/   Go realtime server for live meetup locations
```

The mobile app imports the web app's logic directly from `app/src`: search, routing, directions, parking and schedules. A change there affects both apps, so test both. Shared files must only import through the `@/` aliases, never a package by name.

Everything specific to CSI lives in `app/campus/campus.json`. Campus details belong there, not in the code.

## Running it

**Web**

```bash
cd app
npm install
npm run dev
```

**Mobile:** follow `mobile/README.md`. The app uses native code, so it runs in a development build, not Expo Go. Add packages with `npx expo install`, not `npm install`, so versions match the Expo SDK.

**Backend:** copy `.env.example` to `.env.development` in `backend/bkapp` or `backend/rtapp`, fill it in, then `go run ./cmd/api`. The servers refuse to start when a required setting is missing. That is on purpose.

## Before you open a pull request

Run the checks for whatever you touched:

```bash
# web
cd app && npm run typecheck && npm run lint && npm run build

# mobile
cd mobile && npm run typecheck && npm run lint

# backend
cd backend/bkapp && go test ./...
cd backend/rtapp && go test ./...
```

Then check it yourself:

- Look at your change in both light and dark mode, and at phone width.
- For anything about directions or location, test it while moving with a simulated location, not just standing still. Try speed changes, GPS jumps and missed turns.
- If the change applies to both the web and the app, update both.

## Code style

- Match the code around you. Clear names beat clever code.
- Comment only when the reason is not obvious, in one short line. No big comment blocks.
- Use the theme tokens (`background`, `foreground`, `muted`, `accent`, `border` and so on). Never hardcode colors. Show a selected item with a background highlight, not just a color change.
- Keep spacing, corner radius and motion consistent with the rest of the app. It should feel designed, not generated.
- No new dependencies or paid services without agreeing in an issue first. This is a student project with no budget.

## Security

These rules are not optional.

- **Never commit secrets:** no `.env` files, API keys, tokens, `google-services.json` or `GoogleService-Info.plist`. Only `.env.example` files belong in git.
- **Validate every input:** type, length and format.
- **Fail closed:** if a required setting or secret is missing, stop. Never fall back silently.
- **No secrets in client code**, web or mobile.
- **Rate limit and origin check** any endpoint that changes data or sends email.
- **Never expose internal fields** like ids, IP addresses, tokens or private columns in API responses, page props or anything visible in the page source.
- **Protect students' privacy.** The app handles locations, schedules and school emails. Don't log them, and don't add analytics or tracking without discussing it first.

Found a vulnerability? Please don't open a public issue. Report it privately from the **Security** tab with **Report a vulnerability**.

## Database changes

Add a new numbered file in `backend/bkapp/migrations`, like `0015_something.sql`. Never edit a migration that has already been applied.

## Commits and pull requests

- Write commit messages as a plain sentence about what changed and why, for example: *Keep the map following through reroutes, since iOS reported our own camera moves as finger pans*.
- Keep each pull request to one topic.
- In the description, say what changed and how you tested it. Add screenshots for anything visual, in light and dark.
- If you used an AI tool, you are responsible for every line it wrote, so read it and test it. Don't let tools add co-author lines or commit and push on their own.

## Using CSI Map for your own college

Follow **Use it for your college** in the README. Campus details go in `campus.json`. If you had to change code to make it work for your campus, that change probably helps others too, so please send it back as a pull request.
