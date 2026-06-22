// Make-up engine: per client, per week — what's required, how the week reads,
// and (for upcoming weeks) any make-up videos folded in to recover an earlier
// shortfall. Pure: no I/O, safe on client + server.
//
// Model, per client, walking from the first week of the CURRENT month:
//   1. Settle the past. Each past week is judged at its BASE quota:
//        • posted == 0  (base > 0)  → "did not post" (urgent); whole base is owed
//        • 0 < posted < base        → "short" (reads as met, posted/posted); the
//                                      deficit is owed
//        • posted >= base           → "met"; any over-delivery pays down the
//                                      oldest thing still owed
//      The running owed count is the make-up debt entering the current week.
//   2. Spread the debt FORWARD onto the current + future weeks, one video at a
//      time, always onto the LIGHTEST week that still has room under the client's
//      normal weekly peak (the max of its base quota). This fills valleys instead
//      of spiking one week: a 2·3·2·3 client recovering one video drops it on a
//      "2" week (→3), never turning a "3" into a "4". A unit is deferred up to
//      DEFER_HORIZON weeks to find a valley; only if no week in that window has
//      room does it overflow onto the lightest available week. Smoothing is
//      per-client — we don't rebalance one client against another.
//
// "Posted" counts Posted (delivered) reels only — a made-but-unposted reel does
// NOT rescue a week. Each cell keeps the fields the board, the Monday editor
// alert (messenger.js), and the dry verifier read — state / displayRequired /
// placeholders / priority / base / required / posted / tasks — plus makeup +
// makeupFrom (source week keys) for the monthly-plan overview.
import { requiredFor } from './quota.js';
import { addWeeks, currentWeekKey, monthKeyForWeek, weeksInMonth } from './week.js';

const HORIZON = 16; // weeks computed forward from the chain start
const DEFER_HORIZON = 6; // furthest a make-up video may be pushed to find a valley

export function makeupPlan(videos, clients, currentWeek = currentWeekKey()) {
  const chainStart = weeksInMonth(monthKeyForWeek(currentWeek))[0] || currentWeek;

  // Count counted reel tasks and Posted reels per client|week.
  const taskBy = new Map();
  const postedBy = new Map();
  for (const v of videos) {
    if (!v.counted || !v.weekKey) continue;
    const k = `${v.client}|${v.weekKey}`;
    taskBy.set(k, (taskBy.get(k) || 0) + 1);
    if (v.delivered) postedBy.set(k, (postedBy.get(k) || 0) + 1);
  }

  const out = new Map();
  for (const c of clients) {
    const weeks = [];
    for (let i = 0; i <= HORIZON; i += 1) weeks.push(addWeeks(chainStart, i));
    const curIdx = weeks.findIndex((w) => w === currentWeek);
    const base = weeks.map((w) => requiredFor(c.quota, w));
    const posted = weeks.map((w) => postedBy.get(`${c.name}|${w}`) || 0);
    const tasks = weeks.map((w) => taskBy.get(`${c.name}|${w}`) || 0);

    const makeup = weeks.map(() => 0);
    const makeupFrom = weeks.map(() => []);
    const pastState = weeks.map(() => null);
    const owed = []; // FIFO of outstanding shortfalls: { week, left }

    // ---- 1. Settle the past --------------------------------------------
    for (let i = 0; i < weeks.length && weeks[i] < currentWeek; i += 1) {
      // Clean-slate reset: forgive any carried make-up debt as of this week (e.g.
      // a client's quota is changing, so old-quota shortfalls shouldn't roll in).
      if (c.makeupReset && weeks[i] === c.makeupReset) owed.length = 0;
      const b = base[i];
      const p = posted[i];
      if (b > 0 && p === 0) {
        pastState[i] = 'didnotpost';
        owed.push({ week: weeks[i], left: b });
      } else if (p < b) {
        pastState[i] = 'short';
        owed.push({ week: weeks[i], left: b - p });
      } else {
        pastState[i] = 'met';
        let over = p - b; // over-delivery pays down the oldest owed first
        while (over > 0 && owed.length) {
          const src = owed[0];
          const pay = Math.min(over, src.left);
          src.left -= pay;
          over -= pay;
          if (src.left === 0) owed.shift();
        }
      }
    }

    // ---- 2. Spread the remaining debt forward onto valleys --------------
    // Cap = the client's normal weekly peak, read from the base quota over the
    // forward window (so a scheduled cadence change is respected).
    const startIdx = Math.max(0, curIdx);
    let endIdx = Math.min(weeks.length - 1, startIdx + DEFER_HORIZON);
    // A future clean-slate reset bounds how far make-up may be pushed: debt from
    // before the reset must land before it (or be dropped at the reset).
    if (c.makeupReset && c.makeupReset > currentWeek) {
      const rIdx = weeks.findIndex((w) => w === c.makeupReset);
      if (rIdx > startIdx) endIdx = Math.min(endIdx, rIdx - 1);
    }
    let peak = 0;
    for (let i = startIdx; i <= endIdx; i += 1) peak = Math.max(peak, base[i]);

    let debt = owed.reduce((s, o) => s + o.left, 0);
    while (debt > 0 && endIdx >= startIdx) {
      // Lightest week with room under the peak; fall back to lightest overall.
      let pick = -1;
      let pickLoad = Infinity;
      let forced = -1;
      let forcedLoad = Infinity;
      for (let i = startIdx; i <= endIdx; i += 1) {
        const load = base[i] + makeup[i];
        if (load < forcedLoad) {
          forced = i;
          forcedLoad = load;
        }
        if (load < peak && load < pickLoad) {
          pick = i;
          pickLoad = load;
        }
      }
      const tgt = pick >= 0 ? pick : forced;
      if (tgt < 0) break;
      makeup[tgt] += 1;
      const src = owed[0];
      if (src) {
        makeupFrom[tgt].push(src.week);
        src.left -= 1;
        if (src.left === 0) owed.shift();
      }
      debt -= 1;
    }

    // ---- 3. Build cells -------------------------------------------------
    const cells = new Map();
    let prevState = null;
    for (let i = 0; i < weeks.length; i += 1) {
      const wk = weeks[i];
      const isPast = wk < currentWeek;
      const isCurrent = wk === currentWeek;
      const b = base[i];
      const p = posted[i];
      const t = tasks[i];
      const mk = isPast ? 0 : makeup[i];
      const required = b + mk;

      let state;
      let placeholders = 0;
      let displayRequired;
      if (isPast) {
        state = pastState[i];
        // A short past week reads as met (posted/posted); everything else shows
        // its real (base) requirement.
        displayRequired = state === 'short' ? p : b;
      } else {
        state = isCurrent ? 'current' : 'future';
        placeholders = Math.max(0, required - t);
        displayRequired = required;
      }

      cells.set(wk, {
        base: b,
        required: isPast ? b : required,
        posted: p,
        tasks: t,
        state,
        placeholders,
        priority: prevState === 'didnotpost', // the week right after a no-post week
        displayRequired,
        makeup: mk,
        makeupFrom: isPast ? [] : makeupFrom[i],
      });
      prevState = state;
    }
    out.set(c.name, cells);
  }
  return out;
}
