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
  addWeeks,
  addMonths,
  weeksInMonth,
} from '@/lib/week.js';
import { editorTotalsForMonth, clientRunway } from '@/lib/insights.js';
import { STATUS_LEGEND } from '@/lib/status.js';
import BumbotMark from '@/components/BumbotMark.js';

const POLL_MS = 30 * 1000;
const MIN_WEEK = config.minWeek;
const MIN_MONTH = monthKeyForWeek(MIN_WEEK);
const CARRY_OVER_WEEKS = config.carryOverWeeks || 4;
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

function ClientTile({ client, videos, required, ended, carried, density }) {
  const delivered = videos.filter((v) => v.delivered).length;
  const met = required > 0 && delivered >= required;
  const short = ended && required > 0 ? Math.max(0, required - delivered) : 0;
  const carriedList = carried || [];
  const own = useMemo(() => [...videos].sort(sortVideos), [videos]);
  const idle = required === 0 && own.length === 0 && carriedList.length === 0;
  const tallyTone = met ? 'tally--met' : short > 0 ? 'tally--short' : '';
  const clean = density === 'clean';
  // "Almost done" row tag. Only when the row isn't fully posted (green) yet, but
  // we already have all the videos we need this week AND every one of them is
  // wrapped up — nothing left in editing. Anything still in client review =>
  // "waiting on client"; otherwise everything's ready to post => "pretty much
  // done". Purely cosmetic: it doesn't change any count or layout slot.
  const counted = [...own, ...carriedList].filter((v) => v.counted);
  const wrapped = (v) => v.statusKey === 'posted' || v.statusKey === 'ready' || v.statusKey === 'review';
  const allWrapped =
    counted.length > 0 &&
    counted.length >= required &&
    counted.every(wrapped) &&
    counted.some((v) => v.statusKey !== 'posted'); // at least one still to post — else it's just done
  const tag = !met && allWrapped ? (counted.some((v) => v.statusKey === 'review') ? 'wait' : 'ready') : null;
  return (
    <div className={`tile${clean ? ' tile--clean' : ''}${idle ? ' tile--idle' : ''}${met ? ' tile--met' : ''}${short > 0 ? ' tile--short' : ''}`}>
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
          {short > 0 && <span className="flag flag--short">{short} short</span>}
        </span>
      </div>
      {idle ? (
        <div className="tile__idle">—</div>
      ) : clean ? (
        <div className="tile__squares">
          {own.map((v) => (
            <StatusSquare key={v.taskId} v={v} />
          ))}
          {carriedList.map((v) => (
            <StatusSquare key={`c-${v.taskId}`} v={v} />
          ))}
        </div>
      ) : (
        <div className="tile__cards">
          {own.map((v) => (
            <VideoCard key={v.taskId} v={v} />
          ))}
          {carriedList.map((v) => (
            <VideoCard key={`c-${v.taskId}`} v={v} />
          ))}
        </div>
      )}
    </div>
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

function EditorBreakdown({ weekKey, reels, onClose }) {
  const stats = useMemo(() => editorWeekStats(reels), [reels]);
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
                <AvatarBase src={e.avatar} color={e.color} initials={e.initials} size={30} />
                <span className="estat__name">{e.name}</span>
                <span className="estat__nums">
                  <span className="estat__n">
                    <b>{e.assigned}</b>
                    <i>assigned</i>
                  </span>
                  <span className="estat__n">
                    <b>{e.toDo}</b>
                    <i>to do</i>
                  </span>
                  <span className="estat__n">
                    <b>{e.notStarted}</b>
                    <i>not started</i>
                  </span>
                  <span className={`estat__n${e.extra ? ' estat__n--extra' : ''}`}>
                    <b>{e.extra}</b>
                    <i>extra</i>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="emodal__note">
          <b>assigned</b> = the editor on it now · <b>to do</b> = not yet Ready/Posted/Client Review ·{' '}
          <b>not started</b> = no replay link · <b>extra</b> = reassigned from another editor (counts only
          handoffs we can see).
        </p>
      </div>
    </div>
  );
}

function WeekPanel({ weekKey, byClient, isNow, ended, density, carriedByClient, carriedTotalByClient, leftForWeek }) {
  const [showEditors, setShowEditors] = useState(false);
  let totalDelivered = 0;
  let totalRequired = 0;
  const rows = config.clients.map((client) => {
    const vids = byClient?.get(client.name) ?? [];
    const base = requiredFor(client.quota, weekKey);
    const carried = isNow ? carriedByClient.get(client.name) ?? [] : [];
    // This week needs its base quota PLUS anything owed from the past; an ended
    // week needs its base quota MINUS whatever moved forward (so it can be met).
    const required = isNow
      ? base + (carriedTotalByClient.get(client.name) ?? 0)
      : ended
        ? Math.max(0, base - (leftForWeek?.get(client.name) ?? 0))
        : base;
    totalDelivered += vids.filter((v) => v.delivered).length;
    totalRequired += required;
    return { client, vids, required, carried };
  });
  const weekMet = totalRequired > 0 && totalDelivered >= totalRequired;
  const weekReels = rows.flatMap((r) => [...r.vids, ...r.carried]);
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
            Editors
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
        {rows.map(({ client, vids, required, carried }) => (
          <ClientTile
            key={client.listId}
            client={client}
            videos={vids}
            required={required}
            ended={ended}
            carried={carried}
            density={density}
          />
        ))}
      </div>
      {showEditors && (
        <EditorBreakdown weekKey={weekKey} reels={weekReels} onClose={() => setShowEditors(false)} />
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

  // Carry-over with deliverables that follow the video: a reel due before this
  // week that wasn't posted in its own week is "owed this week". It's removed
  // from its due week (which therefore needs one fewer) and added to the current
  // week's target (which needs one more) — whether it's still in flight (shown
  // as overdue) or already made up this week (a Posted card here). The required
  // count moves the same way the video does.
  const { videosByWeekClient, carriedByClient, carriedTotalByClient, leftByWeekClient } = useMemo(() => {
    const byWeek = new Map(); // weekKey -> Map(client -> [video])  (display)
    const carried = new Map(); // client -> [still-in-flight overdue videos]
    const carriedTotal = new Map(); // client -> count owed-this-week from the past (in-flight + made-up)
    const left = new Map(); // dueWeek -> Map(client -> count that moved forward)
    const carryCutoff = addWeeks(currentWk, -CARRY_OVER_WEEKS);
    for (const v of videos) {
      const overdue = v.counted && v.dueWeek && v.dueWeek < currentWk && !(v.delivered && v.weekKey < currentWk);
      // Old misses: a reel still unposted from beyond the carry-over window is no
      // longer rolled into this week's target (a make-up post still counts, any age).
      const owedThisWeek = overdue && (v.delivered || v.dueWeek >= carryCutoff);
      if (owedThisWeek) {
        carriedTotal.set(v.client, (carriedTotal.get(v.client) || 0) + 1);
        if (!left.has(v.dueWeek)) left.set(v.dueWeek, new Map());
        const lm = left.get(v.dueWeek);
        lm.set(v.client, (lm.get(v.client) || 0) + 1);
        if (!v.delivered) {
          // still in flight → move it out of its due week into this week
          if (!carried.has(v.client)) carried.set(v.client, []);
          carried.get(v.client).push(v);
          continue;
        }
        // made up this week (delivered, weekKey === currentWk) → stays in byWeek below
      }
      if (!v.weekKey) continue;
      if (!byWeek.has(v.weekKey)) byWeek.set(v.weekKey, new Map());
      const cm = byWeek.get(v.weekKey);
      if (!cm.has(v.client)) cm.set(v.client, []);
      cm.get(v.client).push(v);
    }
    for (const list of carried.values()) list.sort((a, b) => (a.dueWeek || '').localeCompare(b.dueWeek || ''));
    return { videosByWeekClient: byWeek, carriedByClient: carried, carriedTotalByClient: carriedTotal, leftByWeekClient: left };
  }, [videos, currentWk]);

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
  const canPrev = month > MIN_MONTH;
  const unscheduledClients = config.clients.filter((c) => unscheduledByClient.has(c.name));
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
            <div className="viewtabs" role="group" aria-label="Density">
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
                carriedByClient={carriedByClient}
                carriedTotalByClient={carriedTotalByClient}
                leftForWeek={leftByWeekClient.get(w)}
              />
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
