# Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Live boards of new, about-to-graduate, graduated, trending and promoted Pump.fun tokens from free sources.
**Architecture:** Pure scoring module, an in-memory + SQLite token store, a feed (free PumpPortal socket + 15 s curve/DexScreener refresh), one API route, one UI page polling it.
**Tech Stack:** TypeScript, ws, @solana/web3.js, node:sqlite, Vitest; React.
**Spec:** `docs/superpowers/specs/2026-11-18-discovery-design.md`

## Global Constraints
- Free sources only. Refresh 15 s; at most 300 tokens per refresh; curve batch 100; DexScreener batch 30; promoted every 120 s.
- Board rules: new = not migrated and bonding < 30; soon = not migrated and bonding ≥ 70; graduated = migrated within 24 h. Keep 24 h, memory cap 2,000 (drop oldest).
- Promoted tokens are labelled "Promoted" and never appear in Trending.
- No buying from Discovery.

## Review Focus
1. PumpPortal free socket drops → reconnects and re-subscribes → Task 3 test `resubscribes after reconnect`.
2. DexScreener returns several pairs per token → use the most liquid → Task 3 test `picks the most liquid pair`.
3. Custom-reserve curves give odd progress → clamp 0–100 → Task 1 test `bonding clamps`.
4. Cap and 24 h expiry never drop a token that is on a board right now before older ones → Task 2 test `cap drops oldest first`.
5. Empty boards on a fresh start render an empty state, not an error → Task 4 manual check.

### Task 1: Scoring (`backend/src/discovery/score.ts`, test `backend/test/discoveryScore.test.ts`)
Produces: `bondingPct(c: { realTokenReserves: bigint; complete: boolean }): number`; `boardOf(t: DiscoveredToken, now: number): 'new' | 'soon' | 'mid' | 'graduated' | 'old'`; `trendScore(t: DiscoveredToken, now: number): number`; `passes(t, f: DiscoveryFilter, now): boolean`; types `DiscoveredToken`, `DiscoveryFilter` (minMc, maxMc USD; maxAgeMin; socials; maxDevPct).
Tests: bonding 0 / 50 / 100 / clamps; boards by bonding and migration age; trend score orders an active token above a quiet one, halves young tokens, 0 below 10 txns; filters.

### Task 2: Store (`backend/src/discovery/store.ts`, `db.ts` table `discovered_tokens`, test `backend/test/discoveryStore.test.ts`)
Produces: `class DiscoveryStore(db, now)` with `addCreated(ev)`, `markMigrated(mint, ts)`, `applyCurve(mint, pct, realSol)`, `applyMarket(mint, m)`, `setPromoted(mints)`, `refreshCandidates(limit): string[]`, `list(board, filter, limit): DiscoveredToken[]`, `prune()`, `load()`.
Tests: add/list round trip, migration moves to graduated, cap drops oldest first, prune 24 h, load after restart, refreshCandidates prefers recent + active.

### Task 3: Feed (`backend/src/discovery/feed.ts`, test `backend/test/discoveryFeed.test.ts`)
Produces: `parseCreate(m)`, `parseMigration(m)`, `pickPair(pairs)`, `class DiscoveryFeed(store, deps: { socket factory, getAccounts(pubkeys), fetchJson, now })` with `start()`, `stop()`, `refresh()`.
Tests: parse create/migration, picks the most liquid pair, resubscribes after reconnect, refresh batches (≤ 100 curve, ≤ 30 dex).

### Task 4: API + UI
`bot.discovery(query)`; route `GET /api/discovery`. Frontend `pages/Discovery.tsx`, `components/TokenCard.tsx`, tab `discovery`. Verify in pane on the live free feed (Telegram off).

### Task 5: Review, merge, deploy
Fresh reviewer; fix Critical/Important test-first; push `main`; wait for Railway status.
