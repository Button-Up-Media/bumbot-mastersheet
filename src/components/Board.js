'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import config from '@/lib/loadConfig.js';
import { requiredFor } from '@/lib/quota.js';
import { currentWeekKey, addWeeks, weekRangeLabel, monthWeekIndex, dueDayLabel } from '@/lib/week.js';
import { STATUS_LEGEND } from '@/lib/status.js';
import { EDITOR_LEGEND } from '@/lib/editors.js';
import BumbotMark from '@/components/BumbotMark.js';

const POLL_MS = 60 * 1000;
const MIN_WEEK = config.minWeek;
const STATUS_ORDER = Object.fromEntries(STATUS_LEGEND.map((s, i) => [s.key, i]));

function relativeTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function sortVideos(a, b) {
  const oa = STATUS_ORDER[a.statusKey] ?? 99;
  const ob = STATUS_ORDER[b.statusKey] ?? 99;
  if (oa !== ob) return oa - ob;
  return (a.name || '').localeCompare(b.name || '');
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 6.3 L5 8.6 L9.5 3.6"
        stroke="rgba(255,255,255,0.95)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Square({ v }) {
  const due = v.dueMs ? ` · ${dueDayLabel(v.dueMs)}` : '';
  const title = `${v.name} · ${v.statusLabel} · ${v.editorLabel}${due}`;
  return (
    <div
      className={`sq${v.dim ? ' sq--dim' : ''}`}
      style={{ background: v.editorColor }}
      title={title}
    >
      <span className="sq__status" style={{ background: v.color }}>
        {v.check ? <CheckGlyph /> : null}
      </span>
    </div>
  );
}

function ClientRow({ client, videos, weekKey }) {
  const required = requiredFor(client.quota, weekKey);
  const delivered = videos.filter((v) => v.delivered).length;
  const met = required > 0 && delivered >= required;
  const sorted = [...videos].sort(sortVideos);
  return (
    <div className="row">
      <div className="row__head">
        <span className="row__name">{client.name}</span>
        <span className={`tally${met ? ' tally--met' : ''}`}>
          <b>{delivered}</b> / {required} delivered
        </span>
      </div>
      <div className="squares">
        {sorted.length ? (
          sorted.map((v) => <Square key={v.taskId} v={v} />)
        ) : (
          <span className="empty">No videos this week</span>
        )}
      </div>
    </div>
  );
}

export default function Board() {
  const [board, setBoard] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [refreshing, setRefreshing] = useState(false);
  const [week, setWeek] = useState(() => {
    const cur = currentWeekKey();
    return cur < MIN_WEEK ? MIN_WEEK : cur;
  });
  const [, forceTick] = useState(0);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (force) setRefreshing(true);
    try {
      const res = await fetch(`/api/board${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!res.ok) throw new Error(`board ${res.status}`);
      const data = await res.json();
      setBoard(data);
      setStatus('ready');
    } catch {
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const poll = setInterval(() => load(false), POLL_MS);
    const tick = setInterval(() => forceTick((n) => n + 1), 30 * 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const videos = board?.videos ?? [];

  const byClientForWeek = useMemo(() => {
    const map = new Map();
    for (const v of videos) {
      if (v.weekKey !== week) continue;
      if (!map.has(v.client)) map.set(v.client, []);
      map.get(v.client).push(v);
    }
    return map;
  }, [videos, week]);

  const unscheduledByClient = useMemo(() => {
    const map = new Map();
    for (const v of videos) {
      if (v.weekKey) continue;
      if (!map.has(v.client)) map.set(v.client, []);
      map.get(v.client).push(v);
    }
    return map;
  }, [videos]);

  const canPrev = week > MIN_WEEK;
  const monthWeek = monthWeekIndex(week);
  const unscheduledClients = config.clients.filter((c) => unscheduledByClient.has(c.name));
  const errors = board?.errors ?? [];

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <BumbotMark size={34} className="brand__mark" />
          <div className="brand__text">
            <span className="wordmark">BUM BOT</span>
            <span className="tagline">Status Board · read-only</span>
          </div>
        </div>
        <div className="actions">
          <div className="updated" title={board?.lastUpdated ? new Date(board.lastUpdated).toLocaleString() : ''}>
            {status === 'loading' ? 'Loading…' : <>updated <b>{relativeTime(board?.lastUpdated)}</b></>}
          </div>
          <button
            className="btn btn--icon"
            onClick={() => load(true)}
            disabled={refreshing || status === 'loading'}
            aria-label="Refresh board"
            title="Recompute the shared board now"
          >
            <RefreshIcon spinning={refreshing} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <div className="pager">
        <button className="btn btn--icon" onClick={() => canPrev && setWeek(addWeeks(week, -1))} disabled={!canPrev} aria-label="Previous week">‹</button>
        <div className="pager__label">
          {weekRangeLabel(week)}
          <span className="pager__sub">Week {monthWeek} · {week}</span>
        </div>
        <button className="btn btn--icon" onClick={() => setWeek(addWeeks(week, 1))} aria-label="Next week">›</button>
      </div>

      {errors.length > 0 && (
        <div className="banner">
          {errors.length} list{errors.length > 1 ? 's' : ''} failed to load: {errors.map((e) => e.client).join(', ')}
        </div>
      )}

      {status === 'error' && !board ? (
        <div className="banner">Couldn’t load the board. It will retry automatically.</div>
      ) : (
        <>
          <div className="board">
            {config.clients.map((client) => (
              <ClientRow
                key={client.listId}
                client={client}
                weekKey={week}
                videos={byClientForWeek.get(client.name) ?? []}
              />
            ))}
          </div>

          {unscheduledClients.length > 0 && (
            <>
              <div className="section-label">Unscheduled · no due date</div>
              <div className="board">
                {unscheduledClients.map((client) => (
                  <div className="row" key={`u-${client.listId}`}>
                    <div className="row__head">
                      <span className="row__name">{client.name}</span>
                      <span className="tally">{unscheduledByClient.get(client.name).length} unscheduled</span>
                    </div>
                    <div className="squares">
                      {[...unscheduledByClient.get(client.name)].sort(sortVideos).map((v) => (
                        <Square key={v.taskId} v={v} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <Legends />
        </>
      )}
    </main>
  );
}

function Legends() {
  return (
    <div className="legends">
      <div className="legend">
        <div className="legend__title">Status</div>
        <div className="legend__items">
          {STATUS_LEGEND.map((s) => (
            <span className="legend__item" key={s.key}>
              <span className="swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="legend">
        <div className="legend__title">Editor (cell tint)</div>
        <div className="legend__items">
          {EDITOR_LEGEND.map((e) => (
            <span className="legend__item" key={e.key}>
              <span className="swatch swatch--ring" style={{ background: e.color }} />
              {e.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      className={spinning ? 'spin' : undefined}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13.6 8a5.6 5.6 0 1 1-1.6-3.9M13.8 2.4V5.2H11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
