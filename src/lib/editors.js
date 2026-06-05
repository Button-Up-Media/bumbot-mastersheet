// Maps a ClickUp task to the editor whose color tints its cell background.
// Editor is read from the task's assignees first; if no assignee matches a known
// editor, fall back to the "Video Editor" custom field. Anyone unrecognized or
// unassigned → neutral grey. (The pipeline normally sets the editor as BOTH the
// assignee and the custom field, so assignee-first is the common path.)
import config from './loadConfig.js';

const byId = new Map(
  Object.entries(config.editors).map(([name, e]) => [
    String(e.id),
    { key: name, label: name, color: e.color },
  ]),
);

const NEUTRAL = { key: 'none', label: 'Unassigned', color: config.editorNeutralColor };
const FIELD_ID = config.videoEditorFieldId;

function fromAssignees(task) {
  for (const a of task.assignees || []) {
    const hit = byId.get(String(a.id));
    if (hit) return hit;
  }
  return null;
}

function fromCustomField(task) {
  const field = (task.custom_fields || []).find((f) => f.id === FIELD_ID);
  if (!field || field.value == null) return null;
  const arr = Array.isArray(field.value) ? field.value : [field.value];
  for (const u of arr) {
    const id = u && typeof u === 'object' ? u.id : u;
    const hit = byId.get(String(id));
    if (hit) return hit;
  }
  return null;
}

export function editorForTask(task) {
  return fromAssignees(task) || fromCustomField(task) || NEUTRAL;
}

export const EDITOR_LEGEND = [
  ...Object.entries(config.editors).map(([name, e]) => ({ key: name, label: name, color: e.color })),
  NEUTRAL,
];
