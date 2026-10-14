// Entry: a plain Live Activity without Toggl, changed through the manual routes (/message, /start).
// Env: see lib/apns.mjs, lib/state.mjs, lib/http.mjs
import { keepAlive } from "./lib/activity.ts";
import { serveApp } from "./lib/http.ts";

keepAlive();
serveApp();
