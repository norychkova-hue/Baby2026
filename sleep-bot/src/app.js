// Действия приложения — общие для бота и Mini App. Здесь проверки, чтобы данные не ломались.

import { MIN, DAY, HOUR, dateKey, addDays, weekStart, startOfDay, hm } from './core/time.js';
import { status } from './core/planner.js';
import { weeklyReport } from './core/report.js';
import { buildSleeps } from './core/sleep.js';

const HISTORY_DAYS = 60;

export class UserError extends Error {}

export class App {
  constructor(store) {
    this.store = store;
  }

  data(now = Date.now()) {
    const s = this.store;
    return {
      profile: s.getProfile(),
      segments: s.listSleeps(now - HISTORY_DAYS * DAY),
      weights: s.listWeights(),
      feedings: s.listFeedings(now - 2 * DAY),
      settings: s.getSettings(),
      snoozeUntil: s.get('snoozeUntil'),
    };
  }

  /** Всё для главного экрана */
  state(now = Date.now()) {
    const d = this.data(now);
    const tz = process.env.TZ;
    if (!d.profile) return { needsProfile: true, settings: d.settings, tz, now };
    const st = status(d, now);
    const s = this.store;
    const lastWeight = d.weights.at(-1) ?? null;
    return {
      ...st,
      tz,
      profile: d.profile,
      settings: d.settings,
      lastWeight,
      lastFeeding: d.settings.feedings ? d.feedings.at(-1) ?? null : null,
      nightForm: this.nightForm(now, st),
      openId: s.openSleep()?.id ?? null,
    };
  }

  // ── сон ──

  /** Одна кнопка «Уснул / Проснулся». at — момент (можно в прошлом). */
  toggle(at = Date.now(), now = Date.now()) {
    at = Math.min(at, now);
    const open = this.store.openSleep();
    if (open) {
      if (at <= open.start) at = Math.min(now, open.start + MIN);
      this.store.updateSleep(open.id, { end: at });
      this.store.set('snoozeUntil', null);
      return { action: 'wake', id: open.id, at, start: open.start };
    }
    const last = this.store.lastSleep();
    if (last && at < last.end) at = last.end;
    const id = this.store.addSleep({ start: at });
    this.store.set('snoozeUntil', null);
    return { action: 'sleep', id, at };
  }

  /** Явно «уснул» / «проснулся» — из чата, где кнопки две */
  markSleep(at, now = Date.now()) {
    if (this.store.openSleep()) throw new UserError('Уже отмечено, что малыш спит.');
    return this.toggle(at, now);
  }

  markWake(at, now = Date.now()) {
    if (!this.store.openSleep()) throw new UserError('Сейчас не отмечено, что малыш спит. Сначала нажмите «Уснул».');
    return this.toggle(at, now);
  }

  /** Отмена последнего нажатия */
  undo(result) {
    if (result.action === 'sleep') this.store.deleteSleep(result.id);
    else this.store.updateSleep(result.id, { end: null });
  }

  /** Сдвинуть время только что сделанной записи (бегунок «когда») */
  shift(result, minutesAgo, now = Date.now()) {
    const at = now - minutesAgo * MIN;
    const seg = this.store.getSleep(result.id);
    if (!seg) throw new UserError('Запись не найдена.');
    if (result.action === 'sleep') {
      const prev = this.store.listSleeps(at - DAY).filter((x) => x.id !== seg.id && x.end != null && x.end <= seg.start).at(-1);
      const start = prev && at < prev.end ? prev.end : at;
      this.store.updateSleep(seg.id, { start });
      return { ...result, at: start };
    }
    const end = Math.max(at, seg.start + MIN);
    this.store.updateSleep(seg.id, { end });
    return { ...result, at: end };
  }

  /** Поправить или добавить сон (кружок / «＋») */
  saveSleep({ id, start, end }, now = Date.now()) {
    start = Number(start);
    end = end == null ? null : Number(end);
    if (!Number.isFinite(start)) throw new UserError('Не указано, когда уснул.');
    if (end != null && end <= start) throw new UserError('«Проснулся» должно быть позже, чем «уснул».');
    if (start > now + MIN || (end != null && end > now + MIN)) throw new UserError('Время ещё не наступило.');
    if (end != null && end - start > 16 * HOUR) throw new UserError('Сон длиннее 16 часов — проверьте время.');
    const clash = this.store.overlapping(start, end ?? now, now).filter((x) => x !== Number(id));
    if (clash.length) throw new UserError('Этот сон пересекается с другим. Сначала поправьте соседний.');
    if (end == null) {
      const open = this.store.openSleep();
      if (open && open.id !== Number(id)) throw new UserError('Уже идёт другой сон.');
    }
    if (id) {
      if (!this.store.updateSleep(Number(id), { start, end })) throw new UserError('Запись не найдена.');
      return Number(id);
    }
    return this.store.addSleep({ start, end });
  }

  deleteSleep(id) {
    this.store.deleteSleep(Number(id));
  }

  /** Удалить целый сон (блок из нескольких нажатий) */
  deleteBlock(ids) {
    for (const id of ids) this.store.deleteSleep(Number(id));
  }

  /** Поправить целый сон из нескольких отрезков: схлопываем в один отрезок */
  saveBlock({ ids = [], start, end }, now = Date.now()) {
    const keep = ids.length ? Number(ids[0]) : null;
    const others = ids.slice(1).map(Number);
    const old = others.map((id) => this.store.getSleep(id)).filter(Boolean);
    for (const id of others) this.store.deleteSleep(id);
    try {
      return this.saveSleep({ id: keep, start, end }, now);
    } catch (e) {
      for (const o of old) this.store.addSleep(o); // вернуть как было
      throw e;
    }
  }

  // ── ночь одной записью ──

  /** Что показать в утренней форме «Как прошла ночь?» (с 5 до 12 ч) */
  nightForm(now, st) {
    const m = (now - startOfDay(now)) / MIN;
    if (m < 5 * 60 || m >= 12 * 60) return null;
    const today = dateKey(now);
    if (this.store.get(`nightDone:${today}`)) return null;
    if (st?.state === 'asleep' && st.kind === 'night') return null; // ещё спит
    const n = st?.lastNight && st.lastNight.end >= startOfDay(now) ? st.lastNight : null;
    const yesterday = addDays(today, -1);
    return {
      date: today,
      start: n?.start ?? startOfDay(yesterday) + 21 * HOUR,
      end: n?.end ?? Math.min(now, startOfDay(today) + 7 * HOUR),
      wakes: n?.wakes ?? 0,
      longWake: (n?.longWakes ?? 0) > 0,
      ids: n?.ids ?? [],
      fromTaps: Boolean(n),
    };
  }

  saveNight({ start, end, wakes = 0, longWake = false, ids = [] }, now = Date.now()) {
    start = Number(start);
    end = Number(end);
    if (!(end > start)) throw new UserError('«Проснулся» должно быть позже, чем «уснул».');
    if (end - start > 16 * HOUR) throw new UserError('Ночь длиннее 16 часов — проверьте время.');
    if (end > now + MIN) throw new UserError('Время ещё не наступило.');
    const replace = new Set([...ids.map(Number), ...this.store.overlapping(start, end, now)]);
    for (const id of replace) this.store.deleteSleep(id);
    const id = this.store.addSleep({ start, end, wakes: Math.max(0, Math.min(20, Number(wakes) || 0)), longWake: Boolean(longWake) });
    this.store.set(`nightDone:${dateKey(end)}`, true);
    return id;
  }

  skipNightForm(now = Date.now()) {
    this.store.set(`nightDone:${dateKey(now)}`, true);
  }

  // ── вес, кормления, профиль ──

  addWeight(grams, at = Date.now()) {
    grams = Math.round(Number(grams));
    if (!(grams >= 1000 && grams <= 25000)) throw new UserError('Вес должен быть в граммах, например 3450.');
    return this.store.addWeight(at, grams);
  }

  addFeeding(at = Date.now(), side = null, now = Date.now()) {
    if (side && !['L', 'R'].includes(side)) side = null;
    return this.store.addFeeding(Math.min(at, now), side);
  }

  updateFeeding(id, at, side = null, now = Date.now()) {
    if (side && !['L', 'R'].includes(side)) side = null;
    if (!Number.isFinite(at)) throw new UserError('Не указано время кормления.');
    this.store.updateFeeding(id, Math.min(at, now), side);
  }

  deleteFeeding(id) {
    this.store.deleteFeeding(id);
  }

  saveProfile({ name, birth, due, birthWeight }) {
    birth = Number(birth);
    if (!Number.isFinite(birth)) throw new UserError('Укажите дату рождения.');
    due = due ? Number(due) : null;
    birthWeight = birthWeight ? Math.round(Number(birthWeight)) : null;
    if (birthWeight != null && !(birthWeight >= 500 && birthWeight <= 7000)) throw new UserError('Вес при рождении — в граммах, например 3420.');
    this.store.saveProfile({ name: name?.trim() || null, birth, due, birthWeight });
  }

  saveSettings(s) {
    const clean = {};
    if ('feedings' in s) clean.feedings = Boolean(s.feedings);
    this.store.saveSettings(clean);
  }

  snooze(minutes, now = Date.now()) {
    this.store.set('snoozeUntil', now + minutes * MIN);
  }

  // ── отчёты и выгрузка ──

  /** offset 0 — текущая неделя, -1 — прошлая */
  report(offset = -1, now = Date.now()) {
    const d = this.data(now);
    if (!d.profile) return null;
    const monday = addDays(weekStart(dateKey(now)), offset * 7);
    return weeklyReport({ profile: d.profile, segments: this.store.listSleeps(startOfDay(monday) - 8 * DAY) }, monday, now);
  }

  /** CSV для Excel / Google Таблиц и для консультанта */
  exportCsv(now = Date.now()) {
    const segs = this.store.listSleeps(0);
    const built = buildSleeps(segs, now);
    const rows = [['Дата', 'Тип', 'Уснул', 'Проснулся', 'Длительность, мин', 'Просыпался ночью', 'Гуляния 30+ мин']];
    const all = [...built.naps.map((n) => ({ ...n, t: 'дневной сон' })), ...built.nights.map((n) => ({ ...n, t: 'ночь' }))].sort((a, b) => a.start - b.start);
    for (const b of all) {
      rows.push([
        dateKey(b.start),
        b.t,
        hm(b.start),
        b.end ? hm(b.end) : '',
        Math.round(b.sleepMin),
        b.kind === 'night' ? b.wakes + b.longWakes : '',
        b.kind === 'night' ? b.longWakes : '',
      ]);
    }
    for (const w of this.store.listWeights()) rows.push([dateKey(w.at), 'вес, г', '', '', w.grams, '', '']);
    return '﻿' + rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(';')).join('\r\n');
  }
}
