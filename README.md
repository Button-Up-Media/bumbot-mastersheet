# BUM BOT Status Board — "Master Sheet"

A **live, read-only** mirror of ClickUp video-task status for Button Up Media.

> **Hard rule:** this app NEVER writes to ClickUp. Every ClickUp call is a `GET`.
> It reads each client's *Video Editing* list and renders a weekly status grid.

## What it shows (Phase 1)

- **Rows = 12 clients.** Each client shows one square per video due that week,
  plus a `delivered / required` count.
- **Square colour = ClickUp status** (To Do, In Progress, Internal Approval,
  Revisions, Client Review, Ready to Post, Posted, Canceled/Paused).
- **Cell background = assignee** (Fjell · Wesley · Eddie · or neutral).
- **Week model:** Mon–Sun, America/New_York. A video belongs to the week of its
  ClickUp due date. No due date → an "Unscheduled" lane. Page back to the week
  of **June 1, 2026** minimum.
- **`delivered`** = Posted tasks due that week. **`required`** = the client's
  weekly quota (Phase 1 = base quota only, no carry-over).

The computed board is cached in **Vercel KV** with a `lastUpdated` stamp; all
viewers read the shared cache. It auto-recomputes hourly (lazy TTL on read),
clients poll ~60s, and a manual **Refresh** recomputes for everyone.

## Not in Phase 1

Version numbers (Phase 2), carry-over / weekly-reset / monthly deficit
(Phase 3), ClickUp webhooks (Phase 2), and **any** write to ClickUp.

## Secrets

This repo is **public** — no secrets are committed. Two secrets live ONLY as
Vercel environment variables:

| Env var             | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `CLICKUP_API_TOKEN` | Read-only ClickUp token (same as the Sendouts app) |
| `APP_PASSCODE`      | Shared view passcode (`mastersheet`)               |

`KV_REST_API_URL` / `KV_REST_API_TOKEN` are auto-injected by Vercel when a KV
store is connected. See `.env.example`.

## Local dev

```bash
npm install
cp .env.example .env   # fill in CLICKUP_API_TOKEN + APP_PASSCODE (git-ignored)
npm run dev            # http://localhost:3000
npm run verify         # prints the dry decision table (read-only)
```

## Stack

Next.js (App Router) · React · Vercel KV · `next/font` (Figtree / Epilogue /
Plus Jakarta Sans — the Button Up Media website typefaces). Same stack and
patterns as the Sendouts app.
