// Persistent log of the last *editor* known to be working each reel. While a reel
// is in an editing stage its assignee is one of the video editors; once it moves
// to internal approval / review / posting, the assignee becomes a PM and the
// editor is gone from the task. ClickUp's API exposes no history, so we snapshot
// the editor-assignee here while we can see it. A finished reel then credits (and
// displays) whoever actually edited it — including a helper who jumped in.
//
// Stored in the shared KV store, never in ClickUp, so read-only-to-ClickUp holds.
// Shape: { [taskId]: { id, name, avatar, color, initials } }.
import { getStore } from './store.js';

const KEY = 'editors:v1';

export async function loadEditorCaptures() {
  const store = await getStore();
  return (await store.get(KEY)) || {};
}

// Merge new {taskId: editorSnapshot} captures into the stored log (last write
// wins per task, which is what we want — the most recent editor-assignee).
export async function mergeEditorCaptures(updates) {
  const ids = Object.keys(updates || {});
  if (!ids.length) return;
  const store = await getStore();
  const current = (await store.get(KEY)) || {};
  await store.set(KEY, { ...current, ...updates });
}
