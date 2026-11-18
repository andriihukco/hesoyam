# Portfolio, post-exit tracking, Settings sub-pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full portfolio history (equity, drawdown, daily PnL, breakdowns), price tracking after every exit until the coin dies, and Settings split into sub-pages.

**Architecture:** Backend: a `PostExitFollower` (same shape as `SignalRecorder`) writes ticks for closed positions into `price_ticks`; a 5-min `equity_snapshots` writer; a pure `buildPortfolio` turns snapshots + closed positions into the API payload. Frontend: new Portfolio tab with SVG charts in the style of `EquityCurve`/`PriceChart`, chart split solid/dashed at `closedAt`, Settings list → sub-pages.

**Tech Stack:** TypeScript, node:sqlite, Fastify, Vitest; React + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-18-portfolio-design.md`

## Global Constraints

- Follow limits: max 24 h after close; rugged = price ≤ 10 % of max(exit price, highest price since exit); stale = 30 min with no price; graduated poll every 60 s, skipped while Jupiter cooldown is active; ticks thinned like `tick_` (≥ 5 s or ≥ 1 % move).
- `follow_end` ∈ `'24h' | 'rugged' | 'stale'`.
- Equity snapshot every 5 min and on every close. Arena on → sum of lane wallets (same as `walletSummary()`).
- Ranges: `1d | 7d | 30d | all`; days are UTC.
- UI word "Paper"; confirm via `useConfirm`; no new chart library.
- Commit only files each task names; `npm test` and `npm run typecheck` green after every task.

## Review Focus

1. Restart during a follow: following resumes for positions closed < 24 h ago with no `follow_end` → Task 3 test `followCandidates returns recent unended closes only`.
2. A mint followed after exit must stay subscribed even when no position, recording or mention needs it → Task 3 extends `canUntrack` with `following` (test).
3. A coin that never trades again ends as `stale`, not left running forever → Task 1 test `ends stale after 30 min without price`.
4. Ranges with no snapshots yet (fresh install) must return empty arrays, not crash → Task 2 test `empty input gives empty series and zero stats`.
5. Close reasons carry numbers ("hard stop -16.4%"), so grouping must normalise them → Task 2 test `exit reasons are grouped without numbers`.

---

### Task 1: Post-exit follower

**Files:** Create `backend/src/recording/follower.ts`; Test `backend/test/follower.test.ts`

**Interfaces — Produces:**
```ts
export type FollowEnd = '24h' | 'rugged' | 'stale';
export interface FollowDeps {
  now: () => number;
  pollPrice: (mint: string) => Promise<number | null>;
  canPoll?: () => boolean;
  addTick: (positionId: number, ts: number, price: number) => void;
  end: (positionId: number, reason: FollowEnd) => void;
  release: (mint: string) => void; // called when no followed position uses the mint any more
}
export class PostExitFollower {
  constructor(deps: FollowDeps, opts?: { maxMs?: number; rugFrac?: number; staleMs?: number; pollMs?: number; minGapMs?: number });
  follow(p: { positionId: number; mint: string; route: Route; closedAt: number; exitPrice: number }): void; // idempotent per positionId
  onPrice(mint: string, price: number): void;
  tick(): Promise<void>;
  isFollowing(mint: string): boolean;
}
```

- [ ] **Step 1: Failing tests** (fake clock, in-memory arrays for ticks/ends):
  `writes thinned ticks after exit` (prices 1.00 @+1 s, 1.005 @+2 s, 1.02 @+3 s, 1.02 @+9 s → ticks at +1 s, +3 s, +9 s);
  `ends rugged at 10 % of the post-exit peak` (exit 1, peak 3, then 0.3 → end 'rugged', release once);
  `does not end rugged above 10 % of peak` (exit 1, peak 3, 0.31 → still following);
  `ends 24h after close` (tick at closedAt + 24 h → '24h');
  `ends stale after 30 min without price`;
  `polls graduated every 60 s and skips during cooldown`;
  `two positions on one mint release only after both end`.
- [ ] **Step 2:** `npm test -w backend -- follower` → FAIL (module missing).
- [ ] **Step 3:** Implement. Stale clock starts at `closedAt`; a poll returning null does not refresh it.
- [ ] **Step 4:** Same command → PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat(recording): follow price after exit until 24h, rug or stale`.

### Task 2: Portfolio maths and storage

**Files:** Create `backend/src/portfolio/portfolio.ts`; Modify `backend/src/db/db.ts`; Test `backend/test/portfolio.test.ts`

**Interfaces — Produces:**
- DB: table `equity_snapshots(ts INTEGER NOT NULL, mode TEXT NOT NULL, cash_sol REAL NOT NULL, open_sol REAL NOT NULL, total_sol REAL NOT NULL)` + index `(mode, ts)`; `positions.follow_until INTEGER`, `positions.follow_end TEXT` (ALTER if missing).
- `Db.addEquitySnapshot(s: { ts: number; mode: string; cashSol: number; openSol: number; totalSol: number }): void`
- `Db.equitySnapshots(mode: string, sinceTs: number): { ts: number; cashSol: number; openSol: number; totalSol: number }[]`
- `Db.closedSince(mode: string, sinceTs: number): ClosedRow[]` where `ClosedRow = { id; mint; symbol; route; versionId: number | null; cost: number; realized: number; ladder: number; opened: number; closed: number; closeReason: string | null }`
- `Db.setFollowEnd(positionId: number, reason: FollowEnd, ts: number): void`; `Db.followCandidates(sinceTs: number): { id; mint; route; closedAt; lastPrice }[]` (closed, `follow_end IS NULL`, `closed_at >= sinceTs`).
- `rangeStart(range: '1d'|'7d'|'30d'|'all', now: number): number` (all → 0)
- `exitGroup(reason: string | null): string` — lower-case, numbers/%/signs removed, trimmed; null → 'open'.
- `buildPortfolio(i: { snapshots; closed: ClosedRow[]; versionName: (id: number | null) => string }): { equity: {ts,total,cash,open}[]; drawdown: {ts, dd}[]; daily: {day: string, pnl, count, wins}[]; byVersion: {name, count, pnl, winRate}[]; byRoute: {...same}; byExit: {...same}; stats: AllTimeStats }` — drawdown = total − running max of total; `stats` via existing `computeStats`.

- [ ] **Step 1: Failing tests:** `empty input gives empty series and zero stats`; `drawdown is distance below running peak` (totals 10, 12, 9, 13 → dd 0, 0, −3, 0); `daily groups by UTC day`; `exit reasons are grouped without numbers` ('hard stop -16.4%' and 'hard stop -18.3%' → one 'hard stop' group); `rangeStart 7d is now − 7 days, all is 0`; `db equity snapshots round-trip and filter by mode and since`; `followCandidates returns recent unended closes only`.
- [ ] **Step 2:** `npm test -w backend -- portfolio` → FAIL.
- [ ] **Step 3:** Implement DB methods + `portfolio.ts`.
- [ ] **Step 4:** PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat(portfolio): equity snapshots and portfolio maths`.

### Task 3: Bot wiring and API

**Files:** Modify `backend/src/bot.ts`, `backend/src/api/server.ts`, `backend/src/recording/recorder.ts` (`canUntrack`), `backend/test/recorder.test.ts`

**Interfaces:** Consumes Tasks 1–2. Produces:
- `canUntrack({ held, recording, inMentionWindow, following })` — `following` added; test case `following keeps the mint subscribed`.
- On every position close: `follower.follow({ positionId, mint, route, closedAt, exitPrice: last fill price })`, `db` writes `follow_until = closedAt + 24 h`, and an equity snapshot is written.
- On boot: `follower.follow` for each `db.followCandidates(now − 24 h)` (exitPrice = `lastPrice`).
- Feed `price` → `follower.onPrice`; timer 5 s → `follower.tick()`; timer 5 min → equity snapshot; graduated polls via the existing `recordPrice` path (cooldown-aware).
- `bot.portfolio(range)` → `buildPortfolio(...)`; route `GET /api/portfolio?range=` (invalid → `all`).
- `positionDetail` adds `followEnd: FollowEnd | null`, `followUntil: number | null`, `postExit: { peakPct: number; lowPct: number } | null` (vs exit price, from ticks after `closedAt`).

- [ ] **Step 1:** Add the `canUntrack` test case → FAIL. **Step 2:** implement wiring. **Step 3:** `npm test`, typecheck green. **Step 4:** live check on a DB copy (Telegram off): inject a CA, panic-sell after it opens, `sqlite3 … "select count(*) from price_ticks where position_id=? and ts > closed_at"` grows; `curl /api/portfolio?range=1d` returns arrays. **Step 5:** Commit `feat: portfolio API, equity snapshots and post-exit tracking wired in`.

### Task 4: Portfolio page

**Files:** Create `frontend/src/pages/Portfolio.tsx`, `frontend/src/components/LineChart.tsx`, `frontend/src/components/DailyBars.tsx`; Modify `TabBar.tsx` (5th tab `portfolio`, label "Portfolio"), `App.tsx`, `lib/types.ts` (`Portfolio` type mirroring Task 2).

- `LineChart({ points: { ts: number; v: number }[]; height?: number; tone?: 'auto' | 'neg'; zeroLine?: boolean })` — time-scaled x (not index), used for equity and drawdown.
- `DailyBars({ days: { day: string; pnl: number }[] })` — green/red bars around zero, day label on hover/title.
- Page: range `Segmented` (1D/7D/30D/All, default 7D, remembered in localStorage with try/catch); equity `LineChart` + drawdown `LineChart tone="neg"`; stat tiles (PnL, win rate, profit factor, expectancy, max DD, trades); tables byVersion/byRoute/byExit; closed list (filters: strategy, Win/Loss) → `PositionDetailSheet`. Empty state: "No closed trades in this range yet."
- [ ] Implement; typecheck; visual check at 375×812 and 1280×860 on the local run; commit `feat(ui): Portfolio page`.

### Task 5: Chart after exit

**Files:** Modify `frontend/src/components/PriceChart.tsx`, `PositionDetail.tsx`, `lib/types.ts`.
- Ticks with `ts > closedAt` drawn dashed; vertical marker at close; label row: "After exit: peak +X% · low −Y%" and status "tracking until HH:MM" | "rugged after N min" | "stopped: no trades 30 min" | "24 h done".
- [ ] Implement; typecheck; visual check on a closed position with post-exit ticks; commit `feat(ui): show price after exit`.

### Task 6: Settings sub-pages

**Files:** Modify `frontend/src/pages/Settings.tsx` (split into sections rendered by key), keep all existing behaviour.
- Root: grouped list rows (Mode, Telegram folders, RPC, Costs, Security, Hard limits, Danger zone) each with current value summary and ›; tapping opens that section with "‹ Settings". Unsaved Costs/RPC bar stays on its sub-page.
- [ ] Implement; typecheck; visual check; commit `feat(ui): Settings sub-pages`.

### Task 7: Run, review, deploy

- [ ] Run locally: API on a copy of the real DB with Telegram off, UI against it; walk all 5 tabs.
- [ ] Final whole-branch review (fresh reviewer), fix Critical/Important test-first.
- [ ] Merge `origin/main`, `npm test`, typecheck, build; push to `main`; wait for the Railway deployment status; report links.
