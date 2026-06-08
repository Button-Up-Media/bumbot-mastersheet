// Computes the full board snapshot: every video across all client lists,
// flattened into records the UI can group by client + week. READ-ONLY — it only
// calls getListTasks (GET). Lists are fetched in parallel; a failure on one list
// is captured in `errors` instead of failing the whole board.
import config from './loadConfig.js';
import { getListTasks } from './clickup.js';
import { statusInfo } from './status.js';
import { editorForTask } from './editors.js';
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
  const editor = editorForTask(task);
  const dueMs = task.due_date ? Number(task.due_date) : null;
  // A Posted reel belongs to the week it was actually marked Posted — ClickUp
  // stamps date_done on the closed-type "Posted" status — NOT its planned due
  // week, so the sheet reflects what really happened (an early post counts the
  // week it went out). Reels that aren't Posted yet stay in their due week.
  const postedMs = status.delivered ? Number(task.date_done) || Number(task.date_closed) || null : null;
  const weekMs = status.delivered ? postedMs || dueMs : dueMs;
  return {
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
    replay: replayLink(task),
    dueMs,
    postedMs,
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

  return { lastUpdated: Date.now(), videos, errors };
}
