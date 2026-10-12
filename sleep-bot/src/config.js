import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Все местные расчёты (сутки, «днём / ночью») идут в часовом поясе мамы
process.env.TZ = process.env.TZ || 'Europe/Moscow';

const dataDir = resolve(ROOT, process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });

const [reportDay, reportTime] = (process.env.WEEKLY_REPORT || 'mon 09:00').split(/\s+/);

export const config = {
  root: ROOT,
  botToken: process.env.BOT_TOKEN || '',
  ownerId: process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null,
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '127.0.0.1',
  tz: process.env.TZ,
  dataDir,
  dbFile: resolve(dataDir, 'sleep.db'),
  webappDir: resolve(ROOT, 'webapp'),
  dev: process.env.DEV === '1',
  telegramApi: process.env.TELEGRAM_API || 'https://api.telegram.org',
  // недельный отчёт: «mon 09:00» — в понедельник утром, когда завершилась ночь на воскресенье
  report: {
    day: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(reportDay),
    minute: (() => { const [h, m] = (reportTime || '09:00').split(':').map(Number); return h * 60 + m; })(),
  },
  backupMinute: 3 * 60 + 30, // ежедневная копия в чат в 3:30
};
