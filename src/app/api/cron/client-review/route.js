// Weekday client-review reminder cron. Vercel Cron hits this once each weekday at
// ~11 AM ET (see vercel.json: 15:00 UTC). Vercel auto-injects the CRON_SECRET it
// shares with this project, so auth always matches — no external secret to sync
// (GitHub Actions, by contrast, had no CRON_SECRET set, so its runs all 401'd —
// and fired badly delayed besides). A generous window + once-per-day guard keep
// it robust to Vercel's scheduling margin and DST. It DMs Juan only when a reel
// has sat in Client Review past 24h. Gated by CRON_SECRET and exempt from the
// passcode middleware (under /api/cron). LIVE by default (DMs Juan for real);
// set REVIEW_LIVE=0 to force dry-run (DMs Chris, prefixed) for review.
import { runClientReviewWatchdog } from '@/lib/reviewWatchdog.js';
import { weekdayInNY, hourInNY } from '@/lib/week.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Window floor absorbs DST (15:00 UTC = 11 AM EDT / 10 AM EST) + Vercel's margin.
const SEND_FROM_HOUR_NY = 10;
const SEND_UNTIL_HOUR_NY = 18;

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
  // Window gate + once-per-day guard — robust to Vercel's scheduling margin and
  // DST. `?force=1` bypasses both for manual testing.
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
