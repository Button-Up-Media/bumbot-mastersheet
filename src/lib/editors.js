// Resolves the human shown on a video card: the actual ClickUp person, not a
// fixed allowlist. Source of truth is the "Video Editor on Project" custom field
// (a ClickUp users field); if it's empty we fall back to the task's first
// assignee. Either way ClickUp hands us the full user object, so we surface their
// real name, avatar, brand color, and initials. Unrecognized/empty → neutral.
import config from './loadConfig.js';

const FIELD_ID = config.videoEditorFieldId;
const NEUTRAL_COLOR = config.editorNeutralColor;

// The video editors whose involvement we credit. A reel's assignee is one of
// these while it's being edited; everyone else who can be an assignee (PMs,
// coordinators) is not an editor and is never captured or credited.
const EDITOR_IDS = new Set(Object.values(config.editors || {}).map((e) => String(e.id)));

export function isEditorId(id) {
  return id != null && EDITOR_IDS.has(String(id));
}

function initialsFrom(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const ini = parts.map((p) => p[0].toUpperCase()).join('');
  return ini || '—';
}

// Normalize a ClickUp user object (assignee or users-field entry) to our shape.
function person(u) {
  if (!u) return null;
  const name = u.username || u.email || 'Unknown';
  return {
    id: u.id != null ? String(u.id) : null,
    name,
    avatar: u.profilePicture || null,
    color: u.color || NEUTRAL_COLOR,
    initials: u.initials || initialsFrom(name),
  };
}

function fromVideoEditorField(task) {
  const field = (task.custom_fields || []).find((f) => f.id === FIELD_ID);
  const value = field?.value;
  if (value == null) return null;
  const arr = Array.isArray(value) ? value : [value];
  return person(arr[0]);
}

function fromAssignees(task) {
  return person((task.assignees || [])[0]);
}

export const NEUTRAL = { id: null, name: 'Unassigned', avatar: null, color: NEUTRAL_COLOR, initials: '—' };

export function editorForTask(task) {
  return fromVideoEditorField(task) || fromAssignees(task) || NEUTRAL;
}

// The original assignment — the "Video Editor on Project" users field — but only
// when it actually holds one of our editors. That field is occasionally set to a
// PM by mistake; a non-editor there is treated as "no original" so we never
// credit or display a PM as the editor.
export function originalEditor(task) {
  const e = fromVideoEditorField(task);
  return e && isEditorId(e.id) ? e : null;
}

// The editor currently assigned to the task: the person actually working it
// while it's in an editing stage, or null once a PM takes over. When more than
// one editor is assigned, prefer the one who is NOT the original assignment —
// the helper who jumped in to finish is the one credited.
export function editorAssigneeForTask(task, originalId) {
  const editors = (task.assignees || []).filter((u) => isEditorId(u.id));
  if (!editors.length) return null;
  const helper = editors.find((u) => String(u.id) !== String(originalId));
  return person(helper || editors[0]);
}

// Final editor pick for a reel: who's working it now > who last worked it (the
// captured snapshot) > the original assignment > nobody. The fall-through to the
// original (which is effectively always set) guarantees a reel never shows
// "no editor" — and never shows a PM, since only editors flow through here.
export function resolveEditor({ live, captured, original }) {
  return live || captured || original || NEUTRAL;
}
