process.env.TZ = 'Europe/Moscow';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db.js';
import { App } from '../src/app.js';
import { Telegram } from '../src/bot/telegram.js';
import { Bot, BTN_SLEEP, BTN_WAKE } from '../src/bot/bot.js';
import { Scheduler } from '../src/bot/scheduler.js';
import { createAppServer } from '../src/server.js';
import { signInitData } from '../src/auth.js';
import { startOfDay, MIN, HOUR, dateKey } from '../src/core/time.js';

const OWNER = 42;
const TOKEN = '123:TEST';
let dir, store, app, bot, scheduler, fake, calls, server, base;
const quiet = { info() {}, warn() {}, error() {} };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sleepbot-'));
  calls = [];
  fake = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const method = req.url.split('/').pop();
    calls.push({ method, body: body ? JSON.parse(body) : {} });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: calls.length } : true }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const config = { ownerId: OWNER, publicUrl: 'https://sleep.example', dataDir: dir, botToken: TOKEN, report: { day: 1, minute: 540 }, backupMinute: 210, dev: false, webappDir: join(dir, 'web') };
  store = new Store(join(dir, 'sleep.db'));
  app = new App(store);
  bot = new Bot({ tg: new Telegram(TOKEN, `http://127.0.0.1:${fake.address().port}`), app, store, config, log: quiet });
  scheduler = new Scheduler({ bot, app, store, config, log: quiet });
  server = createAppServer({ app, config, ownerId: () => OWNER, log: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  fake.close();
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const msg = (text, from = OWNER) => ({ message: { chat: { id: from, type: 'private' }, from: { id: from }, text } });
const lastSent = () => [...calls].reverse().find((c) => c.method === 'sendMessage')?.body;

test('/start: кнопки «Уснул / Проснулся» и кнопка приложения', async () => {
  await bot.handle(msg('/start'));
  const m = lastSent();
  assert.match(m.text, /сонный помощник/);
  assert.equal(m.reply_markup.keyboard[0][0].text, BTN_SLEEP);
  assert.equal(m.reply_markup.keyboard[1][0].web_app.url, 'https://sleep.example/');
});

test('чужой человек получает отказ, данные не трогаются', async () => {
  await bot.handle(msg(BTN_SLEEP, 777));
  assert.match(lastSent().text, /личный бот/);
  assert.equal(store.listSleeps().length, 0);
});

test('без профиля бот просит заполнить его в приложении', async () => {
  await bot.handle(msg(BTN_SLEEP));
  assert.match(lastSent().text, /дату рождения/);
});

test('«Уснул» → запись, «−10 мин» поправляет время, «Проснулся» закрывает сон', async () => {
  app.saveProfile({ birth: Date.now() - 60 * 24 * HOUR, birthWeight: 3420 });
  await bot.handle(msg(BTN_SLEEP));
  let m = lastSent();
  assert.match(m.text, /Уснул в/);
  const open = store.openSleep();
  assert.ok(open);
  const shift = m.reply_markup.inline_keyboard[0][0];
  assert.equal(shift.text, '−10 мин');
  await bot.handle({ callback_query: { id: 'q1', from: { id: OWNER }, data: shift.callback_data, message: { chat: { id: OWNER }, message_id: 5, text: m.text } } });
  const shifted = store.getSleep(open.id);
  assert.ok(Math.abs(open.start - 10 * MIN - shifted.start) < 2 * MIN);
  assert.ok(calls.some((c) => c.method === 'editMessageText'));

  await bot.handle(msg(BTN_SLEEP)); // повторно — вежливый отказ
  assert.match(lastSent().text, /Уже отмечено/);
  await bot.handle(msg(BTN_WAKE));
  m = lastSent();
  assert.match(m.text, /Проснулся в/);
  assert.match(m.text, /спал 10 мин/);
  assert.equal(store.openSleep(), null);
});

test('вес числом в чат', async () => {
  await bot.handle(msg('5 230'));
  assert.match(lastSent().text, /5\s230 г/);
  assert.equal(store.listWeights().at(-1).grams, 5230);
});

test('напоминание «можно будить» отправляется один раз, с кнопками', async () => {
  const noon = startOfDay(Date.now()) + 13 * HOUR;
  for (const s of store.listSleeps()) store.deleteSleep(s.id);
  store.addSleep({ start: noon - 26 * HOUR, end: noon - 16 * HOUR - 30 * MIN }); // прошлая ночь (вечер позавчера → утро вчера)
  store.addSleep({ start: noon - 160 * MIN }); // спит 2 ч 40 мин
  const before = calls.length;
  await scheduler.tick(noon);
  const sent = calls.slice(before).filter((c) => c.method === 'sendMessage');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /Можно мягко будить/);
  assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].callback_data, 'wn');
  await scheduler.tick(noon + MIN);
  assert.equal(calls.slice(before).filter((c) => c.method === 'sendMessage').length, 1);
});

test('«Ещё 15 мин» откладывает напоминание', async () => {
  await bot.handle({ callback_query: { id: 'q2', from: { id: OWNER }, data: 'z15', message: { chat: { id: OWNER }, message_id: 9, text: 'Спит уже…' } } });
  const st = app.state();
  assert.ok(st.nextAt >= Date.now() + 14 * MIN);
});

test('API Mini App: подпись Telegram обязательна, чужим — 401', async () => {
  const user = (id) => signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'М' }) }, TOKEN);
  let r = await fetch(`${base}/api/state`);
  assert.equal(r.status, 401);
  r = await fetch(`${base}/api/state`, { headers: { 'x-init-data': user(777) } });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/api/state`, { headers: { 'x-init-data': user(OWNER) } });
  assert.equal(r.status, 200);
  const st = await r.json();
  assert.equal(st.state, 'asleep');
  assert.equal(st.tz, 'Europe/Moscow');
  const bad = user(OWNER).replace(/hash=[0-9a-f]{4}/, 'hash=0000');
  r = await fetch(`${base}/api/state`, { headers: { 'x-init-data': bad } });
  assert.equal(r.status, 401);
});

test('API: ошибки ввода объясняются по-человечески', async () => {
  const h = { 'x-init-data': signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: OWNER }) }, TOKEN), 'content-type': 'application/json' };
  const r = await fetch(`${base}/api/sleep`, { method: 'POST', headers: h, body: JSON.stringify({ start: Date.now() - HOUR, end: Date.now() - 2 * HOUR }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /позже/);
});

test('ночь одной записью заменяет ночные нажатия', () => {
  const today = startOfDay(Date.now());
  const s1 = store.addSleep({ start: today - 2 * HOUR, end: today + 2 * HOUR });
  const s2 = store.addSleep({ start: today + 2 * HOUR + 10 * MIN, end: today + 6 * HOUR });
  const id = app.saveNight({ start: today - 3 * HOUR, end: today + 7 * HOUR, wakes: 2, ids: [s1, s2] }, today + 8 * HOUR);
  assert.equal(store.getSleep(s1), null);
  const n = store.getSleep(id);
  assert.equal(n.wakes, 2);
  assert.equal(store.get(`nightDone:${dateKey(today + 7 * HOUR)}`), true);
});

test('резервная копия и восстановление', () => {
  const file = join(dir, 'copy.db');
  store.backupTo(file);
  const count = store.listSleeps().length;
  store.addSleep({ start: Date.now() - 5 * HOUR, end: Date.now() - 4 * HOUR });
  assert.equal(store.restoreFrom(file), true);
  assert.equal(store.listSleeps().length, count);
});
