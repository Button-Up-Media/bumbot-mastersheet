// Serves the shared board snapshot. `?refresh=1` forces a recompute (the manual
// refresh button); otherwise the cache's lazy hourly TTL decides. Node runtime
// so it can reach @vercel/kv and the ClickUp client. Never cached at the edge —
// freshness is owned by the KV layer, not HTTP caching.
import { NextResponse } from 'next/server';
import { getBoard } from '@/lib/cache.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  try {
    const board = await getBoard({ force });
    return NextResponse.json(board, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
