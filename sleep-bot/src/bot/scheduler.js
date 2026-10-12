// Раз в 30 секунд: напоминания, недельный отчёт, вопрос про вес, ночная резервная копия.

import { DAY, dateKey, minuteOfDay, weekStart, addDays } from '../core/time.js';
import { dueReminders } from '../core/reminders.js';
import { BTN_WAKE } from './bot.js';

export class Scheduler {
  constructor({ bot, app, store, config, log = console }) {
    Object.assign(this, { bot, app, store, config, log });
  }

  start(intervalMs = 30_000) {
    this.timer = setInterval(() => this.tick().catch((e) => this.log.error('Планировщик:', e)), intervalMs);
    this.tick().catch((e) => this.log.error('Планировщик:', e));
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Отправить один раз по ключу */
  async once(key, fn) {
    if (this.store.wasSent(key)) return false;
    this.store.markSent(key);
    try {
      await fn();
    } catch (e) {
      this.log.error(`Не удалось отправить ${key}:`, e.message);
    }
    return true;
  }

  async tick(now = Date.now()) {
    if (!this.bot.chatId) return;
    const st = this.app.state(now);
    if (st.needsProfile) return;

    // 1. напоминания по сну
    for (const r of dueReminders(st, now)) {
      await this.once(r.key, () => this.bot.send(r.text, {
        disable_notification: r.silent,
        reply_markup: this.buttons(r),
      }));
    }

    const mod = minuteOfDay(now);
    const dow = new Date(now).getDay();
    const today = dateKey(now);

    // 2. недельный отчёт (по умолчанию в понедельник в 9:00 — за прошедшую неделю)
    const { day, minute } = this.config.report;
    if (dow === day && mod >= minute && mod < minute + 120) {
      const monday = addDays(weekStart(today), day === 1 ? -7 : 0);
      await this.once(`report:${monday}`, () => {
        const offset = day === 1 ? -1 : 0;
        return this.bot.sendReport(this.app.report(offset, now));
      });
    }

    // 3. вес: раз в неделю (первые 2 недели — раз в 3 дня), днём
    const lastW = st.lastWeight?.at ?? 0;
    const every = st.age.days < 14 ? 3 : 7;
    if (mod >= 11 * 60 && mod < 20 * 60 && now - lastW >= every * DAY) {
      await this.once(`weight:${today}`, () => this.bot.send('⚖️ Есть свежий вес? Просто пришлите число в граммах, например <b>5230</b>. Если нет — ничего делать не нужно.', { disable_notification: true }));
    }

    // 4. ночная резервная копия прямо в чат
    if (mod >= this.config.backupMinute && mod < this.config.backupMinute + 60) {
      await this.once(`backup:${today}`, () => this.bot.sendBackup());
    }
  }

  buttons(r) {
    const app = this.bot.appButton('Поправить в приложении');
    if (r.kind === 'wake') return { inline_keyboard: [[{ text: BTN_WAKE, callback_data: 'wn' }, { text: 'Ещё 15 мин', callback_data: 'z15' }]] };
    if (r.kind === 'forgot-wake') {
      return { inline_keyboard: [[{ text: 'Проснулся сейчас', callback_data: 'wn' }, { text: '30 мин назад', callback_data: 'wa:30' }, { text: '1 ч назад', callback_data: 'wa:60' }], ...(app ? [[app]] : [])] };
    }
    if (r.kind === 'forgot-sleep') {
      return { inline_keyboard: [[{ text: 'Уснул 15 мин назад', callback_data: 'sa:15' }, { text: '30 мин назад', callback_data: 'sa:30' }], ...(app ? [[app]] : [])] };
    }
    return undefined;
  }
}

