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
// given member ids (BUMBOT is added automatically as the authed user).
async function directMessageChannelId(memberIds) {
  const w = await workspaceId();
  const res = await post(`${V3}/workspaces/${w}/chat/channels/direct_message`, { member_ids: memberIds });
  return res?.data?.id || res?.id || null;
}

// Send a DM / group-DM (as BUMBOT) to the given ClickUp member ids.
export async function sendDM(memberIds, text) {
  const ids = (memberIds || []).filter(Boolean).map(Number);
  if (!ids.length) throw new Error('no recipient ids');
  const w = await workspaceId();
  const channelId = await directMessageChannelId(ids);
  if (!channelId) throw new Error('no DM channel id returned');
  return post(`${V3}/workspaces/${w}/chat/channels/${channelId}/messages`, { type: 'message', content: text });
}
