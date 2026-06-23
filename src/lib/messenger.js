// Shoot-reminder watchdog. Runs daily; from the current shoot status it decides
// who to nudge today and sends BUMBOT DMs:
//   • Juan      — one grouped reminder of clients that need a shoot booked, on
//                 each client's cadence (gentle→Mon only · 3wk→Mon · 2wk→Mon/Thu
//                 · 1wk→Mon/Wed/Fri, never weekends). Clients that just shot or
//                 already have a shoot are skipped automatically (in shoots.js).
//   • Juan+Chris+Nayith — a heads-up when a booked shoot lands too late.
//
// modes: 'preview' (compose only, send nothing) · 'dry' (send EVERYTHING to Chris
// only, prefixed) · 'live' (send to the real recipients). Recipient ids come from
// env so they stay out of the public repo.
import config from './loadConfig.js';
import { getBoard } from './cache.js';
import { escalationTier, cadenceFiresOn } from './shootPlan.js';
import { weekdayInNY, addWeeks, dayKeyInNY } from './week.js';
import { requiredFor } from './quota.js';
import { makeupPlan } from './makeup.js';
import { isEditorId } from './editors.js';
import {
  buildReminder,
  buildLateAlert,
  buildNayithNudge,
  buildEditorPriorityAlert,
  buildEditorPriorityDM,
} from './shootMessages.js';
import { serviceAccountEmail } from './calendar.js';
import { sendDM, postToChannel } from './clickupChat.js';
import { loadBotState, saveBotState } from './botState.js';

function ids() {
  return {
    juan: process.env.SHOOT_JUAN_ID,
    chris: process.env.SHOOT_CHRIS_ID,
    nayith: process.env.SHOOT_NAYITH_ID,
  };
}

// Distinct real editors on a client's reels in a week (who to ping for a miss).
// If nothing was made that week, fall back to the client's most-frequent editor.
function editorsForMiss(videos, clientName, week) {
  const map = new Map();
  for (const v of videos) {
    if (v.client === clientName && v.weekKey === week && v.counted && isEditorId(v.editorId)) {
      map.set(v.editorId, v.editorName);
    }
  }
  if (!map.size) {
    const tally = new Map();
    for (const v of videos) {
      if (v.client === clientName && isEditorId(v.editorId)) {
        const t = tally.get(v.editorId) || { name: v.editorName, n: 0 };
        t.n += 1;
        tally.set(v.editorId, t);
      }
    }
    const top = [...tally.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (top) map.set(top[0], top[1].name);
  }
  return [...map].map(([id, name]) => ({ id, name }));
}

// Strip @-mention markup down to plain "@Name" — used in DRY RUN so a preview to
// Chris doesn't actually ping the real editors (the id is what triggers a ping).
const deMention = (s) => s.replace(/\[@([^\]]+)\]\(#user_mention#[^)]+\)/g, '@$1');

export async function runShootWatchdog({ mode = 'dry', weekday, now = Date.now(), dedupe = true } = {}) {
  const wd = weekday || weekdayInNY(now);
  const today = dayKeyInNY(now);

  // Run at most once per NY day. The scheduler fires at a few candidate times
  // (11 AM ET on some days, 2:30 PM on others — see the cron route), so this
  // guard stops a second fire (or a delayed one) from sending twice. `dedupe`
  // is off for manual ?force=1 runs, and preview never counts as "ran".
  const state = await loadBotState();
  if (dedupe && mode !== 'preview' && state.shootMeta?.lastRunDay === today) {
    return { mode, weekday: wd, skipped: 'already-ran-today', messages: [] };
  }

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

  // Ready-but-undated reels → a weekly (Monday) nudge to Nayith to set due dates
  // so they slot onto the master sheet. The runway already counts these.
  if (wd === 1) {
    const undated = {};
    for (const v of board?.videos || []) {
      if (v.counted && !v.weekKey) undated[v.client] = (undated[v.client] || 0) + 1;
    }
    const items = Object.entries(undated).map(([client, count]) => ({ client, count }));
    if (items.length) outbox.push({ kind: 'nayith', toLabel: 'Nayith', to: [r.nayith], text: buildNayithNudge(items) });
  }

  // Did-not-post: any client that got ZERO posts the week that just ended (and was
  // due) → an urgent priority alert in the editor channel @-mentioning that
  // client's editor(s), plus a private DM to each. Monday only (the week just
  // closed, and it lines up with the board's PRIORITY tag on the new week).
  const editorChannel = config.shootScheduler?.editorChannelId;
  if (wd === 1) {
    const videos = board?.videos || [];
    const prev = addWeeks(status.currentWeek, -1);
    const plan = makeupPlan(videos, config.clients, status.currentWeek);
    for (const c of config.clients) {
      const cell = plan.get(c.name)?.get(prev);
      const posted = videos.filter((v) => v.client === c.name && v.weekKey === prev && v.delivered).length;
      const didNotPost = cell ? cell.state === 'didnotpost' : requiredFor(c.quota, prev) > 0 && posted === 0;
      if (!didNotPost) continue;
      const editors = editorsForMiss(videos, c.name, prev);
      if (editorChannel) {
        outbox.push({ kind: 'priority', toLabel: 'Video Editing Team', channelId: editorChannel, text: buildEditorPriorityAlert(c.name, editors) });
      }
      for (const e of editors) {
        outbox.push({ kind: 'priority-dm', toLabel: e.name, to: [e.id], text: buildEditorPriorityDM(c.name) });
      }
    }
  }

  for (const m of outbox) {
    if (mode === 'preview') {
      result.messages.push({ kind: m.kind, toLabel: m.toLabel, text: m.text });
      continue;
    }
    // DRY RUN: everything goes to Chris, with @-mentions flattened to plain text
    // so a preview never actually pings the real editors.
    const text =
      mode === 'dry'
        ? `[DRY RUN → would ${m.channelId ? 'post in ' + m.toLabel : 'send to ' + m.toLabel}]\n\n${deMention(m.text)}`
        : m.text;
    const entry = { kind: m.kind, toLabel: mode === 'dry' ? 'Chris (dry-run)' : m.toLabel };
    try {
      if (mode === 'live' && m.channelId) {
        await postToChannel(m.channelId, text);
      } else {
        const recipients = mode === 'dry' ? [r.chris] : m.to;
        const sent = await sendDM(recipients, text);
        // Watch reminder/alert threads (those that include Juan/Chris) for replies,
        // baselined past our own DM, so the conversational poller reacts to them.
        if (sent?.channelId && m.to?.some((id) => id === r.juan || id === r.chris)) {
          state.channels[sent.channelId] = { lastSeenId: sent.messageId || state.channels[sent.channelId]?.lastSeenId || '0' };
        }
      }
      entry.sent = true;
    } catch (e) {
      entry.sent = false;
      entry.error = String(e?.message || e);
    }
    result.messages.push(entry);
  }
  // Record that today's run happened so later/duplicate fires the same NY day
  // no-op (preview is a no-op test, so it never claims the day).
  if (mode !== 'preview') state.shootMeta = { ...state.shootMeta, lastRunDay: today };
  await saveBotState(state);
  return result;
}
