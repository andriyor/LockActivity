# Toggl Lock

Your running [Toggl Track](https://track.toggl.com) timer as a Live Activity on the iPhone Lock Screen
(and Always-On Display), even when the timer is started or stopped on another device, e.g. the
desktop browser. With nothing running it shows "No running timer".

The activity stays up permanently: a small Node server watches Toggl and sends APNs pushes.
The elapsed time ticks on the phone, so pushes go out only when something changes.

## Layout

- `ios/` — the iPhone app and its Live Activity widget (XcodeGen: `ios/project.yml`)
- `server/` — the Node server that watches Toggl and sends APNs pushes (no runtime dependencies;
  `package.json` is only for Prettier and `npm test`)

## Setup

Needs a paid Apple Developer account (push notifications) and Node ≥ 20.

1. Xcode → Settings → Accounts: add the paid account; put its team id in `ios/project.yml` (`DEVELOPMENT_TEAM`).
2. developer.apple.com → Certificates, Identifiers & Profiles → Keys → `+` → enable
   _Apple Push Notifications service (APNs)_ → download `AuthKey_<KEY_ID>.p8` (only once).
   The team id is under Membership details.
3. `cp server/.env.example server/.env` and fill it in (`.env` and `*.p8` are gitignored):
   APNs key path/id/team, and `TOGGL_API_TOKEN` from track.toggl.com/profile.
4. Start the server (see the two modes below), e.g.

       node --env-file=server/.env server/toggl-poll.mjs

5. Build and run the app on the iPhone (same Wi-Fi as the Mac), allow Local Network access.
   In Xcode: `cd ios && ENABLE_PUSH=true xcodegen generate && open LockActivity.xcodeproj`, then Run.
   Or from the terminal:

       cd ios
       ENABLE_PUSH=true xcodegen generate
       xcodebuild -project LockActivity.xcodeproj -scheme LockActivity -destination 'id=<device-udid>' \
         -derivedDataPath build -allowProvisioningUpdates build
       xcrun devicectl device install app --device <device-udid> build/Build/Products/Debug-iphoneos/LockActivity.app
       xcrun devicectl device process launch --device <device-udid> com.andriyor.LockActivity

   (`xcrun devicectl list devices` shows the UDID.)

On launch the app sends its push token to the server, which starts the activity. The first time,
the Lock Screen asks Allow / Don't Allow — tap Allow. `SERVER_URL` in `ios/project.yml` is this Mac's
`.local` address; change it if the server runs elsewhere.

## Two ways to watch Toggl

Both read `/me/time_entries/current` (`server/lib/toggl.mjs`); they differ in _when_.

### Polling — `server/toggl-poll.mjs` (start here)

Nothing has to be public. Changes appear within `TOGGL_POLL_SECONDS` (default 150 s, ~24 req/h).
Toggl's docs say `/me` endpoints get 30 requests/hour, but the real quota can be higher — check
`GET /api/v9/me/quota` (the `organization_id: null` entry). With 240/h (Starter) use 20.
When the quota runs out the server pauses until it resets.

    node --env-file=server/.env server/toggl-poll.mjs

### Webhooks — `server/toggl-webhook.mjs` (instant)

Toggl calls the server on every time-entry change. Needs a public HTTPS URL.

1. Pick a random secret and get your workspace id.
2. Expose **only** port 8788 (it serves just the signed `POST /toggl`), e.g. `tailscale funnel 8788`
   (stable URL) or `cloudflared tunnel --url http://localhost:8788` (URL changes each run).
   Port 8787 has no auth and `/state` holds push tokens — never expose it.
3. Set `TOGGL_WEBHOOK_SECRET=<secret>` in `server/.env`, run `node --env-file=server/.env server/toggl-webhook.mjs`.
4. Subscribe (the server answers Toggl's validation ping itself):

       curl -u $TOGGL_API_TOKEN:api_token -H 'Content-Type: application/json' \
         -d '{"url_callback":"https://<public-host>/toggl","event_filters":[{"entity":"time_entry","action":"*"}],"enabled":true,"description":"LockActivity","secret":"<secret>"}' \
         https://api.track.toggl.com/webhooks/api/v1/subscriptions/<workspace_id>

## How the server works

| File                                                | Role                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `server/main.mjs`                                   | entry: plain activity, no Toggl                                                           |
| `server/toggl-poll.mjs`, `server/toggl-webhook.mjs` | entries: mirror Toggl, by polling or webhooks                                             |
| `server/lib/activity.mjs`                           | `show(display)` sets what should be on screen; `reconcile()` is the only code that pushes |
| `server/lib/apns.mjs`                               | APNs JWT + send a push                                                                    |
| `server/lib/http.mjs`                               | tiny JSON router + app routes on :8787                                                    |
| `server/lib/state.mjs`                              | state + atomic save to `server/state.json`                                                |
| `server/lib/toggl.mjs`                              | reads the current Toggl entry (+ project name) and calls `show()`                         |
| `server/test.mjs`                                   | end-to-end test                                                                           |

`reconcile()` runs one at a time (Toggl syncs, a 1-minute tick and the routes share a queue) and:

- **starts** an activity (push-to-start) when the app reports its token and none exists, or when the
  current one nears iOS's 8h limit (re-created at 7.5h);
- **updates** it when the display changed; an update counts only once APNs returns 200, so a failed
  push is retried on the next sync or tick;
- **starts over** when APNs says the activity token is dead (410 / `Unregistered`);
- retries a start whose activity the phone never reported (e.g. it was off the server's network)
  after an hour, so it doesn't keep re-alerting.

State lives in `server/state.json` (written atomically). Manual routes for poking at it:

    curl localhost:8787/state                                   # tokens, activity, current display
    curl -XPOST localhost:8787/start                            # re-create the activity now
    curl -XPOST localhost:8787/message -d '{"message":"hi"}'    # change the text (no-Toggl mode)

Running `node --env-file=server/.env server/main.mjs` alone (no Toggl) keeps a plain activity
showing that message.

Known gap: if you swipe the activity away, APNs may keep accepting updates for it, so the server
doesn't notice; it comes back at the next 7.5h restart or when you open the app.

### Test

    node server/test.mjs   # real server vs fake Toggl + fake APNs, ~2 s; doesn't touch state.json

Formatting (server code and this README): in `server/`, `npm install` once, then `npm run format`
(or `npm run format:check`). Prettier is the only dev dependency; running the server needs no `npm install`.

### Hosting

Needs an always-on process (restart tick, state file) and HTTP/2 to APNs, so serverless
(Workers, Vercel) doesn't fit. Mac (stops when asleep), Raspberry Pi or a small VPS all work.

- Server → APNs needs no certificate of yours; the `.p8` key authenticates it. `APNS_HOST` must match
  the build: sandbox (default) for Xcode builds, `api.push.apple.com` for TestFlight/App Store.
- iPhone → server: ATS only allows plain `http://` to `.local` names and IP addresses, so
  `http://<mac>.local:8787` (same Wi-Fi) or `http://<tailscale-ip>:8787` (Tailscale on the phone,
  VPN On Demand so token reports never miss) work; a full domain needs HTTPS.

## Possible next steps

- **Input checks + body size limit** (~10 lines in `serve()` and the app routes): reject a
  missing/non-string `token`/`id` and bodies over ~64 KB — mostly matters for the public webhook port.
- **Fastify** instead of the hand-rolled router: schema validation, body limits and logging for free,
  but adds `package.json`/`node_modules` to a zero-dependency server, and the webhook needs a custom
  content-type parser to keep the raw body for the signature check. Worth it once there are more routes.
- **TypeScript**: Node ≥ 22.18 runs `.ts` directly (type stripping), so no build step — rename
  `server/*.mjs` → `.ts`, type `Display`/state/APNs results, add `typescript` as a dev dependency for
  `tsc --noEmit` (`erasableSyntaxOnly`, `verbatimModuleSyntax`). Worth it if the server grows (e.g. multiple users).
- **Detect a swiped-away activity**: the app could report `activityStateUpdates` (`.dismissed`/`.ended`)
  so the server re-creates it sooner than the next 7.5h restart — only while iOS lets the app run,
  so not guaranteed.

## Without push (free Apple team)

    cd ios && xcodegen generate && open LockActivity.xcodeproj

The app starts a local activity with its own text and restarts it when opened; no server, no Toggl.

## Why a server at all (research)

- iOS suspends apps ~30 s after backgrounding; no long-lived connection or on-device polling.
  Background App Refresh runs when iOS decides (often hours apart).
- The Live Activity view can't do networking, and `Activity.request` only works with the app in the
  foreground. Starting one from the background is only possible via APNs push-to-start.
- Toggl Track's own iOS app shows a Live Activity only after the app is opened and syncs
  ([community thread](https://community.toggl.com/t/dynamic-island-only-shows-timer-when-started-from-ios-app/1303)).
- [Toggl Lockscreen Widget](https://apps.apple.com/ca/app/toggl-lockscreen-widget/id6756894639) and
  [Timery](https://apps.apple.com/app/id1425368544): tested — neither updates its Live Activity when the
  timer is changed in the desktop browser.
- The [Toggl Focus API](https://engineering.toggl.com/docs/focus/) (the other Toggl product) has a
  `tracking/current` endpoint but no webhooks; Toggl Track has
  [webhooks](https://engineering.toggl.com/docs/track/webhooks_start/).
