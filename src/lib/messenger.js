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
import { serviceAccountEmail } from './calendar.js';
import { sendDM } from './clickupChat.js';
import { loadBotState, saveBotState } from './botState.js';

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

  // BUMBOT's memory: clients the team told us to stop nudging. Auto-expire any
  // whose content has since recovered (no longer needs a shoot) so an "ignore"
  // naturally lifts once the work is back on track.
  const state = await loadBotState();
  for (const lead of Object.keys(state.ignored)) {
    const unit = status.units.find((u) => u.lead === lead);
    if (!unit || unit.state !== 'needs-shoot') delete state.ignored[lead];
  }
  const ignored = new Set(Object.keys(state.ignored).map((s) => s.toLowerCase()));

  // Clients that need a shoot, aren't being ignored, AND are "due" to be pinged
  // today per their cadence.
  const due = status.units
    .filter((u) => u.state === 'needs-shoot')
    .filter((u) => !ignored.has(u.lead.toLowerCase()))
    .filter((u) => cadenceFiresOn(escalationTier(u.weeksLeft).cadence, wd));
  // Booked shoots that land too late → alert the team.
  const late = status.units.filter((u) => u.state === 'booked' && u.nextShoot?.verdict === 'late');

  const r = ids();
  const botEmail = serviceAccountEmail();
  const outbox = [];
  if (due.length) {
    outbox.push({ kind: 'reminder', toLabel: 'Juan + Chris', to: [r.juan, r.chris], text: buildReminder(due, { botEmail }) });
  }
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
      const sent = await sendDM(recipients, text);
      entry.sent = true;
      // Watch this thread for replies, baselined past the DM we just sent so the
      // conversational poller reacts to the team's responses, not our own message.
      if (sent?.channelId) {
        state.channels[sent.channelId] = { lastSeenId: sent.messageId || state.channels[sent.channelId]?.lastSeenId || '0' };
      }
    } catch (e) {
      entry.sent = false;
      entry.error = String(e?.message || e);
    }
    result.messages.push(entry);
  }
  await saveBotState(state);
  return result;
}
