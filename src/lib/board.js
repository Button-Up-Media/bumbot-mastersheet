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
    editorName: editor.name,
    editorAvatar: editor.avatar,
    editorColor: editor.color,
    editorInitials: editor.initials,
    replay: replayLink(task),
    dueMs,
    weekKey: dueMs ? weekKeyForMs(dueMs) : null,
  };
}

export async function computeBoard() {
  const results = await Promise.allSettled(
    config.clients.map(async (client) => {
      const tasks = await getListTasks(client.listId);
      return tasks.map((t) => normalizeTask(t, client));
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
