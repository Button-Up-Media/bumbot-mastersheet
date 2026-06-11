// Shared key/value store: Vercel KV in production, an in-memory Map when KV isn't
// configured (local dev). One interface, two backends — KV's set() returns 'OK'
// (or null for a failed NX); the in-memory shim mirrors that, including NX + px
// TTL. Used by the board cache and the editor-capture log.
//
// IMPORTANT: writing here is NOT a ClickUp write. The board's "every ClickUp call
// is a GET" guarantee is about api.clickup.com only and is unaffected by KV I/O.
const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

let storePromise;

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

export function getStore() {
  if (!storePromise) storePromise = makeStore();
  return storePromise;
}
