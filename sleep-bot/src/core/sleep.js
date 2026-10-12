// Из «сырых» нажатий (отрезков сна) собираем дневные сны и ночи.
// Правила из гайдов (см. docs/ARCHITECTURE.md §2):
// - проснулся и через ≤ 20 мин снова уснул — это один продлённый сон;
// - ночное пробуждение < 30 мин — часть ночи; ≥ 30 мин — ночное «гуляние»;
// - сутки — от утреннего подъёма до следующего утреннего подъёма.

import { MIN, HOUR, minuteOfDay, dateKey, addDays } from './time.js';

export const MERGE_GAP_MIN = 20;
export const LONG_WAKE_MIN = 30;
const NIGHT_GAP_MAX_MIN = 4 * 60;

const minutes = (a, b) => (b - a) / MIN;

function inEvening(ms) {
  const m = minuteOfDay(ms);
  return m >= 18 * 60 || m < 5 * 60;
}

/** Отрезок сна — ночной? */
export function isNightSegment(seg, now) {
  const end = seg.end ?? now;
  const len = minutes(seg.start, end);
  const m = minuteOfDay(seg.start);
  if (m < 5 * 60) return true; // после полуночи — всегда ночь
  if (len >= 5 * 60) return true; // 5+ часов подряд — ночь (днём так не спят)
  if (!inEvening(seg.start)) return false;
  if (seg.end == null) return m >= 19 * 60; // идёт сейчас: с 19:00 считаем ночью
  return len >= 120;
}

/** Ключ «суток» для ночи — дата вечера, в который она началась */
export function nightKey(start) {
  return dateKey(start - 6 * HOUR);
}

/**
 * Группирует отрезки в сны и ночи.
 * @param {Array<{id,start,end,wakes?,longWake?}>} segments
 * @returns {{naps: Array, nights: Array}}
 */
export function buildSleeps(segments, now = Date.now()) {
  const segs = [...segments].sort((a, b) => a.start - b.start);
  const naps = [];
  const nights = [];
  let cur = null; // текущий собираемый блок

  const close = () => {
    if (!cur) return;
    (cur.kind === 'night' ? nights : naps).push(cur);
    cur = null;
  };

  for (const s of segs) {
    let night = isNightSegment(s, now);
    const gap = cur?.end != null ? minutes(cur.end, s.start) : null;

    // ранний подъём до 6:00 и снова сон вскоре после ночи — продолжение ночи
    if (!night && cur?.kind === 'night' && gap != null && gap <= 60 && minuteOfDay(s.start) < 6 * 60) night = true;

    if (cur && cur.end != null && gap != null) {
      if (cur.kind === 'night' && night && gap < NIGHT_GAP_MAX_MIN) {
        if (gap < LONG_WAKE_MIN) cur.wakes += 1;
        else { cur.longWakes += 1; cur.awakeMin += gap; }
        append(cur, s);
        continue;
      }
      if (cur.kind === 'day' && !night && gap <= MERGE_GAP_MIN) {
        append(cur, s);
        continue;
      }
      // дневной сон, «перешедший» в ночь: короткий вечерний сон + ночь через ≤ 20 мин
      if (cur.kind === 'day' && night && gap <= MERGE_GAP_MIN && inEvening(cur.start)) {
        cur.kind = 'night';
        cur.wakes += 1;
        append(cur, s);
        continue;
      }
    }
    close();
    cur = {
      kind: night ? 'night' : 'day',
      start: s.start,
      end: s.end,
      sleepMin: 0,
      ids: [],
      wakes: 0,
      longWakes: 0,
      awakeMin: 0,
    };
    append(cur, s);
  }
  close();

  for (const n of nights) n.key = nightKey(n.start);
  for (const n of naps) n.key = dateKey(n.start);
  return { naps, nights };

  function append(block, s) {
    block.ids.push(s.id);
    block.end = s.end;
    block.sleepMin += minutes(s.start, s.end ?? now);
    if (block.kind === 'night') {
      block.wakes += s.wakes ?? 0;
      if (s.longWake) block.longWakes = Math.max(block.longWakes, 1);
    }
  }
}

/**
 * Итоги «суток» D: от утреннего подъёма D до утреннего подъёма D+1.
 * Дневные сны — начатые в дату D; ночь — та, что началась вечером D.
 */
export function dayStats(built, key) {
  const morning = built.nights.find((n) => n.key === addDays(key, -1) && n.end != null);
  const night = built.nights.find((n) => n.key === key);
  const naps = built.naps.filter((n) => n.key === key);

  const daySleep = naps.reduce((a, n) => a + n.sleepMin, 0);
  const points = [];
  if (morning) points.push(['wake', morning.end]);
  for (const n of naps) {
    points.push(['sleep', n.start]);
    if (n.end != null) points.push(['wake', n.end]);
  }
  if (night) points.push(['sleep', night.start]);

  const windows = [];
  for (let i = 0; i + 1 < points.length; i++) {
    if (points[i][0] === 'wake' && points[i + 1][0] === 'sleep') windows.push(minutes(points[i][1], points[i + 1][1]));
  }

  const nightDone = night && night.end != null;
  const complete = Boolean(morning && nightDone);
  const total = nightDone ? daySleep + night.sleepMin : null;
  return {
    key,
    wakeUp: morning?.end ?? null,
    bedtime: night?.start ?? null,
    naps,
    napCount: naps.length,
    daySleep,
    night: night ?? null,
    nightSleep: nightDone ? night.sleepMin : null,
    nightWakes: night ? night.wakes + night.longWakes : null,
    longWakes: night ? night.longWakes : null,
    total,
    windows,
    avgWindow: windows.length ? windows.reduce((a, b) => a + b, 0) / windows.length : null,
    // суточное бодрствование = 24 ч − суточный сон (гайд 5–9, стр. 22)
    wakeTotal: total != null ? 24 * 60 - total : null,
    complete,
  };
}
