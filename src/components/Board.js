'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import config from '@/lib/loadConfig.js';
import { requiredFor } from '@/lib/quota.js';
import {
  currentWeekKey,
  weekRangeLabel,
  monthWeekIndex,
  dueDayLabel,
  monthKeyForWeek,
  monthLabel,
  addMonths,
  weeksInMonth,
} from '@/lib/week.js';
import { STATUS_LEGEND } from '@/lib/status.js';
import BumbotMark from '@/components/BumbotMark.js';

const POLL_MS = 60 * 1000;
const MIN_WEEK = config.minWeek;
const MIN_MONTH = monthKeyForWeek(MIN_WEEK);
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

function Chevron() {
  return (
    <svg className="card__chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5 L6 7.5 L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Ext() {
  return (
    <svg className="ext" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5 H9.5 V7.5 M9.5 2.5 L4 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Avatar({ v, size = 22 }) {
  const [bad, setBad] = useState(false);
  const dim = { width: size, height: size };
  if (v.editorAvatar && !bad) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="avatar"
        src={v.editorAvatar}
        alt=""
        style={dim}
        loading="lazy"
        onError={() => setBad(true)}
      />
    );
  }
  return (
    <span className="avatar avatar--i" style={{ ...dim, background: v.editorColor }} aria-hidden="true">
      {v.editorInitials}
    </span>
  );
}

function VideoCard({ v }) {
  const [open, setOpen] = useState(false);
  const due = v.dueMs ? dueDayLabel(v.dueMs) : null;
  const hint = `${v.name} — ${v.statusLabel} — ${v.editorName}${due ? ` — due ${due}` : ''}`;
  const first = (v.editorName || '').split(/\s+/)[0];
  return (
    <div className={`card${v.dim ? ' card--dim' : ''}${open ? ' card--open' : ''}`}>
      <button type="button" className="card__row" title={hint} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="card__bar" style={{ background: v.color }} aria-hidden="true" />
        <Avatar v={v} size={22} />
        <span className="card__who">{first}</span>
        <span className="card__title">{v.name}</span>
        <Chevron />
      </button>
      {open && (
        <div className="card__detail">
          <div className="kv">
            <span className="kv__k">Status</span>
            <span className="kv__v">
              <i className="dot" style={{ background: v.color }} />
              {v.statusLabel}
            </span>
          </div>
          <div className="kv">
            <span className="kv__k">Editor</span>
            <span className="kv__v">
              <Avatar v={v} size={18} />
              {v.editorName}
            </span>
          </div>
          {due && (
            <div className="kv">
              <span className="kv__k">Due</span>
              <span className="kv__v">{due}</span>
            </div>
          )}
          <div className="card__links">
            {v.replay && (
              <a className="clink" href={v.replay} target="_blank" rel="noreferrer noopener">
                Dropbox replay <Ext />
              </a>
            )}
            {v.url && (
              <a className="clink clink--cu" href={v.url} target="_blank" rel="noreferrer noopener">
                Open in ClickUp <Ext />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClientWeekBlock({ client, videos, required }) {
  const delivered = videos.filter((v) => v.delivered).length;
  const met = required > 0 && delivered >= required;
  const sorted = [...videos].sort(sortVideos);
  return (
    <div className="cw">
      <div className="cw__head">
        <span className="cw__name">{client.name}</span>
        <span className={`tally${met ? ' tally--met' : ''}`}>
          <b>{delivered}</b> / {required}
        </span>
      </div>
      {sorted.length ? (
        <div className="cw__cards">
          {sorted.map((v) => (
            <VideoCard key={v.taskId} v={v} />
          ))}
        </div>
      ) : (
        <div className="cw__empty">No videos yet</div>
      )}
    </div>
  );
}

function WeekPanel({ weekKey, byClient, isNow }) {
  return (
    <section className={`week${isNow ? ' week--now' : ''}`}>
      <div className="week__head">
        <span className="week__range">{weekRangeLabel(weekKey)}</span>
        <span className="week__idx">
          Week {monthWeekIndex(weekKey)}
          {isNow ? ' · this week' : ''}
        </span>
      </div>
      <div className="week__clients">
        {config.clients.map((client) => {
          const vids = byClient?.get(client.name) ?? [];
          const required = requiredFor(client.quota, weekKey);
          if (vids.length === 0 && required === 0) return null;
          return <ClientWeekBlock key={client.listId} client={client} videos={vids} required={required} />;
        })}
      </div>
    </section>
  );
}

export default function Board() {
  const [board, setBoard] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState(() => {
    const cur = monthKeyForWeek(currentWeekKey());
    return cur < MIN_MONTH ? MIN_MONTH : cur;
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

  const videosByWeekClient = useMemo(() => {
    const m = new Map(); // weekKey -> Map(clientName -> [video])
    for (const v of videos) {
      if (!v.weekKey) continue;
      if (!m.has(v.weekKey)) m.set(v.weekKey, new Map());
      const cm = m.get(v.weekKey);
      if (!cm.has(v.client)) cm.set(v.client, []);
      cm.get(v.client).push(v);
    }
    return m;
  }, [videos]);

  const unscheduledByClient = useMemo(() => {
    const map = new Map();
    for (const v of videos) {
      if (v.weekKey) continue;
      if (!map.has(v.client)) map.set(v.client, []);
      map.get(v.client).push(v);
    }
    return map;
  }, [videos]);

  const weeks = useMemo(() => weeksInMonth(month).filter((w) => w >= MIN_WEEK), [month]);
  const currentWk = currentWeekKey();
  const canPrev = month > MIN_MONTH;
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
        <button className="btn btn--icon" onClick={() => canPrev && setMonth(addMonths(month, -1))} disabled={!canPrev} aria-label="Previous month">‹</button>
        <div className="pager__label">
          {monthLabel(month)}
          <span className="pager__sub">{weeks.length} week{weeks.length === 1 ? '' : 's'} · scroll for all</span>
        </div>
        <button className="btn btn--icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</button>
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
          <div className="weeks">
            {weeks.map((w) => (
              <WeekPanel key={w} weekKey={w} byClient={videosByWeekClient.get(w)} isNow={w === currentWk} />
            ))}
          </div>

          {unscheduledClients.length > 0 && (
            <>
              <div className="section-label">Unscheduled · no due date</div>
              <section className="week week--unsched">
                <div className="week__clients">
                  {unscheduledClients.map((client) => {
                    const vids = [...unscheduledByClient.get(client.name)].sort(sortVideos);
                    return (
                      <div className="cw" key={`u-${client.listId}`}>
                        <div className="cw__head">
                          <span className="cw__name">{client.name}</span>
                          <span className="tally">{vids.length} unscheduled</span>
                        </div>
                        <div className="cw__cards">
                          {vids.map((v) => (
                            <VideoCard key={v.taskId} v={v} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
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
        <div className="legend__title">Cards</div>
        <div className="legend__hint">
          Avatar + name come from ClickUp. Click a card to see details and open the ClickUp task or Dropbox replay.
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
