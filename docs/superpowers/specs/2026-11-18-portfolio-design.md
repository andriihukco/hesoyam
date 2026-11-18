# Portfolio, post-exit price tracking, Settings sub-pages — design

Status: approved 2026-11-18.

## Intent
See the whole portfolio over time (not only closed trades) and judge every exit by what the coin did after it.

## Facts (local DB, 2026-11-18)
- `price_ticks` exist only while a position is open (156 ticks, 4 positions, 40 s–2.5 min each).
- No wallet / equity history is stored; unrealized PnL over time is lost.

## Design
1. **Post-exit tracking.** After a position closes, keep following its mint and write ticks into `price_ticks` for that position.
   Stop at the first of: 24 h after close; rugged = price ≤ 10 % of max(price at exit, highest price since exit); 30 min with no price update.
   Curve tokens: existing feed subscription. Graduated: Jupiter quote every 60 s, skipped during the Jupiter 429 cooldown.
   Survives restart: followed set rebuilt from closed positions with `closed_at` < 24 h and no `follow_end` reason.
   Positions gain `follow_until` (ts) and `follow_end` (text: `24h` | `rugged` | `stale`).
2. **Equity snapshots.** Table `equity_snapshots(ts, mode, cash_sol, open_sol, total_sol)`, written every 5 min and on every close. Arena: sum of lane wallets (same as header).
3. **API.** `GET /api/portfolio?range=1d|7d|30d|all` → `{ equity[], drawdown[], daily[] (UTC day pnl, count, wins), byVersion[], byRoute[], byExit[], stats }`. `GET /api/positions/:id` also returns `closedAt`, `followEnd`, post-exit peak/low.
4. **Portfolio page (5th tab).** Range switch; equity chart with drawdown; daily PnL bars; stat tiles (PnL, win rate, profit factor, expectancy, max DD); per-strategy table; closed trades list with filters (strategy, outcome) → position sheet.
5. **Position chart.** Solid line while held, dashed after exit; buy/sell markers; labels "peak after exit +X %", "rugged after Y min" / "tracking".
6. **Settings sub-pages.** Settings shows a list (Mode, Telegram, RPC, Costs, Security, Hard limits, Danger zone); each opens its own page with a back link.

## Approaches considered
- Rebuild equity from trades only — rejected: misses unrealized value.
- External chart service — rejected: cost, does not know our trades.
- **Chosen:** snapshots + post-exit ticks in our own SQLite.

## Non-goals
Wallet ranking, discovery feeds, snipers, indicators, CEX trading (later projects).

## Trade-off
A few more curve subscriptions and Jupiter polls per closed trade (~4/day today).
