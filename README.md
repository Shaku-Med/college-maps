# CSI Map

An unofficial campus map for the College of Staten Island. Type a room code like `1N-215` and it shows the building and floor, then walks you there with in-app directions.

It is built to be reused. Everything that belongs to CSI lives in one file, `app/campus/campus.json`, so a student at another college can set it up for their own campus without touching the code.

```
app/       Next.js 16 web app, HeroUI v3, MapLibre with OpenFreeMap tiles
backend/
  bkapp/   Go API: places, email code sign in, sessions in Postgres
  rtapp/   Go realtime server for live meetup locations, standard library only
```

Working on the code, or handing it to someone else? `HANDOFF.md` explains how the pieces fit, the security model, and the rules to keep.

## Run it

```bash
cd app
npm install
npm run dev
```

Open http://localhost:3000.

## Use it for your college

You need Node 22, and an editor like VS Code helps because `campus.json` has a schema that autocompletes fields and flags mistakes as you type.

1. **Set your campus box.**
   - Open `app/campus/campus.json` and change `app`, `college`, and `map`.
   - `map.walkingArea` is a box (south, west, north, east) around your campus. You can read coordinates by right clicking a spot on openstreetmap.org.
   - `map.bounds` is a bigger box users cannot scroll out of.
   - `map.center` is where the map opens.
2. **Draft your places from OpenStreetMap.**

   ```bash
   npm run campus:places
   ```

   This writes `campus/places.draft.json` with the named buildings, parking, food, and bus stops it finds. Review it and copy what you want into `places`.
   - Give each building the **id students actually use**, like the code on signs and schedules, because room search matches against it.
   - Set a short `label` when the id is long.
   - Anything not mapped in OpenStreetMap you can add by hand, or add to OpenStreetMap for everyone.
3. **Describe your room codes** in `rooms`.
   - `pattern` is a regular expression with two named groups, `building` and `room`, in whatever order your college writes them.
   - `floor` picks how floors are read from room numbers.
   - `example` must be a real room code, because the build checks that it matches.

   | Room code | pattern | floor |
   | --- | --- | --- |
   | `1N-215` | `(?<building>[1-9][A-Z])\s*[-\s]?\s*(?<room>\d{3,4}[A-Z]?)` | `leadingDigits` |
   | `3308 Boylan` | `(?<room>\d{4})\s*(?<building>[A-Z][A-Z-]{1,15})` | `firstDigit` |
   | `SCI-B12` | `(?<building>[A-Z]{2,5})-(?<room>[A-Z]?\d{1,3})` | `none` |

4. **Download your walking paths.** This powers directions and "avoid stairs".

   ```bash
   npm run campus:paths
   ```

5. **Optional: add your college colors** in `theme`.
   - `accent` is your main color, used for buttons, the route line, and selected chips. `accentForeground` is the text on top of it.
   - Add a `dark` pair for dark mode. A lighter shade of your color usually reads better on dark backgrounds.
   - The build rejects a pair with less than 4.5:1 contrast, so buttons stay readable.
   - Your college's brand or style guide usually lists official hex values. CSI's come from the blues on csi.cuny.edu: `#1268D2` for light mode and the pale logo blue `#83C8EF` for dark.
   - Set `schedule.portalName` to the site students copy their class schedule from.
6. **Replace the app icon** at `campus/icon.svg`.
   - Use a square SVG with a full-bleed background, and keep the important shapes inside the center 80% so Android's circle crop does not cut them.
   - Keep it to the symbol only, no text, and make it big: it has to read at 16px in a browser tab.
   - Optionally add `campus/og-icon.svg` with your wordmark. It is only used on link preview images, where text is large enough to read.
   - Run `npm run campus:icons` to generate `public/favicon.ico` and `public/icons`: a rounded SVG, rounded PNG and WebP icons, square Apple touch and Android maskable icons. It needs ffmpeg and Chrome, Edge, or Chromium, but only when the icon changes. Commit the generated files.
   - It rejects SVGs with scripts or external links.
   - Do not use your college's official logo without permission. Colors and a map pin are safe.
7. **Set `app.url`** to your deployed address, like `https://csimap.example.com`. Search engines and link previews (iMessage, Discord, X) need it for canonical links and the share image.
8. **Build.**

   ```bash
   npm run build
   ```

   If `campus.json` has a problem, the build stops and lists each one, for example `campus.json places[3]: is outside map.walkingArea`. It never ships a half-configured campus.

A few things to keep:
- The OpenStreetMap and OpenFreeMap attribution stays visible on the map, as their licenses require.
- The disclaimer says the app is unofficial unless your college approves it.
- To use a different map style, put its https URLs in `map.styles`. Put any other tile or font hosts it loads from in `map.extraOrigins`, so the security policy allows them.

## How it works

- **Directions** run on the device with no routing API. `src/data/walk-graph.json` holds campus footpaths, stairs, and roads from OpenStreetMap. `src/lib/routing.ts` runs A* over it, builds turn-by-turn steps, trims the route as you walk, re-routes when you go off it, and switches to a clearly shorter route when you take a shortcut.
- **Heading and wrong way**: the location dot shows a cone for the direction the phone faces. It uses the compass, iOS asks for permission on the first tap, and it falls back to GPS walking direction. Walking backward along the route shows "Wrong way". Keep going about 30 m and it re-routes. The old route stays on the map as a faded dashed line. Walking onto it or tapping it switches back, routing you to it first if needed.
- **The map turns with you**: while navigating it faces the way you are going, from the compass when the phone has one and from the direction of travel when it does not. Small wobbles are ignored so it glides rather than twitches. The button next to Recenter switches between that and north up. Touching the map pauses following; about 8 seconds after it comes to rest it glides back to you and follows again, keeping the rotation you chose. Back in browsing, the map always faces north.
- **Knowing how you move**: every fix feeds a speed tracker (`src/lib/motion.ts`) that tells still, walking, running, riding and driving apart, needing several seconds of steady evidence so one GPS jump or a bus waiting at a light cannot fool it. Walking directions hold still while you ride a bus: no reroutes, no turn calls, no wrong way, just one spoken note, and they pick up from wherever you get off. Spoken warnings come about ten seconds before each turn at whatever speed you are going. While moving fast, the direction of travel is trusted over the compass, since a phone on a bus points anywhere. Reroutes off campus send that heading to the router with a search radius, so on a divided road or a bridge they start on the road you are actually on, not the carriageway beside it or the street underneath. The first instruction also says which way to turn, like "Turn around, then head west".
- **Campus or street directions** depend on whether you are inside the area the campus paths cover (`map.walkingArea`), not on a distance from campus, so someone on a nearby highway gets street directions instead of a campus walk that cannot reach them.
- **Getting going without every permission**: the compass is only ever asked for once a location is in hand, because phones show one permission dialog at a time and drop the rest, which used to leave the web app unable to start unless it was installed. A rough position is enough to set off, and a timeout or lost signal is retried instead of ending navigation. With no location at all, pick a starting building and follow the steps by tapping through them; the moment a location arrives, live guidance takes over.
- **Off campus** there is no campus path to follow, so directions come from OpenStreetMap's free public Valhalla server by drive, walk, or bike (`src/lib/directions.ts`). The browser calls it directly with `X-Client-Id: csimap`, and the map lets go of the campus edges while a street route shows.
- **Voice directions** use Kokoro, an open source neural voice, running in a web worker on the device (`src/lib/voice.worker.ts`), so it sounds like a person and the words never leave the phone. The model (about 90 MB, pinned to one exact revision in the worker) downloads from Hugging Face the first time and is cached. Its WebAssembly runtime is copied from `node_modules` into `public/ort/` on every build, so no CDN code runs. Making a line takes a few seconds on a phone, so lines are made ahead of time, in order of need: setting off, the first turns, "Route updated" and wrong way first, then plain stand ins like "Turn right." in the background, and everything is kept in IndexedDB. A line with a street name that is not ready in time is replaced by its stand in, so the voice stays the same through a reroute. The device's own voice only speaks when neither is ready, which in practice means the first moments of the very first trip. Students pick the voice in Account, from the best rated Kokoro voices or their phone's own voice (no download). Signed out, the choice is kept on the device; signed in, it is saved to the account (`user_settings`, migration 0014) and follows them, and signing in brings a choice made on the device up to an account that has none yet. Clips are saved per voice, so switching back is instant. To add a voice, list it in `VOICE_OPTIONS` in `src/lib/voice.ts`, in `VOICES` in the worker, and in `internal/settings` on the API; to change the model version, update `MODEL_REVISION` in the worker, and listen to the result first.
- **My classes** saves a student's schedule in `localStorage` only. It shows when to leave for the next class and warns when back-to-back classes are too far apart. The paste parser in `src/lib/schedule.ts` is best effort, so tune it against real schedule copies.
- **Offline**: `public/sw.js` caches the app, the walk graph, and every map tile a student has viewed. It only registers in production builds. Bump `VERSION` in that file when its caching rules change.
- **Security**: `src/proxy.ts` sets a nonce based Content Security Policy built from the map origins in `campus.json`. `src/data/campus.ts` validates the whole config at build time.
- **SEO**: the root layout sets the title template, description, keywords, canonical URL, Open Graph and Twitter cards, and every icon size, so every page gets them. It also adds WebApplication structured data. `opengraph-image.tsx` draws the 1200×630 share image from the campus config.
- **Share links** look like `/?place=1N&room=215`, so they work well on QR codes.

| Command | What it does |
| --- | --- |
| `npm run campus:places` | Drafts places for your campus from OpenStreetMap |
| `npm run campus:paths` | Rebuilds the walking path graph |
| `npm run campus:icons` | Generates favicon and app icons from `campus/icon.svg` |
| `npm run campus:sync` | Copies `campus.json` into the backend (also runs on every build) |
| `npm run typecheck` | TypeScript check |

## Backend

The backend has two Go services. Both refuse to start when a required variable is missing.

### Settings files

Each folder (`app`, `backend/bkapp`, `backend/rtapp`) has a `.env.example` that is committed, and two real files that are not:

| File | Used when |
| --- | --- |
| `.env.development` | Go: `APP_ENV` is unset or `development`. Next.js: `npm run dev` |
| `.env.production` | Go: the host sets `APP_ENV=production`. Next.js: `npm run build` |

Copy `.env.example` to both names and fill them in. Variables already set in the environment always win over the file, so a host's dashboard settings override anything on disk. A file whose `APP_ENV` does not match the one being loaded stops the server.

### bkapp: API and accounts

```powershell
cd backend/bkapp
go run ./cmd/api
```

For live reload while you code, install [air](https://github.com/air-verse/air) and run `air` instead. Running it in `backend` or `backend/bkapp` starts the API; run it in `backend/rtapp` for the realtime server.

Sign in is passwordless: students enter their school email (the domains in `college.emailDomains` in `campus.json`), get an 8 digit code, and receive an HttpOnly session cookie. On first sign in they pick a display name and a username; that is all other students will ever see. Data lives in Postgres (Neon works on the free tier).

The schema is plain SQL in `backend/bkapp/migrations`, applied in filename order. The API applies new files when it starts, or run them yourself with `go run ./cmd/migrate`. Applied files are recorded in a `schema_migrations` table. To change the schema, add a new file like `0002_meetups.sql` instead of editing an old one.

For Neon, use the pooled connection string with `sslmode=verify-full` and remove `channel_binding=require`, which the Go driver does not support. Production refuses anything weaker than `verify-full`.

#### Sending sign in emails for free

1. Create a Gmail account just for the app, like `csimap.signin@gmail.com`.
2. Turn on 2-Step Verification for it, then create an app password at myaccount.google.com/apppasswords.
3. In `.env.production` (or `.env.development` to test), set `EMAIL_MODE=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USERNAME` to the Gmail address, `SMTP_PASSWORD` to the app password, and `EMAIL_FROM=CSI Map <that same address>`.

Gmail allows roughly 500 emails a day, which covers a campus pilot. The connection is always encrypted, and the server refuses to send the password to a mail server that does not offer TLS. When you outgrow it, switch to `resend` with your own domain without changing code.

#### When the host blocks SMTP ports

Most free hosting blocks outbound SMTP. On Render's free plan, ports 25, 465 and 587 are closed, so `EMAIL_MODE=smtp` fails with `dial tcp ...:465: i/o timeout` and sign in returns 502. There are two free ways around it.

**Keep SMTP, change the port.** The block covers only the three standard ports, so a relay that listens on 2525 still gets through. Brevo's free tier sends 300 a day: create an account, verify the sending address, and set `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=2525`, `SMTP_USERNAME` to the Brevo login and `SMTP_PASSWORD` to the SMTP key. Mail then leaves from a shared relay rather than Gmail itself, so a plain `@gmail.com` sender is more likely to land in spam than it is over Gmail's own connection.

**Or send over https.** `EMAIL_MODE=gmail` sends the exact same email through the Gmail API on port 443, which no host blocks, from the same free Gmail account, and it keeps Gmail's own signature so inbox placement stays as good as it is today.

1. At console.cloud.google.com create a project, then under APIs & Services enable the Gmail API.
2. Under OAuth consent screen pick External, add the Gmail account as a test user, fill in the required fields, and then press Publish app. While the app sits in Testing, Google expires the refresh token after seven days.
3. Under Credentials create an OAuth client ID of type Desktop app and copy the client id and secret.
4. On your own computer run `go run ./cmd/gmailtoken -id <client id> -secret <client secret>`, open the printed link, and sign in as that Gmail account. Google will warn that the app is not verified; you are the developer and the only user, so continue. The tool prints the variables to set.
5. Set `EMAIL_MODE=gmail`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` and `EMAIL_FROM` on the host, and remove the `SMTP_*` variables.

The token only carries the `gmail.send` permission, so it can send mail as that account and cannot read the mailbox. Revoke it at myaccount.google.com/permissions if it ever leaks.

#### Running bkapp on Vercel

Vercel's Go framework preset runs an ordinary `net/http` server, so bkapp deploys there as it is: same `cmd/api`, same startup migrations, same hourly cleanup. `vercel.json` sets `"framework": "go"`, which is what tells Vercel to build the server instead of looking for serverless functions in an `api/` folder. Vercel supplies `PORT` and the server listens on it.

Vercel leaves ports 465 and 587 open, so `EMAIL_MODE=smtp` with a Gmail app password works there.

To deploy: point a Vercel project at `backend/bkapp` as its root directory, copy the variables from `.env.production`, and deploy. Push notification keys need nothing: the API makes them once and keeps them in the database (`app_keys`, migration 0015), sealed with a key derived from `AUTH_SECRET`, so every instance and every deploy signs with the same keypair and subscriptions keep working. Only the server's own startup can read that table; the API's restricted role has no access. To replace the keys, delete the `vapid` row and restart; `VAPID_*` values, if set, become the new ones.

Then point the web app's `/v1` at it. The browser always calls the web app's own origin, so the session cookie stays first party, and the site forwards `/v1` to the API. On Vercel, set `API_UPSTREAM` to the API's address; on Netlify, the redirect in `app/netlify.toml` does it. Set `NEXT_PUBLIC_API_URL` to the web app's own address in both cases. Getting this wrong used to make the site forward `/v1` to itself, which Vercel answers with `508 INFINITE_LOOP_DETECTED`; the build now stops instead. Whichever host the web app lives on, that address also has to be in the API's `ALLOWED_ORIGINS`, and in rtapp's, or sign in and live meetups are refused.

Set `CRON_SECRET` as well. A host that suspends an idle instance cannot be relied on to fire the hourly cleanup timer, so `vercel.json` schedules `GET /v1/maintenance` once a day to run the same jobs. Vercel sends the value as `Authorization: Bearer ...`. Without the variable the route answers 404 like any unknown path, so forgetting it cannot leave the endpoint open, but nothing gets cleaned up either.

#### Email design

Every email is built from `backend/bkapp/internal/email/templates`:

- `layout.html` and `layout.txt` hold the logo, sign-off area and footer shared by every email.
- `components.html` holds the pieces: `heading`, `paragraph`, `code`, `button`, `note`, and `signoff`.
- Each email is one short content file, like `login_code.html` and `login_code.txt`.

To add an email, write a new content file from those pieces, add its name to `emails` in `render.go`, and give it a method like `LoginCode`. The app name, college, colors, and disclaimer come from `campus.json`, and `npm run campus:sync` copies the app icon in as the email logo, which Gmail sends attached so it shows without loading remote images.

#### Seeing your users

Emails are encrypted, not thrown away. The server decrypts them whenever it needs one, and the owner can read every account from a terminal:

```bash
go run ./cmd/users
```

Add `-find someone@school.edu` to look up one account, or `-csv > users.csv` for a spreadsheet. Set `APP_ENV=production` to read the production database. The Neon dashboard shows emails as unreadable bytes on purpose; only this tool (or the API) with `AUTH_SECRET` can open them.

#### Security

- **Emails stay private.** The database never holds a readable email. Each address is stored as an HMAC-SHA256 blind index (to find the account) plus AES-256-GCM ciphertext bound to that index, so a copied or tampered row does not decrypt. Only `/v1/me` for the owner returns it. Display names and usernames that are built from the email are refused.
- **Separate keys.** Code hashing, the email index, email encryption, and session hashing each use their own key derived from `AUTH_SECRET` with HMAC-SHA256, so a database dump alone reveals no emails, codes, or usable sessions.
- **Codes.** 8 random digits from the OS generator, stored only as a keyed hash, valid 10 minutes, 5 tries, one live code per email, and at most 3 codes per 15 minutes and 8 per day per email. Guessing works out to about 1 in 2.5 million per day per account, however many IPs an attacker uses. Codes are left out of the email subject so they do not show on a locked phone.
- **Sessions.** 256 bit random tokens in a `__Host-` cookie (HttpOnly, Secure, SameSite=Strict), stored as a keyed hash, ending after 30 days or 14 days unused, with sign out everywhere.
- **Row level security.** RLS is on for every table (`migrations/0002_row_level_security.sql`). The Neon owner role bypasses RLS, so the API drops to a restricted `csimap_api` role inside every transaction and tells Postgres which email, session, or user the request is about. Postgres then refuses any row outside that, so a bug or injected query cannot read or change another account, and the API role cannot touch `schema_migrations` at all. Migrations and `cmd/users` run as the owner.
- **Requests.** Only listed origins can call the API with cookies, every write must carry an allowed Origin, bodies are small strict JSON, and each route is rate limited per IP. When `CLIENT_IP_HEADER` is a list header, only the last, proxy-written entry is trusted.

| Variable | What it is |
| --- | --- |
| `PORT` | Port to listen on |
| `APP_ENV` | `development` or `production` |
| `ALLOWED_ORIGINS` | Web app origins allowed to call the API with cookies |
| `DATABASE_URL` | Neon connection string, `sslmode=require` in production |
| `AUTH_SECRET` | 32+ random characters. Every encryption and hashing key is derived from it (see Security below). Changing it signs everyone out and makes stored emails unreadable, so treat it like the database password |
| `EMAIL_MODE` | `smtp` to send through a mail account over an SMTP port (free with Gmail), `gmail` to send through a Gmail account over https on hosts that block those ports, `resend` for resend.com, `log` to print codes to the console (development only) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Needed when `EMAIL_MODE=smtp` |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Needed when `EMAIL_MODE=gmail`, from `go run ./cmd/gmailtoken` |
| `RESEND_API_KEY` | Needed when `EMAIL_MODE=resend` |
| `CRON_SECRET` | Only on serverless hosts. Turns on `/v1/maintenance` for the scheduler that runs cleanup |
| `EMAIL_FROM` | Sender shown to students, like `CSI Map <yourapp@gmail.com>` |
| `CLIENT_IP_HEADER` | Optional, a client IP header your host sets itself, like `Fly-Client-IP` |

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Health check |
| `GET /v1/places` | Campus places as JSON |
| `POST /v1/auth/code` | Email a sign in code |
| `POST /v1/auth/verify` | Check the code and start a session |
| `POST /v1/auth/signout` | End the session |
| `POST /v1/auth/signout-all` | End every session for the user |
| `GET /v1/me`, `PATCH /v1/me` | Read your own account, change `displayName` or `username` |
| `GET /v1/me/settings`, `PATCH /v1/me/settings` | Your preferences, like the navigation `voice`, kept with the account. Only voices from the list in `internal/settings` are accepted |
| `GET /v1/friends` | Friends, requests both ways, and people you blocked |
| `POST /v1/friends/requests` | Ask someone by username; asking back makes you friends |
| `POST /v1/friends/requests/{username}/accept`, `DELETE /v1/friends/requests/{username}` | Accept, decline, or cancel |
| `DELETE /v1/friends/{username}` | Remove a friend |
| `POST /v1/blocks`, `DELETE /v1/blocks/{username}` | Block or unblock |
| `GET /v1/meetups`, `POST /v1/meetups` | Your active meetups, and starting one |
| `GET /v1/meetups/public`, `POST /v1/meetups/public` | The campus board, and posting to it |
| `POST /v1/meetups/{id}/join` | Say you are going to a public meetup |
| `GET /v1/meetups/{id}` | One meetup. The place is only included once you join |
| `POST /v1/meetups/{id}/respond`, `/leave`, `/end` | Join or decline, leave, or end it (host) |
| `POST /v1/meetups/{id}/ticket` | A short pass for rtapp, for joined members only |

The session cookie only reaches the API when the app and API share a site, for example `map.example.edu` and `api.example.edu`. Two unrelated domains (like a vercel.app app with an onrender.com API) will not stay signed in.

To show the account button in the web app, set `NEXT_PUBLIC_API_URL` in the app's settings file to the API origin, and `NEXT_PUBLIC_REALTIME_URL` to the rtapp origin for live meetup locations. Leave them unset to run the map without accounts.

#### Friends and meetups

Students add each other by username, never by email. A meetup invites 1 to 5 friends and picks where to meet: a friend's live location, a campus building, or a dropped pin. Invited friends see who and when, but the place only after they join. Meetups end when the host ends them or when their timer runs out, and the hourly cleanup deletes them a day later.

A **public meetup** goes on the campus board instead: any student can see it and say they are going, the spot only appears once it starts, and nobody shares a live location. The host's name is shown, the guest list is not, and blocking a host hides their meetups and takes you out of them.

Live locations go through rtapp and are never written down. A joined member asks bkapp for a pass that lasts ten minutes, and each person gets a different opaque id in every meetup, so realtime traffic cannot be linked back to an account.

bkapp embeds its own copy of `campus.json` at `internal/campus/campus.json`, because Go cannot embed files from outside its module. `npm run build` in `app` keeps it in sync.

### rtapp: live locations for meetups

```powershell
cd backend/rtapp
go run ./cmd/rt
```

rtapp streams friends' positions during a meetup with Server Sent Events and takes updates as small POST requests. It never touches the database and never stores locations: positions live in memory and vanish when someone leaves, goes quiet for 2 minutes, or the server restarts. Access uses short tickets (15 minutes max) that bkapp signs with `TICKET_SECRET`, so removing someone from a meetup cuts them off within minutes. Ticket issuing arrives in bkapp with the meetups feature.

| Route | Purpose |
| --- | --- |
| `GET /v1/stream?ticket=` | Live event stream: `snapshot`, `position`, `leave`, `expired` |
| `POST /v1/position` | Share your position (`Authorization: Bearer <ticket>`) |
| `POST /v1/leave` | Stop sharing right away |

Host rtapp somewhere that allows long lived connections (Fly.io or Render). Serverless platforms cut streams off.

`go test ./...` in either folder runs its tests. To also test bkapp against a real database, set `TEST_DATABASE_URL` to a development database; the test deletes the rows it creates.
