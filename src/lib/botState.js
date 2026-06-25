// BUMBOT's small persistent memory for the conversational layer:
//   ignored:  { [clientName]: { note, by, at } }  — clients we've been told to
//             stop nudging (auto-expired by the watchdog once their content
//             recovers).
//   channels: { [channelId]: { lastSeenId } }     — the chat threads to watch and
//             the last message already processed in each.
//   reviews:  { [taskId]: { firstSeen, client, name } } — when we first observed
//             each reel sitting in Client Review, so the client-review watchdog
//             can tell it's been parked >24h even when an incidental edit resets
//             the task's date_updated. Pruned to only currently-in-review reels.
//   reviewMeta: { lastSentDay } — NY date of the last client-review nudge, so it
//             fires at most once per day even if the scheduler runs twice.
//   shootMeta:  { lastRunDay }  — NY date the shoot watchdog last ran, so it runs
//             at most once per day across its several candidate cron fire-times.
//   adjustments: { [taskId]: { taskId, client, week, delta, note, taskName, by, at } }
//             — per-week quota tweaks BUMBOT was told to make in chat (e.g. a
//             scrapped video the team won't make up: delta -1). Merged onto each
//             client's quota before the make-up plan is computed.
// KV only (Vercel KV in prod, in-memory in dev) — never a ClickUp write, so the
// board's read-only guarantee is untouched.
import { getStore } from './store.js';

const KEY = 'bot:v1';

export async function loadBotState() {
  const store = await getStore();
  const raw = (await store.get(KEY)) || {};
  return {
    ignored: raw.ignored || {},
    channels: raw.channels || {},
    reviews: raw.reviews || {},
    reviewMeta: raw.reviewMeta || {},
    shootMeta: raw.shootMeta || {},
    adjustments: raw.adjustments || {},
  };
}

export async function saveBotState(state) {
  const store = await getStore();
  await store.set(KEY, {
    ignored: state.ignored || {},
    channels: state.channels || {},
    reviews: state.reviews || {},
    reviewMeta: state.reviewMeta || {},
    shootMeta: state.shootMeta || {},
    adjustments: state.adjustments || {},
  });
}
