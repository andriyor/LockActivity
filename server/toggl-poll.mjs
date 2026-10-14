// Entry: mirror Toggl by polling the current timer. Nothing needs to be public; changes show up
// within one interval.
// Env: see lib/*, plus
//   TOGGL_POLL_SECONDS  default 150 (~24 req/h, fits the 30/h quota). The /me quota is per user;
//                       check yours with GET /api/v9/me/quota (organization_id null). 240/h → 20 is fine.
import { keepAlive } from "./lib/activity.mjs";
import { serveApp } from "./lib/http.mjs";
import { sync } from "./lib/toggl.mjs";

const POLL_MS = Number(process.env.TOGGL_POLL_SECONDS || 150) * 1000;

keepAlive();
serveApp();
sync(); // catch up on anything that changed while the server was down
setInterval(sync, POLL_MS);
console.log(`Toggl: polling every ${POLL_MS / 1000}s`);
