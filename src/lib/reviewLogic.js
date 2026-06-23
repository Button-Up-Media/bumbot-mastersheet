// Pure decision + wording logic for the client-review watchdog. No I/O and no
// config-JSON imports, so it's trivially unit-testable in bare node (like
// insights.js). The watchdog (reviewWatchdog.js) wires this to the board, KV,
// Claude, and the chat sender.

const HOUR_MS = 60 * 60 * 1000;
export const REVIEW_MIN_MS = 24 * HOUR_MS; // "still sitting after a 24h period"

// Decide which reels have been parked in Client Review long enough to chase, and
// roll the KV "first seen in review" memory forward.
//
//   videos  — board records (need: statusKey, taskId, client, name, url, updatedMs)
//   reviews — KV map { [taskId]: { firstSeen, client, name } } from prior runs
//   now     — epoch ms (injected so tests are deterministic)
//
// A reel qualifies when it's CURRENTLY in Client Review and has been there for at
// least minMs, measured as the MAX of two independent lower bounds:
//   • now - updatedMs : nothing on the task has changed since then, and the move
//     INTO review was itself an update, so its review-age ≥ now - updatedMs.
//     (Conservative + sourced straight from ClickUp ⇒ no cold-start blind spot.)
//   • now - firstSeen : we first observed it in review that long ago. Survives an
//     incidental edit (a comment, a field tweak) that would reset date_updated.
//
// The returned `reviews` map contains only reels still in review, so tasks that
// left review (approved, revisions, etc.) are pruned automatically.
export function qualifyReviews({ videos = [], reviews = {}, now = Date.now(), minMs = REVIEW_MIN_MS } = {}) {
  const inReview = videos.filter((v) => v && v.statusKey === 'review');
  const nextReviews = {};
  const qualifying = [];

  for (const v of inReview) {
    const prior = reviews[v.taskId];
    const firstSeen = prior?.firstSeen || now; // stamp on first observation
    nextReviews[v.taskId] = { firstSeen, client: v.client, name: v.name };

    const updatedAge = v.updatedMs ? now - v.updatedMs : 0;
    const seenAge = now - firstSeen;
    const sinceMs = Math.max(updatedAge, seenAge);
    if (sinceMs >= minMs) {
      qualifying.push({
        taskId: v.taskId,
        client: v.client,
        name: v.name || '(untitled)',
        url: v.url || null,
        sinceMs,
        hours: Math.floor(sinceMs / HOUR_MS),
      });
    }
  }

  // Longest-waiting first so the most overdue client leads the message.
  qualifying.sort((a, b) => b.sinceMs - a.sinceMs);
  return { qualifying, reviews: nextReviews, inReview: inReview.length };
}

// Human "how long" phrase from an hour count (already ≥24).
export function waitedLabel(hours) {
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days} days`;
  if (hours >= 36) return `a day and a half`;
  return `over a day`;
}

// Group qualifying items by client, preserving the longest-waiting order.
export function groupByClient(items) {
  const order = [];
  const byClient = new Map();
  for (const it of items) {
    if (!byClient.has(it.client)) {
      byClient.set(it.client, []);
      order.push(it.client);
    }
    byClient.get(it.client).push(it);
  }
  return order.map((client) => ({ client, videos: byClient.get(client) }));
}

// Deterministic, lightly-varied fallback wording for when Claude is unavailable
// (no ANTHROPIC_API_KEY, or the call fails). `seed` (e.g. day-of-year) rotates the
// opener/closer so back-to-back days don't read identically. Markdown (ClickUp
// Chat text/md): **bold** + “quoted” titles render.
export function fallbackNudge(items, seed = 0) {
  const groups = groupByClient(items);
  const openers = [
    'Hey Juan! 👋',
    'Morning, Juan —',
    'Hey Juan, quick one —',
    'Juan! Hope the day’s off to a good start —',
    'Hey Juan, flagging a couple before they go stale —',
  ];
  const closers = [
    'Mind giving them a nudge today? 🙏',
    'Could you check in and see where they’re at? 🙏',
    'A quick follow-up from you would probably get these unstuck. 🙌',
    'Want to reach out and see if they’ve had a chance to look? 🙏',
    'Let’s get a read from them so we can move these along. 🚀',
  ];
  const opener = openers[((seed % openers.length) + openers.length) % openers.length];
  const closer = closers[((seed % closers.length) + closers.length) % closers.length];

  const lines = groups.map(({ client, videos }) => {
    if (videos.length === 1) {
      return `• **${client}** still hasn’t gotten back on “${videos[0].name}” — it’s been waiting ${waitedLabel(videos[0].hours)}.`;
    }
    const longest = Math.max(...videos.map((v) => v.hours));
    return `• **${client}** has ${videos.length} videos waiting on their review (longest ${waitedLabel(longest)}).`;
  });

  return [
    opener,
    '',
    `A few videos have been sitting in client review for more than a day with no word back:`,
    '',
    lines.join('\n'),
    '',
    closer,
  ].join('\n');
}
