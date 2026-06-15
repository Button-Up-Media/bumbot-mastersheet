// Shoot-reminder watchdog. Runs daily; from the current shoot status it decides
// who to nudge today and sends BUMBOT DMs:
//   • Juan      — one grouped reminder of clients that need a shoot booked, on
//                 each client's cadence (gentle→Mon only · 3wk→Mon · 2wk→Mon/Wed/Fri
//                 · 1wk→daily). Clients that just shot or already have a shoot are
//                 skipped automatically (handled upstream in shoots.js).
//   • Juan+Chris+Nayith — a heads-up when a booked shoot lands too late.
//
// modes: 'preview' (compose only, send nothing) · 'dry' (send EVERYTHING to Chris
// only, prefixed) · 'live' (send to the real recipients). Recipient ids come from
// env so they stay out of the public repo.
import { getBoard } from './cache.js';
import { escalationTier, cadenceFiresOn } from './shootPlan.js';
import { weekdayInNY } from './week.js';
import { buildReminder, buildLateAlert } from './shootMessages.js';
import { sendDM } from './clickupChat.js';

function ids() {
  return {
    juan: process.env.SHOOT_JUAN_ID,
    chris: process.env.SHOOT_CHRIS_ID,
    nayith: process.env.SHOOT_NAYITH_ID,
  };
}

export async function runShootWatchdog({ mode = 'dry', weekday } = {}) {
  const wd = weekday || weekdayInNY(Date.now());
  const board = await getBoard({ force: true });
  const status = board?.shoots;
  const result = { mode, weekday: wd, calendarOk: !!status?.calendarOk, messages: [] };
  if (!status?.calendarOk) {
    result.skipped = status?.error || 'calendar not connected';
    return result;
  }

  // Clients that need a shoot AND are "due" to be pinged today per their cadence.
  const due = status.units
    .filter((u) => u.state === 'needs-shoot')
    .filter((u) => cadenceFiresOn(escalationTier(u.weeksLeft).cadence, wd));
  // Booked shoots that land too late → alert the team.
  const late = status.units.filter((u) => u.state === 'booked' && u.nextShoot?.verdict === 'late');

  const r = ids();
  const outbox = [];
  if (due.length) outbox.push({ kind: 'reminder', toLabel: 'Juan', to: [r.juan], text: buildReminder(due) });
  for (const u of late) {
    outbox.push({ kind: 'alert', toLabel: 'Juan + Chris + Nayith', to: [r.juan, r.chris, r.nayith], text: buildLateAlert(u) });
  }

  for (const m of outbox) {
    if (mode === 'preview') {
      result.messages.push({ kind: m.kind, toLabel: m.toLabel, text: m.text });
      continue;
    }
    const recipients = mode === 'dry' ? [r.chris] : m.to;
    const text = mode === 'dry' ? `[DRY RUN → would send to ${m.toLabel}]\n\n${m.text}` : m.text;
    const entry = { kind: m.kind, toLabel: mode === 'dry' ? 'Chris (dry-run)' : m.toLabel };
    try {
      await sendDM(recipients, text);
      entry.sent = true;
    } catch (e) {
      entry.sent = false;
      entry.error = String(e?.message || e);
    }
    result.messages.push(entry);
  }
  return result;
}
