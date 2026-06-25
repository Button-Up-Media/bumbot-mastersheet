// Per-week quota adjustments — the data behind "scrap this video, don't make it
// up." A scrap drops a client's requirement for one week by 1, so the board needs
// one fewer there and the make-up engine rolls nothing forward.
//
// Adjustments come from two places, merged into each client's quota.adjustments
// before requiredFor / makeupPlan run:
//   • config.json   — static, committed (clients[].quota.adjustments)
//   • KV (botState) — dynamic, set by BUMBOT from chat ("scrap …"), keyed by taskId
//
// Pure module (no I/O) so it's safe in the client bundle (Board.js) and on the
// server (cache, messenger, chatBot).

// Flatten the KV adjustments map to a plain list (for shipping in the board
// snapshot and feeding withAdjustments).
export function adjustmentsList(map = {}) {
  return Object.values(map || {}).filter((a) => a && a.client && a.week);
}

// Return a new clients array with each client's quota.adjustments = its config
// adjustments plus any dynamic ones for that client. Never mutates the input. A
// dynamic entry whose taskId is already recorded in config is skipped, so the
// same scrap can't be double-counted.
export function withAdjustments(clients, list = []) {
  if (!Array.isArray(list) || !list.length) return clients;
  const byClient = new Map();
  for (const a of list) {
    if (!a || !a.client || !a.week) continue;
    if (!byClient.has(a.client)) byClient.set(a.client, []);
    byClient.get(a.client).push(a);
  }
  return clients.map((c) => {
    const extra = byClient.get(c.name);
    if (!extra || !extra.length) return c;
    const baseAdj = c.quota && Array.isArray(c.quota.adjustments) ? c.quota.adjustments : [];
    const seen = new Set(baseAdj.map((a) => a.taskId).filter(Boolean));
    const merged = [...baseAdj];
    for (const a of extra) {
      if (a.taskId && seen.has(a.taskId)) continue; // already in config
      merged.push({ week: a.week, delta: Number(a.delta) || 0, note: a.note, taskId: a.taskId });
      if (a.taskId) seen.add(a.taskId);
    }
    return { ...c, quota: { ...c.quota, adjustments: merged } };
  });
}

const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[“”„‟"'‘’]/g, '')
    .trim();

// Find the one reel a free-text query names, optionally scoped to a client.
// Returns { reel } on a unique hit, or { error, matches? } so the caller can ask
// a clarifying question instead of guessing.
export function resolveReel(videos, clientName, query) {
  const q = normName(query);
  if (!q) return { error: 'no-query' };
  const pool = (videos || []).filter((v) => v && (!clientName || v.client === clientName));
  let matches = pool.filter((v) => normName(v.name).includes(q));
  if (!matches.length) {
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    if (words.length) matches = pool.filter((v) => words.every((w) => normName(v.name).includes(w)));
  }
  const uniq = [...new Map(matches.map((v) => [v.taskId, v])).values()];
  if (!uniq.length) return { error: 'not-found' };
  if (uniq.length > 1) return { error: 'ambiguous', matches: uniq };
  return { reel: uniq[0] };
}

// Where a given task is already scrapped, if anywhere: 'kv' | 'config' | null.
export function scrapSource(configClients, kvMap, taskId) {
  if (!taskId) return null;
  if (kvMap && kvMap[taskId]) return 'kv';
  for (const c of configClients || []) {
    const adj = c.quota && c.quota.adjustments;
    if (Array.isArray(adj) && adj.some((a) => a && a.taskId === taskId)) return 'config';
  }
  return null;
}
