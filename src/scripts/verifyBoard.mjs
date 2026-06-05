// Dry verification — run locally with `npm run verify`. It:
//   1. wraps global fetch and asserts every ClickUp call is a GET (zero writes),
//   2. recomputes the board independently of cache.js / board.js and prints a
//      decision table: status→color, editor→tint, due-date→week, delivered/req.
//
// It loads config.json from disk (not the webpack loadConfig shim) and imports
// only the JSON-free pure libs, so it's a genuinely independent recomputation.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getListTasks } from '../lib/clickup.js';
import { statusInfo } from '../lib/status.js';
import { requiredFor } from '../lib/quota.js';
import { currentWeekKey, weekKeyForMs, weekRangeLabel, monthWeekIndex, dueDayLabel } from '../lib/week.js';

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

// --- Independent editor + replay resolution (mirrors src/lib/editors.js and
// src/lib/board.js): the real ClickUp person, no allowlist. --------------------
function editorForTask(task) {
  const field = (task.custom_fields || []).find((f) => f.id === config.videoEditorFieldId);
  const val = field?.value;
  if (val != null) {
    const u = Array.isArray(val) ? val[0] : val;
    if (u && typeof u === 'object' && (u.username || u.email)) return u.username || u.email;
  }
  const a = (task.assignees || [])[0];
  if (a) return a.username || a.email || 'Unknown';
  return 'Unassigned';
}

const REPLAY_FIELD_IDS = config.replayFieldIds || [];
function replayLink(task) {
  const fields = task.custom_fields || [];
  for (const id of REPLAY_FIELD_IDS) {
    const raw = fields.find((f) => f.id === id)?.value;
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

  console.log('\nBUM BOT — DRY DECISION TABLE  (read-only verification)');
  console.log('='.repeat(78));
  console.log(`Computed : ${new Date().toISOString()}`);
  console.log(`Week     : ${week}  (${weekRangeLabel(week)})  ·  month-week ${monthWeekIndex(week)}`);
  console.log(`Clients  : ${config.clients.length}`);

  const seenStatuses = new Set();
  const unknown = new Set();
  let totalVideos = 0;
  const unscheduled = [];

  for (const client of config.clients) {
    const tasks = await getListTasks(client.listId);
    totalVideos += tasks.length;

    const videos = tasks.map((t) => {
      const s = statusInfo(t.status?.status);
      const ed = editorForTask(t);
      const dueMs = t.due_date ? Number(t.due_date) : null;
      seenStatuses.add(s.raw || s.label);
      if (s.key === 'unknown') unknown.add(t.status?.status || '(none)');
      return {
        name: t.name || '(untitled)',
        s,
        ed,
        replay: replayLink(t),
        dueMs,
        weekKey: dueMs ? weekKeyForMs(dueMs) : null,
      };
    });

    const thisWeek = videos.filter((v) => v.weekKey === week);
    const required = requiredFor(client.quota, week);
    const delivered = thisWeek.filter((v) => v.s.delivered).length;
    const q = client.quota.type === 'fixed' ? `fixed ${client.quota.value}` : `alt [${client.quota.pattern}]`;

    console.log('\n' + '-'.repeat(78));
    console.log(`${client.name}   ·   quota ${q}   ·   delivered ${delivered}/${required}`);
    if (thisWeek.length === 0) {
      console.log('   (no videos due this week)');
    } else {
      console.log(
        `   ${pad('status', 18)}${pad('editor', 24)}${pad('replay', 8)}${pad('due→week', 20)}title`,
      );
      for (const v of thisWeek) {
        const due = v.dueMs ? `${dueDayLabel(v.dueMs)} → ${v.weekKey}` : '(none)';
        const counted = v.s.counted ? '' : '  [uncounted]';
        const rep = v.replay ? 'yes' : '–';
        console.log(
          `   ${pad(v.s.label, 18)}${pad(clip(v.ed, 22), 24)}${pad(rep, 8)}${pad(due, 20)}${clip(v.name, 28)}${counted}`,
        );
      }
    }

    for (const v of videos.filter((x) => !x.weekKey)) {
      unscheduled.push(`${client.name} · ${v.s.label} · ${clip(v.name, 36)}`);
    }
  }

  if (unscheduled.length) {
    console.log('\n' + '='.repeat(78));
    console.log(`UNSCHEDULED — no due date (${unscheduled.length})`);
    for (const u of unscheduled) console.log('   ' + u);
  }

  // --- Checks ---------------------------------------------------------------
  const methods = calls.reduce((m, c) => ((m[c.method] = (m[c.method] || 0) + 1), m), {});
  const writes = calls.filter((c) => c.method !== 'GET');
  const allClickUp = calls.every((c) => c.url.startsWith('https://api.clickup.com/'));

  console.log('\n' + '='.repeat(78));
  console.log('CHECKS');
  console.log(`   total videos read     : ${totalVideos}`);
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
