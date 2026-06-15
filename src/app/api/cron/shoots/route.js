// Daily shoot-reminder cron. Vercel Cron hits this once a day (see vercel.json);
// Vercel attaches `Authorization: Bearer ${CRON_SECRET}` automatically. This is
// the one endpoint that can make BUMBOT send ClickUp DMs, so it is gated by
// CRON_SECRET and exempt from the passcode middleware. Defaults to dry-run (sends
// only to Chris) until SHOOT_LIVE=1 flips it live. Node runtime for KV + ClickUp.
import { runShootWatchdog } from '@/lib/messenger.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const q = new URL(req.url).searchParams.get('mode');
  const mode = q === 'preview' || q === 'dry' || q === 'live' ? q : process.env.SHOOT_LIVE === '1' ? 'live' : 'dry';
  try {
    const result = await runShootWatchdog({ mode });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
