// Dry verification — run locally with `npm run verify`. It:
//   1. wraps global fetch and asserts every ClickUp call is a GET (zero writes),
//   2. recomputes the board independently of cache.js / board.js and prints a
//      decision table plus the new derived intelligence: reel-only filtering,
//      overdue carry-over, ended-week deficits, editor output, client runway.
//
// It loads config.json from disk (not the webpack loadConfig shim) and imports
// only the JSON-free pure libs (status/quota/week/insights), so it's a genuinely
// independent recomputation.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getListTasks } from '../lib/clickup.js';
import { statusInfo } from '../lib/status.js';
import { requiredFor } from '../lib/quota.js';
import {
  currentWeekKey,
  weekKeyForMs,
  weekRangeLabel,
  monthWeekIndex,
  dueDayLabel,
  monthKeyForWeek,
  monthLabel,
  addWeeks,
} from '../lib/week.js';
import { editorTotalsForMonth, clientRunway } from '../lib/insights.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '../../config.json'), 'utf8'));

// --- Runtime zero-write proof: record the method of every outbound request ---
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
  calls.push({ method, url: String(typeof input === 'string' ? input : input?.url || '') });
  return realFetch(input, init);
};

// --- Reel-only filter (mirrors src/lib/board.js isReel) -----------------------
const POST_TYPE_FIELD_ID = config.postTypeFieldId;
const REEL = config.reelPostType || {};
const REEL_NAME = String(REEL.name || '').toUpperCase();
function isReel(task) {
  if (!POST_TYPE_FIELD_ID) return true;
  const value = (task.custom_fields || []).find((f) => f.id === POST_TYPE_FIELD_ID)?.value;
  if (value == null) return false;
  if (typeof value === 'number') return value === REEL.orderindex;
  if (typeof value === 'string') return value === REEL.optionId || value === String(REEL.orderindex) || value.toUpperCase() === REEL_NAME;
  if (typeof value === 'object') return value.id === REEL.optionId || value.orderindex === REEL.orderindex || String(value.name || '').toUpperCase() === REEL_NAME;
  return false;
}

// --- Editor + replay resolution (mirrors src/lib/editors.js + board.js) -------
function editorOf(task) {
  const field = (task.custom_fields || []).find((f) => f.id === config.videoEditorFieldId);
  const val = field?.value;
  let u = null;
  if (val != null) u = Array.isArray(val) ? val[0] : val;
  if (u && typeof u === 'object' && (u.username || u.email)) {
    return { id: u.id != null ? String(u.id) : null, name: u.username || u.email };
  }
  const a = (task.assignees || [])[0];
  if (a) return { id: a.id != null ? String(a.id) : null, name: a.username || a.email || 'Unknown' };
  return { id: null, name: 'Unassigned' };
}

const REPLAY_FIELD_IDS = config.replayFieldIds || [];
function replayLink(task) {
  for (const id of REPLAY_FIELD_IDS) {
    const raw = (task.custom_fields || []).find((f) => f.id === id)?.value;
    if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) return raw.trim();
  }
  return null;
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function main() {
  const week = (() => {
    const c = currentWeekKey();
    return c < config.minWeek ? config.minWeek : c;
  })();
  const month = monthKeyForWeek(week);
  const prevWeek = addWeeks(week, -1);

  console.log('\nBUM BOT — DRY DECISION TABLE  (read-only verification)');
  console.log('='.repeat(78));
  console.log(`Computed : ${new Date().toISOString()}`);
  console.log(`Week     : ${week}  (${weekRangeLabel(week)})  ·  month-week ${monthWeekIndex(week)}`);
  console.log(`Month    : ${month}  (${monthLabel(month)})`);
  console.log(`Clients  : ${config.clients.length}   ·   Reels only (Post Type = "${REEL.name}")`);

  const seenStatuses = new Set();
  const unknown = new Set();
  let totalTasks = 0;
  let totalReels = 0;
  let excluded = 0;
  const all = []; // normalized reel records across every client

  // Pass 1 — gather every reel record.
  for (const client of config.clients) {
    const tasks = await getListTasks(client.listId);
    totalTasks += tasks.length;
    const reels = tasks.filter(isReel);
    excluded += tasks.length - reels.length;
    totalReels += reels.length;
    for (const t of reels) {
      const s = statusInfo(t.status?.status);
      const ed = editorOf(t);
      const dueMs = t.due_date ? Number(t.due_date) : null;
      const postedMs = s.delivered ? Number(t.date_done) || Number(t.date_closed) || null : null;
      const weekMs = s.delivered ? postedMs || dueMs : dueMs;
      seenStatuses.add(s.raw || s.label);
      if (s.key === 'unknown') unknown.add(t.status?.status || '(none)');
      all.push({
        client: client.name,
        name: t.name || '(untitled)',
        statusLabel: s.label,
        counted: s.counted,
        delivered: s.delivered,
        editorId: ed.id || ed.name,
        editorName: ed.name,
        replay: replayLink(t),
        dueMs,
        dueWeek: dueMs ? weekKeyForMs(dueMs) : null,
        postedMs,
        weekKey: weekMs ? weekKeyForMs(weekMs) : null,
      });
    }
  }

  // Carry-over with deliverables that follow the video (mirrors Board.js): a reel
  // owed this week from the past is removed from its due week and added here.
  const carriedBy = new Map(); // client -> [still-in-flight overdue]
  const carriedTotal = new Map(); // client -> owed-this-week count (in-flight + made up)
  const leftByWeek = new Map(); // dueWeek -> Map(client -> count moved forward)
  const byWeek = new Map(); // weekKey -> Map(client -> [v])
  const unscheduled = [];
  const carryCutoff = addWeeks(week, -(config.carryOverWeeks || 4));
  for (const v of all) {
    const overdue = v.counted && v.dueWeek && v.dueWeek < week && !(v.delivered && v.weekKey < week);
    const owed = overdue && (v.delivered || v.dueWeek >= carryCutoff);
    if (owed) {
      carriedTotal.set(v.client, (carriedTotal.get(v.client) || 0) + 1);
      if (!leftByWeek.has(v.dueWeek)) leftByWeek.set(v.dueWeek, new Map());
      const lm = leftByWeek.get(v.dueWeek);
      lm.set(v.client, (lm.get(v.client) || 0) + 1);
      if (!v.delivered) {
        if (!carriedBy.has(v.client)) carriedBy.set(v.client, []);
        carriedBy.get(v.client).push(v);
        continue;
      }
    }
    if (!v.weekKey) {
      unscheduled.push(`${v.client} · ${v.statusLabel} · ${clip(v.name, 34)}`);
      continue;
    }
    if (!byWeek.has(v.weekKey)) byWeek.set(v.weekKey, new Map());
    const cm = byWeek.get(v.weekKey);
    if (!cm.has(v.client)) cm.set(v.client, []);
    cm.get(v.client).push(v);
  }

  const adjReq = (client, wk) => {
    const base = requiredFor(client.quota, wk);
    if (wk === week) return base + (carriedTotal.get(client.name) || 0);
    if (wk < week) return Math.max(0, base - (leftByWeek.get(wk)?.get(client.name) || 0));
    return base;
  };

  // Pass 2 — per-client decision table for the current week (adjusted required).
  for (const client of config.clients) {
    const vids = byWeek.get(week)?.get(client.name) ?? [];
    const carried = carriedBy.get(client.name) ?? [];
    const base = requiredFor(client.quota, week);
    const owed = carriedTotal.get(client.name) || 0;
    const required = base + owed;
    const delivered = vids.filter((v) => v.delivered).length;
    const q = client.quota.type === 'fixed' ? `fixed ${client.quota.value}` : `alt [${client.quota.pattern}]`;
    const note = owed ? `  (base ${base} + ${owed} owed)` : '';

    console.log('\n' + '-'.repeat(78));
    console.log(`${client.name}   ·   quota ${q}   ·   delivered ${delivered}/${required}${note}`);
    const rows = [...vids, ...carried];
    if (rows.length === 0) {
      console.log('   (nothing this week)');
    } else {
      console.log(`   ${pad('status', 18)}${pad('editor', 22)}${pad('when→week', 27)}title`);
      for (const v of rows) {
        const stampMs = v.postedMs || v.dueMs;
        const when = stampMs ? `${v.postedMs ? 'posted' : 'due'} ${dueDayLabel(stampMs)} → ${v.weekKey || v.dueWeek}` : '(none)';
        const tag = carried.includes(v) ? '  [overdue]' : v.counted ? '' : '  [uncounted]';
        console.log(`   ${pad(v.statusLabel, 18)}${pad(clip(v.editorName, 20), 22)}${pad(when, 27)}${clip(v.name, 24)}${tag}`);
      }
    }
  }

  // --- Carry-over: still-in-flight reels owed this week from earlier weeks ----
  console.log('\n' + '='.repeat(78));
  console.log(`CARRY-OVER → ${week} (${weekRangeLabel(week)}) — owed from earlier weeks, not yet Posted`);
  if (carriedBy.size === 0) {
    console.log('   none');
  } else {
    for (const [client, list] of carriedBy) {
      console.log(`   ${pad(client, 24)} +${list.length} owed`);
      for (const v of list) console.log(`      · ${pad(v.statusLabel, 18)} due ${v.dueWeek}  ${clip(v.name, 30)}`);
    }
  }

  // --- Deficit: short in the most recent ended week, AFTER deliverables move --
  console.log('\n' + '='.repeat(78));
  console.log(`DEFICIT — last ended week ${prevWeek} (${weekRangeLabel(prevWeek)}) — adjusted for moved deliverables`);
  let anyDeficit = false;
  for (const client of config.clients) {
    const req = adjReq(client, prevWeek);
    if (req <= 0) continue;
    const delivered = (byWeek.get(prevWeek)?.get(client.name) ?? []).filter((v) => v.delivered).length;
    if (delivered < req) {
      anyDeficit = true;
      console.log(`   ${pad(client.name, 24)} ${delivered}/${req}  (${req - delivered} short)`);
    }
  }
  if (!anyDeficit) console.log('   none — every client met its adjusted quota');

  // --- Editor output: Posted reels this month --------------------------------
  const editors = editorTotalsForMonth(all, month);
  console.log('\n' + '='.repeat(78));
  console.log(`EDITOR OUTPUT — Posted reels in ${monthLabel(month)}`);
  if (editors.length === 0) {
    console.log('   none Posted yet this month');
  } else {
    editors.forEach((e, i) => console.log(`   ${String(i + 1).padStart(2)}. ${pad(e.name, 24)} ${e.count}`));
  }

  // --- Runway: furthest scheduled reel per client ----------------------------
  const runway = clientRunway(all, config.clients, week);
  console.log('\n' + '='.repeat(78));
  console.log(`CONTENT RUNWAY — from ${week} (book the next shoot before these run dry)`);
  for (const r of runway) {
    const left = r.lastWeek === null ? 'NO REELS' : r.weeksLeft < 0 ? 'OUT' : `${r.weeksLeft} wk left`;
    const thru = r.lastWeek === null ? '—' : r.lastWeek;
    console.log(`   ${pad(r.client, 24)} through ${pad(thru, 12)} ${left}`);
  }

  if (unscheduled.length) {
    console.log('\n' + '='.repeat(78));
    console.log(`UNSCHEDULED — reels with no due date (${unscheduled.length})`);
    for (const u of unscheduled) console.log('   ' + u);
  }

  // --- Checks ----------------------------------------------------------------
  const methods = calls.reduce((m, c) => ((m[c.method] = (m[c.method] || 0) + 1), m), {});
  const writes = calls.filter((c) => c.method !== 'GET');
  const allClickUp = calls.every((c) => c.url.startsWith('https://api.clickup.com/'));

  console.log('\n' + '='.repeat(78));
  console.log('CHECKS');
  console.log(`   tasks read            : ${totalTasks}  (reels ${totalReels}, excluded non-reel ${excluded})`);
  console.log(`   network calls         : ${JSON.stringify(methods)}`);
  console.log(`   all calls to ClickUp  : ${allClickUp ? 'yes' : 'NO ⚠'}`);
  console.log(`   write calls (non-GET) : ${writes.length} ${writes.length === 0 ? '✓ ZERO WRITES' : '⚠ WRITES DETECTED'}`);
  console.log(`   distinct statuses     : ${[...seenStatuses].sort().join(', ') || '(none)'}`);
  console.log(`   unknown statuses      : ${unknown.size ? [...unknown].join(', ') : 'none'}`);

  if (writes.length > 0) {
    console.error('\n⚠ Non-GET calls detected — this violates the read-only rule.');
    process.exit(1);
  }
  console.log('\n✓ Verification passed — read-only, decision table above.\n');
}

main().catch((err) => {
  console.error('\n✗ Verify failed:', err.message);
  process.exit(1);
});
