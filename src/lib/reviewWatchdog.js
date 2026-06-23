// Client-review watchdog. Runs each weekday morning (see the cron route + GitHub
// Actions schedule): it finds reels that have been parked in Client Review for
// more than 24h with no word from the client, and DMs Juan one short, personal
// reminder to follow up with those specific client(s). If nothing has been
// waiting that long, it stays silent — Juan only hears from it when there's
// actually a client to chase.
//
// Like the shoot watchdog, this is one of the sanctioned "DM as BUMBOT" writes;
// every ClickUp TASK read stays GET-only. modes: 'preview' (compose only, send
// nothing) · 'dry' (send to Chris, prefixed) · 'live' (DM Juan for real).
import { getBoard } from './cache.js';
import { qualifyReviews, groupByClient, fallbackNudge } from './reviewLogic.js';
import { composeClientReviewNudge } from './claude.js';
import { sendDM } from './clickupChat.js';
import { loadBotState, saveBotState } from './botState.js';
import { dayKeyInNY } from './week.js';

function ids() {
  return { juan: process.env.SHOOT_JUAN_ID, chris: process.env.SHOOT_CHRIS_ID };
}

// Day index (days since epoch) — rotates the wording seed once per day so two
// consecutive days never read identically, in Claude prose or the fallback.
function daySeed(now) {
  return Math.floor(now / 86_400_000);
}

export async function runClientReviewWatchdog({ mode = 'dry', now = Date.now(), dedupe = true } = {}) {
  const board = await getBoard({ force: true });
  const videos = board?.videos || [];
  const state = await loadBotState();

  const { qualifying, reviews, inReview } = qualifyReviews({ videos, reviews: state.reviews, now });
  state.reviews = reviews; // roll memory forward (prunes reels no longer in review)

  const result = { mode, inReview, qualifying: qualifying.length, messages: [] };

  // Only reach out when there's actually a video to chase.
  if (!qualifying.length) {
    await saveBotState(state);
    result.skipped = inReview ? 'in-review-but-under-24h' : 'none-in-review';
    return result;
  }

  // Fire at most once per NY day. The scheduler hits a couple of candidate UTC
  // hours and a delayed run could otherwise double up (esp. across the DST
  // boundary). `dedupe=false` (manual ?force=1) skips this so testing isn't
  // blocked. Preview never sends, so it never counts as "today's nudge".
  const today = dayKeyInNY(now);
  if (dedupe && mode !== 'preview' && state.reviewMeta?.lastSentDay === today) {
    await saveBotState(state);
    result.skipped = 'already-sent-today';
    result.clients = groupByClient(qualifying).map((g) => g.client);
    return result;
  }

  const seed = daySeed(now);
  const groups = groupByClient(qualifying);
  let text;
  let source;
  try {
    text = await composeClientReviewNudge({ items: groups, seed });
    source = 'claude';
  } catch (e) {
    text = fallbackNudge(qualifying, seed);
    source = `fallback (${String(e?.message || e).slice(0, 60)})`;
  }

  result.clients = groups.map((g) => g.client);

  const r = ids();
  if (mode === 'preview') {
    result.messages.push({ toLabel: 'Juan', source, text });
    await saveBotState(state);
    return result;
  }

  const recipients = mode === 'dry' ? [r.chris] : [r.juan];
  const toLabel = mode === 'dry' ? 'Chris (dry-run)' : 'Juan';
  const body = mode === 'dry' ? `[DRY RUN → would send to Juan]\n\n${text}` : text;

  const entry = { toLabel, source };
  try {
    const sent = await sendDM(recipients, body);
    // Baseline this thread past our own DM so the conversational poller treats it
    // as seen and never tries to interpret BUMBOT's own message.
    if (sent?.channelId) {
      state.channels[sent.channelId] = { lastSeenId: sent.messageId || state.channels[sent.channelId]?.lastSeenId || '0' };
    }
    state.reviewMeta = { ...state.reviewMeta, lastSentDay: today }; // mark today handled
    entry.sent = true;
  } catch (e) {
    entry.sent = false;
    entry.error = String(e?.message || e);
  }
  result.messages.push(entry);

  await saveBotState(state);
  return result;
}
