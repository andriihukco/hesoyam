import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { env, ROOT_DIR } from '../config/env.js';
import type { Bot } from '../bot.js';
import { errMsg, log } from '../lib/util.js';
import type { DashboardToken } from './token.js';

function presented(req: FastifyRequest): string | undefined {
  const h = req.headers['x-dashboard-token'];
  const q = (req.query as Record<string, string> | undefined)?.token;
  return (typeof h === 'string' && h) || q || undefined;
}

export async function buildServer(bot: Bot, token: DashboardToken) {
  const authorized = (req: FastifyRequest) => token.check(presented(req));
  const snapshot = () => ({ ...bot.snapshot(), tokenStatus: token.status() });
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      if (!authorized(req)) return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  const run = async (fn: () => unknown) => {
    try {
      return { ok: true, result: await fn() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  };

  app.get('/api/state', async () => snapshot());
  app.put('/api/strategy', async (req) => run(() => bot.setStrategy(req.body as never)));
  app.post('/api/presets/:id/apply', async (req) => run(() => bot.applyPreset((req.params as { id: string }).id)));
  app.get('/api/strategies', async () => run(() => bot.store.list()));
  app.get('/api/strategies/:id', async (req) => run(() => bot.strategyDetail((req.params as { id: string }).id)));
  app.post('/api/strategies', async (req) => {
    const b = (req.body ?? {}) as { name?: string; description?: string; values?: Record<string, unknown> };
    return run(() => bot.createStrategy(String(b.name ?? ''), String(b.description ?? ''), b.values as never));
  });
  app.post('/api/strategies/:id/versions', async (req) => {
    const b = (req.body ?? {}) as { values?: Record<string, unknown>; note?: string };
    return run(() => bot.addStrategyVersion((req.params as { id: string }).id, (b.values ?? {}) as never, String(b.note ?? '')));
  });
  app.post('/api/strategies/:id/archive', async (req) => run(() => bot.archiveStrategy((req.params as { id: string }).id)));
  app.post('/api/versions/:id/apply', async (req) => run(() => bot.applyVersion(Number((req.params as { id: string }).id))));
  app.post('/api/arena', async (req) => {
    const b = (req.body ?? {}) as { enabled?: unknown; autoSelect?: unknown };
    const patch: { enabled?: boolean; autoSelect?: boolean } = {};
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    if (typeof b.autoSelect === 'boolean') patch.autoSelect = b.autoSelect;
    return run(() => bot.setArena(patch));
  });
  app.post('/api/kill-switch', async (req) => run(() => bot.setKillSwitch(Boolean((req.body as { on?: boolean })?.on))));
  app.post('/api/mode', async (req) => run(() => bot.setMode((req.body as { mode: 'paper' | 'live' }).mode)));
  app.get('/api/positions/:id', async (req) => run(() => bot.positionDetail(Number((req.params as { id: string }).id))));
  app.post('/api/positions/:id/sell', async (req) => run(() => bot.sellPosition(Number((req.params as { id: string }).id))));
  app.post('/api/panic-sell', async () => run(() => bot.panicSellAll()));
  app.post('/api/inject', async (req) => run(() => bot.inject(String((req.body as { text?: string })?.text ?? ''))));
  app.get('/api/stats', async () => run(() => bot.allTimeStats()));
  app.get('/api/discovery', async (req) => run(() => bot.discoveryList((req.query ?? {}) as Record<string, string | undefined>)));
  app.get('/api/portfolio', async (req) => run(() => bot.portfolio(String((req.query as { range?: string })?.range ?? 'all'))));
  app.get('/api/activity', async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    return run(() =>
      bot.activityHistory({
        before: q.before ? Number(q.before) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        q: q.q?.trim() || undefined,
        level: q.level && ['info', 'warn', 'trade'].includes(q.level) ? q.level : undefined,
      }),
    );
  });
  app.post('/api/telegram/folders', async (req) => run(() => bot.addTelegramFolder(String((req.body as { link?: string })?.link ?? ''))));
  app.delete('/api/telegram/folders', async (req) => run(() => bot.removeTelegramFolder(String((req.body as { link?: string })?.link ?? ''))));
  app.get('/api/coin/:mint', async (req) => run(() => bot.coinInfo((req.params as { mint: string }).mint)));
  app.get('/api/holders/:mint', async (req) => {
    const refresh = (req.query as Record<string, string | undefined>)?.refresh === '1';
    return run(() => bot.holderReport((req.params as { mint: string }).mint, refresh));
  });
  app.post('/api/holders/:mint/summary', async (req) => run(() => bot.holderSummary((req.params as { mint: string }).mint)));
  app.get('/api/health', async () => ({ ok: true, db: env.DB_PATH, volume: process.env.RAILWAY_VOLUME_MOUNT_PATH ?? null }));
  app.post('/api/paper/reset', async () => run(() => bot.resetPaper()));
  // Rotate the dashboard token: the old one stops working now. Open dashboards (already authorized
  // sockets) receive the new token so they keep working; closed devices must enter it again.
  app.post('/api/token/rotate', async () =>
    run(() => {
      const t = token.rotate();
      const msg = JSON.stringify({ type: 'token', token: t });
      for (const c of clients) c.send(msg);
      log('auth', 'dashboard token rotated; previous token revoked');
      return { token: t };
    }));

  // Push a full snapshot on change, throttled to 2/s, plus a heartbeat.
  const clients = new Set<{ send: (s: string) => void }>();
  let dirty = true;
  bot.on('changed', () => (dirty = true));
  const push = () => {
    if (!clients.size) return;
    const msg = JSON.stringify({ type: 'state', data: snapshot() });
    for (const c of clients) c.send(msg);
    dirty = false;
  };
  setInterval(() => dirty && push(), 500);
  setInterval(push, 3000);

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'state', data: snapshot() }));
    socket.on('close', () => clients.delete(socket));
  });

  const dist = resolve(ROOT_DIR, 'frontend/dist');
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
  }
  return app;
}
