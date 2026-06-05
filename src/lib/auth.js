// Passcode gate helpers. The raw passcode never travels in the cookie; we store
// a salted SHA-256 token derived from it. The same derivation runs in the Edge
// middleware and in the Node login route — Web Crypto (`crypto.subtle`) is a
// global in both, so this module has no runtime-specific imports.
export const AUTH_COOKIE = 'bumbot_auth';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SALT = 'bumbot-mastersheet-v1';

function passcode() {
  const p = process.env.APP_PASSCODE;
  if (!p) {
    throw new Error('Missing APP_PASSCODE. Set it as a Vercel env var (and in .env locally).');
  }
  return p;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function tokenFor(pass) {
  return sha256Hex(`${SALT}:${pass}`);
}

export function expectedToken() {
  return tokenFor(passcode());
}

export async function isValidToken(token) {
  if (!token) return false;
  const expected = await expectedToken();
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function checkPasscode(input) {
  return input != null && String(input) === passcode();
}
