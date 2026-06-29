// Local iMessage reminder agent (runs on Chris's Mac via launchd — see
// com.buttonup.bumbot-review-text.plist). Self-contained:
//   • read-only ClickUp (same token/logic as the board) to find reels that have
//     sat in Client Review > 24h,
//   • if any, iMessage Juan a short reminder via Messages (osascript).
// No cloud endpoint and no MCP — so it works even though the cloud watchdog also
// sends the ClickUp DM; this is the added text channel.
//
// CATCH-UP: launchd runs this on login/boot (RunAtLoad), on wake, hourly
// (StartInterval), AND at 11:00 (StartCalendarInterval). The script gates itself
// — it only sends on a WEEKDAY, at 11 AM ET or later, and at most once per NY day
// (lastSentDay). So if the Mac is asleep or off at 11 AM, the reminder fires the
// next time it's awake that weekday, exactly once. Off-hours runs exit cheaply
// before touching ClickUp.
//
// `--dry` prints what it would send (ignores the time gate); `--force` sends now
// regardless of the gate. State (first-seen stamps + last-sent day) lives in a
// local gitignored JSON.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getListTasks } from '../src/lib/clickup.js';
import { statusInfo } from '../src/lib/status.js';
import { qualifyReviews, groupByClient, waitedLabel } from '../src/lib/reviewLogic.js';
import { weekKeyForMs, dayKeyInNY, weekdayInNY, hourInNY } from '../src/lib/week.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '../config.json'), 'utf8'));
const STATE = join(here, '.review-text-state.json');
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const SEND_FROM_HOUR_NY = 11; // earliest send: 11 AM ET (and any time after, if missed)

const phone = process.env.JUAN_PHONE;
if (!phone) {
  console.error('JUAN_PHONE not set in .env — aborting.');
  process.exit(1);
}

const POST = config.postTypeFieldId;
const REEL = config.reelPostType || {};
function isReel(t) {
  const v = (t.custom_fields || []).find((f) => f.id === POST)?.value;
  if (v == null) return false;
  if (typeof v === 'number') return v === REEL.orderindex;
  if (typeof v === 'string') return v === REEL.optionId || v === String(REEL.orderindex);
  if (typeof v === 'object') return v.id === REEL.optionId || v.orderindex === REEL.orderindex;
  return false;
}

// The quoted title inside a task name (e.g. ... "prank on josh"), else the name.
const title = (name) => (String(name || '').match(/[“"]([^”"]+)[”"]/) || [])[1] || name;

const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { reviews: {}, lastSentDay: null });
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s));

function sendIMessage(msg) {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      [
        '-e', 'on run argv',
        '-e', 'set m to item 1 of argv',
        '-e', 'set p to item 2 of argv',
        '-e', 'tell application "Messages"',
        '-e', 'set s to 1st service whose service type = iMessage',
        '-e', 'set b to buddy p of s',
        '-e', 'send m to b',
        '-e', 'end tell',
        '-e', 'end run',
        msg,
        phone,
      ],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

async function main() {
  const now = Date.now();
  const today = dayKeyInNY(now);
  const wd = weekdayInNY(now); // Mon=1 … Sun=7
  const hr = hourInNY(now);
  const state = loadState();

  // Time gate (skipped for --dry/--force) — keeps off-hours/asleep-wake runs cheap
  // and ensures one weekday send at/after 11 AM ET. This is what makes a missed
  // reminder fire the next time the Mac is awake.
  if (!DRY && !FORCE) {
    if (!(wd >= 1 && wd <= 5 && hr >= SEND_FROM_HOUR_NY)) {
      console.log(`Not due now (NY weekday ${wd}, hour ${hr}) — waiting for the weekday 11 AM window.`);
      return;
    }
    if (state.lastSentDay === today) {
      console.log('Already texted today — skipping.');
      return;
    }
  }

  // Gather reels (read-only).
  const videos = [];
  for (const c of config.clients) {
    let tasks;
    try {
      tasks = await getListTasks(c.listId);
    } catch (e) {
      console.error(`list ${c.name} failed: ${e?.message || e}`);
      continue;
    }
    for (const t of tasks.filter(isReel)) {
      videos.push({
        taskId: t.id,
        client: c.name,
        name: t.name || '(untitled)',
        statusKey: statusInfo(t.status?.status).key,
        updatedMs: t.date_updated ? Number(t.date_updated) : null,
        weekKey: t.due_date ? weekKeyForMs(Number(t.due_date)) : null,
      });
    }
  }

  const { qualifying, reviews } = qualifyReviews({ videos, reviews: state.reviews, now });
  state.reviews = reviews;

  if (!qualifying.length) {
    saveState(state);
    console.log('Nothing in client review past 24h — no text.');
    return;
  }

  // Compact one-line message (iMessage-friendly).
  const groups = groupByClient(qualifying);
  const blurb = groups
    .map((g) => `${g.client} — ${g.videos.map((v) => `"${title(v.name)}"`).join(', ')}`)
    .join('; ');
  const longest = Math.max(...qualifying.map((v) => v.hours));
  const n = qualifying.length;
  const msg = `Hey Juan — ${n} video${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} been sitting in client review for ${waitedLabel(longest)}+ with no word back: ${blurb}. Mind checking in with the client${groups.length === 1 ? '' : 's'} to see if they've reviewed? 🙏`;

  if (DRY) {
    console.log('[DRY] would text', phone, '\n' + msg);
    return;
  }

  await sendIMessage(msg);
  state.lastSentDay = today;
  saveState(state);
  console.log('Texted Juan:', msg);
}

main().catch((e) => {
  console.error('agent failed:', e?.message || e);
  process.exit(1);
});
