// Required deliveries for a client in a given week. Phase 1 = base quota only;
// carry-over / monthly deficit is Phase 3 and deliberately NOT computed here.
//
// Two quota shapes:
//   fixed → the same value every week.
//   alt   → an alternating pattern that restarts each calendar month, indexed
//           by the week's Monday-ordinal-in-month (1-based) mod the pattern
//           length. Anchor: the week of June 1 2026 (a Monday) is month-week 1.
import { monthWeekIndex } from './week.js';

export function requiredFor(quota, weekKey) {
  if (!quota) return 0;
  // A client can have a startWeek (e.g. a newly-onboarded client) — no quota is
  // owed for any week before it, so earlier weeks don't show them as short.
  if (quota.startWeek && weekKey < quota.startWeek) return 0;
  if (quota.type === 'fixed') return Number(quota.value) || 0;
  if (quota.type === 'alt' && Array.isArray(quota.pattern) && quota.pattern.length) {
    const idx = (monthWeekIndex(weekKey) - 1) % quota.pattern.length;
    return Number(quota.pattern[idx]) || 0;
  }
  // schedule → time-phased segments (each a fixed/alt quota with an effective
  // `from` week). Use the latest segment on/before this week; a segment with no
  // `from` is the baseline. Lets a client's cadence change on a date.
  if (quota.type === 'schedule' && Array.isArray(quota.segments)) {
    let active = null;
    for (const seg of quota.segments) {
      const from = seg.from || '';
      if (from <= weekKey && (!active || from >= (active.from || ''))) active = seg;
    }
    return active ? requiredFor(active, weekKey) : 0;
  }
  return 0;
}
