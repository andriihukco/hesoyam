# Strategies page, replay and self-improving agents — design

Status: draft, 2026-11-18. Approved so far: order of work, rule-based optimizer + Gemini advisor, 24/7 on Railway, agents may act in paper **and** live within the limits in §6.

## 1. Intent

The user wants the bot to improve its own strategies around the clock: create versions, test them, keep what works, drop what doesn't, and trade the best one, with the goal of profit from swapping Pump.fun / PumpSwap coins.

Facts that shape the design (local DB, 2026-11-18):
- 194 signals in ~10 days (~0.8/h), 37 reached "buy". About 4 buys per day.
- 4 closed paper positions remain; all hard-stopped at −16 % to −18 %.
- No edge is shown yet. The system must be able to say "nothing works" as clearly as "this works".

Consequence: learning only from live paper trades takes about a week per tested version. So the core of this design is **replay**: record what happened after every signal, then test any config against that record in seconds.

## 2. Goals, non-goals, anti-goals

Goals
- Strategies have immutable versions (v1, v2 …) with parent, author (user / optimizer / advisor) and note.
- Per-version performance: replay, paper and live shown separately.
- Show how results depend on each setting (sensitivity charts).
- Optimizer agent creates and tests versions 24/7; advisor (Gemini) proposes versions with reasons.
- A promotion ladder takes a version from draft to live, with automatic rollback.

Non-goals
- Building the live execution engine (PLAN.md phase 7). Separate project; this design only defines how agents may use it.
- New signal sources or new data providers.
- Multi-user access.

Anti-goals (failure even if it "works")
- Agent changes a hard limit or the kill switch.
- A version reaches live on replay results alone.
- Optimizer reports profits that came from overfitting a small sample.
- Loss of trade history when a strategy is edited.

## 3. Approaches considered

| Approach | Trade-off | Chosen |
|---|---|---|
| A. Evolve only through live paper lanes (extend Arena) | Real fills, no new infra; ~1 week per generation at current signal rate, max 8 lanes | No (too slow alone) |
| **B. Record every signal → replay engine → optimizer, paper as the check** | Fast iteration, enables sensitivity charts; replay fills are approximate | **Yes** |
| C. LLM agent edits configs directly from stats | Readable reasoning; costs per run, can't measure anything itself | Only as advisor feeding B |

## 4. Data to record

New tables (SQLite, same DB):

```
strategies(id TEXT PK, name, description, built_in INT, created_at)
strategy_versions(id INTEGER PK, strategy_id, version INT, parent_id NULL,
  values JSON, author TEXT CHECK IN ('user','optimizer','advisor'), note,
  stage TEXT, created_at, UNIQUE(strategy_id, version))
signal_paths(mint, ts, price REAL, trades INT, buy_sol REAL, sell_sol REAL)   -- 1 row per sample
signal_facts(mint PK, decimals, route_at_first, mint_auth_off INT, freeze_auth_off INT,
  top10_pct REAL, rugcheck JSON, captured_at)
replay_runs(id PK, version_id, from_ts, to_ts, split TEXT, metrics JSON, created_at)
agent_events(id PK, ts, agent TEXT, kind TEXT, version_id NULL, detail JSON)  -- audit log
```

- `positions` gains `version_id`. Existing rows map to v1 of their built-in preset (`lane` / `preset` columns) or to a "Custom" strategy v1.
- Saved presets in `settings` migrate to `strategies` + v1. `presetStats` keys move from name to `version_id` (fixes the name-collision bug).
- **Recording window:** every signal is sampled from first mention for 30 min (curve: on each curve update, at most 1/s; graduated: Jupiter quote every 10 s). Then untracked unless held. Retention: forever for `signal_facts`, 90 days for `signal_paths` (my call; ~0.8 signals/h makes this small).
- Risk facts are captured once per signal regardless of decision, so replay can re-apply any risk filter.

## 5. Replay engine

- Input: version values + time range. For each recorded signal: rebuild channel-count timeline from `mentions`, apply signal filter, entry timing, risk facts, momentum (from `signal_paths` trades/volume over the observe window), then simulate entry at recorded price + simulated latency + slippage model already used by paper, then run the existing `exitEngine` over the price path.
- Uses the same pure functions as live code (aggregator, scorer, entry, exitEngine). No forked logic.
- Output metrics: trades, total PnL SOL, expectancy, profit factor, max drawdown, win rate, avg hold, per-exit-reason counts.
- **Known gap:** price impact and failed transactions are approximated. Replay ranks versions; paper confirms them. UI labels replay numbers "estimated".
- Walk-forward split: oldest 70 % of signals = train, newest 30 % = validate. Validation set is never used to create versions.
- Sensitivity: for a version, sweep one numeric setting across its range (10 steps), replay each, plot PnL and trade count vs value. Done on demand and nightly for the live/leading version.

## 6. Promotion ladder and hard limits

Stages: `draft → replay-passed → paper → live-canary → live → retired`.

| Step | Rule (defaults, configurable) |
|---|---|
| draft → replay-passed | ≥ 30 replay trades on validate split; beats parent's validate PnL and expectancy; max DD not worse than parent by > 20 % |
| replay-passed → paper | Gets an Arena lane (max 4 agent lanes of the 8) |
| paper → live-canary | ≥ 30 paper trades; paper PnL > parent's paper PnL over the same period; PnL > 0 after fees |
| live-canary → live | Canary trades at `LIVE_CANARY_BUY_SOL` for ≥ 20 trades with PnL > 0 |
| any live → rollback | Loss ≥ `LIVE_ROLLBACK_LOSS_SOL` since promotion, or 5 losses in a row → previous live version; if none, kill switch on |

Hard limits, env only (`.env`), agent and UI cannot change them:
`AGENT_LIVE_ENABLED` (default false), `LIVE_MAX_BUY_SOL`, `LIVE_MAX_DAILY_LOSS_SOL`, `LIVE_MAX_OPEN`, `LIVE_CANARY_BUY_SOL`, `LIVE_ROLLBACK_LOSS_SOL`. Version values are clamped to these at execution time, not just at save time.

Other rules:
- One live version at a time (one real wallet). My call: simplest and avoids two versions fighting over the same tokens.
- Separate hot wallet; agent never moves funds.
- Kill switch: agents can turn it **on** (rollback), never off.
- Every agent action writes `agent_events`; any promotion can be undone from the UI in one click.

## 7. Agents

**Optimizer (rule-based, free)** — runs every 30 min and after each new batch of 10 recorded signals.
1. Pick parents: current live, paper leaders, best replay-passed.
2. Mutate 1–3 numeric settings by a random step within schema bounds; sometimes add/remove a ladder step; sometimes cross two parents.
3. Replay on train, keep top N, replay on validate, apply §6 gate.
4. Limit: ≤ 200 replays per run, ≤ 20 new drafts per day kept (others discarded but logged).

**Advisor (Gemini)** — daily and on demand.
- Input: compact JSON of version metrics, sensitivity results, exit-reason breakdown, rejected-signal outcomes (what skipped signals did afterwards).
- Output (JSON schema enforced): up to 3 proposed versions with values diff + reason, plus a plain-text summary shown on the Agents page.
- Proposals enter as `draft` with author `advisor`; same gates as optimizer.
- Config: `GEMINI_API_KEY`, `GEMINI_MODEL` (env). On API failure: skip run, log event.

## 8. UI

Tabs: Positions · Logs · Strategies · Agents · Settings (phone tab bar; desktop left nav).

Strategies
```
[Strategies]                         [+ New]
 Early curve   v7 LIVE   paper +0.42  replay +1.1 est
 First call    v3 PAPER  14/30 trades
 Scalp         v12 draft (optimizer)
 ...
→ detail: versions timeline (author, note, stage), diff vs parent,
  metrics by source (replay / paper / live), equity curve, exit reasons,
  sensitivity charts, [Edit → saves vN+1] [Promote] [Retire] [Compare]
```
Agents: on/off per agent, last run, queue of candidates by stage, promotions/rollbacks log with Undo, advisor summary.
Settings: Mode, Telegram folders, RPC, cost model, hard limits (read-only, from env), reset wallet.
Also applies the UI review fixes (docs/ui-review-2026-11-18.md).

## 9. Phases

1. Recording (`signal_paths`, `signal_facts`) + versions schema/migration + Strategies & Settings pages + review fixes. Recording starts collecting data immediately.
2. Replay engine + sensitivity charts.
3. Optimizer + Agents page + promotion through paper (Arena lanes).
4. Gemini advisor.
5. Live engine (phase 7, own design) + live stages of §6.
Deploy to Railway with persistent volume after phase 1 so recording runs 24/7.

## 10. Left to the builder

Component structure, chart library (lightweight, already-used `PriceChart` style preferred), exact mutation step sizes, API route names, test layout (Vitest, pure functions first: replay, gates, mutation, rollback).
