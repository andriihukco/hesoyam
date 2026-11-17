import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { env, ROOT_DIR } from '../config/env.js';
import type { Bot } from '../bot.js';
import { errMsg } from '../lib/util.js';

function authorized(req: FastifyRequest): boolean {
  if (!env.DASHBOARD_TOKEN) return true;
  const q = (req.query as Record<string, string> | undefined)?.token;
  return req.headers['x-dashboard-token'] === env.DASHBOARD_TOKEN || q === env.DASHBOARD_TOKEN;
}

export async function buildServer(bot: Bot) {
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

  app.get('/api/state', async () => bot.snapshot());
  app.put('/api/strategy', async (req) => run(() => bot.setStrategy(req.body as never)));
  app.post('/api/presets', async (req) => {
    const b = (req.body ?? {}) as { name?: string; description?: string };
    return run(() => bot.savePreset(String(b.name ?? ''), String(b.description ?? '')));
  });
  app.post('/api/presets/:id/apply', async (req) => run(() => bot.applyPreset((req.params as { id: string }).id)));
  app.delete('/api/presets/:id', async (req) => run(() => bot.deletePreset((req.params as { id: string }).id)));
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
  app.post('/api/paper/reset', async () => run(() => bot.resetPaper()));

  // Push a full snapshot on change, throttled to 2/s, plus a heartbeat.
  const clients = new Set<{ send: (s: string) => void }>();
  let dirty = true;
  bot.on('changed', () => (dirty = true));
  const push = () => {
    if (!clients.size) return;
    const msg = JSON.stringify({ type: 'state', data: bot.snapshot() });
    for (const c of clients) c.send(msg);
    dirty = false;
  };
  setInterval(() => dirty && push(), 500);
  setInterval(push, 3000);

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'state', data: bot.snapshot() }));
    socket.on('close', () => clients.delete(socket));
  });

  const dist = resolve(ROOT_DIR, 'frontend/dist');
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
  }
  return app;
}
