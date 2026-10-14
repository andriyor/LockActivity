// A minimal JSON router, and the app-facing routes.
// Env: PORT  default 8787 (app + manual routes; keep on the LAN)
import { createServer } from "node:http";
import { restart, setActivity, setPushToStartToken, show } from "./activity.mjs";
import { state } from "./state.mjs";

// table: { "METHOD /path": (body, raw, headers) => result }; a thrown error becomes a 400.
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

// No auth: /state exposes push tokens. Never expose this port publicly.
export const serveApp = () =>
  serve(process.env.PORT || "8787", {
    // app -> server
    "POST /push-to-start-token": (b) => setPushToStartToken(b.token),
    "POST /activity-token": (b) => setActivity(b.id, b.token),
    // you -> server
    "POST /message": (b) => show({ ...state.display, message: String(b.message) }),
    "POST /start": () => restart(),
    "GET /state": () => state,
  });
