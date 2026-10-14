# LockActivity

Live Activity on the Lock Screen. The app restarts it when opened; the server restarts it
every ~7.5h via APNs push-to-start so it stays without opening the app.

## Free team (no push)

    xcodegen generate && open LockActivity.xcodeproj

## With server (paid Apple Developer account)

1. Xcode → Settings → Accounts: add the paid account. Put its team id in `project.yml` (`DEVELOPMENT_TEAM`).
2. developer.apple.com → Keys → `+` → enable *Apple Push Notifications service (APNs)* → download `AuthKey_XXXX.p8`. Note the Key ID and Team ID.
3. `cp server/.env.example server/.env` and fill in the APNs values (`.env` is gitignored).
   Start the server (Mac and iPhone on the same Wi-Fi):

       node --env-file=server/.env server/server.mjs

4. Build the app with push, run on the iPhone, allow Local Network access:

       ENABLE_PUSH=true xcodegen generate && open LockActivity.xcodeproj

5. Try it (with the app closed):

       curl -XPOST localhost:8787/start                               # push-to-start a new activity
       curl -XPOST localhost:8787/message -d '{"message":"hi"}'       # update it
       curl localhost:8787/state

The first server-started activity shows Allow / Don't Allow on the Lock Screen; tap Allow once.

`SERVER_URL` in `project.yml` is this Mac's `.local` address; change it if you host the server elsewhere.

## Mirror the running Toggl Track timer

The activity appears when a Toggl timer starts (from any device, e.g. the desktop browser),
shows project, description and elapsed time, and ends when the timer stops. The elapsed time
ticks on-device (also in Always-On), so pushes are sent only when something changes.

Both modes read `/me/time_entries/current` (code in `server/toggl.mjs`); they differ in *when*.
Put `TOGGL_API_TOKEN` (track.toggl.com/profile) in `server/.env`.

### Polling — `server/toggl-poll.mjs` (start here)

Nothing has to be public. Changes appear within ~2.5 min: Toggl allows `/me` endpoints only
30 requests/hour per user on every plan, so the server checks every 150 s (~24/h).

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

### Hosting

Needs an always-on process (8h restart timer, state file) and HTTP/2 to APNs, so serverless
(Workers, Vercel) doesn't fit. Mac (stops when asleep), Raspberry Pi or a small VPS all work.

- Server → APNs needs no certificate of yours; the `.p8` key authenticates it.
- iPhone → server: ATS only allows plain `http://` to `.local` names and IP addresses, so
  `http://<mac>.local:8787` (same Wi-Fi) or `http://<tailscale-ip>:8787` (Tailscale on the phone,
  VPN On Demand so token reports never miss) work; a full domain needs HTTPS.

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
