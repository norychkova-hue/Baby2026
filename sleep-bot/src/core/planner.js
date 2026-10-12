// «Что сейчас и что дальше» — главный экран и напоминания строятся отсюда.

import { MIN, DAY, dateKey, addDays, dur, hm } from './time.js';
import { ageInfo, ageLabel } from './age.js';
import { normFor, maxNapMinutes, cycleMinutes } from './norms.js';
import { buildSleeps, dayStats, isNightSegment } from './sleep.js';
import { currentLeap } from './leaps.js';

const minutes = (a, b) => (b - a) / MIN;

/** Через сколько минут после засыпания сон становится глубоким и можно перекладывать (до 4 мес) */
export const TRANSFER_MIN = 20;

/**
 * Режим «будить на кормление» (гайд 0–4, стр. 50; ARCHITECTURE §5):
 * будим, пока вес не вернулся к весу при рождении или прибавка < 150 г/нед.
 */
export function feedingMode(profile, weights, now) {
  if (!profile?.birthWeight) return { mode: 'free', reason: null };
  const age = ageInfo(profile, now);
  const ws = [...weights].sort((a, b) => a.at - b.at);
  const last = ws.at(-1);
  if (!last) {
    return age.days < 14
      ? { mode: 'control', reason: 'первые две недели, пока нет свежего веса' }
      : { mode: 'free', reason: null };
  }
  if (last.grams < profile.birthWeight) {
    return { mode: 'control', reason: 'вес ещё не вернулся к весу при рождении' };
  }
  const prior = [...ws].reverse().find((w) => last.at - w.at >= 5 * DAY);
  if (prior && age.months < 3) {
    const perWeek = ((last.grams - prior.grams) / ((last.at - prior.at) / DAY)) * 7;
    if (perWeek < 150) return { mode: 'control', reason: 'прибавка меньше 150 г в неделю', perWeek };
  }
  return { mode: 'free', reason: null };
}

/** Окно бодрствования на сейчас: индивидуальное (за 7 дней) или середина нормы */
export function targetWindow(norm, built, todayKey, lastNapMin, ageMonths) {
  const [lo, hi] = norm.ww;
  let base = (lo + hi) / 2;

  const recent = [];
  for (let i = 1; i <= 7; i++) {
    const d = dayStats(built, addDays(todayKey, -i));
    if (d.avgWindow != null && d.windows.length >= 2) recent.push(d.avgWindow);
  }
  // индивидуальная норма — если записей хватает и она не вышла далеко за возрастной коридор
  if (recent.length >= 5) {
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg >= lo * 0.75 && avg <= hi * 1.25) base = avg;
  }
  // после короткого сна бодрствование короче, после длинного — длиннее (гайд 0–4, стр. 45)
  if (lastNapMin != null) {
    const [cLo] = cycleMinutes(ageMonths);
    if (lastNapMin < cLo) base = Math.max(lo, base * 0.9);
    else if (lastNapMin >= 90) base = Math.min(hi * 1.1, base * 1.1);
  }
  return Math.round(base / 5) * 5;
}

/**
 * Состояние на сейчас.
 * @param {{profile, segments, weights, feedings, settings, snoozeUntil}} data
 */
export function status(data, now = Date.now()) {
  const { profile, segments = [], weights = [], feedings = [], settings = {} } = data;
  const age = ageInfo(profile, now);
  const norm = normFor(age.correctedMonths);
  const built = buildSleeps(segments, now);
  const todayKey = dateKey(now);
  const feeding = feedingMode(profile, weights, now);
  const leap = currentLeap(age.weekFromDue);

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const last = sorted.at(-1);
  const open = last && last.end == null ? last : null;

  const out = {
    now,
    age: { ...age, label: ageLabel(age) },
    norm,
    leap,
    feeding,
    state: 'none',
    since: null,
    headline: 'Нажмите, когда малыш уснёт',
    next: null,
    nextAt: null,
    why: null,
    ring: null,
  };

  // последний кормление — только если запись кормлений включена
  const lastFeed = settings.feedings ? [...feedings].sort((a, b) => a.at - b.at).at(-1) : null;

  if (open) {
    const night = isNightSegment(open, now);
    const block = (night ? built.nights : built.naps).find((b) => b.ids.includes(open.id));
    const sleptMin = minutes(block?.start ?? open.start, now);
    out.state = 'asleep';
    out.kind = night ? 'night' : 'day';
    out.since = block?.start ?? open.start;
    out.headline = `${night ? 'Ночь · спит' : 'Спит'} ${dur(sleptMin)}`;

    const candidates = [];
    if (!night) {
      const max = maxNapMinutes(age.correctedMonths);
      candidates.push({ at: out.since + max * MIN, reason: 'nap', why: `днём дольше ${dur(max)} подряд лучше не спать, чтобы не сбилась ночь` });
    }
    if (feeding.mode === 'control') {
      const from = lastFeed && lastFeed.at > out.since - 3 * 60 * MIN ? lastFeed.at : out.since;
      const gap = night ? 240 : 180;
      candidates.push({ at: from + gap * MIN, reason: 'feed', why: `${feeding.reason} — будим на кормление` });
    }
    candidates.sort((a, b) => a.at - b.at);
    const pick = candidates[0];
    if (pick) {
      let at = pick.at;
      if (data.snoozeUntil && data.snoozeUntil > at) at = data.snoozeUntil;
      out.nextAt = at;
      out.nextReason = pick.reason;
      out.next = pick.reason === 'feed' ? `Будить ≈ ${hm(at)} — кормление` : `Можно будить ≈ ${hm(at)}`;
      out.why = pick.why;
      out.ring = { kind: 'sleep', elapsed: sleptMin, total: minutes(out.since, at) };
    } else {
      out.next = 'Ночь — пусть спит';
      out.why = feeding.mode === 'free' ? 'вес в порядке, ночью будить не нужно' : null;
      out.ring = { kind: 'sleep', elapsed: sleptMin, total: Math.max(sleptMin, 10 * 60) };
    }
    // до ~4 мес сон начинается с быстрой (поверхностной) фазы: перекладывать — не раньше чем через 20 мин
    // (гайд 0–4, стр. 5 и 39: «ручка падает как тряпочка»)
    out.note = null;
    out.transferAt = null;
    if (age.correctedMonths < 4 && sleptMin < TRANSFER_MIN) {
      out.transferAt = out.since + TRANSFER_MIN * MIN;
      out.note = `Пока поверхностный сон, любой звук будит. Перекладывать лучше после ${hm(out.transferAt)} — когда ручка падает расслабленно.`;
    }
  } else if (last) {
    const lastBlock = [...built.naps, ...built.nights].find((b) => b.ids.includes(last.id));
    const lastNapMin = lastBlock?.kind === 'day' ? lastBlock.sleepMin : null;
    const ww = targetWindow(norm, built, todayKey, lastNapMin, age.correctedMonths);
    const awakeMin = minutes(last.end, now);
    out.state = 'awake';
    out.since = last.end;
    out.headline = `Не спит ${dur(awakeMin)}`;
    out.nextAt = last.end + ww * MIN;
    out.window = ww;
    out.next = `Укладывать ≈ ${hm(out.nextAt)}`;
    out.why = 'или раньше, если зевает, трёт глаза, «зависает»';
    out.ring = { kind: 'awake', elapsed: awakeMin, total: ww };
    const [cLo, cHi] = cycleMinutes(age.correctedMonths);
    if (lastNapMin != null && lastNapMin < cHi && age.correctedMonths < 4) {
      out.note = `Сон ${dur(lastNapMin)} — в этом возрасте это обычный один цикл сна (${cLo}–${cHi} мин).`;
    }
  }

  // итоги сегодняшних суток
  const today = dayStats(built, todayKey);
  out.today = {
    napCount: today.napCount,
    daySleep: today.daySleep,
    naps: today.naps.map((n) => ({ start: n.start, end: n.end, min: Math.round(n.sleepMin), ids: n.ids })),
    expectedNaps: norm.naps,
  };
  const lastNight = [...built.nights].reverse().find((n) => n.end != null && n.end <= now);
  out.lastNight = lastNight
    ? { start: lastNight.start, end: lastNight.end, sleepMin: Math.round(lastNight.sleepMin), wakes: lastNight.wakes + lastNight.longWakes, longWakes: lastNight.longWakes, ids: lastNight.ids, key: lastNight.key }
    : null;
  return out;
}
