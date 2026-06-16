// Conversational poller. An external scheduler (GitHub Actions, ~every 5 min)
// hits this with the CRON_SECRET; it reads new replies from the team in BUMBOT's
// chat threads and lets BUMBOT respond + adjust. Gated by CRON_SECRET and exempt
// from the passcode middleware (under /api/cron). `?probe=<text>` interprets one
// message with no side effects, for testing the Claude wiring in prod.
import { runChatBot } from '@/lib/chatBot.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const probe = new URL(req.url).searchParams.get('probe');
  try {
    const result = await runChatBot(probe != null ? { probe } : {});
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
