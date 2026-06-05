// Verifies the passcode and, on success, sets the httpOnly auth cookie holding
// the salted token. Runs on Node so it shares the exact env + crypto path used
// elsewhere. This is the ONLY auth write; there is no logout route in Phase 1.
import { NextResponse } from 'next/server';
import { AUTH_COOKIE, COOKIE_MAX_AGE, checkPasscode, expectedToken } from '@/lib/auth.js';

export const runtime = 'nodejs';

export async function POST(req) {
  let passcode = '';
  try {
    const body = await req.json();
    passcode = body?.passcode ?? '';
  } catch {
    passcode = '';
  }

  if (!checkPasscode(passcode)) {
    return NextResponse.json({ ok: false, error: 'Incorrect passcode.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await expectedToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
