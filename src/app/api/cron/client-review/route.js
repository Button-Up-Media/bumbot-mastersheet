// Weekday client-review reminder cron. An external scheduler (GitHub Actions —
// see .github/workflows/bumbot-client-review.yml) hits this several times each
// weekday morning/midday with the CRON_SECRET. GitHub's scheduled runs fire LATE
// and unpredictably (often 1–2h), so instead of an exact-hour gate we accept any
// run inside a window (11 AM–5 PM ET) and let the once-per-day guard send just
// once — the first qualifying run that lands. It DMs Juan only when a reel has
// sat in Client Review past 24h. Gated by CRON_SECRET and exempt from the
// passcode middleware (under /api/cron). LIVE by default (DMs Juan for real);
// set REVIEW_LIVE=0 to force dry-run (DMs Chris, prefixed) for review.
import { runClientReviewWatchdog } from '@/lib/reviewWatchdog.js';
import { weekdayInNY, hourInNY } from '@/lib/week.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEND_FROM_HOUR_NY = 11; // earliest send: 11 AM ET
const SEND_UNTIL_HOUR_NY = 17; // latest a delayed run may still send: 5 PM ET

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const now = Date.now();
  const weekday = weekdayInNY(now); // Mon=1 … Sun=7
  const hour = hourInNY(now);

  // Auth-gated wiring check (no secrets leaked) for debugging the deploy.
  if (url.searchParams.get('diag') === '1') {
    return Response.json({
      nowNY: { weekday, hour },
      sendsAt: { window: [SEND_FROM_HOUR_NY, SEND_UNTIL_HOUR_NY], weekdays: '1-5', note: 'first qualifying run in window, once/day' },
      kvConfigured: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
      recipients: { juan: !!process.env.SHOOT_JUAN_ID, chris: !!process.env.SHOOT_CHRIS_ID },
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      live: process.env.REVIEW_LIVE !== '0',
    });
  }

  const q = url.searchParams.get('mode');
  // Live by default; REVIEW_LIVE=0 forces dry-run for testing.
  const mode = q === 'preview' || q === 'dry' || q === 'live' ? q : process.env.REVIEW_LIVE === '0' ? 'dry' : 'live';
  // Window gate (not an exact hour) — GitHub fires scheduled jobs late, so accept
  // any weekday run between 11 AM and 5 PM ET; the watchdog's once-per-day guard
  // makes it send only once. `?force=1` bypasses the gate for manual testing.
  const force = url.searchParams.get('force') === '1';
  const inWindow = weekday >= 1 && weekday <= 5 && hour >= SEND_FROM_HOUR_NY && hour <= SEND_UNTIL_HOUR_NY;
  if (!force && !inWindow) {
    return Response.json({ ok: true, skipped: 'off-window', nowNY: { weekday, hour } });
  }

  try {
    // Manual ?force=1 also bypasses the once-per-day guard so testing isn't blocked.
    const result = await runClientReviewWatchdog({ mode, now, dedupe: !force });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
