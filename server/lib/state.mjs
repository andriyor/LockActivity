// Everything the server remembers, persisted to one JSON file.
// Env: STATE_FILE  default server/state.json
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { STATE_FILE = fileURLToPath(new URL("../state.json", import.meta.url)) } = process.env;

// ponytail: single device, JSON file state; use a DB keyed by device when there's more than one user
export const state = {
  pushToStartToken: null,
  pushToStartTokenAt: 0, // last time the app reported it (each launch)
  activity: null, // { id, token, createdAt } as reported by the app
  lastStartSentAt: 0,
  display: { message: "Hello from the server", project: null, startedAt: null }, // what should be on screen
  shown: null, // JSON of the display the current activity last accepted
  toggl: null, // toggl.mjs's project-name cache
  ...(existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {}),
};

// Write-then-rename so a crash mid-write can't leave invalid JSON behind.
export function save() {
  writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}
