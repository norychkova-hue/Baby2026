process.env.TZ = 'Europe/Moscow';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, weekStart, dur, plural, startOfDay, MIN, DAY } from '../src/core/time.js';
import { normFor } from '../src/core/norms.js';
import { ageInfo, ageLabel } from '../src/core/age.js';
import { buildSleeps, dayStats, isNightSegment } from '../src/core/sleep.js';
import { status, feedingMode } from '../src/core/planner.js';
import { dueReminders } from '../src/core/reminders.js';
import { weeklyReport, reportMessage } from '../src/core/report.js';
import { currentLeap } from '../src/core/leaps.js';

const at = (key, time) => {
  const [h, m] = time.split(':').map(Number);
  return startOfDay(key) + (h * 60 + m) * MIN;
};
let nextId = 1;
const seg = (key, from, to, extra = {}) => {
  const start = at(key, from);
  let end = to == null ? null : at(key, to);
  if (end != null && end <= start) end += DAY; // ночь через полночь
  return { id: nextId++, start, end, wakes: 0, longWake: false, ...extra };
};

/** Обычный день 2-месячного: 4 сна + ночь */
function typicalDay(key, nightEnd = '07:00') {
  return [
    seg(key, '08:10', '09:20'),
    seg(key, '10:30', '11:10'),
    seg(key, '12:30', '14:00'),
    seg(key, '15:20', '16:00'),
    seg(key, '17:20', '17:50'),
    seg(key, '21:30', nightEnd, { wakes: 2 }),
  ];
}

const profile = { birth: at('2026-08-05', '10:00'), due: at('2026-08-07', '00:00'), birthWeight: 3420 };

test('время и склонения', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(weekStart('2026-10-11'), '2026-10-05'); // воскресенье → понедельник
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(dur(70), '1 ч 10 мин');
  assert.equal(dur(40), '40 мин');
  assert.equal(plural(3, ['сон', 'сна', 'снов']), 'сна');
  assert.equal(plural(11, ['сон', 'сна', 'снов']), 'снов');
  assert.equal(plural(21, ['сон', 'сна', 'снов']), 'сон');
});

test('нормы по возрасту: строки таблицы', () => {
  assert.equal(normFor(0.4).label, '0–1 мес');
  assert.equal(normFor(2).label, '2 мес');
  assert.deepEqual(normFor(2).ww, [60, 80]);
  assert.equal(normFor(5).label, '5–6 мес');
  assert.equal(normFor(9).label, '8–10 мес');
  assert.equal(normFor(30).label, '18–36 мес');
});

test('возраст: скорректированный только для недоношенных', () => {
  const now = at('2026-10-12', '12:00');
  const term = ageInfo(profile, now);
  assert.equal(term.corrected, false);
  assert.equal(ageLabel(term), '2 мес 1 нед');
  const preterm = ageInfo({ birth: at('2026-08-05', '10:00'), due: at('2026-09-05', '00:00') }, now);
  assert.equal(preterm.corrected, true);
  assert.ok(preterm.correctedMonths < term.correctedMonths - 0.9);
});

test('скачки по неделям от ПДР', () => {
  assert.equal(currentLeap(4), null);
  assert.match(currentLeap(5).text, /5-я неделя/);
  assert.match(currentLeap(17).name, /регресс/);
});

test('ночь и дневной сон различаются', () => {
  const now = at('2026-10-12', '23:00');
  assert.equal(isNightSegment(seg('2026-10-12', '13:00', '14:30'), now), false);
  assert.equal(isNightSegment(seg('2026-10-12', '18:10', '18:40'), now), false); // последний короткий сон
  assert.equal(isNightSegment(seg('2026-10-12', '21:30', '07:00'), now), true);
  assert.equal(isNightSegment(seg('2026-10-12', '02:00', '02:40'), now), true);
  assert.equal(isNightSegment(seg('2026-10-12', '19:30', null), now), true); // идёт сейчас вечером
});

test('продление сна ≤ 20 мин склеивается в один сон', () => {
  const k = '2026-10-12';
  const b = buildSleeps([seg(k, '10:00', '10:30'), seg(k, '10:45', '11:20'), seg(k, '13:00', '14:00')], at(k, '15:00'));
  assert.equal(b.naps.length, 2);
  assert.equal(Math.round(b.naps[0].sleepMin), 65);
});

test('ночь: короткие пробуждения — часть ночи, 30+ мин — гуляние', () => {
  const k = '2026-10-11';
  const b = buildSleeps([
    seg(k, '21:30', '01:00'),
    seg('2026-10-12', '01:10', '03:00'),
    seg('2026-10-12', '03:50', '07:00'),
  ], at('2026-10-12', '08:00'));
  assert.equal(b.nights.length, 1);
  const n = b.nights[0];
  assert.equal(n.key, '2026-10-11');
  assert.equal(n.wakes, 1);
  assert.equal(n.longWakes, 1);
  assert.equal(Math.round(n.awakeMin), 50);
  assert.equal(Math.round(n.sleepMin), 9 * 60 + 30 - 60);
});

test('итоги суток: сны, бодрствование, полные сутки', () => {
  const segs = [...typicalDay('2026-10-11'), ...typicalDay('2026-10-12')];
  const b = buildSleeps(segs, at('2026-10-13', '09:00'));
  const d = dayStats(b, '2026-10-12');
  assert.equal(d.napCount, 5);
  assert.equal(Math.round(d.daySleep), 70 + 40 + 90 + 40 + 30);
  assert.equal(Math.round(d.nightSleep), 9 * 60 + 30);
  assert.equal(d.nightWakes, 2);
  assert.ok(d.complete);
  assert.equal(d.windows.length, 6);
  assert.equal(Math.round(d.windows[0]), 70); // 7:00 → 8:10
  assert.equal(Math.round(d.windows.at(-1)), 220); // 17:50 → 21:30
  assert.equal(Math.round(d.wakeTotal), 24 * 60 - d.total);
});

test('статус: бодрствует → когда укладывать', () => {
  const k = '2026-10-12';
  const segs = [...typicalDay('2026-10-11'), seg(k, '08:10', '09:20'), seg(k, '10:30', '11:10')];
  const st = status({ profile, segments: segs, weights: [{ at: at('2026-10-10', '10:00'), grams: 5200 }] }, at(k, '11:40'));
  assert.equal(st.state, 'awake');
  assert.equal(st.headline, 'Не спит 30 мин');
  assert.equal(st.norm.label, '2 мес');
  assert.ok(st.window >= 60 && st.window <= 80, `окно ${st.window}`);
  assert.equal(st.today.napCount, 2);
  assert.equal(st.lastNight.wakes, 2);
  assert.equal(st.feeding.mode, 'free');
});

test('статус: долгий дневной сон → мягко будить через 2,5 ч', () => {
  const k = '2026-10-12';
  const segs = [...typicalDay('2026-10-11'), seg(k, '12:00', null)];
  const st = status({ profile, segments: segs, weights: [{ at: at('2026-10-10', '10:00'), grams: 5200 }] }, at(k, '14:40'));
  assert.equal(st.state, 'asleep');
  assert.equal(st.kind, 'day');
  assert.equal(st.nextAt, at(k, '14:30'));
  const r = dueReminders(st, at(k, '14:40'));
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'wake');
  assert.match(r[0].text, /Можно мягко будить/);
});

test('кормление: пока вес не вернулся — будить через 3 ч днём и 4 ч ночью', () => {
  const newborn = { birth: at('2026-10-01', '10:00'), due: at('2026-10-01', '00:00'), birthWeight: 3420 };
  const weights = [{ at: at('2026-10-10', '10:00'), grams: 3390 }];
  assert.equal(feedingMode(newborn, weights, at('2026-10-12', '12:00')).mode, 'control');
  const k = '2026-10-12';
  const day = status({ profile: newborn, segments: [seg(k, '11:00', null)], weights }, at(k, '13:00'));
  assert.equal(day.nextReason, 'nap'); // 2,5 ч раньше, чем 3 ч на кормление
  const night = status({ profile: newborn, segments: [seg(k, '22:00', null)], weights }, at('2026-10-13', '01:00'));
  assert.equal(night.kind, 'night');
  assert.equal(night.nextReason, 'feed');
  assert.equal(night.nextAt, at('2026-10-13', '02:00'));
  const r = dueReminders(night, at('2026-10-13', '02:01'));
  assert.match(r[0].text, /пора будить на кормление/);
  // вес вернулся и прибавка хорошая — ночью не будим
  const ok = [...weights, { at: at('2026-10-17', '10:00'), grams: 3600 }];
  assert.equal(feedingMode(newborn, ok, at('2026-10-18', '12:00')).mode, 'free');
});

test('напоминание «скоро укладывать» за 15 мин и только днём', () => {
  const k = '2026-10-12';
  const segs = [...typicalDay('2026-10-11'), seg(k, '08:10', '09:20')];
  const st = status({ profile, segments: segs, weights: [] }, at(k, '10:20'));
  const r = dueReminders(st, st.nextAt - 14 * MIN);
  assert.equal(r.length, 1);
  assert.match(r[0].text, /укладывать/);
  assert.equal(dueReminders(st, st.nextAt - 40 * MIN).length, 0);
});

test('«забыли нажать?» — дневной сон 4+ ч', () => {
  const k = '2026-10-12';
  const st = status({ profile, segments: [...typicalDay('2026-10-11'), seg(k, '09:00', null)], weights: [] }, at(k, '13:10'));
  assert.ok(dueReminders(st, at(k, '13:10')).some((r) => r.kind === 'forgot-wake'));
});

test('недельный отчёт против норм и прошлой недели', () => {
  const segs = [];
  for (let i = 0; i < 14; i++) {
    const key = addDays('2026-09-28', i);
    // на второй неделе ночь на 30 мин длиннее
    segs.push(...typicalDay(key, i < 7 ? '06:30' : '07:00'));
  }
  const rep = weeklyReport({ profile, segments: segs }, '2026-10-05', at('2026-10-12', '09:00'));
  assert.equal(rep.label, '5–11 октября');
  assert.equal(rep.days, 7);
  assert.ok(rep.enough);
  const night = rep.rows.find((r) => r.id === 'night');
  assert.equal(night.mark, 'ok');
  assert.equal(night.trend, 'up');
  assert.match(rep.summary, /ночь стала длиннее на 30 мин/i);
  const naps = rep.rows.find((r) => r.id === 'naps');
  assert.equal(naps.valueText, '5');
  const day = rep.rows.find((r) => r.id === 'day');
  assert.equal(day.mark, 'low'); // 4 ч 30 мин при норме 6–8 ч
  assert.ok(reportMessage(rep).includes('Неделя 5–11 октября'));
});

test('недельный отчёт при малом числе записей честно говорит об этом', () => {
  const segs = [...typicalDay('2026-10-06'), ...typicalDay('2026-10-07')];
  const rep = weeklyReport({ profile, segments: segs }, '2026-10-05', at('2026-10-12', '09:00'));
  assert.equal(rep.enough, false);
  assert.equal(rep.title, 'Мало записей за неделю');
});
