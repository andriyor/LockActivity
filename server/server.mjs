// Keeps a Live Activity on the Lock Screen via APNs: push-to-start when there is none (or it is
// near iOS's 8h limit), update pushes when the display changes. Zero dependencies: node >= 20.
// Run directly for manual control, or via toggl-poll.mjs / toggl-webhook.mjs to mirror Toggl.
//
// Env:
//   APNS_KEY_PATH  path to AuthKey_XXXX.p8
//   APNS_KEY_ID    key id (10 chars)
//   APNS_TEAM_ID   team id
//   BUNDLE_ID      default com.andriyor.LockActivity
//   APNS_HOST      default api.sandbox.push.apple.com (debug builds); api.push.apple.com for TestFlight/App Store
//   PORT           default 8787 (app + manual routes; keep on the LAN)
//   STATE_FILE     default server/state.json
import { createSign } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:http2";
import { fileURLToPath } from "node:url";

const {
  APNS_KEY_PATH,
  APNS_KEY_ID,
  APNS_TEAM_ID,
  BUNDLE_ID = "com.andriyor.LockActivity",
  APNS_HOST = "api.sandbox.push.apple.com",
  PORT = "8787",
  STATE_FILE = fileURLToPath(new URL("./state.json", import.meta.url)),
} = process.env;
if (!APNS_KEY_PATH || !APNS_KEY_ID || !APNS_TEAM_ID) {
  console.error("Set APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID");
  process.exit(1);
}

const TITLE = "Toggl Lock";
const RESTART_AFTER_MS = 7.5 * 3600 * 1000; // iOS ends activities at 8h
// A start push whose activity the app never reported (e.g. phone off the server's network) is
// retried after this long; shorter would re-alert the phone over and over.
const RETRY_START_MS = 60 * 60 * 1000;
// ActivityKit decodes Date as seconds since 2001-01-01 (Codable default)
const APPLE_EPOCH = 978307200;
// APNs reasons for an activity token that will never work again
const DEAD_TOKEN = new Set(["BadDeviceToken", "ExpiredToken", "Unregistered"]);

// ponytail: single device, JSON file state; use a DB keyed by device when there's more than one user
export const state = {
  pushToStartToken: null,
  pushToStartTokenAt: 0, // last time the app reported it (each launch)
  activity: null, // { id, token, createdAt } as reported by the app
  lastStartSentAt: 0,
  display: { message: "Hello from the server", project: null, startedAt: null }, // what should be on screen
  shown: null, // JSON of the display the current activity last accepted
  ...(existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {}),
};
// Write-then-rename so a crash mid-write can't leave invalid JSON behind.
export function save() {
  writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}

const key = readFileSync(APNS_KEY_PATH, "utf8");
let jwt = { token: "", iat: 0 };
function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (now - jwt.iat < 50 * 60) return jwt.token; // APNs rejects tokens older than 1h
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64({ alg: "ES256", kid: APNS_KEY_ID })}.${b64({ iss: APNS_TEAM_ID, iat: now })}`;
  const sig = createSign("sha256")
    .update(data)
    .sign({ key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  jwt = { token: `${data}.${sig}`, iat: now };
  return jwt.token;
}

const reasonOf = (body) => {
  try {
    return JSON.parse(body).reason ?? body;
  } catch {
    return body;
  }
};

// Resolves { status, reason }: 200 on success, 0 on network failure, else APNs' status and error reason.
function apns(deviceToken, aps) {
  return new Promise((resolve) => {
    const client = connect(`https://${APNS_HOST}`);
    let settled = false; // session and stream can both report the same failure
    const done = (status, reason = "") => {
      if (settled) return;
      settled = true;
      client.close();
      console.log(`APNs ${aps.event} -> ${status} ${reason}`);
      resolve({ status, reason });
    };
    client.on("error", (e) => done(0, e.message));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      "apns-topic": `${BUNDLE_ID}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
    });
    let status = 0;
    let body = "";
    req.on("error", (e) => done(0, e.message)); // network failure must not crash the server
    req.on("response", (h) => (status = h[":status"]));
    req.on("data", (c) => (body += c));
    req.on("end", () => done(status, reasonOf(body)));
    req.end(JSON.stringify({ aps }));
  });
}

const nowSec = () => Math.floor(Date.now() / 1000);
const contentState = ({ message, project, startedAt }) => ({
  message,
  project,
  startedAt: startedAt == null ? null : startedAt / 1000 - APPLE_EPOCH, // null: no timer shown
});

async function start() {
  const shown = JSON.stringify(state.display);
  const content = contentState(state.display);
  if (state.activity) {
    await apns(state.activity.token, {
      event: "end",
      timestamp: nowSec(),
      "content-state": content,
      "dismissal-date": nowSec(),
    });
  }
  state.activity = null; // the app reports the new one via /activity-token
  state.lastStartSentAt = Date.now();
  const res = await apns(state.pushToStartToken, {
    event: "start",
    timestamp: nowSec(),
    "attributes-type": "LockAttributes",
    attributes: { title: TITLE },
    "content-state": content,
    "stale-date": nowSec() + 8 * 3600,
    "input-push-token": 1,
    alert: { title: TITLE, body: state.display.message },
  });
  state.shown = res.status === 200 ? shown : null;
  save();
  return res;
}

// The only place that sends pushes. Brings the Lock Screen in line with state.display:
// start when there's no activity or it's near 8h, update when the display changed,
// retry a failed update on the next call, start over when APNs says the token is dead.
async function reconcile({ force = false } = {}) {
  if (!state.pushToStartToken)
    return { status: 0, reason: "no push-to-start token yet; open the app once" };
  const now = Date.now();
  const startRetryDue = now - state.lastStartSentAt > RETRY_START_MS;
  const needStart = !state.activity
    ? state.pushToStartTokenAt > state.lastStartSentAt || startRetryDue
    : now - state.activity.createdAt > RESTART_AFTER_MS && startRetryDue;
  if (force || needStart) return start();
  const shown = JSON.stringify(state.display);
  if (!state.activity || shown === state.shown) return { status: 200, reason: "up to date" };

  const res = await apns(state.activity.token, {
    event: "update",
    timestamp: nowSec(),
    "content-state": contentState(state.display),
  });
  if (res.status === 200) state.shown = shown;
  else if (res.status === 410 || DEAD_TOKEN.has(res.reason)) return start();
  save();
  return res;
}

// Serialized so a sync, the restart tick and manual routes can never push concurrently.
let queue = Promise.resolve();
const enqueue = (fn) =>
  (queue = queue.then(fn).catch((e) => console.error("reconcile:", e.message)));

// Set what the Lock Screen should show. Always reconciles, so a failed push is retried next call.
export function show(display) {
  state.display = display;
  save();
  return enqueue(reconcile);
}

// Restart before the 8h cutoff and retry failed pushes, even when nothing else triggers.
setInterval(() => enqueue(reconcile), 60 * 1000);

const routes = {
  // app -> server
  "POST /push-to-start-token": (b) => {
    state.pushToStartToken = b.token;
    state.pushToStartTokenAt = Date.now();
    save();
    return enqueue(reconcile);
  },
  "POST /activity-token": (b) => {
    const known = state.activity?.id === b.id;
    if (!known) state.shown = null; // its content is unknown; resend the display
    state.activity = {
      id: b.id,
      token: b.token,
      createdAt: known ? state.activity.createdAt : Date.now(),
    };
    save();
    return enqueue(reconcile);
  },
  // you -> server
  "POST /message": (b) => show({ ...state.display, message: String(b.message) }),
  "POST /start": () => enqueue(() => reconcile({ force: true })),
  "GET /state": () => state,
};

export function serve(port, table) {
  createServer(async (req, res) => {
    const handler = table[`${req.method} ${req.url}`];
    if (!handler) return res.writeHead(404).end();
    let raw = "";
    for await (const c of req) raw += c;
    try {
      const result = await handler(raw ? JSON.parse(raw) : {}, raw, req.headers);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result ?? { ok: true }));
    } catch (e) {
      res.writeHead(400).end(e.message);
    }
  }).listen(Number(port), () => console.log(`listening on :${port}`));
}
console.log(`APNs ${APNS_HOST}`);
serve(PORT, routes);
