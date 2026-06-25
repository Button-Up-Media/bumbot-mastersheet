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
import { resolveReel, withAdjustments, adjustmentsList, scrapSource } from './adjustments.js';
import { requiredFor } from './quota.js';
import { weekRangeLabel } from './week.js';

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

const wkLabel = (k) => (k ? weekRangeLabel(k).split(' – ')[0] : '');

// "Scrap this video, don't make it up" → record a -1 quota adjustment for the
// reel's week (keyed by taskId so it's idempotent + reversible). Returns the
// exact chat confirmation, including the clarifying question when the video can't
// be resolved. BUMBOT can't write ClickUp, so this only adjusts the master sheet.
function applyScrap(state, clientName, video, msg, videos) {
  const r = resolveReel(videos, clientName, video);
  if (r.error === 'no-query') return 'Which video should I scrap? Tell me the client and a bit of the title.';
  if (r.error === 'not-found')
    return `I couldn't find a${clientName ? ' ' + clientName : ''} video matching “${video}”. Can you give me a bit of the exact title?`;
  if (r.error === 'ambiguous') {
    const list = r.matches.slice(0, 5).map((m) => `“${m.name}”`).join(', ');
    return `A few videos match “${video}”: ${list}. Which one?`;
  }
  const reel = r.reel;
  if (!reel.weekKey)
    return `“${reel.name}” doesn't have a due date yet, so I can't tell which week to adjust. Set its due date and I'll scrap it.`;
  if (scrapSource(config.clients, state.adjustments, reel.taskId))
    return `“${reel.name}” is already scrapped — I'm not making it up. Nothing to change. 👍`;

  state.adjustments[reel.taskId] = {
    taskId: reel.taskId,
    client: reel.client,
    week: reel.weekKey,
    delta: -1,
    taskName: reel.name,
    by: msg.userId,
    at: msg.date,
  };
  const eff = withAdjustments(config.clients, adjustmentsList(state.adjustments)).find((c) => c.name === reel.client);
  const req = eff ? requiredFor(eff.quota, reel.weekKey) : null;
  return (
    `Done — scrapping **“${reel.name}”** for **${reel.client}**, and I won't make it up.` +
    (req != null ? ` The week of ${wkLabel(reel.weekKey)} now needs **${req}**.` : '') +
    ` (Heads up: I can't edit ClickUp — make sure the task is canceled there too.)`
  );
}

// Undo a scrap → the video counts toward its week again.
function applyUnscrap(state, clientName, video, msg, videos) {
  const reel = resolveReel(videos, clientName, video).reel || null;
  const taskId = reel?.taskId;
  if (taskId && state.adjustments[taskId]) {
    const e = state.adjustments[taskId];
    delete state.adjustments[taskId];
    return `Got it — **“${e.taskName || reel.name}”** is back on the books for **${e.client}**; it'll count toward its week again.`;
  }
  if (taskId && scrapSource(config.clients, state.adjustments, taskId) === 'config')
    return `“${reel.name}” was scrapped in the master sheet's config, so I can't undo it from chat — ask Chris to remove it.`;
  return `I don't have an active scrap matching “${video}”${clientName ? ' for ' + clientName : ''}, so there's nothing to undo.`;
}

// Apply one interpreted action to BUMBOT's memory. Returns { matched, reply },
// where `reply` (when set) is a precise app-composed confirmation that overrides
// Claude's draft — used for scrap/unscrap, whose outcome depends on resolution.
function applyAction(state, out, msg, videos) {
  const matched = matchClient(out.client);
  if ((out.action === 'ignore' || out.action === 'booked') && matched) {
    state.ignored[matched] = {
      note: out.action === 'booked' ? 'shoot booked' : String(msg.content || '').slice(0, 120),
      by: msg.userId,
      at: msg.date,
    };
  } else if (out.action === 'unignore' && matched) {
    delete state.ignored[matched];
  } else if (out.action === 'scrap') {
    return { matched, reply: applyScrap(state, matched, out.video, msg, videos) };
  } else if (out.action === 'unscrap') {
    return { matched, reply: applyUnscrap(state, matched, out.video, msg, videos) };
  }
  return { matched };
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
      const act = applyAction(state, out, m, board?.videos || []);
      const matched = act.matched;
      // scrap/unscrap return an app-composed confirmation that overrides Claude's
      // draft (its outcome depends on whether the video resolved); other actions
      // post Claude's reply as before.
      const replyText = act.reply != null && act.reply !== '' ? act.reply : out.reply;
      let replied = false;
      if (replyText && replyText.trim()) {
        try {
          const res = await postToChannel(channelId, replyText);
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
