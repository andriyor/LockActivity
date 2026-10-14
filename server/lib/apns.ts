// Sends Live Activity pushes to APNs over HTTP/2, authenticated with a .p8 key (no certificate).
// Env:
//   APNS_KEY_PATH  path to AuthKey_XXXX.p8
//   APNS_KEY_ID    key id (10 chars)
//   APNS_TEAM_ID   team id
//   BUNDLE_ID      default com.andriyor.LockActivity
//   APNS_HOST      default api.sandbox.push.apple.com (debug builds); api.push.apple.com for TestFlight/App Store
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:http2";

// 200 on success, 0 on network failure, else APNs' status; reason is APNs' error reason.
export type PushResult = { status: number; reason: string };

const {
  APNS_KEY_PATH,
  APNS_KEY_ID,
  APNS_TEAM_ID,
  BUNDLE_ID = "com.andriyor.LockActivity",
  APNS_HOST = "api.sandbox.push.apple.com",
} = process.env;
if (!APNS_KEY_PATH || !APNS_KEY_ID || !APNS_TEAM_ID) {
  console.error("Set APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID");
  process.exit(1);
}
console.log(`APNs ${APNS_HOST}`);

const key = readFileSync(APNS_KEY_PATH, "utf8");
let jwt = { token: "", iat: 0 };
function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (now - jwt.iat < 50 * 60) return jwt.token; // APNs rejects tokens older than 1h
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64({ alg: "ES256", kid: APNS_KEY_ID })}.${b64({ iss: APNS_TEAM_ID, iat: now })}`;
  const sig = createSign("sha256")
    .update(data)
    .sign({ key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  jwt = { token: `${data}.${sig}`, iat: now };
  return jwt.token;
}

const reasonOf = (body: string): string => {
  try {
    return JSON.parse(body).reason ?? body;
  } catch {
    return body;
  }
};

export function push(deviceToken: string, aps: { event: string } & Record<string, unknown>) {
  return new Promise<PushResult>((resolve) => {
    const client = connect(`https://${APNS_HOST}`);
    let settled = false; // session and stream can both report the same failure
    const done = (status: number, reason = "") => {
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
    req.on("response", (h) => (status = h[":status"] ?? 0));
    req.on("data", (c) => (body += c));
    req.on("end", () => done(status, reasonOf(body)));
    req.end(JSON.stringify({ aps }));
  });
}
