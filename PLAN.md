# 1mbot — Build Plan

Telegram alpha-signal scraper + Solana (Pump.fun / Raydium) trading bot with a web dashboard.
Paper trading first; live trading only after paper results justify it.

Status: **approved 2026-11-08 (all defaults in §8 accepted). Phases 0–5 built; phase 6 (paper soak) next.**

Next: strategies, replay and self-improving agents — design `docs/superpowers/specs/2026-11-18-strategies-agents-design.md`; phase 1 (signal recording, strategy versions, Strategies & Settings pages) in `docs/superpowers/plans/2026-11-18-phase1-strategies-recording.md`.

## Run

```
cp .env.example .env         # fill in Telegram + optional paid RPC
npm install
npm run tg:login             # once, interactive; paste printed TG_SESSION into .env
npm run dev                  # API :8787 + UI :5173 (hot reload)
npm start                    # or: build UI and serve everything on :8787
npm test                     # backend + frontend unit tests
```

## Findings during build (2026-11-08, verified against mainnet)

| Finding | Evidence | What was done |
|---|---|---|
| PumpPortal free socket rejects `subscribeTokenTrade` | Server reply: method needs an API key funded with ≥ 0.02 SOL | Default trade feed = RPC `accountSubscribe` on each bonding-curve account (free). PumpPortal used only if `PUMPPORTAL_API_KEY` is set |
| Public RPC returns 429 on `getTokenLargestAccounts` | Every holder check failed on api.mainnet-beta | Fail fast on 429; fall back to RugCheck holder list with the same PDA-exclusion rule; fails closed if both fail. **For the soak, use a paid RPC** |
| Some new curves launch with custom virtual reserves (e.g. 899.7 SOL instead of 30) and 0 real SOL | On-chain curve of `8fec…oZnC` | Paper sell no longer capped by real SOL reserve (was returning 0); regression test added |
| Exact −20% did not trigger the hard stop | Float: 0.8/1−1 = −0.19999… | Epsilon on all exit thresholds |
| Pump.fun fee | Not verified; set to 100 bps | Configurable `pumpFeeBps`; check current fee before the soak |
| Jupiter `lite-api.jup.ag` | Endpoint used for graduated tokens; not exercised in the e2e test (all test tokens were on the curve) | Verify with a graduated token during the soak |

## First paper results (2026-11-08, 14 trades, custom settings 3 ch / 120 s)

3/14 wins, −0.209 SOL (avg −15% per trade). 13/14 were graduated (Jupiter) tokens.

| Finding | Evidence | What was done |
|---|---|---|
| Hard stops filled far below −20% | Stop exits averaged about −33%; worst −75% (SEAL) | Graduated price poll 5 s → 3 s; poll write-back race fixed |
| Blind positions | #14 had no price for 181 s, then sold at −65% via the stagnation rule | New `markStaleSec` (default 20 s): sell when quotes keep failing |
| Late re-shill entries | 7/14 bought more than 5 min after first call (up to 108 min), +60 to +358% above first price | New gates: `maxSignalAgeSec`, `maxRunupFromFirstPct`, `routes`. In this sample the two big winners were also late, so 14 trades do not prove these gates help |
| Score is saturated | Every buy scored 100, so `minScore` filters nothing | Not changed yet |
| Presets | — | 5 built-in presets (hypotheses) + saved user presets; each position records its preset; win rate and PnL shown per preset |

## Arena mode (2026-11-08)

All presets (built-in + saved, max 8) paper-trade the same signals at the same time, each with its own 10 SOL wallet,
channel window, entry gates, risk thresholds, exits and limits. Network checks (mint, holders, RugCheck, DexScreener,
route) are cached per token, so lanes do not multiply API calls. Ranked by total PnL; a lane qualifies after 30 closed
trades. Optional auto-select applies the leader as the main strategy after it leads for 24 h. While Arena is on, the main
strategy opens no new positions. Rotation over time was rejected: lanes tested in different hours see different markets.

| Finding | Evidence | What was done |
|---|---|---|
| Jupiter lite-api 429 on price polls | 15:28: first Arena position got "429" within 6 s; the no-price rule would have sold it | One quote per token per poll (shared by lanes); 15 s back-off on 429 with DexScreener spot price as the fallback mark |
| Few signals qualify | 11.3 h of mentions: 119 tokens; ≥2 channels within 60 s: 45; ≥3 within 120 s: 21 | Expected rate is a few evaluations per hour; ~30 trades per lane takes days |
| Position charts need history | Only fills were stored | `price_ticks` table (a point every 5 s or on a 1% move, plus every fill); each position also stores the exit rules it opened with, so charts never show today's rules on old trades |
| Telegram push updates stop silently | 14:59–15:16: channels had new messages, bot got none, status still "listening" | Poll each chat for messages newer than the last handled id every 20 s; dedupe by message id; header shows time of last message |

End-to-end check run: fresh pump.fun tokens → inject → validation → risk → paper buy (0.1 SOL, ~1.3% impact, ~470 ms latency) → stagnation exit. Telegram listener not tested (no credentials yet).

---

## 1. Goal (as understood)

1. Read private alpha channels from a Telegram folder link with a user session (MTProto).
2. Extract Solana mint addresses, score them (cross-channel mentions, rug checks, momentum).
3. Buy only signals that pass; manage each position with a laddered exit engine.
4. Run in **Paper** mode against live market data, or **Live** mode with a real wallet.
5. Control and observe everything from a web dashboard (mode, kill switch, positions, config).

---

## 2. Review of the spec (issues to resolve)

| # | Issue | Evidence | Proposed resolution |
|---|---|---|---|
| 1 | Holder threshold contradicts itself | Scope says "top holders < 20%", risk section says "reject top 10 > 30%" | One config value `maxTop10HolderPct`, default **30**, excluding the bonding-curve / pool account (otherwise every Pump.fun token fails) |
| 2 | `wss://pumpswap.com/api/ws` is not a known PumpPortal endpoint | PumpPortal's documented WS is `wss://pumpportal.fun/api/data` | Use `wss://pumpportal.fun/api/data` only; make URL configurable |
| 3 | Multi-mention filter costs entry speed | 2+ channels within 30 s means buying seconds to tens of seconds after the first call; on Pump.fun that is often after the pump | Keep it (it is the main spam filter), but log "would-have-bought on first mention" in paper mode so the cost is measurable |
| 4 | Regex matches far more than mints | `[1-9A-HJ-NP-Za-km-z]{32,44}` also matches wallet addresses, tx signatures (87–88 chars, partial), random base58 | Decode with `PublicKey`, then `getAccountInfo` → must be owned by SPL Token / Token-2022 program and be a Mint account; cache results |
| 5 | "Real market conditions" in paper mode is limited | Public RPC is rate-limited (~10–40 req/s, 429s common) and has no landing/priority-fee reality | Paper fills = bonding-curve math (Pump.fun) or Jupiter `/quote` (Raydium) + modelled fee + measured latency. State clearly it does **not** model failed/dropped tx or MEV |
| 6 | "Graduated to Raydium" is outdated for new tokens | Pump.fun now graduates to PumpSwap (its own AMM), not Raydium | Route = bonding curve (PumpPortal) vs. anything else (Jupiter, which covers PumpSwap + Raydium) |
| 7 | Telegram user-bot risk | Automated user accounts get flagged/limited; auto-joining many channels triggers FloodWait | Use a dedicated Telegram account; respect FloodWait; join slowly; read-only (never post) |
| 8 | Live mode = real money, irreversible | Bugs in exit logic or kill switch lose funds | Live mode behind: separate hot wallet with capped balance, per-trade and per-day SOL caps, kill switch that also blocks new buys, explicit enable flag in env (not just a UI toggle) |
| 9 | Spec is cut off | Ends at "Required Workspace Structure" with no content | Proposed structure in §4; confirm or send the missing part |
| 10 | TP slider vs. ladder | Config asks for one "Target Take-Profit %", exits define a 2-step ladder | Config exposes the ladder: list of `{roiPct, sellPct}` + trailing %, hard SL %, stagnation timeout |

Not a trading/financial recommendation: whether this strategy is profitable is unknown; paper mode exists to measure it.

---

## 3. Recommended stack (one language: TypeScript)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js (v26 installed) + TypeScript, npm workspaces (pnpm not installed) | GramJS, web3.js, Jupiter and PumpPortal all have first-class JS support; one language for backend + UI |
| Telegram | `telegram` (GramJS), StringSession | Supports folder links (`chatlists.checkChatlistInvite` / `joinChatlistInvite`) |
| Solana | `@solana/web3.js`, `@solana/spl-token` | Sign/broadcast, mint + holder checks |
| Routing | PumpPortal (`/api/trade-local` → sign locally) for bonding curve; Jupiter Swap API for graduated | Keys never leave the machine |
| MEV | Jito block-engine `sendBundle` with tip transfer | Live mode only |
| Risk data | On-chain checks first (mint/freeze authority, top holders via `getTokenLargestAccounts`), RugCheck API as a second opinion | Do not depend on one external API |
| Server | Fastify + WebSocket (`@fastify/websocket`) | Small, fast, push events to UI |
| Storage | SQLite (`better-sqlite3`) | Signals, trades, positions, config; zero ops |
| UI | React + Vite + Tailwind | Lightweight dashboard |
| Tests | Vitest | Unit tests for parser, scorer, exit engine, fill math |

Trade-off: Python (Telethon/solders) has a stronger quant ecosystem, but two languages double setup and the spec allows either.

---

## 4. Proposed workspace structure

```
1mbot/
├── PLAN.md
├── .env.example                # all secrets as env vars; .env is git-ignored
├── package.json / pnpm-workspace.yaml
├── backend/
│   └── src/
│       ├── index.ts            # boot, wiring, graceful shutdown
│       ├── config/             # zod-validated env + runtime strategy config
│       ├── telegram/           # client.ts, folder.ts, listener.ts, extract.ts
│       ├── signals/            # aggregator.ts (cross-channel window), scorer.ts
│       ├── risk/               # mintCheck.ts, holders.ts, rugcheck.ts, momentum.ts
│       ├── market/             # pumpportalWs.ts, bondingCurve.ts, jupiterQuote.ts, priceFeed.ts
│       ├── trading/
│       │   ├── router.ts       # bonding curve vs. Jupiter
│       │   ├── paper.ts        # virtual wallet (10 SOL), simulated fills
│       │   ├── live.ts         # sign + send, Jito bundle
│       │   ├── exitEngine.ts   # ladder, trailing SL, hard SL, stagnation dump
│       │   └── guards.ts       # caps, kill switch, max open positions
│       ├── db/                 # schema.sql, repo.ts
│       └── api/                # REST + WS for the dashboard
│   └── test/
└── frontend/
    └── src/
        ├── components/Header.tsx        # mode, balance, ping, kill switch
        ├── components/AlphaLog.tsx      # signal stream + scores
        ├── components/Positions.tsx     # ROI, PnL, ladder status, panic sell
        ├── components/StrategyConfig.tsx
        └── lib/ws.ts
```

---

## 5. Data flow

```
Telegram msg ─▶ extract CAs ─▶ validate mint (on-chain, cached)
            ─▶ aggregator (unique channels in 30 s window)
            ─▶ risk checks (mint/freeze auth off, top10 ≤ N%, LP / curve state, momentum)
            ─▶ score ≥ threshold? ─▶ guards (kill switch, caps, open-position limit, no duplicate)
            ─▶ router ─▶ paper | live executor ─▶ position
position ◀── price feed (PumpPortal WS trades / Jupiter quote poll) ──▶ exit engine ─▶ sell
everything ─▶ SQLite + WS event bus ─▶ dashboard
```

Default exit ladder (all configurable):
- Sell 50% at +50% ROI, 25% at +100% ROI.
- Remainder: trailing stop 15% from peak.
- Hard stop at −20% (checked on every tick, before ladder).
- Stagnation: no trades for 3 min → sell all.

---

## 6. Phases

Each phase ends with something runnable and tested.

| Phase | Deliverable | Done when |
|---|---|---|
| 0. Scaffold | pnpm workspace, TS, lint, Vitest, `.env.example`, SQLite schema | `pnpm test` and `pnpm dev` run |
| 1. Telegram | Login script → StringSession; resolve folder link; listen; extract + validate mints | Live messages from a real folder show as validated CAs in the console/DB |
| 2. Signals + risk | Cross-channel aggregator, on-chain checks, RugCheck, score | Unit tests for window + scoring; real CAs get pass/fail with reasons |
| 3. Market data | PumpPortal WS subscriptions, bonding-curve price math, Jupiter quotes | Price for a tracked token updates live; matches pump.fun within tolerance |
| 4. Paper engine + exits | Virtual wallet, fills with impact/fee/latency, exit engine | Exit engine unit tests (ladder, trailing, hard SL, stagnation); end-to-end paper trades from real signals |
| 5. Dashboard | Header, alpha log, positions, config, kill switch, panic sell | All controls work against paper engine |
| 6. Paper soak | Run 3–7 days, report win rate, PnL, would-have-bought-first-mention comparison | Report reviewed by you → decide on live |
| 7. Live engine | PumpPortal local tx + Jupiter swap, Jito tips, caps, env gate | Tested with tiny size (e.g. 0.01 SOL) on mainnet with a fresh hot wallet |

Live trading is not started until you approve it after Phase 6.

---

## 7. Security rules

- Secrets only in `.env` (git-ignored): Telegram `api_id`/`api_hash`/session string, wallet private key, RPC URLs with keys.
- Wallet key loaded in backend only; never sent to the frontend or logs.
- Dashboard binds to `127.0.0.1` by default; if exposed, require a token.
- Live mode requires `LIVE_TRADING_ENABLED=true` in env **and** the UI toggle.

---

## 8. Decisions (all defaults accepted 2026-11-08)

Notes: `@solana/web3.js` pinned to 1.98.x (stable `Connection`/`PublicKey` API; `latest` is 3.x with a different API).

Original questions, default in brackets:

1. **Missing part of the spec**: the text stops at "Required Workspace Structure". Use the structure in §4? *(Yes.)*
2. **Language**: TypeScript for everything? *(Yes, TypeScript.)*
3. **Top-10 holder limit**: 20% or 30%, excluding curve/pool accounts? *(30%.)*
4. **Telegram account**: do you have a dedicated account and `api_id`/`api_hash` from my.telegram.org? *(Use a dedicated account, not your main one.)*
5. **Scope of this first build**: Phases 0–5 (paper only), live engine later? *(Yes, paper first.)*
