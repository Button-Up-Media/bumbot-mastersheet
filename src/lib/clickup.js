// READ-ONLY ClickUp client. This module exposes GET requests ONLY — there is
// deliberately no POST / PUT / DELETE here. The Status Board never writes to
// ClickUp; that is a hard rule for this whole app.
import { clickupToken } from './env.js';

const BASE = 'https://api.clickup.com/api/v2';

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { Authorization: clickupToken() },
    cache: 'no-store',
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`ClickUp GET ${path} → ${res.status}: ${json?.err || text}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Every task in a list (each task = a video). include_closed=true so POSTED /
// done videos are returned and counted. Top-level tasks only (subtasks excluded
// so a video isn't double-counted). Paginates 100/page.
export async function getListTasks(listId) {
  const out = [];
  for (let page = 0; ; page++) {
    const data = await getJSON(
      `/list/${listId}/task?archived=false&include_closed=true&subtasks=false&page=${page}`,
    );
    const tasks = data.tasks || [];
    out.push(...tasks);
    if (data.last_page || tasks.length < 100) break;
  }
  return out;
}
