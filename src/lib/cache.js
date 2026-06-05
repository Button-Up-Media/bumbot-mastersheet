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

const REFRESH_MS = 60 * 60 * 1000; // recompute snapshots older than 1h
const LOCK_MS = 30 * 1000; // max time a single recompute may hold the lock
const KEY = 'board:v1';
const LOCK = 'board:v1:lock';

const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

let storePromise;

// One storage interface with two backends. KV's set() returns 'OK' (or null for
// a failed NX); the in-memory shim mirrors that contract including NX + px TTL.
function makeStore() {
  if (hasKV) {
    return import('@vercel/kv').then(({ kv }) => ({
      get: (k) => kv.get(k),
      set: (k, v, opts) => kv.set(k, v, opts),
    }));
  }
  const mem = new Map();
  const live = (e) => e && (!e.exp || e.exp >= Date.now());
  return Promise.resolve({
    get: async (k) => {
      const e = mem.get(k);
      if (!live(e)) {
        mem.delete(k);
        return null;
      }
      return e.val;
    },
    set: async (k, v, opts) => {
      if (opts?.nx && live(mem.get(k))) return null;
      mem.set(k, { val: v, exp: opts?.px ? Date.now() + opts.px : null });
      return 'OK';
    },
  });
}

function getStore() {
  if (!storePromise) storePromise = makeStore();
  return storePromise;
}

async function recompute() {
  const board = await computeBoard();
  const store = await getStore();
  await store.set(KEY, board);
  return board;
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
