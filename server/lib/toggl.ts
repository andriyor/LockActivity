// Mirrors the running Toggl Track timer into the Live Activity. sync() reads Toggl and calls
// show(); toggl-poll.mjs / toggl-webhook.mjs decide when to call it.
// Env: TOGGL_API_TOKEN  from track.toggl.com/profile
import { show } from "./activity.ts";
import { save, state } from "./state.ts";

// The fields of a Toggl time entry this file reads.
type TimeEntry = {
  start: string;
  description: string | null;
  project_id: number | null;
  workspace_id: number;
};

const { TOGGL_API_TOKEN } = process.env;
if (!TOGGL_API_TOKEN) {
  console.error("Set TOGGL_API_TOKEN");
  process.exit(1);
}

let quotaResetAt = 0;
async function toggl<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.track.toggl.com/api/v9${path}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${TOGGL_API_TOKEN}:api_token`).toString("base64")}`,
    },
  });
  if (res.status === 402)
    quotaResetAt = Date.now() + Number(res.headers.get("x-toggl-quota-resets-in") || 3600) * 1000;
  if (!res.ok) throw new Error(`Toggl ${res.status} ${await res.text()}`);
  return res.json();
}

// The current entry is the source of truth, which also ignores teammates' entries.
async function syncOnce() {
  if (Date.now() < quotaResetAt) return; // out of hourly quota; calls would only fail
  const te = await toggl<TimeEntry | null>("/me/time_entries/current"); // null when nothing is running
  const prev = state.toggl;
  // ponytail: project name is re-fetched only when the project changes, so a rename shows on the next entry
  const project = !te?.project_id
    ? null
    : prev && te.project_id === prev.projectId
      ? prev.project
      : (await toggl<{ name: string }>(`/workspaces/${te.workspace_id}/projects/${te.project_id}`))
          .name;
  state.toggl = te && { projectId: te.project_id, project }; // cache for the lookup above
  save();
  // The activity stays up permanently; with nothing running it shows a message and no clock.
  return show(
    te
      ? { message: te.description || "No description", project, startedAt: Date.parse(te.start) }
      : { message: "No running timer", project: null, startedAt: null },
  );
}

// Serialized so overlapping triggers can't interleave their reads of state.toggl.
let syncing: Promise<unknown> = Promise.resolve();
export const sync = () =>
  (syncing = syncing.then(syncOnce).catch((e) => console.error("Toggl sync:", e.message)));
