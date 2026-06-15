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
  const url = new URL(req.url);
  // Safe config check (auth-gated, no secret leaked) to debug env wiring.
  if (url.searchParams.get('diag') === '1') {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
    let t = raw.trim();
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) t = t.slice(1, -1);
    let parses = false;
    let clientEmail = null;
    let parseErr = null;
    try {
      clientEmail = JSON.parse(t).client_email;
      parses = true;
    } catch (e) {
      parseErr = String(e?.message || e).slice(0, 90);
    }
    return Response.json({
      google: { present: !!raw, length: raw.length, startsWith: raw.slice(0, 14), parses, clientEmail, parseErr },
      recipients: { juan: !!process.env.SHOOT_JUAN_ID, chris: !!process.env.SHOOT_CHRIS_ID, nayith: !!process.env.SHOOT_NAYITH_ID },
      live: process.env.SHOOT_LIVE === '1',
    });
  }
  const q = url.searchParams.get('mode');
  const mode = q === 'preview' || q === 'dry' || q === 'live' ? q : process.env.SHOOT_LIVE === '1' ? 'live' : 'dry';
  try {
    const result = await runShootWatchdog({ mode });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
