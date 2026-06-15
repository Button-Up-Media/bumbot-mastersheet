// Edge passcode gate. Every request for an app page or data API must carry a
// valid auth cookie; otherwise pages redirect to /login and APIs get a 401.
// The login page, the login API, Next internals, and the brand assets are the
// only things left open (see matcher below).
import { NextResponse } from 'next/server';
import { AUTH_COOKIE, isValidToken } from './lib/auth.js';

export async function middleware(req) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (await isValidToken(token)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/((?!login|api/login|api/cron|_next/static|_next/image|favicon.ico|icon.svg|bumbot-mark.svg|bumbot-icon.svg).*)',
  ],
};
