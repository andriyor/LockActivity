// Keeps a Live Activity on the Lock Screen by re-starting it via APNs push-to-start
// before iOS's 8h limit. Zero dependencies: node >= 20.
// Run directly for manual control, or via toggl-poll.mjs / toggl-webhook.mjs to mirror Toggl.
//
// Env:
//   APNS_KEY_PATH  path to AuthKey_XXXX.p8
//   APNS_KEY_ID    key id (10 chars)
//   APNS_TEAM_ID   team id
//   BUNDLE_ID      default com.andriyor.LockActivity
//   APNS_HOST      default api.sandbox.push.apple.com (debug builds); api.push.apple.com for TestFlight/App Store
//   PORT           default 8787 (app + manual routes; keep on the LAN)
import { createSign } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:http2'

const {
  APNS_KEY_PATH,
  APNS_KEY_ID,
  APNS_TEAM_ID,
  BUNDLE_ID = 'com.andriyor.LockActivity',
  APNS_HOST = 'api.sandbox.push.apple.com',
  PORT = '8787',
} = process.env
if (!APNS_KEY_PATH || !APNS_KEY_ID || !APNS_TEAM_ID) {
  console.error('Set APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID')
  process.exit(1)
}

const RESTART_AFTER_MS = 7.5 * 3600 * 1000 // iOS ends activities at 8h
const STATE_FILE = new URL('./state.json', import.meta.url)
// ActivityKit decodes Date as seconds since 2001-01-01 (Codable default)
const APPLE_EPOCH = 978307200

// ponytail: single device, JSON file state; use a DB keyed by device when there's more than one user
export const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : { pushToStartToken: null, activity: null, lastStartSentAt: 0, message: 'Hello from the server' }
export const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

const key = readFileSync(APNS_KEY_PATH, 'utf8')
let jwt = { token: '', iat: 0 }
function providerToken() {
  const now = Math.floor(Date.now() / 1000)
  if (now - jwt.iat < 50 * 60) return jwt.token // APNs rejects tokens older than 1h
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'ES256', kid: APNS_KEY_ID })}.${b64({ iss: APNS_TEAM_ID, iat: now })}`
  const sig = createSign('sha256').update(data).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  jwt = { token: `${data}.${sig}`, iat: now }
  return jwt.token
}

function apns(deviceToken, aps) {
  return new Promise((resolve) => {
    const client = connect(`https://${APNS_HOST}`)
    client.on('error', (e) => resolve({ status: 0, body: e.message }))
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': `${BUNDLE_ID}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
      'apns-priority': '10',
    })
    let status = 0
    let body = ''
    req.on('error', (e) => {
      client.close()
      console.log(`APNs ${aps.event} -> ${e.message}`)
      resolve({ status: 0, body: e.message }) // network failure must not crash the server
    })
    req.on('response', (h) => (status = h[':status']))
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      client.close()
      console.log(`APNs ${aps.event} -> ${status} ${body}`)
      resolve({ status, body })
    })
    req.end(JSON.stringify({ aps }))
  })
}

const nowSec = () => Math.floor(Date.now() / 1000)
const contentState = (startedAtMs) => ({
  message: state.message,
  project: state.toggl?.project,
  startedAt: startedAtMs / 1000 - APPLE_EPOCH,
})

export async function startActivity(startedAt = Date.now()) {
  if (!state.pushToStartToken) return { status: 0, body: 'no push-to-start token yet; open the app once' }
  if (state.activity) await endActivity()
  state.lastStartSentAt = Date.now()
  save()
  return apns(state.pushToStartToken, {
    event: 'start',
    timestamp: nowSec(),
    'attributes-type': 'LockAttributes',
    attributes: { title: 'Lock Activity' },
    'content-state': contentState(startedAt),
    'stale-date': nowSec() + 8 * 3600,
    'input-push-token': 1,
    alert: { title: 'Lock Activity', body: state.message },
  })
}

export async function updateActivity() {
  if (!state.activity) return startActivity()
  return apns(state.activity.token, {
    event: 'update',
    timestamp: nowSec(),
    'content-state': contentState(state.activity.startedAt),
  })
}

export async function endActivity() {
  const { token, startedAt } = state.activity
  state.activity = null
  save()
  // Apple's end payload carries the final content-state; APNs returns 200 either way, so don't rely on omitting it
  return apns(token, {
    event: 'end',
    timestamp: nowSec(),
    'content-state': contentState(startedAt),
    'dismissal-date': nowSec(),
  })
}

// Set by toggl.mjs: then the activity exists only while a Toggl timer runs.
export const mode = { toggl: false }

// Restart before the 8h cutoff. lastStartSentAt guards against retrying every minute
// when a start push landed but the app never reported the new activity's token.
setInterval(() => {
  const last = Math.max(state.activity?.startedAt ?? 0, state.lastStartSentAt)
  if (mode.toggl && !state.toggl) return // no timer running, nothing to show
  if (state.pushToStartToken && Date.now() - last > RESTART_AFTER_MS) startActivity(state.toggl?.start)
}, 60 * 1000)

const routes = {
  // app -> server
  'POST /push-to-start-token': (b) => {
    state.pushToStartToken = b.token
    save()
  },
  'POST /activity-token': (b) => {
    state.activity = { id: b.id, token: b.token, startedAt: b.startedAt * 1000 }
    save()
  },
  // you -> server
  'POST /message': (b) => {
    state.message = String(b.message)
    save()
    return updateActivity()
  },
  'POST /start': () => startActivity(),
  'GET /state': () => state,
}

export function serve(port, table) {
  createServer(async (req, res) => {
    const handler = table[`${req.method} ${req.url}`]
    if (!handler) return res.writeHead(404).end()
    let raw = ''
    for await (const c of req) raw += c
    try {
      const result = await handler(raw ? JSON.parse(raw) : {}, raw, req.headers)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result ?? { ok: true }))
    } catch (e) {
      res.writeHead(400).end(e.message)
    }
  }).listen(Number(port), () => console.log(`listening on :${port}`))
}
console.log(`APNs ${APNS_HOST}`)
serve(PORT, routes)
