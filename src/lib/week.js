// Week model: Mon–Sun, America/New_York. A video belongs to the week of its
// ClickUp due date, identified by that week's Monday as a YYYY-MM-DD key. Pure
// date logic — safe to import on both the server and the client.

const TZ = 'America/New_York';

const nyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Calendar date (in New York) for an epoch-ms instant.
function nyYMD(ms) {
  const parts = nyFmt.formatToParts(new Date(Number(ms)));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// Anchor a calendar date at UTC noon so whole-day arithmetic never crosses a
// DST boundary. getUTCDay() of a noon-UTC date is the weekday of that date.
function noonUTC(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function ymdString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Monday (YYYY-MM-DD) of the week containing a calendar date.
function mondayOf(y, m, d) {
  const date = noonUTC(y, m, d);
  const dow = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dow);
  return ymdString(date);
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return noonUTC(y, m, d);
}

// Week key (the Monday) for an epoch-ms instant, in NY time.
export function weekKeyForMs(ms) {
  const { y, m, d } = nyYMD(ms);
  return mondayOf(y, m, d);
}

export function currentWeekKey() {
  return weekKeyForMs(Date.now());
}

// Shift a week key by n weeks (n may be negative).
export function addWeeks(key, n) {
  const date = parseKey(key);
  date.setUTCDate(date.getUTCDate() + 7 * n);
  return ymdString(date);
}

// Which Monday-of-its-month this week is, 1-based. The week of June 1, 2026 (a
// Monday) = 1. Alternating quotas restart each calendar month, indexed by this
// value mod the pattern length. weekKey is always a Monday, so its day-of-month
// gives the Monday ordinal directly.
export function monthWeekIndex(key) {
  const day = Number(key.split('-')[2]);
  return Math.floor((day - 1) / 7) + 1;
}

// ---- Month paging --------------------------------------------------------
// A week belongs to the calendar month of its Monday (same rule monthWeekIndex
// uses). Months are keyed "YYYY-MM". The board pages by month and stacks that
// month's weeks vertically.

const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

export function monthKeyForWeek(weekKey) {
  return weekKey.slice(0, 7);
}

export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return monthFmt.format(noonUTC(y, m, 1));
}

export function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

// Every week key (Monday) whose Monday falls inside the given month.
export function weeksInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const date = noonUTC(y, m, 1);
  const dow = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  if (dow !== 0) date.setUTCDate(date.getUTCDate() + (7 - dow)); // first Monday on/after the 1st
  const weeks = [];
  while (date.getUTCMonth() === m - 1 && date.getUTCFullYear() === y) {
    weeks.push(ymdString(date));
    date.setUTCDate(date.getUTCDate() + 7);
  }
  return weeks;
}

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

// "Jun 1 – Jun 7" label for a week key.
export function weekRangeLabel(key) {
  const mon = parseKey(key);
  const sun = parseKey(key);
  sun.setUTCDate(sun.getUTCDate() + 6);
  return `${dayFmt.format(mon)} – ${dayFmt.format(sun)}`;
}

// "due Jun 3" style label for a single epoch-ms instant, in NY time.
export function dueDayLabel(ms) {
  const { y, m, d } = nyYMD(ms);
  return dayFmt.format(noonUTC(y, m, d));
}
