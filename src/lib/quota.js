// Required deliveries for a client in a given week. Phase 1 = base quota only;
// carry-over / monthly deficit is Phase 3 and deliberately NOT computed here.
//
// Two quota shapes:
//   fixed → the same value every week.
//   alt   → an alternating pattern that restarts each calendar month, indexed
//           by the week's Monday-ordinal-in-month (1-based) mod the pattern
//           length. Anchor: the week of June 1 2026 (a Monday) is month-week 1.
//   schedule → time-phased segments (see baseRequired).
//
// On top of the shape, a quota may carry per-week `adjustments`:
//   adjustments: [{ week: "YYYY-MM-DD", delta: -1, note, taskId }]
// Each matching week's requirement is shifted by `delta` (clamped at 0). This is
// how a scrapped video is reflected WITHOUT a make-up: dropping that week's
// required by 1 means the board needs one fewer there and nothing rolls forward.
import { monthWeekIndex } from './week.js';

// The quota shape's value for a week, before any manual adjustments.
function baseRequired(quota, weekKey) {
  if (quota.type === 'fixed') return Number(quota.value) || 0;
  if (quota.type === 'alt' && Array.isArray(quota.pattern) && quota.pattern.length) {
    const idx = (monthWeekIndex(weekKey) - 1) % quota.pattern.length;
    return Number(quota.pattern[idx]) || 0;
  }
  // schedule → use the latest segment whose `from` is on/before this week; a
  // segment with no `from` is the baseline. Lets a client's cadence change on a date.
  if (quota.type === 'schedule' && Array.isArray(quota.segments)) {
    let active = null;
    for (const seg of quota.segments) {
      const from = seg.from || '';
      if (from <= weekKey && (!active || from >= (active.from || ''))) active = seg;
    }
    return active ? baseRequired(active, weekKey) : 0;
  }
  return 0;
}

export function requiredFor(quota, weekKey) {
  if (!quota) return 0;
  // A client can have a startWeek (e.g. a newly-onboarded client) — no quota is
  // owed for any week before it, so earlier weeks don't show them as short.
  if (quota.startWeek && weekKey < quota.startWeek) return 0;
  let n = baseRequired(quota, weekKey);
  if (Array.isArray(quota.adjustments)) {
    for (const a of quota.adjustments) {
      if (a && a.week === weekKey) n += Number(a.delta) || 0;
    }
  }
  return Math.max(0, n);
}
