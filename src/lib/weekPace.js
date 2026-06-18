// Week pace model — a high-level "are we on pace?" read for a week's editing.
//
// Deadline is FRIDAY: every required video should be finished editing (Posted /
// Ready to Post / Client Review) by end of Friday. Thursday is the aim — every
// reel started (a Dropbox draft exists) AND ~80% finished. Expected progress
// therefore ramps 20%/day to 100% by Friday (which lands ~80% on Thursday).
//
// Inputs (current week): finished, required, started, posted, day (Mon=1…Sun=7).
// Past weeks return their final result; future weeks return "upcoming". Pure — no
// I/O, safe on client + server.

const DEADLINE_DAY = 5; // Friday — everything due
const AIM_DAY = 4; // Thursday — all started + ~80% done
const ONPACE_RATIO = 0.9; // finished% ≥ 90% of expected → on pace
const BEHIND_RATIO = 0.6; // ≥ 60% of expected → behind; below → majorly behind

export const PACE_LABEL = {
  done: 'Done',
  onpace: 'On pace',
  behind: 'Behind',
  major: 'Majorly behind',
  missed: 'Missed',
  upcoming: 'Upcoming',
  idle: '',
};

export function weekPace({ finished = 0, required = 0, started = 0, posted = 0, day = 1, isPast = false, isCurrent = false }) {
  const finishedPct = required > 0 ? finished / required : 0;
  const fill = Math.max(0, Math.min(1, finishedPct));
  const base = { finished, required, posted, fill, expectedPct: 0, notStarted: 0 };

  if (required <= 0) return { ...base, kind: 'idle', status: 'idle' };
  if (isPast) return { ...base, kind: 'past', status: finished >= required ? 'done' : 'missed', expectedPct: 1 };
  if (!isCurrent) return { ...base, kind: 'future', status: 'upcoming' };

  // Current week pace.
  const expectedPct = Math.min(1, day / DEADLINE_DAY); // 20%/day → 100% by Fri
  const ratio = expectedPct > 0 ? finishedPct / expectedPct : 1;
  const notStarted = Math.max(0, required - started);
  const startedGate = day < AIM_DAY || notStarted === 0; // by Thu, everything must be started

  let status;
  if (finished >= required) status = 'done';
  else if (ratio >= ONPACE_RATIO && startedGate) status = 'onpace';
  else if (ratio >= BEHIND_RATIO) status = 'behind';
  else status = 'major';
  // On/after the Friday deadline, not-done can't read as "on pace" — it's overdue.
  if (day >= DEADLINE_DAY && status === 'onpace') status = 'behind';

  const remaining = Math.max(0, required - finished);
  const daysElapsed = Math.max(1, Math.min(day, DEADLINE_DAY));
  const daysLeft = Math.max(0, DEADLINE_DAY - day);
  return {
    ...base,
    kind: 'current',
    status,
    expectedPct,
    notStarted,
    remaining,
    perDaySoFar: finished / daysElapsed,
    neededPerDay: daysLeft > 0 ? remaining / daysLeft : remaining,
    daysLeft,
    day,
  };
}
