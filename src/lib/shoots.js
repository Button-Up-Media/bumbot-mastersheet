// Per-shoot-unit status for the Overview + (later) the watchdog. Combines the
// ClickUp content runway (shootPlan) with calendar shoots into one verdict per
// client unit. Server-only (pulls the calendar). Returned data is plain JSON.
//
// State machine per unit:
//   booked     — an upcoming shoot is on the calendar (with a fine/late verdict)
//   just-shot  — a shoot in the last ~3 weeks; its content isn't in ClickUp yet,
//                so the runway looks short but isn't — no nudge. Next shoot is
//                expected ~last-shoot + the client's frequency.
//   needs-shoot— running short, no upcoming shoot, no recent shoot → nudge Juan
//   covered    — plenty of runway, nothing to do
import config from './loadConfig.js';
import { currentWeekKey } from './week.js';
import { shootUnits, unitRunway, escalationTier, classifyBookedShoot } from './shootPlan.js';
import { getShoots } from './calendar.js';

const RECENT_DAYS = 21; // a shoot this recent = "just shot, content coming"
const MS_DAY = 86400000;

export async function computeShootStatus(videos) {
  const cal = await getShoots();
  const currentWeek = currentWeekKey();
  const now = Date.now();
  const units = shootUnits(config.clients).map((u) => {
    const runway = unitRunway(u, config.clients, videos, currentWeek);
    const shoots = (cal.byUnit && cal.byUnit[u.lead]) || [];
    const next = shoots.find((s) => s.startMs >= now) || null;
    const last = [...shoots].reverse().find((s) => s.startMs < now) || null;
    const justShot = !!last && now - last.startMs <= RECENT_DAYS * MS_DAY;

    let state;
    let nextShoot = null;
    let nextExpectedMs = null;
    let tier = null;
    if (next) {
      state = 'booked';
      const verdict = runway.lastCoveredWeek ? classifyBookedShoot(next.weekKey, next.weekday, runway.lastCoveredWeek) : 'fine';
      nextShoot = { title: next.title, startMs: next.startMs, weekKey: next.weekKey, verdict };
    } else if (justShot) {
      state = 'just-shot';
      if (u.frequencyMonths && last) nextExpectedMs = last.startMs + Math.round(u.frequencyMonths * 30.44 * MS_DAY);
    } else if (runway.covered) {
      state = 'covered';
    } else {
      state = 'needs-shoot';
      tier = escalationTier(runway.weeksLeft).key;
    }

    return {
      lead: u.lead,
      members: u.members,
      frequencyMonths: u.frequencyMonths,
      state,
      runsShortWeek: runway.firstShortWeek,
      recommendedWeek: runway.recommendedWeek,
      weeksLeft: runway.weeksLeft,
      tier,
      nextShoot,
      lastShootMs: last ? last.startMs : null,
      nextExpectedMs,
    };
  });
  return { calendarOk: cal.ok, error: cal.error || null, currentWeek, units };
}
