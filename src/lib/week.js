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

// Whole weeks from aKey to bKey (b - a). Negative if b is before a. Noon-UTC
// anchoring keeps the division DST-safe. Used for "weeks of runway left".
export function weeksBetween(aKey, bKey) {
  const ms = parseKey(bKey).getTime() - parseKey(aKey).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

// Weekday of an epoch-ms instant in New York time: Mon=1 … Sun=7. Used to tell
// whether a booked shoot lands on/before Tuesday of its week, and which days a
// reminder cadence fires on.
export function weekdayInNY(ms) {
  const { y, m, d } = nyYMD(ms);
  return ((noonUTC(y, m, d).getUTCDay() + 6) % 7) + 1;
}

// Hour-of-day (0–23) of an epoch-ms instant in New York time. Lets a UTC cron
// fire on a couple of candidate hours and gate to the exact NY local hour, so a
// "11 AM ET" reminder stays at 11 AM through both EDT and EST.
const nyHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
export function hourInNY(ms) {
  return Number(nyHourFmt.format(new Date(Number(ms))).replace(/\D/g, ''));
}

// Calendar day (YYYY-MM-DD, New York) for an epoch-ms instant. Used as a
// once-per-day key so a reminder fires at most once on a given NY date even if
// the scheduler runs more than once that morning.
export function dayKeyInNY(ms) {
  return nyFmt.format(new Date(Number(ms))); // en-CA → "YYYY-MM-DD"
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
