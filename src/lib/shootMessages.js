// Pure message composers for the shoot-reminder watchdog — turn shoot-status
// units into the text BUMBOT sends. No I/O, no config, so the wording is easy to
// test and tweak in isolation from the sender.
import { weekRangeLabel, dueDayLabel } from './week.js';

const weekStart = (weekKey) => (weekKey ? weekRangeLabel(weekKey).split('–')[0].trim() : null);
const TIER_MARK = { urgent: '🔴', soon: '🟠', earnest: '🟡', gentle: '🟢' };
const TIER_RANK = { urgent: 0, soon: 1, earnest: 2, gentle: 3 };

// One grouped reminder DM to Juan, listing every client that needs a shoot today,
// most-urgent first. The per-client dot conveys urgency so it stays one tidy message.
export function buildReminder(units) {
  const lines = [...units]
    .sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || ((a.weeksLeft ?? 99) - (b.weeksLeft ?? 99)))
    .map((u) => {
      const short = weekStart(u.runsShortWeek);
      const by = weekStart(u.recommendedWeek);
      return `${TIER_MARK[u.tier] || '🟢'} ${u.lead} — runs short ${short ? `the week of ${short}` : 'soon'}${by ? `; aim to shoot by ${by}` : ''}`;
    });
  return [
    '🎬 Shoot reminders',
    '',
    'These clients still need a shoot on the calendar:',
    ...lines,
    '',
    "Once it's booked, add the BUMBOT guest to the calendar event and I'll stop nudging.",
  ].join('\n');
}

// One heads-up to Juan + Chris + Nayith when a booked shoot lands too late.
export function buildLateAlert(u) {
  const day = dueDayLabel(u.nextShoot.startMs);
  const short = weekStart(u.runsShortWeek);
  return (
    `Hey team 👋 glad the ${u.lead} shoot is booked for ${day} — heads up though, at that timing ` +
    `we run short on ${u.lead} content the week of ${short}. Juan / Chris, are you good with that, or ` +
    `should we move it up? Nayith — if it stays, maybe build one from existing ${u.lead} footage to cover the gap.`
  );
}
