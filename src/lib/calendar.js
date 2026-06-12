// Reads booked shoot events from Google Calendar via the BUMBOT service account.
// The SA is invited only to shoot events, so anything it can see is a shoot; each
// is mapped to a client by matching the event title against that client's
// aliases. The Brewing Buddha shoot covers Rainy Days (one unit). Read-only — the
// service account is shared on nothing, it only sees events it's a guest on.
//
// Server-only: uses the SA private key from GOOGLE_SERVICE_ACCOUNT_JSON. Must
// never be imported by client code. Any failure (no key, Google down) is returned
// as { ok:false } so the board never breaks on it.
import { JWT } from 'google-auth-library';
import config from './loadConfig.js';
import { weekKeyForMs, weekdayInNY } from './week.js';

const UNITS = config.clients
  .filter((c) => c.shoot && !c.shoot.coveredBy)
  .map((c) => ({ lead: c.name, aliases: c.shoot.aliases && c.shoot.aliases.length ? c.shoot.aliases : [c.name] }));

function loadCreds() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  raw = raw.trim();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function matchUnit(title) {
  const t = (title || '').toLowerCase();
  for (const u of UNITS) for (const a of u.aliases) if (t.includes(a.toLowerCase())) return u.lead;
  return null;
}

function startMsOf(ev) {
  if (ev.start?.dateTime) return Date.parse(ev.start.dateTime);
  if (ev.start?.date) return Date.parse(ev.start.date + 'T12:00:00Z'); // all-day → noon UTC keeps the week calc DST-safe
  return null;
}

// Every shoot the SA can see (recent past + next ~6 months), grouped by client
// unit lead, soonest first. Shape: { ok, byUnit: { lead: [{title,startMs,weekKey,weekday}] }, unmatched, error }.
export async function getShoots() {
  const creds = loadCreds();
  if (!creds) return { ok: false, error: 'no service-account key configured', byUnit: {}, unmatched: [] };
  try {
    const client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
    const timeMin = new Date(Date.now() - 42 * 24 * 3600 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 183 * 24 * 3600 * 1000).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250&singleEvents=true&orderBy=startTime`;
    const res = await client.request({ url });
    const byUnit = {};
    const unmatched = [];
    for (const ev of res.data.items || []) {
      const startMs = startMsOf(ev);
      if (!startMs) continue;
      const lead = matchUnit(ev.summary);
      if (!lead) {
        unmatched.push(ev.summary || '(no title)');
        continue;
      }
      (byUnit[lead] = byUnit[lead] || []).push({ title: ev.summary || '', startMs, weekKey: weekKeyForMs(startMs), weekday: weekdayInNY(startMs) });
    }
    for (const list of Object.values(byUnit)) list.sort((a, b) => a.startMs - b.startMs);
    return { ok: true, byUnit, unmatched };
  } catch (e) {
    return { ok: false, error: String(e?.response?.data?.error?.message || e?.message || e), byUnit: {}, unmatched: [] };
  }
}
