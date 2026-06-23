// Weekday client-review reminder cron. An external scheduler (GitHub Actions —
// see .github/workflows/bumbot-client-review.yml) hits this at a couple of UTC
// times each weekday with the CRON_SECRET; the route gates to exactly 11:00 in
// America/New_York so the reminder lands at 11 AM ET through both EDT and EST.
// It DMs Juan only when a reel has sat in Client Review past 24h. Gated by
// CRON_SECRET and exempt from the passcode middleware (under /api/cron).
// LIVE by default (DMs Juan for real); set REVIEW_LIVE=0 to force dry-run (DMs
// Chris, prefixed) when you want to review wording before it reaches Juan.
import { runClientReviewWatchdog } from '@/lib/reviewWatchdog.js';
import { weekdayInNY, hourInNY } from '@/lib/week.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEND_HOUR_NY = 11; // 11:00 AM America/New_York

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
      sendsAt: { hour: SEND_HOUR_NY, weekdays: '1-5' },
      kvConfigured: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
      recipients: { juan: !!process.env.SHOOT_JUAN_ID, chris: !!process.env.SHOOT_CHRIS_ID },
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      live: process.env.REVIEW_LIVE !== '0',
    });
  }

  const q = url.searchParams.get('mode');
  // Live by default; REVIEW_LIVE=0 forces dry-run for testing.
  const mode = q === 'preview' || q === 'dry' || q === 'live' ? q : process.env.REVIEW_LIVE === '0' ? 'dry' : 'live';
  // The scheduler fires on a couple of candidate UTC hours; do the real work only
  // at 11:00 ET on a weekday. `?force=1` bypasses the gate for manual testing.
  const force = url.searchParams.get('force') === '1';
  const onSchedule = weekday >= 1 && weekday <= 5 && hour === SEND_HOUR_NY;
  if (!force && !onSchedule) {
    return Response.json({ ok: true, skipped: 'off-schedule', nowNY: { weekday, hour } });
  }

  try {
    // Manual ?force=1 also bypasses the once-per-day guard so testing isn't blocked.
    const result = await runClientReviewWatchdog({ mode, now, dedupe: !force });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
