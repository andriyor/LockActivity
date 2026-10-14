// Everything the server remembers, persisted to one JSON file.
// Env: STATE_FILE  default server/state.json
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { STATE_FILE = fileURLToPath(new URL("../state.json", import.meta.url)) } = process.env;

// What the Lock Screen should show. startedAt (ms) drives the on-device clock; null hides it.
export type Display = { message: string; project: string | null; startedAt: number | null };

export type State = {
  pushToStartToken: string | null;
  startWanted: boolean; // set when the app reports its activity is gone; one start push clears it
  activity: { id: string; token: string; createdAt: number } | null; // as reported by the app
  lastStartSentAt: number;
  display: Display; // what should be on screen
  shown: string | null; // JSON of the display the current activity last accepted
  toggl: { projectId: number | null; project: string | null } | null; // toggl.ts's project-name cache
};

// ponytail: single device, JSON file state; use a DB keyed by device when there's more than one user
export const state: State = {
  pushToStartToken: null,
  startWanted: false,
  activity: null,
  lastStartSentAt: 0,
  display: { message: "Hello from the server", project: null, startedAt: null },
  shown: null,
  toggl: null,
  ...(existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {}),
};

// Write-then-rename so a crash mid-write can't leave invalid JSON behind.
export function save() {
  writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}
