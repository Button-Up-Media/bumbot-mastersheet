'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import config from '@/lib/loadConfig.js';
import { requiredFor } from '@/lib/quota.js';
import {
  currentWeekKey,
  weekRangeLabel,
  dueDayLabel,
  monthKeyForWeek,
  monthLabel,
  addMonths,
  weeksInMonth,
} from '@/lib/week.js';
import { editorTotalsForMonth, clientRunway } from '@/lib/insights.js';
import { makeupPlan } from '@/lib/makeup.js';
import { STATUS_LEGEND } from '@/lib/status.js';
import BumbotMark from '@/components/BumbotMark.js';

const POLL_MS = 30 * 1000;
const MIN_WEEK = config.minWeek;
const MIN_MONTH = monthKeyForWeek(MIN_WEEK);
const STATUS_ORDER = Object.fromEntries(STATUS_LEGEND.map((s, i) => [s.key, i]));

// Per-visitor preference (remembered in localStorage) for where "Open in ClickUp"
// goes: the desktop app (clickup:// deep link) or the browser (https). The app
// opens whatever account it's signed into — usually the person's own, not the
// shared one the browser happens to be logged into.
const CuPrefContext = createContext({ target: 'app', setTarget: () => {} });

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

// "Open in ClickUp" — desktop app (clickup:// deep link) or browser, per the
// remembered preference. The deep link works for regular ClickUp task IDs.
function ClickUpLink({ url }) {
  const { target } = useContext(CuPrefContext);
  const app = target === 'app';
  const href = app ? url.replace('https://app.clickup.com', 'clickup://') : url;
  const linkProps = app ? {} : { target: '_blank', rel: 'noreferrer noopener' };
  return (
    <a className="clink clink--cu" href={href} {...linkProps}>
      Open in ClickUp{app ? ' app' : ''} <Ext />
    </a>
  );
}

function AvatarBase({ src, color, initials, size = 22 }) {
  const [bad, setBad] = useState(false);
  const dim = { width: size, height: size };
  if (src && !bad) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="avatar" src={src} alt="" style={dim} loading="lazy" onError={() => setBad(true)} />
    );
  }
  return (
    <span className="avatar avatar--i" style={{ ...dim, background: color }} aria-hidden="true">
      {initials}
    </span>
  );
}

function Avatar({ v, size = 22 }) {
  return <AvatarBase src={v.editorAvatar} color={v.editorColor} initials={v.editorInitials} size={size} />;
}

function VideoCard({ v }) {
  const [open, setOpen] = useState(false);
  const isPosted = !!(v.delivered && v.postedMs);
  const dateMs = isPosted ? v.postedMs : v.dueMs;
  const dateLabel = dateMs ? dueDayLabel(dateMs) : null;
  const dateKind = isPosted ? 'Posted' : 'Due';
  const hint = `${v.name} — ${v.statusLabel} — ${v.editorName}${dateLabel ? ` — ${isPosted ? 'posted' : 'due'} ${dateLabel}` : ''}`;
  const first = (v.editorName || '').split(/\s+/)[0];
  const tone =
    v.statusKey === 'posted'
      ? ' card--posted'
      : v.statusKey === 'review'
        ? ' card--review'
        : v.statusKey === 'canceled'
          ? ' card--canceled'
          : '';
  const dimClass = v.dim && v.statusKey !== 'canceled' ? ' card--dim' : '';
  return (
    <div className={`card${dimClass}${open ? ' card--open' : ''}${tone}`}>
      <button type="button" className="card__row" title={hint} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="card__bar" style={{ background: v.color }} aria-hidden="true" />
        <Avatar v={v} size={20} />
        <span className="card__who">{first}</span>
        <span className="card__title">{v.name}</span>
        <Chevron />
      </button>
      {open && (
        <div className="card__detail">
          <div className="card__fullname">{v.name}</div>
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
          {dateLabel && (
            <div className="kv">
              <span className="kv__k">{dateKind}</span>
              <span className="kv__v">{dateLabel}</span>
            </div>
          )}
          <div className="card__links">
            {v.replay && (
              <a className="clink" href={v.replay} target="_blank" rel="noreferrer noopener">
                Dropbox replay <Ext />
              </a>
            )}
            {v.url && <ClickUpLink url={v.url} />}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusSquare({ v }) {
  const isPosted = !!(v.delivered && v.postedMs);
  const dateMs = isPosted ? v.postedMs : v.dueMs;
  const dateLabel = dateMs ? dueDayLabel(dateMs) : null;
  const title = `${v.name} — ${v.statusLabel} — ${v.editorName}${dateLabel ? ` — ${isPosted ? 'posted' : 'due'} ${dateLabel}` : ''}`;
  const cls = `sq${v.dim && v.statusKey !== 'canceled' ? ' sq--dim' : ''}`;
  return <span className={cls} style={{ background: v.color }} title={title} aria-label={title} />;
}

// Small "CR" circle for Client Review clients — those who approve every video
// before it goes live (vs. clients who let us post straight from internal
// approval). Flagged per-client in config.json.
function CRBadge({ client }) {
  if (!client?.clientReview) return null;
  return (
    <span
      className="crtag"
      title="Client Review client — every video is sent to the client for approval before it goes live"
      aria-label="Client Review client"
    >
      CR
    </span>
  );
}

function ClientTile({ client, videos, cell, density }) {
  const delivered = videos.filter((v) => v.delivered).length;
  const required = cell.displayRequired;
  const didNotPost = cell.state === 'didnotpost';
  const priority = !!cell.priority && !didNotPost;
  const placeholders = cell.placeholders || 0;
  const isCurrent = cell.state === 'current';
  const met = !didNotPost && required > 0 && delivered >= required;
  const own = useMemo(() => [...videos].sort(sortVideos), [videos]);
  const idle = required === 0 && own.length === 0 && placeholders === 0 && !didNotPost;
  const tallyTone = didNotPost ? 'tally--miss' : met ? 'tally--met' : '';
  const clean = density === 'clean';
  // "Almost done" row tag — only on live (current/future) weeks where every slot
  // is filled and every video is wrapped (nothing left in editing). Review =>
  // "waiting on client"; otherwise "pretty much done". Cosmetic only.
  const counted = own.filter((v) => v.counted);
  const wrapped = (v) => v.statusKey === 'posted' || v.statusKey === 'ready' || v.statusKey === 'review';
  const allWrapped =
    !didNotPost &&
    !met &&
    placeholders === 0 &&
    counted.length > 0 &&
    counted.length >= required &&
    counted.every(wrapped) &&
    counted.some((v) => v.statusKey !== 'posted');
  const tag = allWrapped ? (counted.some((v) => v.statusKey === 'review') ? 'wait' : 'ready') : null;
  return (
    <div
      className={`tile${clean ? ' tile--clean' : ''}${idle ? ' tile--idle' : ''}${met ? ' tile--met' : ''}${didNotPost ? ' tile--miss' : ''}${priority ? ' tile--priority' : ''}`}
    >
      {didNotPost && <span className="misstag">⚠ DID NOT POST</span>}
      {priority && <span className="prioritytag">★ PRIORITY</span>}
      {tag && (
        <span className={`rtag rtag--${tag}`}>{tag === 'wait' ? 'waiting on client' : 'pretty much done!'}</span>
      )}
      <div className="tile__head">
        <span className="tile__name" title={client.name}>
          {client.name}
          <CRBadge client={client} />
        </span>
        <span className="tile__meta">
          <span className={`tally ${tallyTone}`}>
            <b>{delivered}</b>
            <i>/</i>
            {required}
          </span>
        </span>
      </div>
      {idle ? (
        <div className="tile__idle">—</div>
      ) : clean ? (
        <div className="tile__squares">
          {own.map((v) => (
            <StatusSquare key={v.taskId} v={v} />
          ))}
          {Array.from({ length: placeholders }).map((_, i) => (
            <PlaceholderSquare key={`ph${i}`} urgent={isCurrent} />
          ))}
        </div>
      ) : (
        <div className="tile__cards">
          {own.map((v) => (
            <VideoCard key={v.taskId} v={v} />
          ))}
          {Array.from({ length: placeholders }).map((_, i) => (
            <PlaceholderCard key={`ph${i}`} urgent={isCurrent} />
          ))}
        </div>
      )}
    </div>
  );
}

// An empty slot for a video that should exist this week but hasn't been created /
// assigned yet. Grey for a future week; urgent (yellow + ⚠️) for the current week.
function PlaceholderCard({ urgent }) {
  return (
    <div className={`card card--ph${urgent ? ' card--ph-urgent' : ''}`} title="A video for this slot hasn't been sent out yet">
      <span className="card__row card__row--ph">
        <span className="ph__mark" aria-hidden="true">
          {urgent ? '⚠️' : '＋'}
        </span>
        <span className="ph__text">needs to be sent out</span>
      </span>
    </div>
  );
}

function PlaceholderSquare({ urgent }) {
  return (
    <span
      className={`sq sq--ph${urgent ? ' sq--ph-urgent' : ''}`}
      title={`${urgent ? '⚠️ ' : ''}needs to be sent out`}
      aria-label="needs to be sent out"
    />
  );
}

// Per-editor workload for a week's reels. "assigned" = the editor on it now
// (resolved); "to do" = not yet Ready/Posted/Client Review; "not started" = no
// replay link; "extra" = reels whose current editor isn't who they were first
// assigned to. Canceled/Paused are excluded.
function editorWeekStats(reels) {
  const DONE = new Set(['ready', 'posted', 'review']);
  const map = new Map();
  for (const v of reels) {
    if (!v.counted) continue;
    const key = v.editorId || 'unassigned';
    let e = map.get(key);
    if (!e) {
      e = {
        id: v.editorId || null,
        name: v.editorName || 'Unassigned',
        avatar: v.editorAvatar || null,
        color: v.editorColor || null,
        initials: v.editorInitials || '—',
        assigned: 0,
        toDo: 0,
        notStarted: 0,
        extra: 0,
      };
      map.set(key, e);
    }
    e.assigned += 1;
    if (!DONE.has(v.statusKey)) {
      e.toDo += 1;
      if (!v.replay) e.notStarted += 1;
    }
    if (v.editorOriginalId && v.editorId && String(v.editorOriginalId) !== String(v.editorId)) e.extra += 1;
  }
  return [...map.values()].sort(
    (a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || b.assigned - a.assigned || a.name.localeCompare(b.name),
  );
}

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const firstName = (n) => String(n || '').split(' ')[0];

// Colour for the "not started" count. Red + pulse is reserved for an end-of-week
// emergency (Thu–Fri with un-started reels); Wednesday is an amber warning; earlier
// in the week — or past weeks, or zero — it stays calm/grey.
function nsTone(notStarted, isNow, weekday) {
  if (!isNow || notStarted === 0) return '';
  if (weekday >= 4) return 'is-alert';
  if (weekday === 3) return 'is-warn';
  return '';
}

// Plain-English notes from the week's editor stats: who's behind (and it's late
// in the week), who's carrying the load, who took on extra. Day-aware notes only
// fire for the current week, against the "wrapped by Thursday" goal.
function editorInsights(stats, { isNow, weekday }) {
  const eds = stats.filter((e) => e.id).map((e) => ({ ...e, done: e.assigned - e.toDo }));
  if (!eds.length) return [];
  const notes = [];
  const totalToDo = eds.reduce((s, e) => s + e.toDo, 0);
  const totalNotStarted = eds.reduce((s, e) => s + e.notStarted, 0);
  const totalDone = eds.reduce((s, e) => s + e.done, 0);

  if (isNow && weekday >= 3) {
    const behind = eds.filter((e) => e.notStarted > 0).sort((a, b) => b.notStarted - a.notStarted)[0];
    if (behind) {
      notes.push({
        tone: weekday >= 4 ? 'alert' : 'warn',
        text: `It's ${DAY_NAMES[weekday]} and ${firstName(behind.name)} hasn't started ${behind.notStarted} reel${behind.notStarted > 1 ? 's' : ''} — worth prioritizing (or a hand) to wrap by Thursday.`,
      });
    }
  }
  if (eds.length > 1) {
    const byDone = [...eds].sort((a, b) => b.done - a.done);
    const top = byDone[0];
    const othersAvg = (totalDone - top.done) / (eds.length - 1);
    if (top.done >= 3 && top.done > byDone[1].done && top.done >= othersAvg * 1.5) {
      notes.push({
        tone: 'good',
        text: `${firstName(top.name)} is carrying the load — ${top.done} wrapped vs ${Math.round(othersAvg)} on average for the others.`,
      });
    }
  }
  const helper = eds.filter((e) => e.extra > 0).sort((a, b) => b.extra - a.extra)[0];
  if (helper) {
    notes.push({
      tone: 'good',
      text: `${firstName(helper.name)} took on ${helper.extra} extra reel${helper.extra > 1 ? 's' : ''} originally assigned to someone else.`,
    });
  }
  if (isNow) {
    if (totalToDo === 0) notes.push({ tone: 'good', text: "Everything's wrapped this week 🎉" });
    else if (weekday >= 4)
      notes.push({ tone: 'warn', text: `Goal is wrapped by Thursday — ${totalToDo} still in progress, ${totalNotStarted} not started.` });
    else notes.push({ tone: 'info', text: `${totalToDo} in progress, ${totalNotStarted} not started — aim to wrap by Thursday.` });
  }
  return notes.slice(0, 4);
}

function EditorBreakdown({ weekKey, reels, isNow, onClose }) {
  const stats = useMemo(() => editorWeekStats(reels), [reels]);
  const weekday = ((new Date().getDay() + 6) % 7) + 1; // Mon=1 … Sun=7
  const insights = useMemo(() => editorInsights(stats, { isNow, weekday }), [stats, isNow, weekday]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="emodal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="emodal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="emodal__head">
          <div>
            <h3 className="emodal__title">Editor breakdown</h3>
            <span className="emodal__sub">{weekRangeLabel(weekKey)}</span>
          </div>
          <button className="emodal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {stats.length === 0 ? (
          <div className="emodal__empty">No reels this week.</div>
        ) : (
          <ul className="estat">
            {stats.map((e) => (
              <li className="estat__row" key={e.id || 'unassigned'}>
                <div className="estat__who">
                  <AvatarBase src={e.avatar} color={e.color} initials={e.initials} size={30} />
                  <span className="estat__name">{e.name}</span>
                  {isNow && e.assigned > 0 && e.toDo === 0 && (
                    <span className="estat__done" title="All wrapped this week">
                      ✓
                    </span>
                  )}
                </div>
                <span className="estat__nums">
                  <span className="estat__n estat__n--assigned">
                    <b>{e.assigned}</b>
                    <i>assigned</i>
                  </span>
                  <span className="estat__n estat__n--todo">
                    <b>{e.toDo}</b>
                    <i>working on it</i>
                  </span>
                  <span className={`estat__n estat__n--ns ${nsTone(e.notStarted, isNow, weekday)}`}>
                    <b>{e.notStarted}</b>
                    <i>not started</i>
                  </span>
                  <span className={`estat__n estat__n--extra${e.extra > 0 ? ' is-on' : ''}`}>
                    <b>{e.extra}</b>
                    <i>extra</i>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {insights.length > 0 && (
          <div className="einsights">
            {insights.map((n, i) => (
              <p key={i} className={`einsight einsight--${n.tone}`}>
                {n.text}
              </p>
            ))}
          </div>
        )}
        <p className="emodal__note">
          <b>assigned</b> = the editor on it now · <b>working on it</b> = not yet Ready/Posted/Client Review ·{' '}
          <b>not started</b> = no replay link · <b>extra</b> = reassigned from another editor (counts only
          handoffs we can see).
        </p>
      </div>
    </div>
  );
}

function WeekPanel({ weekKey, byClient, isNow, ended, density, makeup }) {
  const [showEditors, setShowEditors] = useState(false);
  let totalDelivered = 0;
  let totalRequired = 0;
  const rows = config.clients.map((client) => {
    const vids = byClient?.get(client.name) ?? [];
    // The make-up plan owns each week's required count and how it reads (met /
    // short / did-not-post / placeholders). Outside the computed window, fall back
    // to the plain quota.
    const cell = makeup?.get(client.name)?.get(weekKey) || {
      displayRequired: requiredFor(client.quota, weekKey),
      state: ended ? 'met' : isNow ? 'current' : 'future',
      placeholders: 0,
      priority: false,
    };
    totalDelivered += vids.filter((v) => v.delivered).length;
    totalRequired += cell.displayRequired;
    return { client, vids, cell };
  });
  const weekMet = totalRequired > 0 && totalDelivered >= totalRequired;
  const weekReels = rows.flatMap((r) => r.vids);
  return (
    <section className={`week${isNow ? ' week--now' : ''}`}>
      <div className="week__head">
        <span className="week__range">{weekRangeLabel(weekKey)}</span>
        <div className="week__headR">
          <button
            className="week__editors"
            onClick={() => setShowEditors(true)}
            title="Editor workload breakdown for this week"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="20" x2="6" y2="13" />
              <line x1="12" y1="20" x2="12" y2="6" />
              <line x1="18" y1="20" x2="18" y2="16" />
            </svg>
            Editor weekly status
          </button>
          <span
            className={`week__total${weekMet ? ' week__total--met' : ''}`}
            title="All clients · Posted / required this week"
          >
            <b>{totalDelivered}</b> / {totalRequired}
            <span className="week__total-l">posted</span>
          </span>
          {isNow && <span className="week__now">THIS WEEK</span>}
        </div>
      </div>
      <div className="week__clients">
        {rows.map(({ client, vids, cell }) => (
          <ClientTile key={client.listId} client={client} videos={vids} cell={cell} density={density} />
        ))}
      </div>
      {showEditors && (
        <EditorBreakdown weekKey={weekKey} reels={weekReels} isNow={isNow} onClose={() => setShowEditors(false)} />
      )}
    </section>
  );
}

// Compact shoot-status chip shown on each content-runway row.
function ShootStatus({ s }) {
  if (!s) return null;
  if (s.state === 'booked' && s.nextShoot) {
    const late = s.nextShoot.verdict === 'late';
    return (
      <span className={`shoot shoot--${late ? 'warn' : 'ok'}`} title={s.nextShoot.title || ''}>
        {late ? '⚠ shoot' : '✓ shoot'} {dueDayLabel(s.nextShoot.startMs)}
      </span>
    );
  }
  if (s.state === 'just-shot') {
    return (
      <span className="shoot shoot--ok">
        ✓ shot {dueDayLabel(s.lastShootMs)}
        {s.nextExpectedMs ? ` · next ~${dueDayLabel(s.nextExpectedMs)}` : ''}
      </span>
    );
  }
  if (s.state === 'needs-shoot') {
    const tier = s.tier || 'gentle';
    const where = s.recommendedWeek ? weekRangeLabel(s.recommendedWeek).split('–')[0].trim() : null;
    const label =
      tier === 'urgent'
        ? '⚠ book a shoot ASAP'
        : tier === 'soon'
          ? `⚠ book a shoot${where ? ` by ${where}` : ''}`
          : `book a shoot${where ? ` by ${where}` : ''}`;
    return <span className={`shoot shoot--need shoot--${tier}`}>{label}</span>;
  }
  return <span className="shoot shoot--ok">✓ covered</span>;
}

function OverviewView({ videos, month, currentWk, shoots, roster }) {
  const editors = useMemo(() => editorTotalsForMonth(videos, month), [videos, month]);
  const runway = useMemo(() => clientRunway(videos, config.clients, currentWk), [videos, currentWk]);
  const unitByLead = useMemo(() => new Map((shoots?.units || []).map((u) => [u.lead, u])), [shoots]);
  const leadMap = useMemo(() => new Map(config.clients.map((c) => [c.name, c.shoot?.coveredBy || c.name])), []);
  // Only trust shoot chips when the calendar actually connected — otherwise we'd
  // wrongly show "book a shoot" for clients whose shoots we just can't see.
  const shootStatusFor = (name) => (shoots?.calendarOk ? unitByLead.get(leadMap.get(name) || name) : null);
  const maxCount = editors.reduce((m, e) => Math.max(m, e.count), 0) || 1;
  const totalPosted = editors.reduce((m, e) => m + e.count, 0);

  return (
    <div className="overview">
      <div className="ov__col">
        <section className="ov">
          <div className="ov__head">
            <h2 className="ov__title">Editor output</h2>
            <span className="ov__meta">
              {totalPosted} reels Posted · {monthLabel(month)}
            </span>
          </div>
          {editors.length === 0 ? (
            <div className="ov__empty">No reels Posted in {monthLabel(month)} yet.</div>
          ) : (
            <ul className="lb">
              {editors.map((e, i) => (
                <li className="lb__row" key={e.id || e.name}>
                  <span className="lb__rank">{i + 1}</span>
                  <AvatarBase src={e.avatar} color={e.color} initials={e.initials} size={28} />
                  <span className="lb__name">{e.name}</span>
                  <span className="lb__bar" aria-hidden="true">
                    <i style={{ width: `${(e.count / maxCount) * 100}%` }} />
                  </span>
                  <span className="lb__count">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ov">
          <div className="ov__head">
            <h2 className="ov__title">Editor assignments</h2>
            <span className="ov__meta">official editor · per client</span>
          </div>
          <ul className="roster">
            {(roster || []).map((r) => (
              <li className="roster__row" key={r.client}>
                <span className="roster__client" title={r.client}>{r.client}</span>
                {r.editor ? (
                  <span className="roster__ed" title={r.alt ? `${r.editor.name} · also ${r.alt}` : r.editor.name}>
                    <AvatarBase src={r.editor.avatar} color={r.editor.color} initials={r.editor.initials} size={26} />
                  </span>
                ) : (
                  <span className="roster__none">—</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="ov">
        <div className="ov__head">
          <h2 className="ov__title">Content runway</h2>
          <span className="ov__meta">from {weekRangeLabel(currentWk)}</span>
        </div>
        <p className="ov__sub">
          {shoots && shoots.calendarOk === false
            ? 'Shoot calendar not connected yet — showing content runway only.'
            : 'Content runway + the next shoot. ✓ a shoot is booked or just happened · ⚠ time to book one.'}
        </p>
        <ul className="rw">
          {runway.map((r) => {
            const s = shootStatusFor(r.client);
            const out = r.lastWeek === null || (r.weeksLeft != null && r.weeksLeft < 0);
            const tone = !s
              ? out
                ? 'out'
                : r.weeksLeft <= 1
                  ? 'urgent'
                  : r.weeksLeft <= 3
                    ? 'soon'
                    : 'ok'
              : s.state === 'needs-shoot'
                ? s.tier === 'urgent'
                  ? 'urgent'
                  : s.tier === 'soon'
                    ? 'soon'
                    : 'ok'
                : s.state === 'booked' && s.nextShoot?.verdict === 'late'
                  ? 'soon'
                  : 'ok';
            const through = r.lastWeek === null ? 'No reels scheduled' : `through ${weekRangeLabel(r.lastWeek)}`;
            const left = out ? 'out of content' : r.weeksLeft === 0 ? 'final week' : `${r.weeksLeft} wk${r.weeksLeft === 1 ? '' : 's'} of runway`;
            return (
              <li className={`rw__row rw__row--${tone}`} key={r.listId}>
                <span className="rw__dot" aria-hidden="true" />
                <span className="rw__name">{r.client}</span>
                <span className="rw__through">{through}</span>
                {s ? <ShootStatus s={s} /> : <span className="rw__left">{left}</span>}
              </li>
            );
          })}
        </ul>
      </section>

    </div>
  );
}

export default function Board() {
  const [board, setBoard] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState('calendar'); // calendar | overview
  const [density, setDensity] = useState('detailed'); // detailed | clean
  const [cuTarget, setCuTarget] = useState('app'); // app | web — where "Open in ClickUp" goes
  const [month, setMonth] = useState(() => {
    const cur = monthKeyForWeek(currentWeekKey());
    return cur < MIN_MONTH ? MIN_MONTH : cur;
  });
  const [, forceTick] = useState(0);
  const inFlight = useRef(false);
  const anchored = useRef(false);

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

  // On first load (e.g. right after login), drop the visitor at the current week.
  useEffect(() => {
    if (anchored.current || status !== 'ready' || view !== 'calendar') return;
    const el = document.querySelector('.week--now');
    if (!el) return;
    anchored.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [status, view]);

  // Remembered "Open in ClickUp" target (per browser).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cuTarget');
      if (saved === 'app' || saved === 'web') setCuTarget(saved);
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  const setCu = useCallback((t) => {
    setCuTarget(t);
    try {
      localStorage.setItem('cuTarget', t);
    } catch {
      /* ignore */
    }
  }, []);
  const cuPref = useMemo(() => ({ target: cuTarget, setTarget: setCu }), [cuTarget, setCu]);

  const videos = board?.videos ?? [];
  const currentWk = currentWeekKey();

  // Group reels by week → client for display, and compute the make-up plan: a
  // numeric rebalance where a missed week shows as met and its deficit moves +1
  // per following week (see makeup.js). This replaces the old reel roll-forward.
  const { videosByWeekClient, makeup } = useMemo(() => {
    const byWeek = new Map(); // weekKey -> Map(client -> [video])
    for (const v of videos) {
      if (!v.weekKey) continue;
      if (!byWeek.has(v.weekKey)) byWeek.set(v.weekKey, new Map());
      const cm = byWeek.get(v.weekKey);
      if (!cm.has(v.client)) cm.set(v.client, []);
      cm.get(v.client).push(v);
    }
    return { videosByWeekClient: byWeek, makeup: makeupPlan(videos, config.clients, currentWk) };
  }, [videos, currentWk]);

  const unscheduledByClient = useMemo(() => {
    const map = new Map();
    for (const v of videos) {
      if (v.weekKey || !v.counted) continue; // ready reels only — made, no due date yet (not canceled/paused)
      if (!map.has(v.client)) map.set(v.client, []);
      map.get(v.client).push(v);
    }
    return map;
  }, [videos]);

  const weeks = useMemo(() => weeksInMonth(month).filter((w) => w >= MIN_WEEK), [month]);
  const canPrev = month > MIN_MONTH;
  const unscheduledClients = config.clients.filter((c) => unscheduledByClient.has(c.name));
  const unscheduledTotal = unscheduledClients.reduce((n, c) => n + unscheduledByClient.get(c.name).length, 0);
  const errors = board?.errors ?? [];

  return (
    <CuPrefContext.Provider value={cuPref}>
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <BumbotMark size={34} className="brand__mark" />
          <div className="brand__text">
            <span className="wordmark">BUMBOT</span>
            <span className="tagline">Video Master Sheet</span>
          </div>
        </div>
        <div className="actions">
          <div className="viewtabs" role="tablist" aria-label="View">
            <button
              className={`viewtab${view === 'calendar' ? ' viewtab--on' : ''}`}
              role="tab"
              aria-selected={view === 'calendar'}
              onClick={() => setView('calendar')}
            >
              Calendar
            </button>
            <button
              className={`viewtab${view === 'overview' ? ' viewtab--on' : ''}`}
              role="tab"
              aria-selected={view === 'overview'}
              onClick={() => setView('overview')}
            >
              Overview
            </button>
          </div>
          {view === 'calendar' && (
            <div className="viewtabs viewtabs--sub" role="group" aria-label="Density">
              <button
                className={`viewtab${density === 'detailed' ? ' viewtab--on' : ''}`}
                aria-pressed={density === 'detailed'}
                onClick={() => setDensity('detailed')}
              >
                Detailed
              </button>
              <button
                className={`viewtab${density === 'clean' ? ' viewtab--on' : ''}`}
                aria-pressed={density === 'clean'}
                onClick={() => setDensity('clean')}
              >
                Clean
              </button>
            </div>
          )}
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

      {status === 'loading' ? (
        <Loader />
      ) : (
        <>
      <div className="pager">
        <button className="btn btn--nav" onClick={() => canPrev && setMonth(addMonths(month, -1))} disabled={!canPrev} aria-label="Previous month">
          ‹
        </button>
        <div className="pager__label">
          <span className="pager__month">{monthLabel(month)}</span>
          <span className="pager__sub">
            {view === 'calendar'
              ? `${weeks.length} week${weeks.length === 1 ? '' : 's'} · scroll for all`
              : 'editor totals for this month'}
          </span>
        </div>
        <button className="btn btn--nav" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          ›
        </button>
      </div>

      {errors.length > 0 && (
        <div className="banner">
          {errors.length} list{errors.length > 1 ? 's' : ''} failed to load: {errors.map((e) => e.client).join(', ')}
        </div>
      )}

      {status === 'error' && !board ? (
        <div className="banner">Couldn’t load the board. It will retry automatically.</div>
      ) : view === 'overview' ? (
        <OverviewView videos={videos} month={month} currentWk={currentWk} shoots={board?.shoots} roster={board?.editorRoster} />
      ) : (
        <>
          <Legends />
          <div className="weeks">
            {weeks.map((w) => (
              <WeekPanel
                key={w}
                weekKey={w}
                byClient={videosByWeekClient.get(w)}
                isNow={w === currentWk}
                ended={w < currentWk}
                density={density}
                makeup={makeup}
              />
            ))}
          </div>

          {unscheduledClients.length > 0 && (
            <>
              <div className="section-label">
                Ready · awaiting a due date <span className="section-count">{unscheduledTotal}</span>
              </div>
              <div className="section-sub">
                Made reels with no due date yet — Nayith sets one to slot each into a week. They already count toward
                the shoot runway.
              </div>
              <section className="week week--unsched">
                <div className="week__clients">
                  {unscheduledClients.map((client) => {
                    const vids = [...unscheduledByClient.get(client.name)].sort(sortVideos);
                    return (
                      <div className="tile" key={`u-${client.listId}`}>
                        <div className="tile__head">
                          <span className="tile__name">{client.name}<CRBadge client={client} /></span>
                          <span className="tally">{vids.length}</span>
                        </div>
                        <div className="tile__cards">
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
        </>
      )}
        </>
      )}
    </main>
    </CuPrefContext.Provider>
  );
}

function Legends() {
  const { target, setTarget } = useContext(CuPrefContext);
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
        <div className="legend__title">Markers</div>
        <div className="legend__items">
          <span className="legend__item">
            <span className="crtag crtag--legend">CR</span>
            Client Review — client approves every video before it goes live
          </span>
        </div>
      </div>
      <div className="legend">
        <div className="legend__title">Open ClickUp tasks in</div>
        <div className="viewtabs" role="group" aria-label="Open ClickUp tasks in">
          <button
            className={`viewtab${target === 'app' ? ' viewtab--on' : ''}`}
            aria-pressed={target === 'app'}
            onClick={() => setTarget('app')}
          >
            Desktop app
          </button>
          <button
            className={`viewtab${target === 'web' ? ' viewtab--on' : ''}`}
            aria-pressed={target === 'web'}
            onClick={() => setTarget('web')}
          >
            Browser
          </button>
        </div>
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg className={spinning ? 'spin' : undefined} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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

// Branded loading state: two crossed chef's knives that "chop" (scissor) while
// the board data loads — so visitors never see a flash of empty/0-filled data.
function Loader() {
  const spline = '0.45 0 0.55 1; 0.45 0 0.55 1';
  return (
    <div className="loader" role="status" aria-label="Loading">
      <svg className="loader__mark" viewBox="0 0 120 120" width="108" height="108" aria-hidden="true">
        {/* chef's toque */}
        <g>
          <ellipse cx="60" cy="24" rx="16" ry="12" fill="#eef1f5" />
          <circle cx="48" cy="26" r="8" fill="#eef1f5" />
          <circle cx="72" cy="26" r="8" fill="#eef1f5" />
          <rect x="46" y="32" width="28" height="9" rx="2.5" fill="#cfd5de" />
        </g>
        {/* crossed chef's knives, chopping below the toque */}
        <g>
          <rect x="55.8" y="75" width="8.4" height="31" rx="3.6" fill="#2f343d" />
          <rect x="54.4" y="71" width="11.2" height="4.8" rx="2" fill="#b3bac6" />
          <path d="M55.5 70 L64.5 70 L64 56 L60 46 Q55 57 55.5 70 Z" fill="#e2e7ee" />
          <animateTransform attributeName="transform" type="rotate" values="-38 60 76; -15 60 76; -38 60 76" dur="1.1s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={spline} />
        </g>
        <g>
          <rect x="55.8" y="75" width="8.4" height="31" rx="3.6" fill="#2f343d" />
          <rect x="54.4" y="71" width="11.2" height="4.8" rx="2" fill="#b3bac6" />
          <path d="M55.5 70 L64.5 70 L64 56 L60 46 Q55 57 55.5 70 Z" fill="#e2e7ee" />
          <animateTransform attributeName="transform" type="rotate" values="38 60 76; 15 60 76; 38 60 76" dur="1.1s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={spline} />
        </g>
      </svg>
      <div className="loader__text">Prepping the board…</div>
    </div>
  );
}
