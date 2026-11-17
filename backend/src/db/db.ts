import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Mention, Position, SignalRecord, Trade } from '../types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL, ts INTEGER NOT NULL, snippet TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS mentions_mint ON mentions(mint);
CREATE TABLE IF NOT EXISTS signals (
  mint TEXT PRIMARY KEY, symbol TEXT, first_seen INTEGER NOT NULL, channels TEXT NOT NULL,
  score REAL NOT NULL, decision TEXT NOT NULL, reasons TEXT NOT NULL,
  first_price REAL, decision_price REAL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, symbol TEXT, mode TEXT NOT NULL,
  route TEXT NOT NULL, status TEXT NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER,
  decimals INTEGER NOT NULL, cost_sol REAL NOT NULL, entry_price REAL NOT NULL,
  initial_tokens REAL NOT NULL, tokens_held REAL NOT NULL, realized_sol REAL NOT NULL,
  ladder_done INTEGER NOT NULL, peak_price REAL NOT NULL, last_price REAL NOT NULL,
  last_activity_at INTEGER NOT NULL, close_reason TEXT);
CREATE INDEX IF NOT EXISTS positions_status ON positions(status);
CREATE TABLE IF NOT EXISTS price_ticks (position_id INTEGER NOT NULL, ts INTEGER NOT NULL, price REAL NOT NULL);
CREATE INDEX IF NOT EXISTS price_ticks_pos ON price_ticks(position_id, ts);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL, side TEXT NOT NULL,
  route TEXT NOT NULL, sol REAL NOT NULL, tokens REAL NOT NULL, price REAL NOT NULL,
  fee_sol REAL NOT NULL, impact_pct REAL NOT NULL, slippage_pct REAL NOT NULL,
  latency_ms INTEGER NOT NULL, reason TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL, text TEXT NOT NULL);
`;

export interface ActivityRow { id: number; ts: number; level: 'info' | 'warn' | 'trade'; text: string }

export interface TradeRef { id: number; symbol: string | null; mint: string; pnlSol: number; pnlPct: number; closedAt: number }
export interface AllTimeStats {
  count: number; wins: number; losses: number; winRate: number;
  pnlSol: number; grossWinSol: number; grossLossSol: number; profitFactor: number | null;
  avgWinSol: number; avgLossSol: number; expectancySol: number; avgPnlPct: number;
  biggestWin: TradeRef | null; biggestLoss: TradeRef | null; bestPct: TradeRef | null; worstPct: TradeRef | null;
  longestWinStreak: number; longestLossStreak: number; currentStreak: number;
  /** K = wins, D = losses, A = take-profit ladder steps hit; KDA = (K + A) / max(1, D). */
  kills: number; deaths: number; assists: number; kda: number;
  avgHoldMs: number; maxDrawdownSol: number; firstAt: number | null; lastAt: number | null;
}

/** All-time results from closed positions, oldest first. Exported for tests. */
export function computeStats(rows: { id: number; symbol: string | null; mint: string; cost: number; realized: number; ladder: number; opened: number; closed: number }[]): AllTimeStats {
  let wins = 0, losses = 0, grossWin = 0, grossLoss = 0, pctSum = 0, holdSum = 0, assists = 0;
  let run = 0, bestRun = 0, worstRun = 0, cum = 0, peak = 0, dd = 0;
  let bigW: TradeRef | null = null, bigL: TradeRef | null = null, bestP: TradeRef | null = null, worstP: TradeRef | null = null;
  for (const r of rows) {
    const pnl = r.realized - r.cost;
    const ref: TradeRef = { id: r.id, symbol: r.symbol, mint: r.mint, pnlSol: pnl, pnlPct: r.cost > 0 ? (pnl / r.cost) * 100 : 0, closedAt: r.closed };
    pctSum += ref.pnlPct;
    holdSum += Math.max(0, r.closed - r.opened);
    assists += r.ladder;
    if (pnl > 0) {
      wins++; grossWin += pnl; run = run > 0 ? run + 1 : 1;
    } else {
      losses++; grossLoss += -pnl; run = run < 0 ? run - 1 : -1;
    }
    bestRun = Math.max(bestRun, run);
    worstRun = Math.min(worstRun, run);
    if (!bigW || pnl > bigW.pnlSol) bigW = ref;
    if (!bigL || pnl < bigL.pnlSol) bigL = ref;
    if (!bestP || ref.pnlPct > bestP.pnlPct) bestP = ref;
    if (!worstP || ref.pnlPct < worstP.pnlPct) worstP = ref;
    cum += pnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum);
  }
  const n = rows.length;
  return {
    count: n, wins, losses, winRate: n ? (wins / n) * 100 : 0,
    pnlSol: grossWin - grossLoss, grossWinSol: grossWin, grossLossSol: grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWinSol: wins ? grossWin / wins : 0, avgLossSol: losses ? -grossLoss / losses : 0,
    expectancySol: n ? (grossWin - grossLoss) / n : 0, avgPnlPct: n ? pctSum / n : 0,
    biggestWin: bigW && bigW.pnlSol > 0 ? bigW : null, biggestLoss: bigL && bigL.pnlSol <= 0 ? bigL : null,
    bestPct: bestP, worstPct: worstP,
    longestWinStreak: bestRun, longestLossStreak: -worstRun, currentStreak: run,
    kills: wins, deaths: losses, assists, kda: (wins + assists) / Math.max(1, losses),
    avgHoldMs: n ? holdSum / n : 0, maxDrawdownSol: dd,
    firstAt: n ? rows[0]!.closed : null, lastAt: n ? rows[n - 1]!.closed : null,
  };
}

type Row = Record<string, any>;

const toPosition = (r: Row): Position => ({
  id: r.id, mint: r.mint, symbol: r.symbol, mode: r.mode, route: r.route, status: r.status,
  openedAt: r.opened_at, closedAt: r.closed_at, decimals: r.decimals, costSol: r.cost_sol,
  entryPriceSol: r.entry_price, initialTokens: r.initial_tokens, tokensHeld: r.tokens_held,
  realizedSol: r.realized_sol, ladderDone: r.ladder_done, peakPriceSol: r.peak_price,
  lastPriceSol: r.last_price, lastActivityAt: r.last_activity_at, closeReason: r.close_reason,
  preset: r.preset ?? null,
  lane: r.lane ?? null,
  rules: r.rules ? JSON.parse(r.rules) : null,
});

const toTrade = (r: Row): Trade => ({
  id: r.id, positionId: r.position_id, side: r.side, route: r.route, sol: r.sol, tokens: r.tokens,
  priceSol: r.price, feeSol: r.fee_sol, impactPct: r.impact_pct, slippagePct: r.slippage_pct,
  latencyMs: r.latency_ms, reason: r.reason, ts: r.ts,
});

const toSignal = (r: Row): SignalRecord => ({
  mint: r.mint, symbol: r.symbol, firstSeen: r.first_seen, channels: JSON.parse(r.channels),
  score: r.score, decision: r.decision, reasons: JSON.parse(r.reasons),
  firstPriceSol: r.first_price, decisionPriceSol: r.decision_price, updatedAt: r.updated_at,
});

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode = WAL;');
    this.sql.exec(SCHEMA);
    const cols = (this.sql.prepare('PRAGMA table_info(positions)').all() as Row[]).map((c) => c.name);
    if (!cols.includes('preset')) this.sql.exec('ALTER TABLE positions ADD COLUMN preset TEXT');
    if (!cols.includes('lane')) this.sql.exec('ALTER TABLE positions ADD COLUMN lane TEXT');
    if (!cols.includes('rules')) this.sql.exec('ALTER TABLE positions ADD COLUMN rules TEXT');
  }

  getSetting<T>(key: string): T | undefined {
    const r = this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return r ? (JSON.parse(r.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown) {
    this.sql
      .prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  addMention(m: Mention): number {
    const r = this.sql
      .prepare('INSERT INTO mentions(mint, channel_id, channel_name, ts, snippet) VALUES(?,?,?,?,?)')
      .run(m.mint, m.channelId, m.channelName, m.ts, m.snippet);
    return Number(r.lastInsertRowid);
  }

  recentMentions(limit = 100): Mention[] {
    return (this.sql.prepare('SELECT * FROM mentions ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: r.id, mint: r.mint, channelId: r.channel_id, channelName: r.channel_name, ts: r.ts, snippet: r.snippet,
    }));
  }

  upsertSignal(s: SignalRecord) {
    this.sql
      .prepare(
        `INSERT INTO signals(mint, symbol, first_seen, channels, score, decision, reasons, first_price, decision_price, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(mint) DO UPDATE SET symbol=excluded.symbol, channels=excluded.channels, score=excluded.score,
           decision=excluded.decision, reasons=excluded.reasons, first_price=excluded.first_price,
           decision_price=excluded.decision_price, updated_at=excluded.updated_at`,
      )
      .run(s.mint, s.symbol, s.firstSeen, JSON.stringify(s.channels), s.score, s.decision,
        JSON.stringify(s.reasons), s.firstPriceSol, s.decisionPriceSol, s.updatedAt);
  }

  getSignal(mint: string): SignalRecord | undefined {
    const r = this.sql.prepare('SELECT * FROM signals WHERE mint = ?').get(mint) as Row | undefined;
    return r ? toSignal(r) : undefined;
  }

  recentSignals(limit = 50): SignalRecord[] {
    return (this.sql.prepare('SELECT * FROM signals ORDER BY updated_at DESC LIMIT ?').all(limit) as Row[]).map(toSignal);
  }

  insertPosition(p: Omit<Position, 'id'>): Position {
    const r = this.sql
      .prepare(
        `INSERT INTO positions(mint, symbol, mode, route, status, opened_at, closed_at, decimals, cost_sol, entry_price,
          initial_tokens, tokens_held, realized_sol, ladder_done, peak_price, last_price, last_activity_at, close_reason, preset, lane, rules)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(p.mint, p.symbol, p.mode, p.route, p.status, p.openedAt, p.closedAt, p.decimals, p.costSol, p.entryPriceSol,
        p.initialTokens, p.tokensHeld, p.realizedSol, p.ladderDone, p.peakPriceSol, p.lastPriceSol, p.lastActivityAt,
        p.closeReason, p.preset, p.lane, p.rules ? JSON.stringify(p.rules) : null);
    return { ...p, id: Number(r.lastInsertRowid) };
  }

  updatePosition(p: Position) {
    this.sql
      .prepare(
        `UPDATE positions SET route=?, status=?, closed_at=?, tokens_held=?, realized_sol=?, ladder_done=?,
          peak_price=?, last_price=?, last_activity_at=?, close_reason=?, symbol=? WHERE id=?`,
      )
      .run(p.route, p.status, p.closedAt, p.tokensHeld, p.realizedSol, p.ladderDone, p.peakPriceSol, p.lastPriceSol,
        p.lastActivityAt, p.closeReason, p.symbol, p.id);
  }

  updateRules(id: number, rules: Position['rules']) {
    this.sql.prepare('UPDATE positions SET rules = ? WHERE id = ?').run(JSON.stringify(rules), id);
  }

  openPositions(): Position[] {
    return (this.sql.prepare("SELECT * FROM positions WHERE status = 'open' ORDER BY id").all() as Row[]).map(toPosition);
  }

  /** Newest position (any status) for a mint, or undefined if it was never bought. */
  latestPositionFor(mint: string): Position | undefined {
    const r = this.sql.prepare('SELECT * FROM positions WHERE mint = ? ORDER BY id DESC LIMIT 1').get(mint) as Row | undefined;
    return r ? toPosition(r) : undefined;
  }

  position(id: number): Position | undefined {
    const r = this.sql.prepare('SELECT * FROM positions WHERE id = ?').get(id) as Row | undefined;
    return r ? toPosition(r) : undefined;
  }

  addTick(positionId: number, ts: number, price: number) {
    this.sql.prepare('INSERT INTO price_ticks(position_id, ts, price) VALUES(?,?,?)').run(positionId, ts, price);
  }

  ticks(positionId: number): { ts: number; price: number }[] {
    return this.sql.prepare('SELECT ts, price FROM price_ticks WHERE position_id = ? ORDER BY ts').all(positionId) as { ts: number; price: number }[];
  }

  tradesFor(positionId: number): Trade[] {
    return (this.sql.prepare('SELECT * FROM trades WHERE position_id = ? ORDER BY ts').all(positionId) as Row[]).map(toTrade);
  }

  closedPositions(limit = 50): Position[] {
    return (
      this.sql.prepare("SELECT * FROM positions WHERE status = 'closed' ORDER BY closed_at DESC LIMIT ?").all(limit) as Row[]
    ).map(toPosition);
  }

  /** `lane` undefined = all lanes; null = main strategy only; string = that arena lane. */
  realizedSince(ts: number, mode: string, lane?: string | null): { pnl: number; wins: number; count: number } {
    const laneSql = lane === undefined ? '' : lane === null ? ' AND lane IS NULL' : ' AND lane = ?';
    const args: (string | number)[] = lane ? [ts, mode, lane] : [ts, mode];
    const r = this.sql
      .prepare(
        `SELECT COALESCE(SUM(realized_sol - cost_sol), 0) AS pnl, COUNT(*) AS count,
          COALESCE(SUM(CASE WHEN realized_sol > cost_sol THEN 1 ELSE 0 END), 0) AS wins
         FROM positions WHERE status = 'closed' AND closed_at >= ? AND mode = ?${laneSql}`,
      )
      .get(...args) as Row;
    return { pnl: r.pnl, wins: r.wins, count: r.count };
  }

  /** Closed-trade results per preset (null preset = custom settings). */
  statsByPreset(mode: string): { preset: string | null; count: number; wins: number; pnl: number; avgPnlPct: number }[] {
    return (
      this.sql
        .prepare(
          `SELECT preset, COUNT(*) AS count, SUM(CASE WHEN realized_sol > cost_sol THEN 1 ELSE 0 END) AS wins,
             SUM(realized_sol - cost_sol) AS pnl, AVG((realized_sol / cost_sol - 1) * 100) AS avgPnlPct
           FROM positions WHERE status = 'closed' AND mode = ? GROUP BY preset ORDER BY count DESC`,
        )
        .all(mode) as Row[]
    ).map((r) => ({ preset: r.preset, count: r.count, wins: r.wins, pnl: r.pnl, avgPnlPct: r.avgPnlPct }));
  }

  /** Closed-trade results per arena lane. */
  statsByLane(mode: string): { id: string; count: number; wins: number; pnl: number; avgPnlPct: number; worstPct: number; avgPeakPct: number }[] {
    return (
      this.sql
        .prepare(
          `SELECT lane AS id, COUNT(*) AS count, SUM(CASE WHEN realized_sol > cost_sol THEN 1 ELSE 0 END) AS wins,
             SUM(realized_sol - cost_sol) AS pnl, AVG((realized_sol / cost_sol - 1) * 100) AS avgPnlPct,
             MIN((realized_sol / cost_sol - 1) * 100) AS worstPct, AVG((peak_price / entry_price - 1) * 100) AS avgPeakPct
           FROM positions WHERE status = 'closed' AND mode = ? AND lane IS NOT NULL GROUP BY lane`,
        )
        .all(mode) as Row[]
    ).map((r) => ({ id: r.id, count: r.count, wins: r.wins, pnl: r.pnl, avgPnlPct: r.avgPnlPct, worstPct: r.worstPct, avgPeakPct: r.avgPeakPct }));
  }

  /** All-time stats over closed positions of a mode, every lane included. */
  allTimeStats(mode: string): AllTimeStats {
    const rows = this.sql
      .prepare(
        `SELECT id, symbol, mint, cost_sol AS cost, realized_sol AS realized, ladder_done AS ladder,
           opened_at AS opened, closed_at AS closed
         FROM positions WHERE status = 'closed' AND mode = ? ORDER BY closed_at, id`,
      )
      .all(mode) as Parameters<typeof computeStats>[0];
    return computeStats(rows);
  }

  addActivity(ts: number, level: string, text: string): number {
    return Number(this.sql.prepare('INSERT INTO activity(ts, level, text) VALUES(?,?,?)').run(ts, level, text).lastInsertRowid);
  }

  /** Activity newest first; `before` pages back by id; `q` filters by text. */
  activity(opts: { before?: number; limit?: number; q?: string; level?: string } = {}): ActivityRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.before) { where.push('id < ?'); args.push(opts.before); }
    if (opts.q) { where.push("text LIKE ? ESCAPE '\\'"); args.push(`%${opts.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }
    if (opts.level) { where.push('level = ?'); args.push(opts.level); }
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const sql = `SELECT id, ts, level, text FROM activity${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    return this.sql.prepare(sql).all(...args, limit) as unknown as ActivityRow[];
  }

  activityCount(): number {
    return (this.sql.prepare('SELECT COUNT(*) AS n FROM activity').get() as Row).n;
  }

  addTrade(t: Trade): number {
    const r = this.sql
      .prepare(
        `INSERT INTO trades(position_id, side, route, sol, tokens, price, fee_sol, impact_pct, slippage_pct, latency_ms, reason, ts)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(t.positionId, t.side, t.route, t.sol, t.tokens, t.priceSol, t.feeSol, t.impactPct, t.slippagePct,
        t.latencyMs, t.reason, t.ts);
    return Number(r.lastInsertRowid);
  }

  recentTrades(limit = 50): Trade[] {
    return (this.sql.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(toTrade);
  }

  /** Paper reset: wipe positions and trades of a mode. */
  clearMode(mode: string) {
    this.sql.prepare('DELETE FROM trades WHERE position_id IN (SELECT id FROM positions WHERE mode = ?)').run(mode);
    this.sql.prepare('DELETE FROM price_ticks WHERE position_id IN (SELECT id FROM positions WHERE mode = ?)').run(mode);
    this.sql.prepare('DELETE FROM positions WHERE mode = ?').run(mode);
  }
}
