# Phase 1 — Signal recording, strategy versions, Strategies & Settings pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start recording what happens after every signal, replace flat presets with immutable strategy versions, and split the Strategy sidebar into a Strategies page and a Settings page with the UI review fixes.

**Architecture:** Two new backend modules: `strategies/` (versions store over SQLite, pure diff helpers) and `recording/` (a recorder that samples price/trade flow for 30 min per signal and captures risk facts once). `bot.ts` keeps its lane model but resolves presets from the latest version of each strategy and stamps `version_id` on positions. Frontend gains a 4-tab shell (Positions, Logs, Strategies, Settings); Agents tab comes in phase 3.

**Tech Stack:** TypeScript, Node 26 `node:sqlite`, Fastify, zod, Vitest (backend); React + Vite + Tailwind (frontend).

**Spec:** `docs/superpowers/specs/2026-11-18-strategies-agents-design.md` (§4, §6 hard limits, §8, §9 phase 1) and `docs/ui-review-2026-11-18.md`.

## Global Constraints

- Before Task 1: the working tree has uncommitted social-source work (`backend/src/social/`, `bot.ts`, `env.ts`, `strategy.ts`, …). Do not commit it as part of these tasks; the user must commit or stash it first. Commit only files each task names.
- Versions are immutable: never `UPDATE strategy_versions SET values`. Edits create `version + 1`.
- `author` ∈ `'user' | 'optimizer' | 'advisor'`; `stage` ∈ `'draft' | 'replay-passed' | 'paper' | 'live-canary' | 'live' | 'retired'`.
- Recording window 30 min from first mention; curve samples at most 1 per 1 s; graduated poll every 10 s; `signal_paths` retention 90 days; `signal_facts` kept forever.
- Hard-limit env vars (read-only in UI, unused by trading until phase 5): `AGENT_LIVE_ENABLED` (default false), `LIVE_MAX_BUY_SOL`, `LIVE_MAX_DAILY_LOSS_SOL`, `LIVE_MAX_OPEN`, `LIVE_CANARY_BUY_SOL`, `LIVE_ROLLBACK_LOSS_SOL`; plus `GEMINI_API_KEY`, `GEMINI_MODEL`. Never logged or sent in the snapshot except `AGENT_LIVE_ENABLED` and the numeric limits.
- UI word for test mode is **"Paper"** everywhere.
- Existing 45+ tests stay green: `npm test` from repo root; `npm run typecheck` clean.

## Review Focus

1. Upgrading an existing DB (saved presets in `settings`, positions with `lane`/`preset` but no `version_id`) must lose no history and be idempotent on every restart → Task 2 test `migration runs twice without duplicates`.
2. A built-in preset whose values change in code must get a new version, not overwrite v1 (old trades keep their rules) → Task 2 test `changed built-in gets v2`.
3. Saving a version identical to the latest must not create v+1 noise → Task 2 test `identical values return latest`.
4. A mint still being recorded must not be untracked by `prune()` after the mention window, and must be untracked when recording ends and no position holds it → Task 4 tests.
5. Strategy editor with an empty/invalid number must not send a request; it shows the field error → Task 7 manual check + `validateDraft` unit test.

---

### Task 1: Schema for strategies, versions and recording

**Files:**
- Modify: `backend/src/db/db.ts` (SCHEMA, constructor migrations)
- Test: `backend/test/db.schema.test.ts`

**Interfaces:**
- Produces tables exactly as spec §4 plus `strategies.archived INTEGER NOT NULL DEFAULT 0`, index `signal_paths_mint_ts ON signal_paths(mint, ts)`, and `positions.version_id INTEGER` (added via `ALTER TABLE` like `lane`). `replay_runs` and `agent_events` are created now (empty) so later phases need no migration.

- [ ] **Step 1: Write failing test** `db.schema.test.ts`: `new Db(':memory:')`, then `PRAGMA table_info` for each of `strategies, strategy_versions, signal_paths, signal_facts, replay_runs, agent_events` returns the spec's columns; `positions` has `version_id`; inserting two `strategy_versions` with the same `(strategy_id, version)` throws.
- [ ] **Step 2: Run** `npm test -w backend -- db.schema` → FAIL (no such table).
- [ ] **Step 3: Add the DDL** to `SCHEMA` and the `version_id` `ALTER` next to the existing `lane` one.
- [ ] **Step 4: Run** same command → PASS; `npm test` all green.
- [ ] **Step 5: Commit** `git add backend/src/db/db.ts backend/test/db.schema.test.ts && git commit -m "feat(db): tables for strategy versions and signal recording"`

### Task 2: Strategy store and migration

**Files:**
- Create: `backend/src/strategies/types.ts`, `backend/src/strategies/store.ts`
- Test: `backend/test/strategyStore.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), `Preset`, `PresetValues`, `BUILT_IN_PRESETS`, `presetValues` from `config/strategy.ts`.
- Produces (`types.ts`):
  - `type Author = 'user' | 'optimizer' | 'advisor'`, `type Stage = 'draft' | 'replay-passed' | 'paper' | 'live-canary' | 'live' | 'retired'`
  - `interface StrategyRow { id: string; name: string; description: string; builtIn: boolean; archived: boolean; createdAt: number }`
  - `interface VersionRow { id: number; strategyId: string; version: number; parentId: number | null; values: PresetValues; author: Author; note: string; stage: Stage; createdAt: number }`
  - `interface ValueDiff { key: string; from: unknown; to: unknown }`
  - `function diffValues(a: PresetValues, b: PresetValues): ValueDiff[]` (ladder compared as one key via JSON)
- Produces (`store.ts`) `class StrategyStore`:
  - `constructor(db: Db, now?: () => number)`
  - `ensureBuiltIns(presets: Preset[]): void`
  - `migrateSavedPresets(saved: Preset[]): void` — idempotent; sets setting `presetsMigrated = true`
  - `backfillPositionVersions(): number` — returns rows updated
  - `list(includeArchived?: boolean): (StrategyRow & { latest: VersionRow })[]`
  - `versions(strategyId: string): VersionRow[]` (newest first)
  - `get(versionId: number): VersionRow | undefined`
  - `create(name: string, description: string, values: PresetValues, author: Author, note: string): VersionRow` — id = slug of name; throws `'name taken'` on collision (case-insensitive, archived included)
  - `addVersion(strategyId: string, values: PresetValues, author: Author, note: string): VersionRow` — parent = latest; returns latest unchanged when `diffValues` is empty
  - `setStage(versionId: number, stage: Stage): void`
  - `archive(strategyId: string): void` — built-ins throw `'built-in'`
- Migration rules: built-ins → strategy id = preset id, v1 `author 'user'`, stage `'paper'`; a built-in whose code values differ from its latest → `addVersion(..., 'user', 'built-in updated')`. Saved presets → strategy + v1 with their values. Backfill: `lane` = strategy id → latest version **at or before** `opened_at`; else `preset` name match; else strategy `custom` v1 (created on demand, values = `presetValues(DEFAULT_STRATEGY)`).

- [ ] **Step 1: Write failing tests:** `creates v1 for every built-in`; `migration runs twice without duplicates` (call all three migrate methods twice, counts unchanged); `changed built-in gets v2` (mutate a copy's `hardStopLossPct`, `ensureBuiltIns` → `versions('scalp')[0].version === 2`, `parentId` = v1 id, v1 values unchanged); `identical values return latest`; `addVersion increments and diffValues lists the changed key`; `create rejects duplicate name case-insensitively`; `backfill maps lane, then preset name, then custom`; `archive refuses built-in`.
- [ ] **Step 2: Run** `npm test -w backend -- strategyStore` → FAIL.
- [ ] **Step 3: Implement** `types.ts` and `store.ts`. Store `values` as JSON; reuse the slug logic from `bot.savePreset` (move it to `lib/util.ts` as `slug(name: string): string` and use it in both).
- [ ] **Step 4: Run** → PASS; full `npm test` green.
- [ ] **Step 5: Commit** the four files (+ `lib/util.ts`, `bot.ts` only for the slug import) with `feat(strategies): versioned strategy store with preset migration`.

### Task 3: Bot and API on versions

**Files:**
- Modify: `backend/src/bot.ts` (presets section ~l.679–725, `openPosition` ~l.484, `snapshot` ~l.805, lane fallback ~l.420), `backend/src/db/db.ts` (stats), `backend/src/api/server.ts`, `backend/src/types.ts` (`Position.versionId`)
- Test: `backend/test/versionStats.test.ts`

**Interfaces:**
- Consumes: `StrategyStore` (Task 2).
- Produces:
  - `Db.statsByVersion(mode: string): { versionId: number; count: number; wins: number; pnl: number; avgPnlPct: number; maxDrawdownSol: number }[]`
  - `Db.equityCurve(versionId: number, mode: string): { ts: number; pnl: number }[]` (cumulative, by `closed_at`)
  - `bot.presets()` returns one `Preset` per non-archived strategy built from its latest version, plus `versionId` and `version` fields (extend `Preset` with optional `versionId?: number; version?: number`).
  - `Position.versionId: number | null`; `openPosition` stores the lane's version id (main lane: `activePreset()?.versionId ?? custom latest`).
  - Snapshot: replace `presetStats` with `versionStats` (same shape as `statsByVersion`), add `hardLimits: { agentLiveEnabled: boolean; maxBuySol: number | null; maxDailyLossSol: number | null; maxOpen: number | null; canaryBuySol: number | null; rollbackLossSol: number | null }`.
  - Routes: `GET /api/strategies` → `list()`; `GET /api/strategies/:id` → `{ strategy, versions, stats: statsByVersion filtered, curves: Record<versionId, equityCurve> }`; `POST /api/strategies` `{name, description, values?}` (values default = current strategy) → `create`; `POST /api/strategies/:id/versions` `{values, note}` → `addVersion(…, 'user', note)`; `POST /api/strategies/:id/archive`; `POST /api/versions/:id/apply` (sets main strategy to that version's values). Keep `POST /api/presets/:id/apply` as alias to latest version for one release; remove `POST /api/presets` and `DELETE /api/presets/:id`.
- `env.ts`: add the Global Constraints env vars (numbers optional, `AGENT_LIVE_ENABLED` bool default false, `GEMINI_MODEL` default `''`); `.env.example` gets them empty with one-line comments.
- On boot: `ensureBuiltIns(BUILT_IN_PRESETS)`, `migrateSavedPresets(db.getSetting('presets') ?? [])`, `backfillPositionVersions()`.

- [ ] **Step 1: Write failing tests** in `versionStats.test.ts` on an in-memory `Db`: insert 3 closed positions for version 7 (pnl +0.2, −0.1, +0.05) and 1 for version 8 → `statsByVersion('paper')` gives count 3, pnl 0.15, `maxDrawdownSol` 0.1 for 7; `equityCurve(7,'paper')` = `[0.2, 0.1, 0.15]` in `closed_at` order.
- [ ] **Step 2: Run** `npm test -w backend -- versionStats` → FAIL.
- [ ] **Step 3: Implement** Db methods (reuse `computeStats` for drawdown), then bot/API/env wiring above.
- [ ] **Step 4: Verify** `npm test` green, `npm run typecheck -w backend` clean, then start `npm run dev` and `curl -s localhost:8787/api/strategies -H "authorization: Bearer $DASHBOARD_TOKEN" | head -c 400` lists 7 built-ins with `latest.version`.
- [ ] **Step 5: Commit** named files: `feat: presets backed by strategy versions; per-version stats API`.

### Task 4: Signal recorder

**Files:**
- Create: `backend/src/recording/recorder.ts`, `backend/src/recording/facts.ts`
- Modify: `backend/src/risk/checks.ts` (export `holderTop10`), `backend/src/bot.ts` (new-signal hook ~l.222, `prune` ~l.633, timers ~l.164, feed `price` listener)
- Test: `backend/test/recorder.test.ts`

**Interfaces:**
- Produces `class SignalRecorder`:
  ```ts
  constructor(deps: {
    db: Db; now: () => number;
    pollPrice: (mint: string) => Promise<number | null>;          // Jupiter quote path the bot already uses
    flow: (mint: string, sinceMs: number) => { trades: number; buySol: number; sellSol: number }; // from PriceFeed trades
    release: (mint: string) => void;                              // bot untracks if no open position
  }, opts?: { windowMs?: number; curveMinGapMs?: number; pollMs?: number; retentionMs?: number })
  start(mint: string, route: Route): void   // idempotent
  onPrice(mint: string, price: number): void // curve/pumpswap ticks; throttled to curveMinGapMs
  tick(): Promise<void>                      // polls graduated mints due; ends expired ones and calls release
  prune(): number                            // deletes signal_paths older than retentionMs; returns rows
  isRecording(mint: string): boolean
  ```
  Each `signal_paths` row: `trades/buy_sol/sell_sol` = flow **since the previous sample** of that mint.
- `PriceFeed.flowSince(mint: string, sinceMs: number)` added (same filter as `stats` but from a timestamp).
- `facts.ts`: `captureFacts(deps: { rpc: Rpc; db: Db; programOf: (mint) => string }, mint: string, route: Route): Promise<void>` — `loadMint`, `holderTop10`, `rugcheck`; writes one `signal_facts` row (`INSERT OR IGNORE`); on any error writes the row with nulls for what failed (never throws).
- `holderTop10(rpc: Rpc, mint: string, f: MintFacts): Promise<number | null>`; `holderCheck` calls it (behaviour unchanged).
- Bot: on first mention of a mint → `recorder.start(mint, route)` with route from `quoter.route` (memoised as in `evaluate`), and `void captureFacts(...)`. `prune()` skips untrack while `recorder.isRecording(mint)`. Timer every 5 s → `recorder.tick()`; hourly → `recorder.prune()`. `release` = untrack unless an open position holds the mint.

- [ ] **Step 1: Write failing tests** with fake `now`: `throttles curve samples to 1 per second` (5 `onPrice` in 900 ms → 1 row); `polls graduated every 10 s` (tick at 0, 5 s, 10 s → 2 rows); `stops after 30 min and calls release once`; `flow columns are deltas since last sample`; `start is idempotent`; `prune deletes rows older than 90 days only`; `captureFacts writes a row with nulls when rpc throws`.
- [ ] **Step 2: Run** `npm test -w backend -- recorder` → FAIL.
- [ ] **Step 3: Implement** recorder, facts, `flowSince`, `holderTop10`, bot wiring.
- [ ] **Step 4: Verify** `npm test` green; run `npm run dev`, inject a CA via `POST /api/inject`, after 30 s `sqlite3 data/1mbot.sqlite "select count(*) from signal_paths; select * from signal_facts order by captured_at desc limit 1"` shows rows.
- [ ] **Step 5: Commit** named files: `feat(recording): record 30-min price and flow path plus risk facts for every signal`.

### Task 5: App shell, shared UI pieces, naming fixes

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/components/TabBar.tsx`, `frontend/src/components/Header.tsx`, `frontend/src/components/ui.tsx`, `frontend/src/components/Activity.tsx`, `frontend/src/components/Positions.tsx`, `frontend/src/lib/types.ts`
- Create: `frontend/src/components/ConfirmSheet.tsx`, `frontend/src/components/SideNav.tsx`

**Interfaces:**
- `type Tab = 'home' | 'logs' | 'strategies' | 'settings'`; `readTab` accepts these (old `'strategy'` → `'strategies'`).
- Desktop (`lg+`): left `SideNav` with the same 4 entries; one page visible at a time; Positions page keeps Positions + Logs side by side at `xl`.
- `useConfirm(): (opts: { title: string; body?: string; confirm: string; danger?: boolean }) => Promise<boolean>` backed by `ConfirmSheet` (bottom sheet on phone, dialog on desktop, Escape = cancel). Replace every `confirm(` in `Positions`, `Presets`/Strategies, `Arena`, Settings.
- `types.ts`: mirror Task 3 (`versionStats`, `hardLimits`, `Preset.versionId/version`, `Position.versionId`).
- Fixes: header badge "PAPER"/"LIVE" (#10) and stats heading "All-time · Paper"; kill switch label "New buys" with state "On"/"Off" (#14); Arena-on banner on Positions: "Arena is running: main strategy is not opening new trades." (#7); KDA tile moved into a `<details>` "More" (#13); min text size 11 px in TabBar/tiles (#16).

- [ ] **Step 1: Implement** the above.
- [ ] **Step 2: Verify** `npm run typecheck -w frontend` clean; `grep -rn "confirm(" frontend/src` returns only `useConfirm` internals.
- [ ] **Step 3: Visual check** in the browser pane at 375×812 and 1440×900: 4 tabs/nav work, banner shows when Arena is on, Sell asks via sheet. Screenshot both.
- [ ] **Step 4: Commit** named files: `feat(ui): 4-page shell, confirm sheet, naming and label fixes`.

### Task 6: Settings page

**Files:**
- Create: `frontend/src/pages/Settings.tsx`
- Modify: `frontend/src/components/StrategyConfig.tsx` (remove moved groups), `frontend/src/components/TelegramFolders.tsx` (no change expected beyond import site)

**Interfaces:**
- Consumes: `PUT /api/strategy` (existing) for infra/cost fields, `POST /api/mode`, `POST /api/paper/reset`, `hardLimits` from snapshot.
- Groups in order: Mode (Live segment **disabled** with text "Live engine not built yet" (#4)); Telegram folders; RPC; Costs — `priorityFeeSol` (0–0.01, step 0.0001), `jitoTipSol` (0–0.01, step 0.0001), `pumpFeeBps` (0–300, step 5), `simulatedLatencyMs` (#1); Hard limits (read-only rows; "not set" when null; footer "Set in .env. Agents and this page cannot change them."); Danger zone — Reset paper wallet (#11) via `useConfirm({ danger: true })`.

- [ ] **Step 1: Implement** `Settings.tsx` reusing `Group`, slider row and `Segmented`.
- [ ] **Step 2: Verify** typecheck clean; in the pane change Paper latency and save → `GET /api/state` shows new value; Live segment cannot be pressed.
- [ ] **Step 3: Commit** named files: `feat(ui): Settings page with costs, hard limits and danger zone`.

### Task 7: Strategies page

**Files:**
- Create: `frontend/src/pages/Strategies.tsx`, `frontend/src/pages/StrategyDetail.tsx`, `frontend/src/components/StrategyEditor.tsx`, `frontend/src/lib/validate.ts`, `frontend/src/components/EquityCurve.tsx`
- Delete: `frontend/src/components/Presets.tsx`, `frontend/src/components/StrategyConfig.tsx` (contents moved)
- Modify: `frontend/src/components/Arena.tsx` (rendered on Strategies list page, above the list)
- Test: `frontend/src/lib/validate.test.ts` (pure; no DOM). Add `vitest` to frontend devDependencies with script `"test": "vitest run"`, and change root `"test"` to `npm test -w backend && npm test -w frontend`.

**Interfaces:**
- Consumes: Task 3 routes, `versionStats`.
- `validateDraft(d: Strategy): Record<string, string>` — field → message; empty = valid. Rules mirror `StrategySchema` bounds; ladder `roiPct > 0`, `sellPct` 1–100, total `sellPct` ≤ 100.
- **List:** row per strategy: name, `v{n}`, stage badge, author of latest, paper `count · pnl` from `versionStats` of latest version, "MAIN" if active. `+ New` → name + description, starts from current main values.
- **Detail:** header (name, description, Apply button → confirm sheet listing `diffValues` vs current main (#3)); versions timeline (version, author, note, stage, date, its paper stats); `EquityCurve` of selected version (SVG polyline from `curves[versionId]`, same tokens as `PriceChart`) (#8); metrics tiles from `statsByVersion` (count, win %, pnl, avg %, max DD); Edit → `StrategyEditor`.
- **Editor:** groups in funnel order (#6): Signal filter → Entry timing (with Route) → Risk & momentum (adds `minGraduatedVolumeUsd5m` 0–100 000 step 1 000 (#1)) → Entry → Exits incl. ladder → Limits. Inline errors from `validateDraft`, Save disabled while errors exist (#5). Save asks for a note (optional) → `POST /api/strategies/:id/versions`; result toast "Saved as v{n}" or "No changes".
- Stats are matched by `versionId`, never by name (#2).

- [ ] **Step 1: Write failing test** `validate.test.ts`: default strategy → `{}`; ladder `[{roiPct:0,sellPct:50}]` → key `takeProfitLadder.0.roiPct`; two steps selling 60 + 50 → key `takeProfitLadder`; `buyAmountSol: NaN` → key `buyAmountSol`.
- [ ] **Step 2: Run** `npm test -w frontend -- validate` → FAIL.
- [ ] **Step 3: Implement** `validate.ts`, then pages and editor.
- [ ] **Step 4: Verify** test PASS, typecheck clean; in the pane: edit Scalp's hard stop → saved as v2, timeline shows v2 with parent v1; clearing a ladder field shows inline error and Save is disabled; Apply shows the diff.
- [ ] **Step 5: Commit** named files: `feat(ui): Strategies page with versions, per-version stats and editor`.

### Task 8: Railway volume and docs

**Files:**
- Modify: `docs/superpowers/plans/2026-11-18-railway-deploy.md`, `PLAN.md` (status line + phase list pointer to the spec)

- [ ] **Step 1:** Document: mount a Railway volume at `/app/data` and set `DB_PATH=/app/data/1mbot.sqlite` (env var already read in `config/env.ts:21`); list new env vars from Global Constraints.
- [ ] **Step 2: Verify** `npm test` and `npm run typecheck` from repo root both pass.
- [ ] **Step 3: Commit** `docs: phase 1 deploy notes and env vars`.
