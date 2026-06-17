// The conversational half of BUMBOT (Phase 2). A poller (GitHub Actions, ~every
// 5 min) calls runChatBot(). For each NEW message from a trusted commander
// (Juan/Chris) in a watched chat thread, it asks Claude Haiku to interpret the
// message into a structured action, updates BUMBOT's memory (which clients to
// stop nudging — KV only), and replies in the chat. Idle polling is just ClickUp
// reads (free); Claude is called only per new commander message, so credits track
// real usage. Only Juan/Chris can command — everyone else's messages are data.
import { getBoard } from './cache.js';
import config from './loadConfig.js';
import { interpretMessage } from './claude.js';
import { loadBotState, saveBotState } from './botState.js';
import { getChannelMessages, postToChannel, directMessageChannelId } from './clickupChat.js';

function commanderIds() {
  return [process.env.SHOOT_JUAN_ID, process.env.SHOOT_CHRIS_ID].filter(Boolean).map(String);
}

// Resolve Claude's free-text client guess to a real client name.
function matchClient(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  let partial = null;
  for (const c of config.clients) {
    const lead = c.name.toLowerCase();
    if (lead === n) return c.name;
    if (!partial && (lead.includes(n) || n.includes(lead))) partial = c.name;
  }
  return partial;
}

function buildContext(status, state) {
  return {
    needsShoot: (status?.units || [])
      .filter((u) => u.state === 'needs-shoot')
      .map((u) => ({ lead: u.lead, weeksLeft: u.weeksLeft })),
    ignored: Object.entries(state.ignored || {}).map(([lead, info]) => ({ lead, note: info?.note || '' })),
    clients: config.clients.map((c) => c.name),
  };
}

function applyAction(state, out, msg) {
  const matched = matchClient(out.client);
  if ((out.action === 'ignore' || out.action === 'booked') && matched) {
    state.ignored[matched] = {
      note: out.action === 'booked' ? 'shoot booked' : String(msg.content || '').slice(0, 120),
      by: msg.userId,
      at: msg.date,
    };
  } else if (out.action === 'unignore' && matched) {
    delete state.ignored[matched];
  }
  return matched;
}

export async function runChatBot({ probe } = {}) {
  const board = await getBoard({ force: false });
  const status = board?.shoots;
  const state = await loadBotState();
  const context = buildContext(status, state);

  // Probe mode: interpret one supplied message with NO side effects (for testing
  // the Claude wiring in prod without needing a real chat message).
  if (probe != null) {
    const interpreted = await interpretMessage({ text: probe, context });
    return { probe: true, interpreted, matchedClient: matchClient(interpreted.client) };
  }

  const commanders = new Set(commanderIds());
  // Discover the threads BUMBOT talks to commanders in: resolve the canonical
  // groups/DMs (idempotent — returns the existing channel) and merge with any the
  // messenger recorded. This way a reply in the Juan+Chris(+Nayith) thread is seen
  // even when that thread wasn't explicitly recorded on send.
  const cmd = { juan: process.env.SHOOT_JUAN_ID, chris: process.env.SHOOT_CHRIS_ID, nayith: process.env.SHOOT_NAYITH_ID };
  const channelSet = new Set(Object.keys(state.channels || {}));
  const combos = [[cmd.juan, cmd.chris, cmd.nayith], [cmd.juan, cmd.chris], [cmd.juan], [cmd.chris]].map((a) => a.filter(Boolean));
  for (const combo of combos) {
    if (!combo.length) continue;
    try {
      const cid = await directMessageChannelId(combo);
      if (cid) channelSet.add(cid);
    } catch {
      /* ignore resolve errors — keep polling whatever we know */
    }
  }
  const channelIds = [...channelSet];
  const handled = [];

  for (const channelId of channelIds) {
    let msgs;
    try {
      msgs = await getChannelMessages(channelId);
    } catch (e) {
      handled.push({ channelId, error: String(e?.message || e) });
      continue;
    }
    if (!msgs.length) continue;
    const ch = state.channels[channelId] || {};
    const lastSeen = Number(ch.lastSeenId || 0);
    const maxIdAll = Math.max(...msgs.map((m) => Number(m.id)));

    // First time watching a thread with no baseline: baseline to the latest and
    // don't reply to history (the message that created the thread was ours).
    if (!ch.lastSeenId) {
      state.channels[channelId] = { lastSeenId: String(maxIdAll) };
      continue;
    }

    // New messages only, oldest → newest.
    const fresh = msgs.filter((m) => Number(m.id) > lastSeen).reverse();
    let maxId = lastSeen;
    for (const m of fresh) {
      maxId = Math.max(maxId, Number(m.id));
      if (!commanders.has(m.userId)) continue; // only Juan/Chris command; others = data
      let out;
      try {
        out = await interpretMessage({ text: m.content, context });
      } catch (e) {
        handled.push({ channelId, msg: m.id, error: String(e?.message || e) });
        continue;
      }
      const matched = applyAction(state, out, m);
      let replied = false;
      if (out.reply && out.reply.trim()) {
        try {
          const res = await postToChannel(channelId, out.reply);
          replied = true;
          // Skip our own reply on the next poll.
          if (res?.data?.id) maxId = Math.max(maxId, Number(res.data.id));
        } catch (e) {
          handled.push({ channelId, msg: m.id, error: 'reply failed: ' + String(e?.message || e) });
        }
      }
      handled.push({ channelId, msg: m.id, from: m.userId, action: out.action, client: matched || out.client || null, replied });
    }
    state.channels[channelId] = { lastSeenId: String(maxId) };
  }

  await saveBotState(state);
  return { ok: true, watched: channelIds.length, handled };
}
