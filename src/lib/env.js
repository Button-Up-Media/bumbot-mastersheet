// The only secret this app needs at runtime is the ClickUp token (read-only).
// Next.js auto-loads .env in dev and injects Vercel env vars in production, so
// no dotenv import is needed here. The CLI verify script loads dotenv itself.
export function clickupToken() {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    throw new Error(
      'Missing CLICKUP_API_TOKEN. Set it in .env locally (see .env.example) or as a Vercel env var.',
    );
  }
  return token;
}
