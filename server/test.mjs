// End-to-end check of the server against a fake Toggl and a fake APNs: node server/test.mjs
// Runs the real entry points in child processes with a temp STATE_FILE; never touches state.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "lockactivity-test-"));
const file = (name) => join(dir, name);
const entry = (te) => writeFileSync(file("te.json"), JSON.stringify(te));

// Fake Toggl: current entry from te.json. Fake APNs: token "dead" gets 410 Unregistered,
// everything fails while apns-down exists, each push is printed as "PUSH <event> <token> <content-state>".
writeFileSync(
  file("mock.mjs"),
  `
import { existsSync, readFileSync } from 'node:fs'
import http2 from 'node:http2'
import { syncBuiltinESMExports } from 'node:module'
const dir = ${JSON.stringify(dir)}
globalThis.fetch = async (url) => {
  const body = url.includes('/projects/') ? { name: 'Project ' + url.split('/').pop() } : JSON.parse(readFileSync(dir + '/te.json', 'utf8'))
  return { ok: true, status: 200, headers: new Headers(), json: async () => body }
}
http2.connect = () => ({ on() {}, close() {}, request(headers) {
  const token = headers[':path'].split('/').pop(), h = {}
  return { on(e, f) { h[e] = f }, end(b) { setImmediate(() => {
    const aps = JSON.parse(b).aps
    if (existsSync(dir + '/apns-down')) return h.error(new Error('network down'))
    console.log('PUSH', aps.event, token, JSON.stringify(aps['content-state']))
    h.response({ ':status': token === 'dead' ? 410 : 200 })
    if (token === 'dead') h.data('{"reason":"Unregistered"}')
    h.end()
  }) } }
} })
syncBuiltinESMExports()
`,
);
writeFileSync(
  file("key.p8"),
  generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
    type: "pkcs8",
    format: "pem",
  }),
);

const children = [];
function run(script, port, env = {}) {
  const lines = [];
  const child = spawn(
    process.execPath,
    ["--import", file("mock.mjs"), new URL(script, import.meta.url).pathname],
    {
      env: {
        ...process.env,
        APNS_KEY_PATH: file("key.p8"),
        APNS_KEY_ID: "K",
        APNS_TEAM_ID: "T",
        TOGGL_API_TOKEN: "t",
        PORT: String(port),
        STATE_FILE: file(`state-${port}.json`),
        TOGGL_POLL_SECONDS: "0.3",
        ...env,
      },
    },
  );
  children.push(child);
  child.stdout.on("data", (d) => lines.push(...String(d).trim().split("\n")));
  child.stderr.on("data", (d) => lines.push(...String(d).trim().split("\n")));
  const pushes = () =>
    lines
      .filter((l) => l.startsWith("PUSH "))
      .map((l) => {
        const [, event, token, content] = l.match(/^PUSH (\S+) (\S+) (.*)$/);
        return { event, token, content: JSON.parse(content) };
      });
  const waitFor = async (what, ok, ms = 4000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50)))
      if (ok()) return;
    throw new Error(`timed out waiting for ${what}\n${lines.join("\n")}`);
  };
  const post = (path, body, headers = {}) =>
    fetch(`http://localhost:${port}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    });
  return { child, lines, pushes, waitFor, post };
}

try {
  // --- polling mode
  entry(null);
  const s = run("./toggl-poll.mjs", 9871);
  await s.waitFor("server", () => s.lines.some((l) => l.includes("listening")));
  const last = () => s.pushes().at(-1);

  const starts = () => s.pushes().filter((p) => p.event === "start").length;
  // first launch: the app reports no alive activities, then its token → exactly one start
  await s.post("/activities", { ids: [] });
  await s.post("/push-to-start-token", { token: "ptst" });
  await s.waitFor("start on first launch", () => last()?.event === "start");
  assert.deepEqual(last().content, { message: "No running timer", project: null, startedAt: null });

  await s.post("/activity-token", { id: "a", token: "act" });
  await s.waitFor("update to the new activity", () => last()?.token === "act");
  const settled = s.pushes().length;
  await new Promise((r) => setTimeout(r, 1000)); // ~3 idle polls
  assert.equal(s.pushes().length, settled, "idle polls must not push");

  entry({
    id: 5,
    start: "2026-10-14T08:00:00Z",
    description: "Coding",
    project_id: 7,
    workspace_id: 3,
  });
  await s.waitFor("timer start update", () => last()?.content.message === "Coding");
  assert.equal(last().event, "update", "a new timer is an update, not a new activity");
  assert.equal(last().content.project, "Project 7");
  assert.equal(last().content.startedAt, Date.parse("2026-10-14T08:00:00Z") / 1000 - 978307200);

  writeFileSync(file("apns-down"), "");
  entry(null);
  await s.waitFor("failed update", () => s.lines.some((l) => l.startsWith("APNs update -> 0")));
  rmSync(file("apns-down"));
  await s.waitFor("retried update", () => last()?.content.message === "No running timer");
  assert.equal(last().event, "update");

  await s.post("/activity-token", { id: "b", token: "dead" });
  await s.waitFor("start after dead token", () => last()?.event === "start");

  // app launch reports which activities are alive; ours missing (e.g. after a reinstall) → new start
  await s.post("/activity-token", { id: "c", token: "act2" });
  await s.waitFor("update to activity c", () => last()?.token === "act2");
  await s.post("/activities", { ids: ["c"] });
  const before = starts();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(starts(), before, "an alive activity is left alone");
  // relaunch with our activity gone; both launch reports arrive, but only one start goes out
  await s.post("/activities", { ids: [] });
  await s.post("/push-to-start-token", { token: "ptst" });
  await s.waitFor("start after activity is gone", () => starts() === before + 1);
  await new Promise((r) => setTimeout(r, 1000)); // a few polls
  assert.equal(starts(), before + 1, "exactly one start per launch");
  s.child.kill();

  // --- webhook mode: signature check and validation handshake
  const w = run("./toggl-webhook.mjs", 9872, { TOGGL_WEBHOOK_SECRET: "sek", WEBHOOK_PORT: "9873" });
  await w.waitFor("webhook server", () => w.lines.some((l) => l.includes(":9873")));
  const body = JSON.stringify({ validation_code: "v1" });
  const sig = createHmac("sha256", "sek").update(body).digest("hex");
  const hook = (signature) =>
    fetch("http://localhost:9873/toggl", {
      method: "POST",
      body,
      headers: { "x-webhook-signature-256": signature },
    });
  assert.equal((await hook("sha256=00")).status, 400, "forged signature is rejected");
  assert.deepEqual(await (await hook(`sha256=${sig}`)).json(), { validation_code: "v1" });
  assert.equal(
    (await fetch("http://localhost:9873/state")).status,
    404,
    "webhook port exposes only /toggl",
  );
  w.child.kill();

  console.log("ok");
} finally {
  for (const c of children) c.kill();
  rmSync(dir, { recursive: true, force: true });
}
