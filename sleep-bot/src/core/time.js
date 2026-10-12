// Время хранится в миллисекундах (epoch). Все «местные» расчёты идут в часовом поясе процесса,
// поэтому при запуске задаётся process.env.TZ (см. config.js).

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Минуты от местной полуночи: 0…1439 */
export function minuteOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Ключ местной даты 'YYYY-MM-DD' */
export function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Местная полночь для даты-ключа или момента */
export function startOfDay(msOrKey) {
  if (typeof msOrKey === 'string') {
    const [y, m, d] = msOrKey.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const d = new Date(msOrKey);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Сдвиг даты-ключа на n дней (учитывает переход на летнее время) */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n, 12).getTime());
}

/** Понедельник недели, в которую входит дата-ключ */
export function weekStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // 0 = понедельник
  return addDays(key, -dow);
}

/** «13:05» */
export function hm(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** «1 ч 10 мин», «40 мин» */
export function dur(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}

/** «1:10» для коротких подписей */
export function hmm(minutes) {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Склонение: plural(3, ['сон','сна','снов']) → 'сна' */
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «6–12 октября» / «28 сентября – 4 октября» */
export function rangeLabel(fromKey, toKey) {
  const [, m1, d1] = fromKey.split('-').map(Number);
  const [, m2, d2] = toKey.split('-').map(Number);
  if (m1 === m2) return `${d1}–${d2} ${MONTHS[m2 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}
