// Toggl mode 1: poll the current timer. Nothing needs to be public; changes show up within ~2.5 min.
// Env: server.mjs + toggl.mjs
import { queueSync } from './toggl.mjs'

// /me endpoints get a flat 30 requests/hour per user on every Toggl plan; this uses ~24
const POLL_MS = 150 * 1000
setInterval(queueSync, POLL_MS)
console.log(`Toggl: polling every ${POLL_MS / 1000}s`)
