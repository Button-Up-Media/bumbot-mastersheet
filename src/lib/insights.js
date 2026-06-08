// Derived board intelligence — pure functions over the normalized video list.
// Shared by the client UI (Board.js) and the dry verifier so both agree.
//
//   - carry-over : in-flight reels whose due week has already passed roll into
//                  the current week (they still need doing).
//   - deficit    : an ended week where a client posted fewer than its quota.
//   - editor     : Posted reels per editor for a month (workload leaderboard).
//   - runway     : the furthest week each client still has reels scheduled, so
//                  the PM knows when to book the next shoot.
import { requiredFor } from './quota.js';
import { monthKeyForWeek, weeksBetween } from './week.js';

// Still needs work: occupies a slot (counted) but isn't Posted. Canceled/Paused
// are counted:false; Posted is delivered:true — both excluded.
export function isInFlight(v) {
  return !!v.counted && !v.delivered;
}

// A week is "ended" once the (real) current week has moved past it.
export function weekEnded(weekKey, currentWeek) {
  return !!weekKey && weekKey < currentWeek;
}

// Overdue in-flight reels (due before the current week), grouped by client name.
// These are carried into the current week's view. Sorted oldest-due first.
export function carryoverByClient(videos, currentWeek) {
  const map = new Map();
  for (const v of videos) {
    if (!v.weekKey || v.weekKey >= currentWeek || !isInFlight(v)) continue;
    if (!map.has(v.client)) map.set(v.client, []);
    map.get(v.client).push(v);
  }
  for (const list of map.values()) list.sort((a, b) => (a.weekKey || '').localeCompare(b.weekKey || ''));
  return map;
}

// Clients that fell short of quota in a single (ended) week.
export function deficitsForWeek(videos, clients, weekKey) {
  const out = [];
  for (const c of clients) {
    const required = requiredFor(c.quota, weekKey);
    if (required <= 0) continue;
    const delivered = videos.filter((v) => v.client === c.name && v.weekKey === weekKey && v.delivered).length;
    if (delivered < required) out.push({ client: c.name, delivered, required, short: required - delivered });
  }
  return out;
}

// Posted reels per editor within a calendar month, ranked. Editor identity is
// taken from the first reel seen for that editor (same person → same identity).
export function editorTotalsForMonth(videos, monthKey) {
  const map = new Map();
  for (const v of videos) {
    if (!v.delivered || !v.weekKey || monthKeyForWeek(v.weekKey) !== monthKey) continue;
    const key = v.editorId || v.editorName || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        id: v.editorId || null,
        name: v.editorName || 'Unassigned',
        avatar: v.editorAvatar || null,
        color: v.editorColor || null,
        initials: v.editorInitials || '—',
        count: 0,
      });
    }
    map.get(key).count += 1;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// For each client: the furthest week that still holds a real reel (any status
// except Canceled/Paused) and how many weeks of runway that leaves from the
// current week. Sorted most-urgent first (soonest to run out at the top).
export function clientRunway(videos, clients, currentWeek) {
  const last = new Map();
  for (const v of videos) {
    if (!v.counted || !v.weekKey) continue;
    const cur = last.get(v.client);
    if (!cur || v.weekKey > cur) last.set(v.client, v.weekKey);
  }
  return clients
    .map((c) => {
      const lastWeek = last.get(c.name) || null;
      return {
        client: c.name,
        listId: c.listId,
        lastWeek,
        weeksLeft: lastWeek ? weeksBetween(currentWeek, lastWeek) : null,
      };
    })
    .sort((a, b) => {
      if (a.lastWeek === b.lastWeek) return a.client.localeCompare(b.client);
      if (a.lastWeek === null) return -1; // no content at all → most urgent
      if (b.lastWeek === null) return 1;
      return a.lastWeek.localeCompare(b.lastWeek);
    });
}
