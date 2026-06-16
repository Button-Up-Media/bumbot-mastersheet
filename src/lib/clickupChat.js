// BUMBOT's ClickUp Chat sender — the ONE place this app writes to ClickUp, and
// ONLY chat messages (never task data). Used solely by the shoot-reminder
// watchdog; the board/data pipeline stays strictly GET-only. Authenticated as the
// BUMBOT seat via CLICKUP_API_TOKEN, so messages arrive from "BUM BOT".
import { clickupToken } from './env.js';

const V2 = 'https://api.clickup.com/api/v2';
const V3 = 'https://api.clickup.com/api/v3';

let cachedWorkspaceId;
async function workspaceId() {
  if (cachedWorkspaceId) return cachedWorkspaceId;
  const res = await fetch(`${V2}/team`, { headers: { Authorization: clickupToken() }, cache: 'no-store' });
  const data = await res.json();
  cachedWorkspaceId = data?.teams?.[0]?.id;
  if (!cachedWorkspaceId) throw new Error('could not resolve ClickUp workspace id');
  return cachedWorkspaceId;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: clickupToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const e = new Error(`ClickUp POST ${url} → ${res.status}: ${json?.err || json?.error || text}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

// Create (or fetch the existing) direct-message channel between BUMBOT and the
// given user ids (BUMBOT is added automatically as the authed user). The field
// is `user_ids` and the ids MUST be strings — ClickUp silently makes a BUMBOT
// self-DM if they're missing/wrong (which is what `member_ids` + numbers did).
async function directMessageChannelId(userIds) {
  const w = await workspaceId();
  const res = await post(`${V3}/workspaces/${w}/chat/channels/direct_message`, { user_ids: userIds });
  return res?.data?.id || res?.id || null;
}

// Post a markdown message (as BUMBOT) to an existing channel. Returns the raw
// ClickUp response so callers can read back the new message id.
export async function postToChannel(channelId, text) {
  const w = await workspaceId();
  return post(`${V3}/workspaces/${w}/chat/channels/${channelId}/messages`, {
    type: 'message',
    content_format: 'text/md',
    content: text,
  });
}

// Send a DM / group-DM (as BUMBOT) to the given ClickUp user ids. Returns the
// channel id + the posted message id so the conversational poller can watch the
// thread and baseline "last seen" past its own message.
export async function sendDM(userIds, text) {
  const ids = (userIds || []).filter(Boolean).map(String);
  if (!ids.length) throw new Error('no recipient ids');
  const channelId = await directMessageChannelId(ids);
  if (!channelId) throw new Error('no DM channel id returned');
  const res = await postToChannel(channelId, text);
  return { channelId, messageId: res?.data?.id ? String(res.data.id) : null };
}

// Recent messages in a channel (ClickUp returns newest-first). Tidied to the
// fields the poller needs: id (monotonic), userId (the sender), content, date.
export async function getChannelMessages(channelId) {
  const w = await workspaceId();
  const res = await fetch(`${V3}/workspaces/${w}/chat/channels/${channelId}/messages`, {
    headers: { Authorization: clickupToken() },
    cache: 'no-store',
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) throw new Error(`ClickUp GET messages ${res.status}: ${json?.err || text}`);
  return (json.data || []).map((m) => ({
    id: String(m.id),
    userId: String(m.user_id),
    content: m.content || '',
    date: Number(m.date) || 0,
  }));
}
