// Toggl mode 2: Toggl webhooks trigger a sync. Instant, but Toggl must reach WEBHOOK_PORT over public HTTPS.
// Env: server.mjs + toggl.mjs, plus
//   TOGGL_WEBHOOK_SECRET  the secret given when creating the subscription
//   WEBHOOK_PORT          default 8788, serves only POST /toggl; expose only this port
import { createHmac, timingSafeEqual } from 'node:crypto'
import { serve } from './server.mjs'
import { queueSync } from './toggl.mjs'

const { TOGGL_WEBHOOK_SECRET, WEBHOOK_PORT = '8788' } = process.env
if (!TOGGL_WEBHOOK_SECRET) {
  console.error('Set TOGGL_WEBHOOK_SECRET')
  process.exit(1)
}

function verify(raw, headers) {
  const want = createHmac('sha256', TOGGL_WEBHOOK_SECRET).update(raw).digest('hex')
  const got = String(headers['x-webhook-signature-256'] ?? '').replace(/^sha256=/, '')
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want)))
    throw new Error('bad signature')
}

// Separate port so exposing the webhook doesn't expose /state (push tokens) or /start.
serve(WEBHOOK_PORT, {
  'POST /toggl': (b, raw, headers) => {
    verify(raw, headers)
    if (b.validation_code) return { validation_code: b.validation_code } // subscription validation ping
    if (b.payload !== 'ping') queueSync() // reply now; Toggl doesn't need to wait for APNs
  },
})
