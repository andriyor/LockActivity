// Keeps the one Live Activity in line with state.display: push-to-start when there is none (or it
// is near iOS's 8h limit), update pushes when the display changes. reconcile() is the only code
// that pushes, and every call goes through one queue so nothing pushes concurrently.
import { push, type PushResult } from "./apns.ts";
import { save, state, type Display } from "./state.ts";

const TITLE = "Toggl Lock";
const RESTART_AFTER_MS = 7.5 * 3600 * 1000; // iOS ends activities at 8h
// A start push whose activity the app never reported (e.g. phone off the server's network) is
// retried after this long; shorter would re-alert the phone over and over.
const RETRY_START_MS = 60 * 60 * 1000;
// ActivityKit decodes Date as seconds since 2001-01-01 (Codable default)
const APPLE_EPOCH = 978307200;
// APNs reasons for an activity token that will never work again
const DEAD_TOKEN = new Set(["BadDeviceToken", "ExpiredToken", "Unregistered"]);

const nowSec = () => Math.floor(Date.now() / 1000);
const contentState = ({ message, project, startedAt }: Display) => ({
  message,
  project,
  startedAt: startedAt == null ? null : startedAt / 1000 - APPLE_EPOCH, // null: no timer shown
});

async function start(): Promise<PushResult> {
  const shown = JSON.stringify(state.display);
  const content = contentState(state.display);
  if (state.activity) {
    await push(state.activity.token, {
      event: "end",
      timestamp: nowSec(),
      "content-state": content,
      "dismissal-date": nowSec(),
    });
  }
  state.activity = null; // the app reports the new one via /activity-token
  state.lastStartSentAt = Date.now();
  const res = await push(state.pushToStartToken!, {
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
  if (res.status === 200) state.startWanted = false; // a failed start is retried on the next call
  save();
  return res;
}

// Start when there's no activity or it's near 8h, update when the display changed,
// retry a failed update on the next call, start over when APNs says the token is dead.
async function reconcile({ force = false } = {}): Promise<PushResult> {
  if (!state.pushToStartToken)
    return { status: 0, reason: "no push-to-start token yet; open the app once" };
  const now = Date.now();
  const startRetryDue = now - state.lastStartSentAt > RETRY_START_MS;
  const needStart = !state.activity
    ? state.startWanted || startRetryDue
    : now - state.activity.createdAt > RESTART_AFTER_MS && startRetryDue;
  if (force || needStart) return start();
  const shown = JSON.stringify(state.display);
  if (!state.activity || shown === state.shown) return { status: 200, reason: "up to date" };

  const res = await push(state.activity.token, {
    event: "update",
    timestamp: nowSec(),
    "content-state": contentState(state.display),
  });
  if (res.status === 200) state.shown = shown;
  else if (res.status === 410 || DEAD_TOKEN.has(res.reason)) return start();
  save();
  return res;
}

let queue: Promise<unknown> = Promise.resolve();
const enqueue = (fn: () => Promise<PushResult>) =>
  (queue = queue.then(fn).catch((e: Error) => console.error("reconcile:", e.message)));

// Set what the Lock Screen should show. Always reconciles, so a failed push is retried next call.
export function show(display: Display) {
  state.display = display;
  save();
  return enqueue(reconcile);
}

// The app reports its push-to-start token on every launch (it may arrive after /activities).
export function setPushToStartToken(token: string) {
  state.pushToStartToken = token;
  save();
  return enqueue(reconcile);
}

// The app reports each activity's push token (including ones the server started).
export function setActivity(id: string, token: string) {
  const known = state.activity?.id === id;
  if (!known) state.shown = null; // its content is unknown; resend the display
  state.activity = { id, token, createdAt: known ? state.activity!.createdAt : Date.now() };
  save();
  return enqueue(reconcile);
}

// On launch the app lists the activities still alive on the phone. If ours isn't among them
// (first launch, dismissed, ended by iOS, app reinstalled) a start is wanted. APNs may still
// accept updates for a gone activity, so this report is the only way to notice.
export function setAliveActivities(ids: string[]) {
  if (state.activity && ids.includes(state.activity.id)) return;
  if (state.activity) console.log(`activity ${state.activity.id} is gone on the phone`);
  state.activity = null;
  state.startWanted = true; // one flag, so this report and the token report can't both start
  save();
  return enqueue(reconcile);
}

// Re-create the activity now, e.g. to pick up a changed title.
export const restart = () => enqueue(() => reconcile({ force: true }));

// Restart before the 8h cutoff and retry failed pushes, even when nothing else triggers.
export const keepAlive = () => setInterval(() => enqueue(reconcile), 60 * 1000);
