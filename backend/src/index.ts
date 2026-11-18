import { env } from './config/env.js';
import { Db } from './db/db.js';
import { Bot } from './bot.js';
import { buildServer } from './api/server.js';
import { DashboardToken } from './api/token.js';
import { log } from './lib/util.js';

if (env.HOST !== '127.0.0.1' && env.HOST !== 'localhost' && !env.DASHBOARD_TOKEN) {
  log('boot', `refusing to bind ${env.HOST} without DASHBOARD_TOKEN`);
  process.exit(1);
}

// On Railway without a volume the SQLite file lives in the container and is lost on every deploy.
if (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  log('boot', `WARNING: no Railway volume mounted; ${env.DB_PATH} (activity log, trades, holder reports) will be wiped on redeploy. Mount a volume at /app/data.`);
} else if (process.env.RAILWAY_VOLUME_MOUNT_PATH && !env.DB_PATH.startsWith(process.env.RAILWAY_VOLUME_MOUNT_PATH)) {
  log('boot', `WARNING: DB_PATH ${env.DB_PATH} is outside the volume at ${process.env.RAILWAY_VOLUME_MOUNT_PATH}`);
}

const db = new Db(env.DB_PATH);
const bot = new Bot(db);
const token = new DashboardToken(db, { envToken: env.DASHBOARD_TOKEN, reset: env.DASHBOARD_TOKEN_RESET });
if (env.DASHBOARD_TOKEN_RESET) log('boot', 'DASHBOARD_TOKEN_RESET is set: rotated dashboard token cleared, DASHBOARD_TOKEN works again. Remove the flag after you log in.');
const app = await buildServer(bot, token);
await app.listen({ host: env.HOST, port: env.PORT });
log('boot', `dashboard API on http://${env.HOST}:${env.PORT}`);
await bot.start();

const shutdown = async () => {
  log('boot', 'shutting down');
  await bot.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
