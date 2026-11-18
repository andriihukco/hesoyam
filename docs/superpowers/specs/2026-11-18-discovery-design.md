# Discovery: new pairs, about-to-graduate, graduated, trending — design

Status: approved 2026-11-18 (all defaults).

## Facts (tested 2026-11-18)
- PumpPortal free socket accepts `subscribeNewToken` and `subscribeMigration` without a key. A create event carries `mint, traderPublicKey (dev), initialBuy, solAmount, bondingCurveKey, vTokensInBondingCurve, vSolInBondingCurve, marketCapSol, name, symbol, uri, pool`. 1 create in a 20 s sample.
- DexScreener `/tokens/v1/solana/{≤30 mints}` (~300 req/min) gives price, market cap, volume, txns, liquidity, socials. `/token-boosts/top/v1` = paid promotions (25 of 30 on Solana).
- Live trades for every token need a funded PumpPortal key; holder counts need Helius. Not used.

## Decisions
1. Free sources only; boards refresh every 15 s (not tick by tick).
2. Boards: **New** (curve, < 30 % bonded), **About to graduate** (curve, ≥ 70 % bonded), **Graduated** (migrated < 24 h), plus **Trending** (own score) and **Promoted** (paid boosts, labelled, never in Trending).
3. View only; no buying from Discovery (Snipers project later). Strategy signals stay Telegram / X.
4. Keep discovered tokens 24 h (memory cap 2,000; SQLite table for restart and later replay).

## Design
- `backend/src/discovery/`: `score.ts` (pure: bonding %, board, trend score, filters), `store.ts` (tokens in memory + `discovered_tokens` table), `feed.ts` (free PumpPortal socket, 15 s refresher: curve accounts via `getMultipleAccountsInfo` in batches of 100, DexScreener in batches of 30, promoted list every 2 min).
- Bonding % = (1 − realTokenReserves / 793.1 M tokens) × 100, clamped 0–100; `complete` → 100.
- Trend score (0–100): volume 5 m (log-scaled), buy/sell ratio, txns 5 m, price change 5 m; × 0.5 when age < 5 min or liquidity < $5 k; tokens with < 10 txns in 5 m score 0.
- API `GET /api/discovery?board=new|soon|graduated|trending|promoted&minMc&maxMc&maxAgeMin&socials=1&maxDevPct` → up to 60 cards. UI polls every 5 s while the page is open.
- UI: Discovery tab. Desktop: three board columns + Trending/Promoted switch; phone: segmented board switch. Card: symbol/name, age, market cap, 5 m volume, txns (buys/sells), bonding %, dev buy %, social icons, our risk result if the bot evaluated it. Tap → existing coin sheet.

## Non-goals
Buying, wallet tracking, holder counts per card, paid data.
