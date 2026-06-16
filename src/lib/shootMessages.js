// Pure message composers for the shoot-reminder watchdog — turn shoot-status
// units into the text BUMBOT sends. No I/O, no config, so the wording is easy to
// test and tweak in isolation from the sender. Sent as markdown (ClickUp Chat
// content_format: text/md), so **bold** + `code` render.
import { weekRangeLabel, dueDayLabel } from './week.js';

const weekStart = (weekKey) => (weekKey ? weekRangeLabel(weekKey).split('–')[0].trim() : null);
const TIER_MARK = { urgent: '🔴', soon: '🟠', earnest: '🟡', gentle: '🟢' };
const TIER_RANK = { urgent: 0, soon: 1, earnest: 2, gentle: 3 };

// One grouped reminder DM listing every client that needs a shoot today,
// most-urgent first, with the bot's calendar-guest email for easy copy/paste.
export function buildReminder(units, { botEmail } = {}) {
  const blocks = [...units]
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || (a.weeksLeft ?? 99) - (b.weeksLeft ?? 99))
    .map((u) => {
      const short = weekStart(u.runsShortWeek);
      const by = weekStart(u.recommendedWeek);
      return `${TIER_MARK[u.tier] || '🟢'} **${u.lead}**\nruns short the week of ${short || 'soon'}${by ? ` · book by **${by}**` : ''}`;
    });

  const parts = ['🎬 **Shoot Reminders**', '', 'These clients still need a shoot booked:', '', blocks.join('\n\n')];
  parts.push('');
  if (botEmail) {
    parts.push(`📌 To stop the nudges: book the shoot and add this guest to the calendar event —\n\`${botEmail}\``);
  } else {
    parts.push("Once it's booked, add the BUMBOT guest to the calendar event and I'll stop nudging.");
  }
  return parts.join('\n');
}

// Weekly nudge to Nayith: reels that are made but have no due date yet. Setting
// a date slots each onto the master sheet (the runway already counts them).
export function buildNayithNudge(items) {
  const lines = [...items].sort((a, b) => b.count - a.count).map((u) => `🎬 **${u.client}** — ${u.count} ready`);
  const total = items.reduce((n, u) => n + u.count, 0);
  return [
    '🗓️ **Ready for a due date**',
    '',
    `${total} reel${total === 1 ? '' : 's'} are made and waiting on a due date so they land on the master sheet:`,
    '',
    lines.join('\n'),
    '',
    "When you get a sec, set due dates so they slot into their weeks 🙏 (they're already counting toward the shoot runway).",
  ].join('\n');
}

// A real ClickUp chat @-mention: a markdown link whose href is #user_mention#<id>.
// The id is what fires the notification; the visible text is the person's name.
export function clickupMention(id, name) {
  return `[@${name}](#user_mention#${id})`;
}

// Urgent alert in the Video Editing Team channel when a client got ZERO posts the
// week they were due — @-mentions the editor(s) on that client so they're pinged.
export function buildEditorPriorityAlert(client, editors) {
  const tags = editors.map((e) => clickupMention(e.id, e.name)).join(' ');
  return [
    `🚨 **PRIORITY — we did NOT post for ${client} last week** 🚨`,
    '',
    `${tags ? tags + ' — ' : ''}we missed posting **any** content for **${client}** last week. This is now a top priority.`,
    '',
    `Let's get their videos finished and posted ASAP so we don't fall further behind. 🙏`,
  ].join('\n');
}

// The same heads-up as a private DM to one editor (extra nudge on top of the @).
export function buildEditorPriorityDM(client) {
  return (
    `🚨 Heads up — we didn't post **any** content for **${client}** last week, so they're a **PRIORITY** this week. ` +
    `Please prioritize their videos and get them finished + posted. 🙏`
  );
}

// One heads-up to Juan + Chris + Nayith when a booked shoot lands too late.
export function buildLateAlert(u) {
  const day = dueDayLabel(u.nextShoot.startMs);
  const short = weekStart(u.runsShortWeek);
  return (
    `👋 Heads up team — glad the **${u.lead}** shoot is booked for **${day}**, but at that timing ` +
    `we run short on **${u.lead}** content the week of **${short}**.\n\n` +
    `**Juan / Chris** — good with that, or should we move it up? **Nayith** — if it stays, maybe build ` +
    `one from existing ${u.lead} footage to cover the gap.`
  );
}
