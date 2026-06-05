// Resolves the human shown on a video card: the actual ClickUp person, not a
// fixed allowlist. Source of truth is the "Video Editor on Project" custom field
// (a ClickUp users field); if it's empty we fall back to the task's first
// assignee. Either way ClickUp hands us the full user object, so we surface their
// real name, avatar, brand color, and initials. Unrecognized/empty → neutral.
import config from './loadConfig.js';

const FIELD_ID = config.videoEditorFieldId;
const NEUTRAL_COLOR = config.editorNeutralColor;

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

const NEUTRAL = { id: null, name: 'Unassigned', avatar: null, color: NEUTRAL_COLOR, initials: '—' };

export function editorForTask(task) {
  return fromVideoEditorField(task) || fromAssignees(task) || NEUTRAL;
}
