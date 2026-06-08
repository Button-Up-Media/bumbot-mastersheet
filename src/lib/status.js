// Maps a ClickUp status string to its sanctioned board color + behavior. These
// status colors are the ONLY place the palette appears — never in the chrome.
// The exact ClickUp status strings are normalized to uppercase before lookup.
//
// delivered = counts toward a client's delivered tally (POSTED only).
// counted   = the video occupies a square and is part of the week's set.
//             CANCELED / PAUSED are dimmed and excluded from every count.

const DEFS = {
  'TO DO':             { key: 'todo',      label: 'To Do',             color: '#6B7280', delivered: false, counted: true },
  'IN PROGRESS':       { key: 'progress',  label: 'In Progress',       color: '#E5484D', delivered: false, counted: true },
  'INTERNAL APPROVAL': { key: 'internal',  label: 'Internal Approval', color: '#3B82F6', delivered: false, counted: true },
  'REVISIONS':         { key: 'revisions', label: 'Revisions',         color: '#EAB308', delivered: false, counted: true },
  // "Wait for Client Approval" is the live ClickUp string for the brief's
  // "Client Review" stage (ball in the client's court). Both map here.
  'CLIENT REVIEW':              { key: 'review', label: 'Client Review', color: '#FFFFFF', delivered: false, counted: true },
  'WAIT FOR CLIENT APPROVAL':   { key: 'review', label: 'Client Review', color: '#FFFFFF', delivered: false, counted: true },
  'READY TO POST':     { key: 'ready',     label: 'Ready to Post',     color: '#2DD4A7', delivered: false, counted: true },
  'POSTED':            { key: 'posted',    label: 'Posted',            color: '#15803D', delivered: true,  counted: true, check: true },
  'CANCELED':          { key: 'canceled',  label: 'Canceled',          color: '#A23C46', delivered: false, counted: false, dim: true },
  'CANCELLED':         { key: 'canceled',  label: 'Canceled',          color: '#A23C46', delivered: false, counted: false, dim: true },
  'PAUSED':            { key: 'paused',    label: 'Paused',            color: '#3A4049', delivered: false, counted: false, dim: true },
};

// Anything ClickUp returns that we don't recognize: render it as a neutral grey
// square so it's visible but obviously "other", and keep it counted.
const FALLBACK = { key: 'unknown', label: 'Unknown', color: '#6B7280', delivered: false, counted: true };

export function normalizeStatus(status) {
  return String(status || '').trim().toUpperCase();
}

export function statusInfo(status) {
  const def = DEFS[normalizeStatus(status)];
  if (def) return { ...def, raw: status };
  return { ...FALLBACK, label: status || 'Unknown', raw: status };
}

// Canonical ordered list for the UI legend (one entry per distinct status; the
// alternate CANCELLED spelling is intentionally omitted).
export const STATUS_LEGEND = [
  DEFS['TO DO'],
  DEFS['IN PROGRESS'],
  DEFS['INTERNAL APPROVAL'],
  DEFS['REVISIONS'],
  DEFS['CLIENT REVIEW'],
  DEFS['READY TO POST'],
  DEFS['POSTED'],
  DEFS['CANCELED'],
  DEFS['PAUSED'],
];
