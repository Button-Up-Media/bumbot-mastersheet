// Daily shoot-reminder cron. Vercel Cron hits this once a day (see vercel.json);
// Vercel attaches `Authorization: Bearer ${CRON_SECRET}` automatically. This is
// the one endpoint that can make BUMBOT send ClickUp DMs, so it is gated by
// CRON_SECRET and exempt from the passcode middleware. Defaults to dry-run (sends
// only to Chris) until SHOOT_LIVE=1 flips it live. Node runtime for KV + ClickUp.
import { runShootWatchdog } from '@/lib/messenger.js';
import { hourInNY, dayKeyInNY } from '@/lib/week.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reminders land late-morning some days and mid-afternoon others: from ~11 AM ET
// on "A" days, from ~2 PM ET on "B" days. GitHub fires scheduled jobs late and
// unpredictably, so each slot is a WINDOW (earliest → latest a delayed run may
// still send), and the once-per-day guard sends only once.
const SLOT_WINDOW = { A: [11, 16], B: [14, 19] };
// Which slot today uses — deterministic per NY calendar date, alternating, so the
// time varies day to day without being random.
function chosenSlot(now) {
  const dayIndex = Math.round(Date.parse(dayKeyInNY(now) + 'T12:00:00Z') / 86_400_000);
  return dayIndex % 2 === 0 ? 'A' : 'B';
}

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
      nowNY: { hour: hourInNY(Date.now()) },
      slotWindows: { A: 'from 11 AM ET', B: 'from 2 PM ET' },
      chosenSlotToday: chosenSlot(Date.now()),
    });
  }
  const q = url.searchParams.get('mode');
  const mode = q === 'preview' || q === 'dry' || q === 'live' ? q : process.env.SHOOT_LIVE === '1' ? 'live' : 'dry';
  // Optional ?weekday=1..7 (Mon..Sun) override, for testing the day-gated messages
  // (Monday's Nayith nudge + did-not-post alert) on any day.
  const wdParam = Number(url.searchParams.get('weekday'));
  const weekday = wdParam >= 1 && wdParam <= 7 ? wdParam : undefined;

  // Timing gate: GitHub fires scheduled jobs late, so accept any run inside this
  // day's chosen slot WINDOW; the watchdog's once-per-day guard sends only once.
  // `?force=1` bypasses the gate and that guard so manual runs work any time.
  const now = Date.now();
  const hour = hourInNY(now);
  const force = url.searchParams.get('force') === '1';
  const chosen = chosenSlot(now);
  const [from, until] = SLOT_WINDOW[chosen];
  const inWindow = hour >= from && hour <= until;
  if (!force && !inWindow) {
    return Response.json({ ok: true, skipped: 'off-window', nowNY: { hour }, chosenSlot: chosen, window: [from, until] });
  }

  try {
    const result = await runShootWatchdog({ mode, weekday, now, dedupe: !force });
    return Response.json({ ok: true, slot: chosen, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
