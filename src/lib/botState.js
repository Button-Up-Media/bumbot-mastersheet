// BUMBOT's small persistent memory for the conversational layer:
//   ignored:  { [clientName]: { note, by, at } }  — clients we've been told to
//             stop nudging (auto-expired by the watchdog once their content
//             recovers).
//   channels: { [channelId]: { lastSeenId } }     — the chat threads to watch and
//             the last message already processed in each.
// KV only (Vercel KV in prod, in-memory in dev) — never a ClickUp write, so the
// board's read-only guarantee is untouched.
import { getStore } from './store.js';

const KEY = 'bot:v1';

export async function loadBotState() {
  const store = await getStore();
  const raw = (await store.get(KEY)) || {};
  return { ignored: raw.ignored || {}, channels: raw.channels || {} };
}

export async function saveBotState(state) {
  const store = await getStore();
  await store.set(KEY, { ignored: state.ignored || {}, channels: state.channels || {} });
}
