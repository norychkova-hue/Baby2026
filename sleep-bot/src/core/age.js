import { DAY, plural } from './time.js';

const MONTH_DAYS = 30.4375;

/**
 * Возраст ребёнка.
 * - days / months — фактический;
 * - correctedMonths — скорректированный (для недоношенных: родился на 3+ недели раньше ПДР),
 *   по нему берутся нормы сна;
 * - weekFromDue — неделя жизни от ПДР (для календаря скачков).
 */
export function ageInfo(profile, now) {
  const birth = profile.birth;
  const due = profile.due ?? birth;
  const days = Math.max(0, Math.floor((now - birth) / DAY));
  const early = due - birth;
  const correction = early >= 21 * DAY ? early : 0;
  const correctedDays = Math.max(0, (now - birth - correction) / DAY);
  const weekFromDue = Math.floor((now - due) / DAY / 7) + 1;
  return {
    days,
    months: days / MONTH_DAYS,
    correctedMonths: correctedDays / MONTH_DAYS,
    corrected: correction > 0,
    weekFromDue,
  };
}

/** «12 дней», «5 нед», «2 мес 1 нед» */
export function ageLabel(info) {
  const d = info.days;
  if (d < 14) return `${d} ${plural(d, ['день', 'дня', 'дней'])}`;
  if (d < 61) {
    const w = Math.floor(d / 7);
    return `${w} нед`;
  }
  const m = Math.floor(d / MONTH_DAYS);
  const w = Math.floor((d - m * MONTH_DAYS) / 7);
  return w ? `${m} мес ${w} нед` : `${m} мес`;
}

