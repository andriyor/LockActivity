// A minimal JSON router, and the app-facing routes.
// Env:
//   PORT        default 8790 (app + manual routes)
//   APP_SECRET  if set, these routes need "Authorization: Bearer <APP_SECRET>"; set it before
//               exposing the port beyond the LAN (e.g. a Cloudflare Tunnel hostname)
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { restart, setActivity, setAliveActivities, setPushToStartToken, show } from "./activity.ts";
import { state } from "./state.ts";

// Request bodies are untrusted JSON; handlers check what they read with str().
export type Body = Record<string, unknown>;
export type Handler = (body: Body, raw: string, headers: IncomingHttpHeaders) => unknown;

// A non-empty string from the body, or a 400.
export function str(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v) throw new Error(`${key} must be a non-empty string`);
  return v;
}

// Constant-time compare; hashing first makes the lengths equal.
const sha = (s: string) => createHash("sha256").update(s).digest();
const authorized = (header: string | undefined, secret: string) =>
  timingSafeEqual(sha(header ?? ""), sha(`Bearer ${secret}`));

// table: { "METHOD /path": handler }; a thrown error becomes a 400. secret: see APP_SECRET.
export function serve(port: string, table: Record<string, Handler>, secret?: string) {
  createServer(async (req, res) => {
    const handler = table[`${req.method} ${req.url}`];
    if (!handler) return res.writeHead(404).end();
    if (secret && !authorized(req.headers.authorization, secret)) return res.writeHead(401).end();
    let raw = "";
    for await (const c of req) raw += c;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== "object" || parsed === null)
        throw new Error("body must be a JSON object");
      const result = await handler(parsed as Body, raw, req.headers);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result ?? { ok: true }));
    } catch (e) {
      res.writeHead(400).end((e as Error).message);
    }
  }).listen(Number(port), () => console.log(`listening on :${port}`));
}

// /state exposes push tokens: without APP_SECRET, never expose this port publicly.
export function serveApp() {
  const { APP_SECRET } = process.env;
  if (!APP_SECRET) console.log("no APP_SECRET: app routes are open, keep them on the LAN");
  serve(
    process.env.PORT || "8790",
    {
      // app -> server
      "POST /push-to-start-token": (b) => setPushToStartToken(str(b, "token")),
      "POST /activity-token": (b) => setActivity(str(b, "id"), str(b, "token")),
      "POST /activities": (b) =>
        setAliveActivities(
          Array.isArray(b.ids) ? b.ids.filter((id) => typeof id === "string") : [],
        ),
      // you -> server
      "POST /message": (b) => show({ ...state.display, message: str(b, "message") }),
      "POST /start": () => restart(),
      "GET /state": () => state,
    },
    APP_SECRET,
  );
}
