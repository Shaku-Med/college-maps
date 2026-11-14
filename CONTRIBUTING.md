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

**Backend:** copy `.env.example` to `.env.development` in `backend/bkapp` or `backend/rtapp`, fill it in as below, then `go run ./cmd/api`. The servers refuse to start when a required setting is missing. That is on purpose.

### Run it with no keys

Nobody needs the maintainer's `.env` files, and you should never ask for them. Everything runs on free stand ins you make yourself.

**Just the map:** run the web app with no `.env` at all. The map, search, directions and voice all work; only accounts are off. That covers most map and UI work.

**With accounts:** in `backend/bkapp/.env.development` use:

| Setting | Use | Cost |
|---|---|---|
| `DATABASE_URL` | Your own free [Neon](https://neon.tech) database, or Postgres on your machine | free |
| `EMAIL_MODE` | `log`, so sign in codes print in the terminal instead of being emailed | free |
| `TURNSTILE_SECRET` | Cloudflare's public test secret `1x0000000000000000000000000000000AA` | free |
| `AUTH_SECRET`, `TICKET_SECRET` | Two different random strings from `openssl rand -base64 48` | free |

Use the same `TICKET_SECRET` in `backend/rtapp/.env.development` if you work on live meetups. In `app/.env.development`, set `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` and keep the localhost URLs from `.env.example`. The API creates its tables on first start. With these settings nothing touches a real mail account or the production database, and production refuses the test keys, so a mixed up file fails loudly instead of quietly.

Most phone app work (the map, search, directions, screens) needs no account either. If yours needs accounts against a local API, open an issue first and we'll sort out a test setup together.

## Before you open a pull request

Every pull request runs the same checks automatically (`.github/workflows/checks.yml`), and nothing is reviewed until they pass. Run them yourself first to save a round trip:

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

## Using AI tools

AI tools are fine. Pull requests you don't understand are not.

- **You own every line.** Read all of it before you open the pull request, and be ready to explain any line in review. "The AI wrote it" is not an answer.
- **Say so.** Mention in the description which parts an AI tool wrote or changed.
- **Test it for real.** Run the checks, then use the feature yourself in light and dark mode and at phone width. A diff that passes checks but was never opened in a browser or on a phone will be closed.
- **Keep it small.** One topic per pull request. Large generated rewrites, mass reformatting, or changes to files you didn't need to touch will be closed without review.
- **Double check the risky parts.** AI tools often skip input validation, remove rate limits, log personal data, add packages, or invent APIs that don't exist. The security rules above apply to every line, generated or not.
- **No autopilot.** Don't let tools open pull requests, commit, push, or add co-author lines on their own.

## How changes reach the phone app

Merging a pull request does not ship it to phones. The maintainer releases the app on their own schedule:

- **JavaScript only changes** (screens, text, logic in `mobile/src` or the shared `app/src`) go out together as an over the air update, usually in a weekly batch. No App Store review needed.
- **Native changes** (a new package with native code, permissions, `app.json`, anything that needs a new build) wait for the next store release, a few times a semester. Say clearly in your pull request if your change needs a new build.

So there's no need to rush: a merged change just waits for the next batch.

## Using CSI Map for your own college

Follow **Use it for your college** in the README. Campus details go in `campus.json`. If you had to change code to make it work for your campus, that change probably helps others too, so please send it back as a pull request.
