import { EventEmitter } from 'node:events';
import { env } from './config/env.js';
import {
  BUILT_IN_PRESETS, DEFAULT_STRATEGY, STARTING_PAPER_SOL, StrategySchema, presetValues, type Preset, type Strategy,
} from './config/strategy.js';
import type { Db } from './db/db.js';
import { Rpc } from './lib/rpc.js';
import { errMsg, fetchJson, log, memo, startOfUtcDay } from './lib/util.js';
import { StrategyStore } from './strategies/store.js';
import { resolveMain } from './strategies/main.js';
import type { PresetValues } from './config/strategy.js';
import { LAMPORTS } from './market/pump.js';
import { PriceFeed } from './market/priceFeed.js';
import { PumpPortalWs } from './market/pumpportalWs.js';
import { CurveWatcher } from './market/curveWatcher.js';
import { MarketQuoter } from './market/quoter.js';
import { dexPriceSol } from './market/dexPrice.js';
import { authorityChecks, holderCheck, holderTop10, loadMint, rugcheck, rugcheckSummary } from './risk/checks.js';
import { SignalRecorder, canUntrack } from './recording/recorder.js';
import { captureFacts } from './recording/facts.js';
import { PostExitFollower } from './recording/follower.js';
import { PublicKey } from '@solana/web3.js';
import { DiscoveryStore, type DiscoveryBoard } from './discovery/store.js';
import { DiscoveryFeed, nativeSocket } from './discovery/feed.js';
import { boardOf, trendScore, type DiscoveryFilter } from './discovery/score.js';
import { RANGES, buildPortfolio, rangeStart, snapshotFrom, type Range } from './portfolio/portfolio.js';
import { momentum } from './risk/momentum.js';
import { analyzeHolders, heliusKey } from './holders/analyzer.js';
import { summarize } from './holders/summary.js';
import type { HolderReport } from './holders/score.js';
import { SignalAggregator, countableChannels } from './signals/aggregator.js';
import { XSource } from './social/xSource.js';
import { ThreadsSource } from './social/threadsSource.js';
import { score } from './signals/scorer.js';
import { entryChecks } from './signals/entry.js';
import { extractCandidates, snippet } from './telegram/extract.js';
import { MintValidator } from './telegram/mintValidator.js';
import { TelegramScraper, type TgMessage } from './telegram/client.js';
import { evaluateExit, type ExitAction } from './trading/exitEngine.js';
import { buyBlocked } from './trading/guards.js';
import { ATA_RENT_SOL, BASE_FEE_SOL, PaperExecutor } from './trading/paper.js';
import { ARENA_MAX_LANES, ARENA_MIN_TRADES, DEFAULT_ARENA, leaderStep, rankLanes, type ArenaState } from './trading/arena.js';
import type { CheckResult, Decision, Mode, Position, SignalRecord } from './types.js';

type EvalState = 'running' | 'bought' | 'hard' | 'soft';

/** A strategy that trades with its own wallet. id null = the main strategy; otherwise an arena preset. */
interface Lane {
  id: string | null;
  name: string;
  strategy: Strategy;
  paper: PaperExecutor;
  /** Strategy version new positions of this lane are stamped with. */
  versionId: number | null;
}

interface Outcome {
  decision: 'buy' | 'reject' | 'skipped' | 'error';
  score: number;
  reasons: CheckResult[];
  failed: CheckResult[];
  symbol?: string | null;
  decisionPriceSol?: number;
}

const DECISION_RANK: Record<string, number> = { buy: 4, skipped: 3, reject: 2, error: 1 };

/** A Telegram message seen in a watched chat (memory only, not written to disk). */
export interface ChatLine {
  id: number;
  ts: number;
  channelName: string;
  folder: string | null;
  text: string;
  /** Address-like strings found in the message and what they turned out to be. */
  cas: { address: string; status: 'checking' | 'mint' | 'not-mint' | 'error' }[];
}

interface ActivityLine {
  id?: number;
  ts: number;
  level: 'info' | 'warn' | 'trade';
  text: string;
}

export class Bot extends EventEmitter {
  strategy: Strategy;
  mode: Mode = 'paper';
  killSwitch: boolean;
  readonly rpc: Rpc;
  readonly ws: PumpPortalWs | null;
  readonly feed: PriceFeed;
  readonly quoter: MarketQuoter;
  readonly tg: TelegramScraper;
  readonly x: XSource;
  readonly threads: ThreadsSource;
  readonly paper: PaperExecutor;
  private validator: MintValidator;
  private aggregator: SignalAggregator;
  private evalState = new Map<string, EvalState>();
  private mintProgram = new Map<string, string>();
  private lastMentionAt = new Map<string, number>();
  private busy = new Set<number>();
  private retryAt = new Map<number, number>();
  /** Position id -> last successful mark-to-market quote (graduated tokens). */
  private markOkAt = new Map<number, number>();
  private jupCooldownUntil = 0;
  /** Position id -> last stored chart point (to thin the price history). */
  private lastTick = new Map<number, { ts: number; price: number }>();
  private timers: NodeJS.Timeout[] = [];
  arena: ArenaState;
  private laneWallets = new Map<string, PaperExecutor>();
  activity: ActivityLine[] = [];
  chats: ChatLine[] = [];
  private chatSeq = 0;
  readonly store: StrategyStore;
  readonly recorder: SignalRecorder;
  readonly follower: PostExitFollower;
  readonly discoveryStore: DiscoveryStore;
  readonly discovery: DiscoveryFeed;

  constructor(private db: Db) {
    super();
    this.store = new StrategyStore(db);
    this.store.ensureBuiltIns(BUILT_IN_PRESETS);
    this.store.migrateSavedPresets(db.getSetting<Preset[]>('presets') ?? []);
    this.store.backfillPositionVersions();
    this.activity = db.activity({ limit: 200 });
    const saved = db.getSetting<Partial<Strategy>>('strategy');
    const merged = StrategySchema.safeParse({ ...DEFAULT_STRATEGY, ...saved });
    this.strategy = merged.success ? merged.data : DEFAULT_STRATEGY;
    this.killSwitch = db.getSetting<boolean>('killSwitch') ?? false;
    this.arena = { ...DEFAULT_ARENA, ...db.getSetting<Partial<ArenaState>>('arena') };

    this.rpc = new Rpc(env.rpcEndpoints, this.strategy.rpc);
    this.strategy.rpc = this.rpc.name;
    if (env.PUMPPORTAL_API_KEY) {
      this.ws = new PumpPortalWs(`${env.PUMPPORTAL_WS_URL}?api-key=${encodeURIComponent(env.PUMPPORTAL_API_KEY)}`);
      this.ws.on('notice', (m: string) => this.note('warn', `PumpPortal: ${m}`));
      this.feed = new PriceFeed(this.ws, 'pumpportal');
    } else {
      this.ws = null;
      this.feed = new PriceFeed(new CurveWatcher(this.rpc), 'rpc-curve');
    }
    this.quoter = new MarketQuoter(this.rpc);
    this.recorder = new SignalRecorder({
      db,
      now: Date.now,
      pollPrice: (m) => this.recordPrice(m),
      canPoll: () => Date.now() >= this.jupCooldownUntil,
      flow: (m, since) => this.feed.flowSince(m, since),
      release: (m) => this.untrackIfIdle(m),
    });
    this.discoveryStore = new DiscoveryStore(db);
    this.discovery = new DiscoveryFeed(this.discoveryStore, {
      // Free socket (no key): new tokens and migrations only.
      connect: () => nativeSocket('wss://pumpportal.fun/api/data'),
      getAccounts: async (keys) => (await this.rpc.connection.getMultipleAccountsInfo(keys.map((k) => new PublicKey(k)))).map((a) => (a ? Buffer.from(a.data) : null)),
      fetchJson: (url) => fetchJson(url, { timeoutMs: 6000 }),
      dexUrl: env.DEXSCREENER_API_URL,
    });
    this.follower = new PostExitFollower({
      now: Date.now,
      pollPrice: (m, size) => this.followPrice(m, size),
      canPoll: () => Date.now() >= this.jupCooldownUntil,
      addTick: (id, ts, price) => this.db.addTick(id, ts, price),
      end: (id, reason) => this.db.setFollowEnd(id, reason, Date.now()),
      release: (m) => this.untrackIfIdle(m),
    });
    this.validator = new MintValidator(this.rpc);
    this.aggregator = new SignalAggregator(() => this.maxWindowSec() * 1000);
    this.paper = new PaperExecutor(
      this.quoter,
      {
        load: () => db.getSetting('paperWallet') ?? { balanceSol: STARTING_PAPER_SOL, startingSol: STARTING_PAPER_SOL },
        save: (w) => db.setSetting('paperWallet', w),
      },
      () => this.strategy,
    );
    this.tg = new TelegramScraper({
      apiId: env.TG_API_ID, apiHash: env.TG_API_HASH, session: env.TG_SESSION,
      // Links saved from the dashboard win; .env only seeds the list on first run.
      folderLinks: [...(db.getSetting<string[]>('tgFolderLinks') ?? env.folderLinks)], extraChannels: env.extraChannels, autoJoin: env.TG_AUTO_JOIN,
    });
    this.x = new XSource({ apiKey: env.X_API_KEY, apiUrl: env.X_API_URL, handles: env.xHandles, pollSec: env.X_POLL_SEC });
    this.threads = new ThreadsSource({
      accessToken: env.THREADS_ACCESS_TOKEN, apiUrl: env.THREADS_API_URL, handles: env.threadsHandles, keywords: env.threadsKeywords,
    });
  }

  // ---------- lifecycle ----------

  async start() {
    if (env.DISCOVERY_ENABLED) this.discovery.start();
    this.ws?.on('status', () => this.changed());
    this.feed.on('price', (mint: string, price: number | null) => {
      if (!price) return;
      this.recorder.onPrice(mint, price);
      this.follower.onPrice(mint, price);
      void this.onPrice(mint, price);
    });
    this.tg.on('message', (m: TgMessage) => void this.onTelegram(m));
    // X and Threads posts use the same message shape and pipeline as Telegram.
    this.x.on('message', (m: TgMessage) => void this.onTelegram(m));
    this.threads.on('message', (m: TgMessage) => void this.onTelegram(m));
    this.ws?.start();
    for (const p of this.db.openPositions()) {
      this.feed.track(p.mint);
      // Positions opened before rules were stored: a built-in lane's rules are known exactly, so fill them in.
      const preset = p.lane ? BUILT_IN_PRESETS.find((x) => x.id === p.lane) : undefined;
      if (!p.rules && preset) {
        const v = preset.values;
        this.db.updateRules(p.id, { hardStopLossPct: v.hardStopLossPct, trailingStopPct: v.trailingStopPct, takeProfitLadder: v.takeProfitLadder });
      }
    }

    this.timers.push(setInterval(() => void this.rpc.ping().then(() => this.changed()), 10_000));
    this.timers.push(setInterval(() => void this.tick(), 2_000));
    this.timers.push(setInterval(() => void this.pollGraduated(), 3_000));
    this.timers.push(setInterval(() => this.prune(), 30_000));
    this.timers.push(setInterval(() => void this.recorder.tick(), 5_000));
    this.timers.push(setInterval(() => void this.follower.tick(), 5_000));
    this.timers.push(setInterval(() => this.snapshotEquity(), 5 * 60_000));
    // Resume post-exit tracking after a restart (positions closed in the last 24 h, not ended yet).
    for (const c of this.db.followCandidates(Date.now() - 24 * 3_600_000)) {
      this.feed.track(c.mint);
      if (!c.followUntil) this.db.setFollowUntil(c.id, c.closedAt + 24 * 3_600_000);
      this.follower.follow({
        positionId: c.id, mint: c.mint, route: c.route, closedAt: c.closedAt, exitPrice: c.exitPrice,
        tokens: c.exitTokens, decimals: c.decimals, resumedAt: Date.now(), peak: c.peak ?? undefined,
      });
    }
    this.snapshotEquity();
    this.timers.push(setInterval(() => this.recorder.prune(), 3_600_000));
    void this.rpc.ping();
    this.note('info', `bot started in ${this.mode} mode, RPC ${this.rpc.name}, trade feed ${this.feed.sourceName}`);
    await Promise.all([this.tg.start(), this.x.start(), this.threads.start()]);
    this.changed();
  }

  async stop() {
    this.timers.forEach(clearInterval);
    this.discovery.stop();
    this.ws?.stop();
    this.x.stop();
    this.threads.stop();
    await this.tg.stop();
  }

  // ---------- signal intake ----------

  private async onTelegram(m: TgMessage) {
    const cands = extractCandidates(m.text);
    const line: ChatLine = {
      id: ++this.chatSeq, ts: m.ts, channelName: m.channelName, folder: m.folder, text: m.text.slice(0, 600),
      cas: cands.map((address) => ({ address, status: 'checking' as const })),
    };
    this.chats.unshift(line);
    if (this.chats.length > 300) this.chats.length = 300;
    this.changed();
    for (const ca of line.cas) {
      try {
        ca.status = (await this.ingest(ca.address, m.channelId, m.channelName, snippet(m.text, ca.address), m.ts, false)) ? 'mint' : 'not-mint';
      } catch (e) {
        ca.status = 'error';
        this.note('warn', `ingest ${ca.address.slice(0, 6)}…: ${errMsg(e)}`);
      }
      this.changed();
    }
  }

  /** Manual inject from the dashboard (counts as meeting the channel rule; risk + momentum still apply). */
  async inject(text: string) {
    const cands = extractCandidates(text);
    if (!cands.length) throw new Error('no Solana address found');
    for (const c of cands) await this.ingest(c, 'manual', 'manual inject', text.slice(0, 120), Date.now(), true);
    return cands;
  }

  /** Returns false when the candidate is not an SPL mint. */
  private async ingest(candidate: string, channelId: string, channelName: string, text: string, ts: number, force: boolean): Promise<boolean> {
    const info = await this.validator.validate(candidate);
    if (!info) return false;
    const mint = info.mint;
    this.mintProgram.set(mint, info.programId);
    this.lastMentionAt.set(mint, Date.now());
    this.db.addMention({ mint, channelId, channelName, ts, snippet: text });

    this.aggregator.add(mint, channelId, ts);
    let sig = this.db.getSignal(mint);
    if (!sig) {
      this.feed.track(mint);
      void this.startRecording(mint);
      sig = { mint, symbol: null, firstSeen: ts, channels: [], score: 0, decision: 'pending', reasons: [],
        firstPriceSol: null, decisionPriceSol: null, updatedAt: Date.now() };
      void this.entryPrice(mint, this.strategy).then((p) => {
        const cur = this.db.getSignal(mint);
        if (cur && cur.firstPriceSol === null) this.db.upsertSignal({ ...cur, firstPriceSol: p });
      });
    }
    const allChannels = new Set([...sig.channels, channelName]);
    sig = { ...sig, channels: [...allChannels], updatedAt: Date.now() };
    this.db.upsertSignal(sig);
    this.changed();

    // Each lane applies its own channel window and minimum to the same mentions.
    const due: { lane: Lane; n: number }[] = [];
    for (const lane of this.activeLanes()) {
      const win = lane.strategy.windowSec * 1000;
      const mode = lane.strategy.socialMentions;
      const inWin = countableChannels(this.aggregator.channels(mint, win, ts), mode);
      // New = this mention raised the count (a social repost under 'one' or 'off' usually does not).
      const isNew = inWin.length > countableChannels(this.aggregator.channels(mint, win, ts, true), mode).length;
      const enough = force || inWin.length >= lane.strategy.minChannels;
      const st = this.evalState.get(laneKey(lane.id, mint));
      if (enough && (isNew || force) && (st === undefined || st === 'soft')) {
        due.push({ lane, n: force ? Math.max(lane.strategy.minChannels, inWin.length) : inWin.length });
      }
    }
    await Promise.all(due.map((d) => this.evaluate(d.lane, mint, d.n)));
    return true;
  }

  /** Effective buy price (SOL/token) for the configured size, or null. */
  /** Start the 30-min path recording and capture risk facts for a new signal. Never throws. */
  private async startRecording(mint: string) {
    try {
      const route = await memo(`route:${mint}`, 5_000, () => this.quoter.route(mint));
      this.recorder.start(mint, route);
      const program = this.mintProgram.get(mint)!;
      await captureFacts({
        db: this.db,
        now: Date.now,
        loadMint: (m) => loadMint(this.rpc, m, program),
        top10: (m, f) => holderTop10(this.rpc, m, f),
        rugcheck: (m) => rugcheckSummary(m),
      }, mint, route);
    } catch (e) {
      log('recorder', `start failed for ${short(mint)}: ${errMsg(e)}`);
    }
  }

  /** Token program of a mint; looked up on-chain when not seen in this run (e.g. after a restart). */
  private async programFor(mint: string): Promise<string> {
    const known = this.mintProgram.get(mint);
    if (known) return known;
    const info = await this.validator.validate(mint);
    if (!info) throw new Error('not a token mint');
    this.mintProgram.set(mint, info.programId);
    return info.programId;
  }

  private async quotePrice(mint: string, s: Strategy): Promise<number | null> {
    const program = await this.programFor(mint);
    const f = await loadMint(this.rpc, mint, program);
    const lamports = BigInt(Math.floor(s.buyAmountSol * LAMPORTS));
    const q = await this.quoter.quoteBuy(mint, lamports, f.decimals, s.pumpFeeBps, s.maxSlippagePct * 100);
    return q.outRaw > 0n ? s.buyAmountSol / (Number(q.outRaw) / 10 ** f.decimals) : null;
  }

  private async entryPrice(mint: string, s: Strategy): Promise<number | null> {
    try {
      return await this.quotePrice(mint, s);
    } catch {
      return null;
    }
  }

  /** Post-exit poll: sell quote for the exit size (curve or Jupiter), same basis as the exit fill. */
  private async followPrice(mint: string, size: { tokens: number; decimals: number }): Promise<number | null> {
    try {
      const s = this.strategy;
      const raw = BigInt(Math.floor(size.tokens * 10 ** size.decimals));
      if (raw <= 0n) return null;
      const q = await this.quoter.quoteSell(mint, raw, size.decimals, s.pumpFeeBps, s.maxSlippagePct * 100);
      const px = Number(q.outRaw) / LAMPORTS / size.tokens;
      return px > 0 ? px : null;
    } catch (e) {
      if (/429/.test(errMsg(e))) this.jupCooldownUntil = Date.now() + 15_000;
      return null;
    }
  }

  /** Recorder poll for graduated tokens; a 429 starts the same Jupiter cooldown open positions use. */
  private async recordPrice(mint: string): Promise<number | null> {
    try {
      return await this.quotePrice(mint, this.strategy);
    } catch (e) {
      if (/429/.test(errMsg(e))) this.jupCooldownUntil = Date.now() + 15_000;
      return null;
    }
  }

  private async evaluate(lane: Lane, mint: string, uniqueChannels: number) {
    const key = laneKey(lane.id, mint);
    const tag = lane.id ? `[${lane.name}] ` : '';
    this.evalState.set(key, 'running');
    const s = lane.strategy;
    const sig = this.db.getSignal(mint)!;
    const channelsLine: CheckResult = { name: 'channels', pass: uniqueChannels >= s.minChannels, detail: `${uniqueChannels} in ${s.windowSec}s` };
    try {
      const facts = await loadMint(this.rpc, mint, this.mintProgram.get(mint)!);
      const route = await memo(`route:${mint}`, 5_000, () => this.quoter.route(mint));
      const now = Date.now();
      const nowPrice = s.maxRunupFromFirstPct > 0 && sig.firstPriceSol
        ? await memo(`px:${mint}:${s.buyAmountSol}`, 5_000, () => this.entryPrice(mint, s))
        : null;
      const entry = entryChecks({
        ageSec: (now - sig.firstSeen) / 1000,
        runupPct: nowPrice && sig.firstPriceSol ? (nowPrice / sig.firstPriceSol - 1) * 100 : null,
        route,
      }, s);
      const entryFail = entry.filter((c) => !c.pass);
      if (entryFail.length) {
        this.evalState.set(key, 'hard');
        this.record(lane, mint, { decision: 'reject', score: 0, reasons: [channelsLine, ...entry], failed: entryFail });
        this.note('info', `${tag}reject ${short(mint)}: ${entryFail.map((f) => f.detail).join('; ')}`);
        return;
      }
      const [holders, rug, mom] = await Promise.all([
        holderCheck(this.rpc, mint, facts, s).catch((e): CheckResult => ({ name: 'top10 holders', pass: false, detail: errMsg(e) })),
        rugcheck(mint, s),
        momentum(mint, route, this.feed, s),
      ]);
      const risk = [...authorityChecks(facts, s), holders, ...(rug ? [rug] : [])];
      const res = score({ uniqueChannels, risk, momentum: mom }, s);
      const reasons: CheckResult[] = [channelsLine, { name: 'route', pass: true, detail: route }, ...entry, ...risk, mom];
      const symbol = mom.symbol ?? sig.symbol;

      if (!res.buy) {
        this.evalState.set(key, res.failed.some((f) => f.hard) ? 'hard' : 'soft');
        this.record(lane, mint, { decision: 'reject', score: res.score, reasons, failed: res.failed, symbol });
        this.note('info', `${tag}reject ${short(mint)} score ${res.score}: ${res.failed.map((f) => f.name).join(', ')}`);
        return;
      }

      const hr = await this.holderRiskCheck(mint, s);
      if (hr) {
        reasons.push(hr);
        if (!hr.pass) {
          this.evalState.set(key, 'soft');
          this.record(lane, mint, { decision: 'reject', score: res.score, reasons, failed: [hr], symbol });
          this.note('info', `${tag}reject ${short(mint)}: ${hr.detail}`);
          return;
        }
      }

      const blocked = this.guardReason(lane, mint);
      if (blocked) {
        this.evalState.set(key, 'soft');
        const g: CheckResult = { name: 'guard', pass: false, detail: blocked };
        this.record(lane, mint, { decision: 'skipped', score: res.score, reasons: [...reasons, g], failed: [g], symbol });
        this.note('warn', `${tag}skip ${short(mint)}: ${blocked}`);
        return;
      }
      await this.openPosition(lane, mint, facts.decimals, { ...sig, symbol }, { decision: 'buy', score: res.score, reasons, failed: [], symbol });
    } catch (e) {
      this.evalState.set(key, 'soft');
      const err: CheckResult = { name: 'error', pass: false, detail: errMsg(e) };
      this.record(lane, mint, { decision: 'error', score: 0, reasons: [err], failed: [err] });
      this.note('warn', `${tag}evaluate ${short(mint)} failed: ${errMsg(e)}`);
    } finally {
      this.changed();
    }
  }

  /**
   * Write a lane's outcome to the signal. Main strategy: full check list. Arena: one line per lane,
   * and the signal's decision is the best of all lanes (buy > skipped > reject > error).
   */
  private record(lane: Lane, mint: string, o: Outcome) {
    const cur = this.db.getSignal(mint)!;
    const base = { ...cur, symbol: o.symbol ?? cur.symbol, updatedAt: Date.now(), decisionPriceSol: o.decisionPriceSol ?? cur.decisionPriceSol };
    if (lane.id === null) {
      this.db.upsertSignal({ ...base, decision: o.decision, score: o.score, reasons: o.reasons });
      return;
    }
    const line: CheckResult = {
      name: lane.name, lane: lane.id, decision: o.decision, pass: o.decision === 'buy',
      detail: o.decision === 'buy' ? `bought (score ${o.score})` : o.failed.map((f) => `${f.name}: ${f.detail}`).join('; '),
    };
    const lines = [...cur.reasons.filter((r) => r.lane && r.lane !== lane.id), line];
    const decision = lines.reduce<Decision>(
      (best, r) => ((DECISION_RANK[r.decision!] ?? 0) > (DECISION_RANK[best] ?? 0) ? (r.decision as Decision) : best), 'error');
    this.db.upsertSignal({ ...base, decision, score: Math.max(o.score, cur.reasons.some((r) => r.lane) ? cur.score : 0), reasons: lines });
  }

  private guardReason(lane: Lane, mint: string): string | null {
    const open = this.db.openPositions().filter((p) => p.lane === lane.id);
    const s = lane.strategy;
    return buyBlocked(
      {
        killSwitch: this.killSwitch,
        openPositions: open.length,
        hasPositionInMint: open.some((p) => p.mint === mint),
        balanceSol: lane.paper.balanceSol(),
        dailyPnlSol: this.db.realizedSince(startOfUtcDay(), this.mode, lane.id).pnl,
      },
      s,
      BASE_FEE_SOL + s.priorityFeeSol + s.jitoTipSol + ATA_RENT_SOL,
    );
  }

  /** Store a chart point: always for fills, otherwise at most every 5 s unless the price moved 1%+. */
  private tick_(positionId: number, price: number, force = false, at?: number) {
    if (!(price > 0)) return;
    const now = at ?? Date.now();
    const last = this.lastTick.get(positionId);
    if (!force && last && now - last.ts < 5_000 && Math.abs(price / last.price - 1) < 0.01) return;
    this.db.addTick(positionId, now, price);
    this.lastTick.set(positionId, { ts: now, price });
  }

  /** Everything the position detail view needs, including what the price did after the exit. */
  positionDetail(id: number) {
    const position = this.db.position(id);
    if (!position) throw new Error('position not found');
    const ticks = this.db.ticks(id);
    let postExit: { peakPct: number; lowPct: number } | null = null;
    // Compared with the exit fill (a sell quote), the same basis the post-exit polls use.
    const exit = position.closedAt ? (this.db.exitPrice(id) ?? position.lastPriceSol) : 0;
    if (position.closedAt && exit > 0) {
      let hi = -Infinity, lo = Infinity, n = 0;
      for (const t of ticks) if (t.ts > position.closedAt) { hi = Math.max(hi, t.price); lo = Math.min(lo, t.price); n++; }
      if (n) postExit = { peakPct: (hi / exit - 1) * 100, lowPct: (lo / exit - 1) * 100 };
    }
    return {
      position,
      trades: this.db.tradesFor(id),
      ticks,
      rules: position.rules,
      followEnd: position.followEnd,
      followUntil: position.followUntil,
      postExit,
      serverTime: Date.now(),
    };
  }

  /** Wallet value now (cash + open positions at last price); stored every 5 min and on each close. */
  private snapshotEquity() {
    try {
      // Every wallet (main + all Arena lanes), whatever Arena's state, so toggling it does not move the line.
      const wallets = [this.paper, ...this.arenaPresets().map((p) => this.presetLane(p).paper)]
        .map((w) => ({ balanceSol: w.balanceSol(), startingSol: w.startingSol() }));
      this.db.addEquitySnapshot({ ts: Date.now(), mode: this.mode, ...snapshotFrom(wallets, this.db.openPositions()) });
    } catch (e) {
      log('portfolio', `snapshot failed: ${errMsg(e)}`);
    }
  }

  /** Discovery board for the UI, with the bot's own decision on each token when it evaluated one. */
  discoveryList(q: Record<string, string | undefined>) {
    const boards: DiscoveryBoard[] = ['new', 'soon', 'graduated', 'trending', 'promoted'];
    const board = boards.includes(q.board as DiscoveryBoard) ? (q.board as DiscoveryBoard) : 'new';
    const n = (v?: string) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const filter: DiscoveryFilter = {
      minMc: n(q.minMc), maxMc: n(q.maxMc), maxAgeMin: n(q.maxAgeMin), maxDevPct: n(q.maxDevPct), socials: q.socials === '1',
    };
    const now = Date.now();
    return {
      board,
      status: { enabled: env.DISCOVERY_ENABLED, connected: this.discovery.connected, lastEventAt: this.discovery.lastEventAt, tracked: this.discoveryStore.size },
      tokens: this.discoveryStore.list(board, filter, 60).map((t) => ({
        ...t, board: boardOf(t, now), score: Math.round(trendScore(t, now)), decision: this.db.getSignal(t.mint)?.decision ?? null,
      })),
      serverTime: now,
    };
  }

  portfolio(range: string) {
    const r: Range = RANGES.includes(range as Range) ? (range as Range) : 'all';
    const since = rangeStart(r, Date.now());
    const names = new Map(this.store.list(true).flatMap((s) => this.store.versions(s.id).map((v) => [v.id, `${s.name} v${v.version}`] as const)));
    return {
      range: r,
      mode: this.mode,
      ...buildPortfolio({
        snapshots: this.db.equitySnapshots(this.mode, since),
        closed: this.db.closedSince(this.mode, since),
        versionName: (id) => (id === null ? 'Unknown' : names.get(id) ?? `#${id}`),
      }),
    };
  }

  // ---------- lanes ----------

  private mainLane(): Lane {
    // versionId is resolved when a position opens (openPosition), not on every exit check.
    return { id: null, name: this.activePreset()?.name ?? 'Custom', strategy: this.strategy, paper: this.paper, versionId: null };
  }

  private arenaPresets(): Preset[] {
    return this.presets().slice(0, ARENA_MAX_LANES);
  }

  private presetLane(p: Preset): Lane {
    let wallet = this.laneWallets.get(p.id);
    if (!wallet) {
      wallet = new PaperExecutor(
        this.quoter,
        {
          load: () => this.db.getSetting(`laneWallet:${p.id}`) ?? { balanceSol: STARTING_PAPER_SOL, startingSol: STARTING_PAPER_SOL },
          save: (w) => this.db.setSetting(`laneWallet:${p.id}`, w),
        },
        () => this.laneFor(p.id).strategy,
      );
      this.laneWallets.set(p.id, wallet);
    }
    // Presets never carry infra/cost settings, so those always come from the main strategy.
    return { id: p.id, name: p.name, strategy: { ...this.strategy, ...p.values }, paper: wallet, versionId: p.versionId ?? null };
  }

  /** Lanes that may open new positions now. */
  activeLanes(): Lane[] {
    return this.arena.enabled ? this.arenaPresets().map((p) => this.presetLane(p)) : [this.mainLane()];
  }

  /** The lane that manages an existing position (also after Arena is switched off or a preset deleted). */
  private laneFor(id: string | null): Lane {
    if (id === null) return this.mainLane();
    const p = this.presets().find((x) => x.id === id);
    if (p) return this.presetLane(p);
    const fallback = this.presetLane({ id, name: id, description: '', builtIn: false, values: presetValues(this.strategy) });
    return { ...fallback, strategy: this.strategy };
  }

  private maxWindowSec(): number {
    return Math.max(this.strategy.windowSec, ...this.activeLanes().map((l) => l.strategy.windowSec));
  }

  setArena(patch: Partial<Pick<ArenaState, 'enabled' | 'autoSelect'>>) {
    this.arena = { ...this.arena, ...patch };
    this.db.setSetting('arena', this.arena);
    if (patch.enabled !== undefined) this.note('info', `Arena ${patch.enabled ? 'ON: all presets trade in parallel' : 'OFF: main strategy trades'}`);
    if (patch.autoSelect !== undefined) this.note('info', `Arena auto-select ${patch.autoSelect ? 'ON' : 'OFF'}`);
    this.changed();
  }

  /** Leaderboard: one row per arena preset, ranked by total PnL. */
  arenaBoard() {
    const stats = new Map(this.db.statsByLane(this.mode).map((r) => [r.id, r]));
    const open = this.db.openPositions();
    const rows = this.arenaPresets().map((p) => {
      const lane = this.presetLane(p);
      const st = stats.get(p.id);
      return {
        id: p.id, name: p.name,
        balanceSol: lane.paper.balanceSol(), startingSol: lane.paper.startingSol(),
        open: open.filter((x) => x.lane === p.id).length,
        count: st?.count ?? 0, wins: st?.wins ?? 0, pnl: st?.pnl ?? 0, avgPnlPct: st?.avgPnlPct ?? 0,
        worstPct: st?.worstPct ?? 0, avgPeakPct: st?.avgPeakPct ?? 0,
      };
    });
    return rankLanes(rows);
  }

  /** Runs on a timer: track the leader and, if auto-select is on, apply it after it held the lead long enough. */
  private arenaTick() {
    if (!this.arena.enabled) return;
    const { leader, apply } = leaderStep(this.arena, this.arenaBoard(), this.activePreset()?.id ?? null, Date.now());
    if (leader?.id !== this.arena.leader?.id) {
      this.arena = { ...this.arena, leader };
      this.db.setSetting('arena', this.arena);
      if (leader) this.note('info', `Arena leader: ${this.presets().find((p) => p.id === leader.id)?.name}`);
    }
    if (apply) {
      this.applyPreset(apply);
      this.note('info', 'Arena auto-select applied the leader as the main strategy');
    }
  }

  // ---------- positions ----------

  private async openPosition(lane: Lane, mint: string, decimals: number, sig: SignalRecord, o: Outcome) {
    const fill = await lane.paper.buy(mint, lane.strategy.buyAmountSol, decimals);
    const now = Date.now();
    const costSol = fill.sol + fill.feeSol - ATA_RENT_SOL;
    const p = this.db.insertPosition({
      mint, symbol: sig.symbol, mode: this.mode, route: fill.route, status: 'open', openedAt: now, closedAt: null,
      decimals, costSol, entryPriceSol: costSol / fill.tokens, initialTokens: fill.tokens, tokensHeld: fill.tokens,
      realizedSol: 0, ladderDone: 0, peakPriceSol: fill.priceSol, lastPriceSol: fill.priceSol, lastActivityAt: now, closeReason: null, followUntil: null, followEnd: null,
      preset: lane.id ? lane.name : (this.activePreset()?.name ?? null),
      lane: lane.id,
      versionId: lane.id ? lane.versionId : (this.mainResolved().versionId ?? this.store.customFor(presetValues(this.strategy)).id),
      rules: {
        hardStopLossPct: lane.strategy.hardStopLossPct,
        trailingStopPct: lane.strategy.trailingStopPct,
        takeProfitLadder: lane.strategy.takeProfitLadder,
      },
    });
    this.db.addTrade({ positionId: p.id, side: 'buy', route: fill.route, sol: fill.sol, tokens: fill.tokens, priceSol: fill.priceSol,
      feeSol: fill.feeSol, impactPct: fill.impactPct, slippagePct: fill.slippagePct, latencyMs: fill.latencyMs, reason: 'signal', ts: now });
    this.tick_(p.id, fill.priceSol, true);
    this.evalState.set(laneKey(lane.id, mint), 'bought');
    this.record(lane, mint, { ...o, decisionPriceSol: fill.priceSol });
    this.note('trade', `${lane.id ? `[${lane.name}] ` : ''}BUY ${short(mint)} ${fill.sol} SOL → ${fmt(fill.tokens)} tokens via ${fill.route}, impact ${fill.impactPct.toFixed(2)}%`);
  }

  private async onPrice(mint: string, price: number) {
    for (const p of this.db.openPositions().filter((x) => x.mint === mint)) {
      p.lastPriceSol = price;
      p.lastActivityAt = Math.max(p.lastActivityAt, this.feed.lastTradeAt(mint) ?? 0);
      this.tick_(p.id, price);
      await this.checkExit(p);
    }
    this.changed();
  }

  private async tick() {
    for (const p of this.db.openPositions()) await this.checkExit(p);
  }

  private async checkExit(p: Position) {
    if (this.busy.has(p.id) || (this.retryAt.get(p.id) ?? 0) > Date.now()) return;
    const { peak, action } = evaluateExit(p, p.lastPriceSol, Date.now(), this.laneFor(p.lane).strategy);
    if (peak !== p.peakPriceSol || !action) {
      p.peakPriceSol = peak;
      this.db.updatePosition(p);
    }
    if (action) await this.sell(p, action);
  }

  /**
   * Graduated tokens: mark-to-market. One quote per token (shared by every lane holding it):
   * Jupiter sell quote for the held size; when Jupiter fails or rate-limits, DexScreener spot price.
   * Only when both fail is the position blind, and it is closed after markStaleSec.
   */
  private async pollGraduated() {
    const byMint = new Map<string, Position[]>();
    for (const p of this.db.openPositions()) {
      if (p.route !== 'jupiter' || this.busy.has(p.id)) continue;
      byMint.set(p.mint, [...(byMint.get(p.mint) ?? []), p]);
    }
    for (const [mint, group] of byMint) {
      let price: number | null = null;
      let why = '';
      const ref = group.reduce((a, b) => (b.tokensHeld > a.tokensHeld ? b : a));
      if (Date.now() >= this.jupCooldownUntil) {
        try {
          const ls = this.laneFor(ref.lane).strategy;
          const raw = BigInt(Math.floor(ref.tokensHeld * 10 ** ref.decimals));
          const q = await this.quoter.quoteSell(mint, raw, ref.decimals, ls.pumpFeeBps, ls.maxSlippagePct * 100);
          const px = Number(q.outRaw) / LAMPORTS / ref.tokensHeld;
          if (px > 0) price = px;
          else why = 'empty Jupiter quote';
        } catch (e) {
          why = errMsg(e);
          if (/429/.test(why)) this.jupCooldownUntil = Date.now() + 15_000; // back off, use DexScreener meanwhile
        }
      } else {
        why = 'Jupiter cooling down after 429';
      }
      if (price === null) {
        try {
          price = await dexPriceSol(mint);
        } catch (e) {
          why += `; DexScreener: ${errMsg(e)}`;
        }
      }
      for (const stale of group) {
        // Re-read: a sell may have changed the position while we were quoting.
        const p = this.db.openPositions().find((x) => x.id === stale.id);
        if (!p || this.busy.has(p.id)) continue;
        if (price !== null) {
          this.markOkAt.set(p.id, Date.now());
          if (Math.abs(price / p.lastPriceSol - 1) > 0.001) p.lastActivityAt = Date.now();
          p.lastPriceSol = price;
          this.db.updatePosition(p);
          this.tick_(p.id, price);
          await this.checkExit(p);
          continue;
        }
        const blindSec = (Date.now() - (this.markOkAt.get(p.id) ?? p.openedAt)) / 1000;
        this.note('warn', `no price ${short(mint)}: ${why} (blind ${Math.round(blindSec)}s)`);
        if (blindSec >= this.laneFor(p.lane).strategy.markStaleSec) {
          await this.sell(p, { tokens: p.tokensHeld, reason: `no price for ${Math.round(blindSec)}s`, closeAll: true });
        }
      }
    }
  }

  private async sell(p: Position, a: ExitAction) {
    this.busy.add(p.id);
    try {
      const raw = BigInt(Math.floor(a.tokens * 10 ** p.decimals));
      const fill = await this.laneFor(p.lane).paper.sell(p.mint, raw, p.decimals, a.closeAll);
      const now = Date.now();
      p.route = fill.route;
      p.tokensHeld = a.closeAll ? 0 : Math.max(0, p.tokensHeld - fill.tokens);
      p.realizedSol += fill.sol;
      if (a.ladderStep) p.ladderDone = a.ladderStep;
      if (a.closeAll) {
        p.status = 'closed';
        p.closedAt = now;
        p.closeReason = a.reason;
      }
      this.db.updatePosition(p);
      this.db.addTrade({ positionId: p.id, side: 'sell', route: fill.route, sol: fill.sol, tokens: fill.tokens, priceSol: fill.priceSol,
        feeSol: fill.feeSol, impactPct: fill.impactPct, slippagePct: fill.slippagePct, latencyMs: fill.latencyMs, reason: a.reason, ts: now });
      this.retryAt.delete(p.id);
      this.tick_(p.id, fill.priceSol, true, now);
      if (p.status === 'closed') this.lastTick.delete(p.id);
      this.note('trade', `${p.lane ? `[${this.laneFor(p.lane).name}] ` : ''}SELL ${short(p.mint)} ${fmt(fill.tokens)} → ${fill.sol.toFixed(4)} SOL (${a.reason})`);
      if (p.status === 'closed') {
        const pnl = p.realizedSol - p.costSol;
        this.note('trade', `CLOSED ${short(p.mint)} PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL`);
        if (p.costSol > 0 && pnl / p.costSol <= -0.7) {
          const n = this.db.markRugged(p.mint);
          if (n) this.note('warn', `rug ${short(p.mint)}: ${n} holder/funder wallets remembered for future holder checks`);
        }
        this.markOkAt.delete(p.id);
        this.db.setFollowUntil(p.id, now + 24 * 3_600_000);
        this.follower.follow({ positionId: p.id, mint: p.mint, route: p.route, closedAt: now, exitPrice: fill.priceSol, tokens: fill.tokens, decimals: p.decimals });
        this.snapshotEquity();
        this.untrackIfIdle(p.mint);
      }
    } catch (e) {
      this.retryAt.set(p.id, Date.now() + 5_000);
      this.note('warn', `sell ${short(p.mint)} failed (${a.reason}): ${errMsg(e)}; retry in 5s`);
    } finally {
      this.busy.delete(p.id);
      this.changed();
    }
  }

  async sellPosition(id: number, reason = 'manual dump') {
    const p = this.db.openPositions().find((x) => x.id === id);
    if (!p) throw new Error('position not open');
    await this.sell(p, { tokens: p.tokensHeld, reason, closeAll: true });
  }

  async panicSellAll() {
    const open = this.db.openPositions();
    await Promise.all(open.map((p) => this.sell(p, { tokens: p.tokensHeld, reason: 'panic sell', closeAll: true })));
    return open.length;
  }

  /** Drop the feed subscription only when no position, recording or mention window still needs it. */
  private untrackIfIdle(mint: string) {
    const held = this.db.openPositions().some((p) => p.mint === mint);
    if (canUntrack({ held, recording: this.recorder.isRecording(mint), inMentionWindow: this.lastMentionAt.has(mint), following: this.follower.isFollowing(mint) })) this.feed.untrack(mint);
  }

  private prune() {
    const now = Date.now();
    this.arenaTick();
    const keepMs = (this.maxWindowSec() + 120) * 1000;
    this.aggregator.prune(now, keepMs);
    const held = new Set(this.db.openPositions().map((p) => p.mint));
    for (const [mint, at] of this.lastMentionAt) {
      if (now - at > keepMs && !held.has(mint)) {
        // A signal still being recorded stays subscribed; the recorder releases it when its window ends.
        this.lastMentionAt.delete(mint);
        this.untrackIfIdle(mint);
      }
    }
  }

  // ---------- controls ----------

  setStrategy(patch: Partial<Strategy>) {
    const next = StrategySchema.parse({ ...this.strategy, ...patch });
    if (next.rpc !== this.rpc.name) this.rpc.use(next.rpc);
    this.strategy = next;
    this.db.setSetting('strategy', next);
    this.note('info', 'strategy updated');
    this.changed();
  }

  // ---------- telegram folders ----------

  async addTelegramFolder(link: string) {
    const f = await this.tg.addFolder(link);
    this.db.setSetting('tgFolderLinks', this.tg.folderLinks());
    this.note('info', `telegram folder added: ${f.title ?? f.link}${f.title ? ` (${f.channels} chats)` : ''}`);
    this.changed();
    return f;
  }

  removeTelegramFolder(link: string) {
    this.tg.removeFolder(link);
    this.db.setSetting('tgFolderLinks', this.tg.folderLinks());
    this.note('info', `telegram folder removed: ${link}`);
    this.changed();
  }

  // ---------- holder analysis ----------

  /** Cached report (≤ 10 min) or a fresh one. Shared by the buy check and the dashboard. */
  holderReport(mint: string, refresh = false): Promise<HolderReport> {
    const cached = this.db.holderReport(mint);
    if (!refresh && cached && Date.now() - cached.at < 10 * 60_000) return Promise.resolve(cached);
    return memo(`hreport:${mint}`, refresh ? 0 : 60_000, async () => {
      const r = await analyzeHolders(mint, (w) => this.db.rugLinks(w));
      this.db.saveHolderReport(r);
      return r;
    });
  }

  async holderSummary(mint: string): Promise<HolderReport> {
    const r = await this.holderReport(mint);
    r.summary = await summarize(r);
    r.summaryAt = Date.now();
    this.db.saveHolderReport(r);
    return r;
  }

  /** Strategy check. No Helius key or a timeout does not block (like RugCheck). */
  private async holderRiskCheck(mint: string, s: Strategy): Promise<CheckResult | null> {
    if (!s.holderAnalysisEnabled || !heliusKey()) return null;
    try {
      const r = await Promise.race([
        this.holderReport(mint),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout 8s')), 8_000)),
      ]);
      return {
        name: 'holder risk',
        pass: r.riskScore <= s.maxHolderRisk,
        detail: `${r.riskScore}/100 (limit ${s.maxHolderRisk})${r.flags.length ? `: ${r.flags.slice(0, 3).join('; ')}` : ''}`,
      };
    } catch (e) {
      return { name: 'holder risk', pass: true, detail: `unavailable: ${errMsg(e)} (not blocking)` };
    }
  }

  /** What the bot knows about one token, for the chart sheet opened from Chats. */
  coinInfo(mint: string) {
    return { signal: this.db.getSignal(mint) ?? null, positionId: this.db.latestPositionFor(mint)?.id ?? null };
  }

  // ---------- presets ----------

  /** One preset per non-archived strategy, from its latest version. Settings added later get their default. */
  presets(): Preset[] {
    const base = presetValues(DEFAULT_STRATEGY);
    return this.store
      .list()
      .filter((x) => x.id !== 'custom')
      .map((x) => ({
        id: x.id, name: x.name, description: x.description, builtIn: x.builtIn,
        values: { ...base, ...x.latest.values }, versionId: x.latest.id, version: x.latest.version,
      }));
  }

  /** Main strategy's version and preset: the applied version while settings still equal it, else a matching preset. */
  private mainResolved() {
    const applied = this.db.getSetting<number>('mainVersionId');
    return resolveMain(presetValues(this.strategy), applied ? this.store.get(applied) : undefined, this.presets());
  }

  /** The preset the main strategy belongs to, if any. */
  activePreset(): Preset | undefined {
    const { presetId } = this.mainResolved();
    return presetId ? this.presets().find((p) => p.id === presetId) : undefined;
  }

  private setMainVersion(versionId: number | undefined) {
    if (versionId) this.db.setSetting('mainVersionId', versionId);
  }

  /** Alias kept for one release: applies the latest version of a strategy. */
  applyPreset(id: string) {
    const p = this.presets().find((x) => x.id === id);
    if (!p) throw new Error('preset not found');
    this.setStrategy(p.values);
    this.setMainVersion(p.versionId);
    this.note('info', `preset "${p.name}" applied`);
  }

  applyVersion(versionId: number) {
    const v = this.store.get(versionId);
    if (!v) throw new Error('version not found');
    this.setStrategy({ ...presetValues(DEFAULT_STRATEGY), ...v.values });
    this.setMainVersion(v.id);
    this.note('info', `strategy ${v.strategyId} v${v.version} applied`);
  }

  /** Validate a partial set of preset values against the schema; infra/cost keys are dropped. */
  private cleanValues(values: Partial<Strategy> | undefined): PresetValues {
    return presetValues(StrategySchema.parse({ ...this.strategy, ...(values ?? {}) }));
  }

  createStrategy(name: string, description = '', values?: Partial<Strategy>) {
    const v = this.store.create(name, description, this.cleanValues(values), 'user', 'created');
    // Created from the current settings: it is the main strategy now, not the built-in it may equal.
    if (!values) this.setMainVersion(v.id);
    this.note('info', `strategy "${name.trim()}" created`);
    this.changed();
    return v;
  }

  addStrategyVersion(strategyId: string, values: Partial<Strategy>, note = '') {
    const prev = this.store.versions(strategyId)[0];
    const v = this.store.addVersion(strategyId, this.cleanValues({ ...prev?.values, ...values }), 'user', note);
    if (v.id !== prev?.id) this.note('info', `strategy ${strategyId} saved as v${v.version}`);
    this.changed();
    return { version: v, changed: v.id !== prev?.id };
  }

  archiveStrategy(strategyId: string) {
    this.store.archive(strategyId);
    this.changed();
  }

  strategyDetail(strategyId: string) {
    const strategy = this.store.list(true).find((x) => x.id === strategyId);
    if (!strategy) throw new Error('strategy not found');
    const versions = this.store.versions(strategyId);
    const ids = new Set(versions.map((v) => v.id));
    return {
      strategy,
      versions,
      stats: this.db.statsByVersion(this.mode).filter((x) => ids.has(x.versionId)),
      curves: Object.fromEntries(versions.map((v) => [v.id, this.db.equityCurve(v.id, this.mode)])),
    };
  }

  setKillSwitch(on: boolean) {
    this.killSwitch = on;
    this.db.setSetting('killSwitch', on);
    this.note('warn', `kill switch ${on ? 'ON: new buys blocked' : 'OFF'}`);
    this.changed();
  }

  setMode(mode: Mode) {
    if (mode === 'live') {
      throw new Error(
        env.LIVE_TRADING_ENABLED
          ? 'Live engine is not built yet (PLAN.md phase 7).'
          : 'Live trading is disabled (LIVE_TRADING_ENABLED=false) and the live engine is not built yet (PLAN.md phase 7).',
      );
    }
    this.mode = mode;
    this.changed();
  }

  allTimeStats() {
    return { mode: this.mode, ...this.db.allTimeStats(this.mode) };
  }

  activityHistory(opts: { before?: number; limit?: number; q?: string; level?: string }) {
    return this.db.activity(opts);
  }

  resetPaper() {
    if (this.db.openPositions().length) throw new Error('close open positions first');
    this.db.clearMode('paper');
    this.follower.clear();
    this.paper.reset(STARTING_PAPER_SOL);
    for (const p of this.presets()) this.presetLane(p).paper.reset(STARTING_PAPER_SOL);
    this.snapshotEquity();
    this.arena = { ...this.arena, leader: null };
    this.db.setSetting('arena', this.arena);
    this.note('info', `paper wallets reset to ${STARTING_PAPER_SOL} SOL (main and every arena lane)`);
    this.changed();
  }

  // ---------- state for UI ----------

  private note(level: ActivityLine['level'], text: string) {
    log(level, text);
    const ts = Date.now();
    let id: number | undefined;
    try {
      id = this.db.addActivity(ts, level, text);
    } catch {
      /* keep running if the log write fails */
    }
    this.activity.unshift({ id, ts, level, text });
    if (this.activity.length > 200) this.activity.length = 200;
  }

  private changed() {
    this.emit('changed');
  }

  /** Header wallet: the main wallet, or all arena lane wallets added together while Arena runs. */
  private walletSummary() {
    if (!this.arena.enabled) return { balanceSol: this.paper.balanceSol(), startingSol: this.paper.startingSol() };
    const lanes = this.activeLanes();
    return {
      balanceSol: lanes.reduce((a, l) => a + l.paper.balanceSol(), 0),
      startingSol: lanes.reduce((a, l) => a + l.paper.startingSol(), 0),
    };
  }

  snapshot() {
    const today = this.db.realizedSince(startOfUtcDay(), this.mode);
    const all = this.db.realizedSince(0, this.mode);
    return {
      mode: this.mode,
      liveAvailable: false,
      killSwitch: this.killSwitch,
      wallet: this.walletSummary(),
      rpc: { current: this.rpc.name, pingMs: this.rpc.pingMs, options: this.rpc.list() },
      feed: { source: this.feed.sourceName, connected: this.feed.source.connected, tracked: this.feed.source.tracked },
      telegram: this.tg.status,
      social: { x: this.x.status, threads: this.threads.status },
      strategy: this.strategy,
      presets: this.presets(),
      activePresetId: this.activePreset()?.id ?? null,
      mainVersionId: this.mainResolved().versionId,
      versionStats: this.db.statsByVersion(this.mode),
      hardLimits: {
        agentLiveEnabled: env.AGENT_LIVE_ENABLED,
        maxBuySol: env.LIVE_MAX_BUY_SOL ?? null,
        maxDailyLossSol: env.LIVE_MAX_DAILY_LOSS_SOL ?? null,
        maxOpen: env.LIVE_MAX_OPEN ?? null,
        canaryBuySol: env.LIVE_CANARY_BUY_SOL ?? null,
        rollbackLossSol: env.LIVE_ROLLBACK_LOSS_SOL ?? null,
      },
      arena: { ...this.arena, minTrades: ARENA_MIN_TRADES, lanes: this.arenaBoard() },
      positions: this.db.openPositions(),
      closed: this.db.closedPositions(30),
      signals: this.db.recentSignals(60),
      mentions: this.db.recentMentions(100),
      trades: this.db.recentTrades(40),
      activity: this.activity.slice(0, 80),
      chats: this.chats.slice(0, 150),
      stats: { today, all },
      activityTotal: this.db.activityCount(),
      serverTime: Date.now(),
    };
  }
}

const laneKey = (lane: string | null, mint: string) => `${lane ?? 'main'}|${mint}`;

const short = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(2));
