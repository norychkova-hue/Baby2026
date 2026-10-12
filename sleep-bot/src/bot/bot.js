// Чат бота: кнопки «Уснул / Проснулся», ответы на напоминания, команды.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIN, hm, dur, dateKey } from '../core/time.js';
import { reportMessage } from '../core/report.js';
import { UserError } from '../app.js';

export const BTN_SLEEP = '😴 Уснул';
export const BTN_WAKE = '☀️ Проснулся';
const BTN_APP = '📱 Открыть приложение';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export class Bot {
  constructor({ tg, app, store, config, log = console }) {
    this.tg = tg;
    this.app = app;
    this.store = store;
    this.config = config;
    this.log = log;
  }

  get ownerId() {
    return this.config.ownerId ?? this.store.get('owner');
  }

  get chatId() {
    return this.store.get('chatId') ?? this.ownerId;
  }

  webAppUrl(hash = '') {
    const u = this.config.publicUrl;
    return u && u.startsWith('https://') ? `${u}/${hash ? '#' + hash : ''}` : null;
  }

  keyboard() {
    const rows = [[{ text: BTN_SLEEP }, { text: BTN_WAKE }]];
    const url = this.webAppUrl();
    if (url) rows.push([{ text: BTN_APP, web_app: { url } }]);
    return { keyboard: rows, resize_keyboard: true, is_persistent: true };
  }

  appButton(text = 'Открыть приложение', hash = '') {
    const url = this.webAppUrl(hash);
    return url ? { text, web_app: { url } } : null;
  }

  async send(text, extra = {}) {
    if (!this.chatId) return null;
    return this.tg.call('sendMessage', { chat_id: this.chatId, text, parse_mode: 'HTML', ...extra });
  }

  /** Кнопка меню рядом с полем ввода открывает Mini App */
  async setup() {
    const url = this.webAppUrl();
    try {
      await this.tg.call('setMyCommands', {
        commands: [
          { command: 'start', description: 'Кнопки и приложение' },
          { command: 'report', description: 'Отчёт за неделю' },
          { command: 'export', description: 'Выгрузить всё в таблицу' },
          { command: 'backup', description: 'Резервная копия' },
        ],
      });
      if (url) await this.tg.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Сон', web_app: { url } } });
      // адрес туннеля меняется при перезапуске — обновить кнопку «Открыть приложение» под полем ввода
      if (url && this.store.get('publicUrl') !== url) {
        if (this.chatId && this.store.get('publicUrl')) {
          await this.send('Бот перезапустился — кнопки обновлены.', { reply_markup: this.keyboard(), disable_notification: true });
        }
        this.store.set('publicUrl', url);
      }
    } catch (e) {
      this.log.warn('Не удалось настроить меню бота:', e.message);
    }
  }

  // ── входящие ──

  async handle(update) {
    try {
      if (update.message) await this.onMessage(update.message);
      else if (update.callback_query) await this.onCallback(update.callback_query);
    } catch (e) {
      this.log.error('Ошибка обработки', e);
    }
  }

  allowed(from) {
    if (!from) return false;
    if (this.ownerId == null) {
      // первый, кто написал /start, становится владельцем (бот личный)
      this.store.set('owner', from.id);
      this.log.info(`Владелец бота: ${from.id}`);
      return true;
    }
    return from.id === this.ownerId;
  }

  async onMessage(msg) {
    if (msg.chat?.type !== 'private') return;
    if (!this.allowed(msg.from)) {
      await this.tg.call('sendMessage', { chat_id: msg.chat.id, text: 'Это личный бот, он работает только для своей хозяйки.' });
      return;
    }
    this.store.set('chatId', msg.chat.id);
    const text = (msg.text || '').trim();

    if (msg.document) return this.onDocument(msg.document);
    if (text.startsWith('/start')) return this.cmdStart();
    if (text.startsWith('/report')) return this.cmdReport();
    if (text.startsWith('/export')) return this.cmdExport();
    if (text.startsWith('/backup')) return this.sendBackup('Резервная копия по запросу.');
    if (text === BTN_SLEEP) return this.tap('sleep');
    if (text === BTN_WAKE) return this.tap('wake');
    const grams = Number(text.replace(/\s|г|гр/gi, ''));
    if (Number.isInteger(grams) && grams >= 1500 && grams <= 20000) return this.weight(grams);
    return this.send('Отмечайте сон кнопками внизу. Остальное — в приложении.', { reply_markup: this.keyboard() });
  }

  async cmdStart() {
    const lines = [
      '<b>Привет! Я сонный помощник.</b>',
      'Нажимайте «Уснул» и «Проснулся» — я посчитаю сны, подскажу, когда укладывать и когда будить, и раз в неделю пришлю отчёт.',
    ];
    if (!this.store.getProfile()) lines.push('Сначала откройте приложение и укажите дату рождения малыша.');
    if (!this.webAppUrl()) lines.push('<i>Приложение пока не подключено: в настройках бота не указан адрес PUBLIC_URL (https). Кнопки в чате уже работают.</i>');
    await this.send(lines.join('\n\n'), { reply_markup: this.keyboard() });
  }

  async tap(kind, at = Date.now()) {
    if (!this.store.getProfile()) {
      const b = this.appButton('Заполнить профиль', 'profile');
      return this.send('Сначала укажите дату рождения малыша в приложении.', b ? { reply_markup: { inline_keyboard: [[b]] } } : {});
    }
    let res;
    try {
      res = kind === 'sleep' ? this.app.markSleep(at) : this.app.markWake(at);
    } catch (e) {
      if (e instanceof UserError) return this.send(esc(e.message));
      throw e;
    }
    return this.send(this.tapText(res), { reply_markup: { inline_keyboard: [this.shiftRow(res)] } });
  }

  tapText(res) {
    if (res.action === 'sleep') return `😴 Уснул в <b>${hm(res.at)}</b>.`;
    const st = this.app.state();
    const slept = res.start ? ` · спал ${dur((res.at - res.start) / MIN)}` : '';
    const next = st.state === 'awake' && st.nextAt ? `\nУкладывать ≈ ${hm(st.nextAt)}.` : '';
    return `☀️ Проснулся в <b>${hm(res.at)}</b>${slept}.${next}`;
  }

  shiftRow(res) {
    const a = res.action === 'sleep' ? 's' : 'w';
    const base = Math.round(res.at / MIN);
    return [
      ...[10, 20, 30].map((m) => ({ text: `−${m} мин`, callback_data: `sh:${a}:${res.id}:${base}:${m}` })),
      { text: 'Отменить', callback_data: `u:${a}:${res.id}` },
    ];
  }

  async weight(grams) {
    try {
      const id = this.app.addWeight(grams);
      const st = this.app.state();
      const note = st.feeding?.mode === 'control' ? `\nПока ${st.feeding.reason}, напомню будить на кормление.` : '';
      return this.send(`⚖️ Записала вес <b>${grams.toLocaleString('ru-RU')} г</b>.${note}`, {
        reply_markup: { inline_keyboard: [[{ text: 'Отменить', callback_data: `uw:${id}` }]] },
      });
    } catch (e) {
      if (e instanceof UserError) return this.send(esc(e.message));
      throw e;
    }
  }

  async cmdReport() {
    const cur = this.app.report(0);
    if (!cur) return this.send('Сначала укажите дату рождения в приложении.');
    const rep = cur.days >= 3 ? cur : this.app.report(-1);
    return this.sendReport(rep);
  }

  async sendReport(rep) {
    const b = this.appButton('Открыть отчёт', `report-${rep.mondayKey}`);
    return this.send(reportMessage(rep), b ? { reply_markup: { inline_keyboard: [[b]] } } : {});
  }

  async cmdExport() {
    const file = resolve(this.config.dataDir, `сон-${dateKey(Date.now())}.csv`);
    writeFileSync(file, this.app.exportCsv());
    await this.tg.sendDocument(this.chatId, file, { caption: 'Все записи сна и веса. Открывается в Excel и Google Таблицах.' });
  }

  async sendBackup(caption = 'Ночная резервная копия. Чтобы восстановить данные, просто перешлите этот файл боту.') {
    const file = resolve(this.config.dataDir, `backup-${dateKey(Date.now())}.db`);
    this.store.backupTo(file);
    await this.tg.sendDocument(this.chatId, file, { caption, filename: `sleep-backup-${dateKey(Date.now())}.db` });
  }

  async onDocument(doc) {
    if (!/\.db$/i.test(doc.file_name || '')) return this.send('Я понимаю только файлы резервной копии (.db).');
    const buf = await this.tg.downloadFile(doc.file_id);
    const file = resolve(this.config.dataDir, 'restore-upload.db');
    writeFileSync(file, buf);
    return this.send('Восстановить данные из этой копии? Текущие записи будут заменены.', {
      reply_markup: { inline_keyboard: [[{ text: 'Да, восстановить', callback_data: 'rs' }, { text: 'Нет', callback_data: 'rsno' }]] },
    });
  }

  // ── нажатия на кнопки под сообщениями ──

  async onCallback(q) {
    if (!this.allowed(q.from)) return this.tg.call('answerCallbackQuery', { callback_query_id: q.id });
    const data = q.data || '';
    const msg = q.message;
    let toast = '';
    const edit = (text, keyboard) => this.tg.call('editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, text, parse_mode: 'HTML',
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    }).catch((e) => { if (!/not modified/.test(e.message)) throw e; });

    try {
      if (data.startsWith('sh:')) {
        const [, a, id, base, m] = data.split(':');
        const res = this.app.shift({ action: a === 's' ? 'sleep' : 'wake', id: Number(id) }, Number(m), Number(base) * MIN);
        const full = { ...res, start: a === 'w' ? this.store.getSleep(Number(id))?.start : undefined };
        await edit(this.tapText(full), [this.shiftRow({ ...full, at: Number(base) * MIN })]);
        toast = `Поправила: ${hm(res.at)}`;
      } else if (data.startsWith('u:')) {
        const [, a, id] = data.split(':');
        this.app.undo({ action: a === 's' ? 'sleep' : 'wake', id: Number(id) });
        await edit(a === 's' ? '<s>Уснул</s> — отменено.' : '<s>Проснулся</s> — отменено, сон продолжается.');
        toast = 'Отменено';
      } else if (data.startsWith('uw:')) {
        this.store.deleteWeight(Number(data.slice(3)));
        await edit('<s>Вес</s> — отменено.');
      } else if (data === 'wn' || data.startsWith('wa:')) {
        const ago = data === 'wn' ? 0 : Number(data.slice(3));
        const res = this.app.markWake(Date.now() - ago * MIN);
        await edit(`${msg.text ? esc(msg.text) + '\n\n' : ''}${this.tapText(res)}`);
      } else if (data.startsWith('sa:')) {
        const res = this.app.markSleep(Date.now() - Number(data.slice(3)) * MIN);
        await edit(`${msg.text ? esc(msg.text) + '\n\n' : ''}${this.tapText(res)}`);
      } else if (data === 'z15') {
        this.app.snooze(15);
        await edit(`${esc(msg.text || '')}\n\nХорошо, напомню через 15 минут.`);
      } else if (data === 'rs') {
        const ok = this.store.restoreFrom(resolve(this.config.dataDir, 'restore-upload.db'));
        await edit(ok ? '✅ Данные восстановлены из копии.' : 'Этот файл не похож на резервную копию бота.');
      } else if (data === 'rsno') {
        await edit('Хорошо, ничего не меняю.');
      }
    } catch (e) {
      if (e instanceof UserError) toast = e.message;
      else throw e;
    } finally {
      await this.tg.call('answerCallbackQuery', { callback_query_id: q.id, text: toast || undefined }).catch(() => {});
    }
  }

  // ── долгий опрос Telegram ──

  async poll(signal) {
    let offset = this.store.get('updateOffset', 0);
    while (!signal?.aborted) {
      try {
        const updates = await this.tg.call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          this.store.set('updateOffset', offset);
          await this.handle(u);
        }
      } catch (e) {
        if (signal?.aborted) break;
        this.log.warn('Нет связи с Telegram, повтор через 5 с:', e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}
