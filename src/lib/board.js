// Computes the full board snapshot: every video across all client lists,
// flattened into records the UI can group by client + week. READ-ONLY — it only
// calls getListTasks (GET). Lists are fetched in parallel; a failure on one list
// is captured in `errors` instead of failing the whole board.
import config from './loadConfig.js';
import { getListTasks } from './clickup.js';
import { statusInfo } from './status.js';
import { originalEditor, editorAssigneeForTask, resolveEditor, isRosterEditor } from './editors.js';
import { loadEditorCaptures, mergeEditorCaptures } from './editorCapture.js';
import { weekKeyForMs } from './week.js';

const REPLAY_FIELD_IDS = config.replayFieldIds || [];
const POST_TYPE_FIELD_ID = config.postTypeFieldId;
const REEL = config.reelPostType || {};
const REEL_NAME = String(REEL.name || '').toUpperCase();

// This board only concerns reels / vertical videos. Stories, static posts, and
// anything else in the "Post Type (PM)" dropdown are ignored everywhere (board
// AND counts). ClickUp returns this dropdown's value as the selected option's
// orderindex (a number), so that's the primary match; we also tolerate the
// option UUID, a stringified orderindex, or an object form for safety.
function isReel(task) {
  if (!POST_TYPE_FIELD_ID) return true; // misconfig → don't hide everything
  const value = (task.custom_fields || []).find((f) => f.id === POST_TYPE_FIELD_ID)?.value;
  if (value == null) return false; // unset Post Type → not a confirmed reel
  if (typeof value === 'number') return value === REEL.orderindex;
  if (typeof value === 'string') {
    return value === REEL.optionId || value === String(REEL.orderindex) || value.toUpperCase() === REEL_NAME;
  }
  if (typeof value === 'object') {
    return value.id === REEL.optionId || value.orderindex === REEL.orderindex || String(value.name || '').toUpperCase() === REEL_NAME;
  }
  return false;
}

// The Dropbox replay link, taken from the first replay custom field that holds a
// real URL (NEW* field first, then the legacy one). Fields often contain a
// placeholder like "Insert Video Link", so require an http(s) value.
function replayLink(task) {
  const fields = task.custom_fields || [];
  for (const id of REPLAY_FIELD_IDS) {
    const raw = fields.find((f) => f.id === id)?.value;
    if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) return raw.trim();
  }
  return null;
}

function normalizeTask(task, client) {
  const status = statusInfo(task.status?.status);
  // Editor identity has two layers: the live editor-assignee (who's actually
  // working it while it's in editing) and the original "Video Editor on Project"
  // field. The final pick — folding in the captured last-known editor for reels
  // past editing — is done in computeBoard once the capture log is loaded. Here
  // we set a provisional editor (live > original) so a record is always valid.
  const editorOriginal = originalEditor(task);
  const editorLive = editorAssigneeForTask(task, editorOriginal?.id);
  const editor = resolveEditor({ live: editorLive, captured: null, original: editorOriginal });
  const dueMs = task.due_date ? Number(task.due_date) : null;
  // A Posted reel belongs to the week it was actually marked Posted — ClickUp
  // stamps date_done on the closed-type "Posted" status — NOT its planned due
  // week, so the sheet reflects what really happened (an early post counts the
  // week it went out). Reels that aren't Posted yet stay in their due week.
  const postedMs = status.delivered ? Number(task.date_done) || Number(task.date_closed) || null : null;
  const weekMs = status.delivered ? postedMs || dueMs : dueMs;
  return {
    dueWeek: dueMs ? weekKeyForMs(dueMs) : null,
    client: client.name,
    listId: client.listId,
    taskId: task.id,
    name: task.name || '(untitled)',
    url: task.url || null,
    statusKey: status.key,
    statusLabel: status.label,
    color: status.color,
    delivered: status.delivered,
    counted: status.counted,
    dim: !!status.dim,
    check: !!status.check,
    editorId: editor.id,
    editorName: editor.name,
    editorAvatar: editor.avatar,
    editorColor: editor.color,
    editorInitials: editor.initials,
    editorOriginal,
    editorLive,
    replay: replayLink(task),
    dueMs,
    postedMs,
    // Last time anything on the task changed. The client-review watchdog uses it
    // as a conservative floor on how long a reel has sat in Client Review (the
    // move into review was itself an update, so nothing newer ⇒ parked at least
    // this long). Read-only — just surfaced from the task ClickUp already returns.
    updatedMs: task.date_updated ? Number(task.date_updated) : null,
    weekKey: weekMs ? weekKeyForMs(weekMs) : null,
  };
}

export async function computeBoard() {
  const results = await Promise.allSettled(
    config.clients.map(async (client) => {
      const tasks = await getListTasks(client.listId);
      // Reel / vertical video only — stories & static posts never reach the UI.
      return tasks.filter(isReel).map((t) => normalizeTask(t, client));
    }),
  );

  const videos = [];
  const errors = [];
  results.forEach((r, i) => {
    const client = config.clients[i];
    if (r.status === 'fulfilled') {
      videos.push(...r.value);
    } else {
      errors.push({
        client: client.name,
        listId: client.listId,
        message: String(r.reason?.message || r.reason),
      });
    }
  });

  // Layer the captured last-known editor into each reel, and record the current
  // editor-assignee for any reel still being edited so a finished reel later
  // credits whoever actually edited it (incl. a helper). KV only — never a
  // ClickUp write, so the read-only guarantee is untouched.
  const captures = await loadEditorCaptures();
  const newCaptures = {};
  const rosterCount = {}; // client -> { editorKey -> { person, count } }, from the initial-assignment field
  for (const v of videos) {
    const resolved = resolveEditor({ live: v.editorLive, captured: captures[v.taskId], original: v.editorOriginal });
    v.editorId = resolved.id;
    v.editorName = resolved.name;
    v.editorAvatar = resolved.avatar;
    v.editorColor = resolved.color;
    v.editorInitials = resolved.initials;
    if (v.editorLive) newCaptures[v.taskId] = v.editorLive;
    // "Official" editor per client = their most common INITIAL assignment (the
    // Video Editor on Project field), tallied over real reels — a stable
    // reference, independent of who happened to finish any one reel. Floating
    // (non-roster) editors are skipped here so they never claim or displace a
    // client's regular editor, even when set on the Video Editor field.
    if (v.counted && v.editorOriginal && isRosterEditor(v.editorOriginal.id)) {
      const byEd = (rosterCount[v.client] = rosterCount[v.client] || {});
      const key = v.editorOriginal.id || v.editorOriginal.name;
      (byEd[key] = byEd[key] || { person: v.editorOriginal, count: 0 }).count += 1;
    }
    // Surface the original (field) editor id so the per-week editor breakdown can
    // flag reels taken on by someone other than who they were first assigned to.
    v.editorOriginalId = v.editorOriginal?.id || null;
    delete v.editorOriginal;
    delete v.editorLive;
  }
  await mergeEditorCaptures(newCaptures);

  const editorRoster = config.clients.map((c) => {
    const ranked = Object.values(rosterCount[c.name] || {}).sort((a, b) => b.count - a.count);
    const top = ranked[0] || null;
    const split = !!(top && ranked[1] && ranked[1].count >= top.count * 0.5);
    return {
      client: c.name,
      editor: top ? { name: top.person.name, avatar: top.person.avatar, color: top.person.color, initials: top.person.initials } : null,
      alt: split ? ranked[1].person.name : null,
    };
  });

  return { lastUpdated: Date.now(), videos, errors, editorRoster };
}
