import { config } from './config.js';
import { Store } from './db.js';
import { App } from './app.js';
import { Telegram } from './bot/telegram.js';
import { Bot } from './bot/bot.js';
import { Scheduler } from './bot/scheduler.js';
import { createAppServer } from './server.js';
import { startTunnel } from './tunnel.js';

const store = new Store(config.dbFile);
const app = new App(store);

let bot = null;
let scheduler = null;
const controller = new AbortController();

if (!config.botToken && !config.dev) {
  console.error('Не задан BOT_TOKEN в файле .env — бот не запустится. Для просмотра приложения без Telegram: npm run dev');
  process.exit(1);
}

const server = createAppServer({
  app,
  config,
  ownerId: () => config.ownerId ?? store.get('owner'),
  // после изменений в приложении сразу проверить напоминания
  onChange: () => scheduler?.tick().catch(() => {}),
});
server.listen(config.port, config.host, async () => {
  console.log(`Приложение: http://${config.host}:${config.port}/${config.dev ? '  (режим разработки, без проверки Telegram)' : ''}`);

  // адрес для Mini App: свой (PUBLIC_URL) или бесплатный туннель Cloudflare
  if (!config.publicUrl && !config.dev && process.env.TUNNEL !== 'off') {
    console.log('Поднимаю туннель Cloudflare для приложения…');
    const url = await startTunnel(config.port);
    if (url) config.publicUrl = url;
  }
  if (config.publicUrl) console.log(`Адрес приложения для Telegram: ${config.publicUrl}`);

  if (config.botToken) {
    const tg = new Telegram(config.botToken, config.telegramApi);
    bot = new Bot({ tg, app, store, config });
    scheduler = new Scheduler({ bot, app, store, config });
    await bot.setup();
    bot.poll(controller.signal);
    scheduler.start();
    console.log('Бот запущен. Напишите ему /start в Telegram.');
  }
});

function shutdown() {
  console.log('Останавливаюсь…');
  controller.abort();
  scheduler?.stop();
  server.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
