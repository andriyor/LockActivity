# LockActivity

Live Activity on the Lock Screen. The app restarts it when opened; the server restarts it
every ~7.5h via APNs push-to-start so it stays without opening the app.

## Free team (no push)

    xcodegen generate && open LockActivity.xcodeproj

## With server (paid Apple Developer account)

1. Xcode → Settings → Accounts: add the paid account. Put its team id in `project.yml` (`DEVELOPMENT_TEAM`).
2. developer.apple.com → Keys → `+` → enable *Apple Push Notifications service (APNs)* → download `AuthKey_XXXX.p8`. Note the Key ID and Team ID.
3. Start the server (Mac and iPhone on the same Wi-Fi):

       APNS_KEY_PATH=~/AuthKey_XXXX.p8 APNS_KEY_ID=XXXX APNS_TEAM_ID=YYYY node server/server.mjs

4. Build the app with push, run on the iPhone, allow Local Network access:

       ENABLE_PUSH=true xcodegen generate && open LockActivity.xcodeproj

5. Try it (with the app closed):

       curl -XPOST localhost:8787/start                               # push-to-start a new activity
       curl -XPOST localhost:8787/message -d '{"message":"hi"}'       # update it
       curl localhost:8787/state

The first server-started activity shows Allow / Don't Allow on the Lock Screen; tap Allow once.
`SERVER_URL` in `project.yml` is this Mac's `.local` address; change it if you host the server elsewhere.
