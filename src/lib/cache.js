// Shared board cache. The board is expensive to compute (a paginated ClickUp
// read per client), so it's computed once and shared across all viewers via
// Vercel KV. Lazy TTL: a read of a snapshot older than REFRESH_MS triggers a
// recompute, and a short-lived lock keeps concurrent readers from stampeding
// ClickUp. When KV isn't configured (local dev), an in-memory Map stands in.
//
// This replaces a Vercel Cron job on purpose: hourly freshness happens on read,
// so there's no scheduled writer to provision and nothing that looks like the
// Phase-3 weekly-reset cron.
import { computeBoard } from './board.js';
import { computeShootStatus } from './shoots.js';
import { getStore } from './store.js';

const REFRESH_MS = 60 * 1000; // recompute snapshots older than 60s (near-real-time; lazy, so 0 calls when nobody's viewing)
const LOCK_MS = 30 * 1000; // max time a single recompute may hold the lock
const KEY = 'board:v1';
const LOCK = 'board:v1:lock';

async function recompute() {
  const board = await computeBoard();
  // Layer in shoot status (content runway + booked shoots from the calendar).
  // Read-only and best-effort: a calendar failure never breaks the board.
  let shoots = null;
  try {
    shoots = await computeShootStatus(board.videos);
  } catch (e) {
    shoots = { calendarOk: false, error: String(e?.message || e), units: [] };
  }
  const full = { ...board, shoots };
  const store = await getStore();
  await store.set(KEY, full);
  return full;
}

async function acquireLock() {
  const store = await getStore();
  const res = await store.set(LOCK, '1', { nx: true, px: LOCK_MS });
  return res === 'OK' || res === true;
}

// Returns the shared snapshot. `force` (manual refresh) always recomputes.
// Otherwise a stale snapshot is recomputed by whichever reader wins the lock;
// the rest are served the existing snapshot until the recompute lands.
export async function getBoard({ force = false } = {}) {
  if (force) return recompute();

  const store = await getStore();
  const cached = await store.get(KEY);
  const stale = !cached || Date.now() - (cached.lastUpdated || 0) > REFRESH_MS;

  if (stale && ((await acquireLock()) || !cached)) {
    return recompute();
  }
  return cached;
}
