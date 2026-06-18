// Make-up engine: per client, per week, what's required and how the week reads.
// Walks each client's weeks from the first week of the CURRENT month forward,
// carrying a running "owed" count that adds +1 to each following week until it's
// absorbed (crossing the month boundary if it has to). Replaces the old reel
// roll-forward with a purely numeric rebalance.
//
// Per-week rules:
//   • PAST week, posted >= required           → met
//   • PAST week, 0 < posted < required (short)→ shown MET (posted/posted); the
//                                               deficit moves forward
//   • PAST week, posted == 0 (and required>0) → "did not post" (urgent); the
//                                               whole requirement moves forward,
//                                               and the NEXT week is "priority"
//   • CURRENT / FUTURE week                   → expose `placeholders` = required −
//                                               reel tasks present ("needs to be
//                                               sent out"; the current week marks
//                                               them urgent in the UI)
//
// "Posted" is the count of Posted (delivered) reels — a made-but-unposted reel
// does NOT rescue a past week. Pure: no I/O, safe on client + server.
import { requiredFor } from './quota.js';
import { addWeeks, currentWeekKey, monthKeyForWeek, weeksInMonth } from './week.js';

const HORIZON = 16; // weeks to compute forward from the chain start

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
    const cells = new Map();
    let pending = 0; // owed videos still to spread forward (+1 per week)
    let prevState = null;
    for (let i = 0; i <= HORIZON; i += 1) {
      const wk = addWeeks(chainStart, i);
      // Clean-slate reset: forgive any carried make-up debt as of this week (e.g.
      // a client's quota is changing, so old-quota shortfalls shouldn't roll in).
      if (c.makeupReset && wk === c.makeupReset) pending = 0;
      const base = requiredFor(c.quota, wk);
      const addNow = pending > 0 ? 1 : 0; // absorb one unit of the backlog this week
      const required = base + addNow;
      pending -= addNow;

      const posted = postedBy.get(`${c.name}|${wk}`) || 0;
      const tasks = taskBy.get(`${c.name}|${wk}`) || 0;
      const isPast = wk < currentWeek;
      const isCurrent = wk === currentWeek;

      let state;
      let placeholders = 0;
      if (isPast) {
        if (required > 0 && posted === 0) {
          state = 'didnotpost';
          pending += required;
        } else if (required > 0 && posted < required) {
          state = 'short';
          pending += required - posted;
        } else {
          state = 'met';
        }
      } else {
        state = isCurrent ? 'current' : 'future';
        placeholders = Math.max(0, required - tasks);
      }

      cells.set(wk, {
        base,
        required,
        posted,
        tasks,
        state,
        placeholders,
        priority: prevState === 'didnotpost', // the week right after a no-post week
        // A short past week reads as met (posted/posted); everything else shows its
        // real requirement.
        displayRequired: state === 'short' ? posted : required,
      });
      prevState = state;
    }
    out.set(c.name, cells);
  }
  return out;
}
