// Shoot-scheduling analysis — pure functions over the normalized reel list.
// Answers, per client / shoot unit: when do we run short, what's the last week
// a fresh shoot should be in the books, how urgent is the nudge, and is an
// already-booked shoot early enough. No ClickUp/Calendar I/O lives here — the
// watchdog and the Overview UI both feed it data and share the verdict.
import { requiredFor } from './quota.js';
import { addWeeks, weeksBetween } from './week.js';

const DEFAULT_HORIZON = 26;

// Counted (non-canceled/paused) reels a client has landing in a given week.
function countInWeek(videos, clientName, weekKey) {
  let n = 0;
  for (const v of videos) {
    if (v.counted && v.client === clientName && v.weekKey === weekKey) n += 1;
  }
  return n;
}

// Scan forward from the current week to the first week a client falls below
// quota ("runs short"). The week before it is the last fully-covered week — the
// latest we'd want a fresh shoot in the books. `covered` means no short week
// inside the horizon (plenty of runway → nothing to nudge).
export function runwayStatus(client, videos, currentWeek, opts = {}) {
  const horizon = opts.horizonWeeks || DEFAULT_HORIZON;
  // Reels that exist but have no due date yet (made, awaiting Nayith's review)
  // are content-in-hand — they'll be slotted into upcoming weeks, so they extend
  // the runway. Draw this buffer down against each week's shortfall before
  // declaring a short week, which pushes the recommended shoot date out.
  let buffer = videos.filter((v) => v.counted && v.client === client.name && !v.weekKey).length;
  let firstShort = null;
  for (let i = 0; i <= horizon; i += 1) {
    const wk = addWeeks(currentWeek, i);
    const required = requiredFor(client.quota, wk);
    if (required <= 0) continue; // no quota that week → cannot be short
    let shortfall = required - countInWeek(videos, client.name, wk);
    if (shortfall <= 0) continue;
    const draw = Math.min(buffer, shortfall);
    buffer -= draw;
    shortfall -= draw;
    if (shortfall > 0) {
      firstShort = wk;
      break;
    }
  }
  if (!firstShort) {
    return {
      client: client.name,
      covered: true,
      firstShortWeek: null,
      lastCoveredWeek: null,
      recommendedWeek: null,
      weeksLeft: null,
    };
  }
  const lastCovered = addWeeks(firstShort, -1);
  const weeksLeft = weeksBetween(currentWeek, firstShort); // 0 = short this week
  // Aim to shoot during the last covered week; if we're already short, ASAP.
  const recommendedWeek = weeksLeft <= 0 ? currentWeek : lastCovered;
  return {
    client: client.name,
    covered: false,
    firstShortWeek: firstShort,
    lastCoveredWeek: lastCovered,
    recommendedWeek,
    weeksLeft,
  };
}

// Group clients into shoot units. Most clients are their own unit; a client
// flagged shoot.coveredBy folds into that lead's unit (e.g. Rainy Days rides the
// Brewing Buddha shoot, so one shoot — and one reminder — covers both).
export function shootUnits(clients) {
  const units = [];
  for (const c of clients) {
    const s = c.shoot || {};
    if (s.coveredBy) continue; // folded into its lead
    const members = [c.name];
    for (const other of clients) {
      if (other.shoot && other.shoot.coveredBy === c.name) members.push(other.name);
    }
    units.push({
      lead: c.name,
      members,
      frequencyMonths: s.frequencyMonths || null,
      aliases: s.aliases && s.aliases.length ? s.aliases : [c.name],
    });
  }
  return units;
}

// A unit's runway is its most-urgent member: a single shoot has to beat the
// soonest short week among everyone it feeds.
export function unitRunway(unit, clients, videos, currentWeek, opts = {}) {
  const byName = new Map(clients.map((c) => [c.name, c]));
  let worst = null;
  for (const name of unit.members) {
    const c = byName.get(name);
    if (!c) continue;
    const st = runwayStatus(c, videos, currentWeek, opts);
    if (st.covered) continue;
    if (!worst || st.firstShortWeek < worst.firstShortWeek) worst = st;
  }
  const base = { lead: unit.lead, members: unit.members, aliases: unit.aliases, frequencyMonths: unit.frequencyMonths };
  if (!worst) {
    return { ...base, covered: true, firstShortWeek: null, lastCoveredWeek: null, recommendedWeek: null, weeksLeft: null, drivenBy: null };
  }
  return {
    ...base,
    covered: false,
    firstShortWeek: worst.firstShortWeek,
    lastCoveredWeek: worst.lastCoveredWeek,
    recommendedWeek: worst.recommendedWeek,
    weeksLeft: worst.weeksLeft,
    drivenBy: worst.client,
  };
}

// Escalation tier from weeks-until-short. Drives wording + which days we ping.
// Deliberately restrained — a nudge should feel like a helpful heads-up, not a
// daily nag — so even the most urgent tier tops out at three weekdays a week.
//   >=4 wks → gentle "just a nudge", Mondays only
//      3 wks → reminders in earnest, Mondays only
//      2 wks → more urgent, Mon + Thu
//     <=1 wk → urgent, Mon/Wed/Fri (never weekends)
export function escalationTier(weeksLeft) {
  if (weeksLeft == null) return { key: 'covered', cadence: 'none' };
  if (weeksLeft <= 1) return { key: 'urgent', cadence: 'mwf' };
  if (weeksLeft === 2) return { key: 'soon', cadence: 'mt' };
  if (weeksLeft === 3) return { key: 'earnest', cadence: 'monday' };
  return { key: 'gentle', cadence: 'monday' };
}

// Does a cadence fire on this weekday? weekday: Mon=1 … Sun=7.
export function cadenceFiresOn(cadence, weekday) {
  switch (cadence) {
    case 'daily': // retained for safety; no tier uses it anymore
      return true;
    case 'mwf':
      return weekday === 1 || weekday === 3 || weekday === 5;
    case 'mt':
      return weekday === 1 || weekday === 4;
    case 'monday':
      return weekday === 1;
    default:
      return false;
  }
}

// Classify a booked shoot against the last covered week. "fine" if it lands on
// or before Tuesday of the last covered week (or any earlier week); otherwise
// "late" → the team gets a heads-up. shootWeek = the shoot's Monday key;
// shootWeekday = Mon..Sun (1..7).
export function classifyBookedShoot(shootWeek, shootWeekday, lastCoveredWeek) {
  if (!lastCoveredWeek) return 'fine';
  if (shootWeek < lastCoveredWeek) return 'fine';
  if (shootWeek === lastCoveredWeek) return shootWeekday <= 2 ? 'fine' : 'late';
  return 'late';
}
