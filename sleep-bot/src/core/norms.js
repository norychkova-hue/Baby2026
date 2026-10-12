// Нормы сна по возрасту — таблица из гайда «Сон 0–4 мес» (К. Мирошникова, стр. 14).
// Все длительности в минутах. Возраст в месяцах (скорректированный, см. age.js).
//
// В таблице строки подписаны «0–1», «2», «3»… Границы между ними поставлены посередине,
// чтобы ребёнок в 6 недель не получал окна «как в 0 недель»: строка «2» действует с 1,5 до 2,5 мес и т. д.

const h = (x) => Math.round(x * 60);

export const NORMS = [
  { label: '0–1 мес',   from: 0,    to: 1.5, ww: [30, 50],          wwTotal: [h(6), h(8)],   naps: [4, 7], day: [h(6), h(8)],     night: [h(8), h(10)],  total: [h(16), h(18)] },
  { label: '2 мес',     from: 1.5,  to: 2.5, ww: [60, 80],          wwTotal: [h(6), h(10)],  naps: [4, 6], day: [h(6), h(8)],     night: [h(8), h(10)],  total: [h(14), h(18)] },
  { label: '3 мес',     from: 2.5,  to: 3.5, ww: [80, 100],         wwTotal: [h(7), h(10)],  naps: [4, 6], day: [h(5), h(7)],     night: [h(9), h(10)],  total: [h(14), h(17)] },
  { label: '4 мес',     from: 3.5,  to: 4.5, ww: [100, 120],        wwTotal: [h(8), h(10)],  naps: [4, 5], day: [h(4), h(6)],     night: [h(10), h(11)], total: [h(14), h(16)] },
  { label: '5–6 мес',   from: 4.5,  to: 6,   ww: [110, 140],        wwTotal: [h(9), h(11)],  naps: [3, 4], day: [h(3), h(4)],     night: [h(10), h(11)], total: [h(13), h(15)] },
  { label: '6–7 мес',   from: 6,    to: 8,   ww: [140, 180],        wwTotal: [h(10), h(11)], naps: [3, 3], day: [h(3), h(3.5)],   night: [h(10), h(11)], total: [h(13), h(14)] },
  { label: '8–10 мес',  from: 8,    to: 10.5, ww: [180, 240],       wwTotal: [h(10), h(12)], naps: [2, 3], day: [h(2.5), h(3)],   night: [h(10), h(11)], total: [h(12), h(14)] },
  { label: '11–12 мес', from: 10.5, to: 13,  ww: [210, 270],        wwTotal: [h(10), h(12)], naps: [2, 2], day: [h(2), h(3)],     night: [h(10), h(11)], total: [h(12), h(14)] },
  { label: '13–17 мес', from: 13,   to: 18,  ww: [210, 330],        wwTotal: [h(11), h(12)], naps: [1, 2], day: [h(1.5), h(2.5)], night: [h(10), h(12)], total: [h(12), h(13)] },
  { label: '18–36 мес', from: 18,   to: Infinity, ww: [330, 390],   wwTotal: [h(11), h(12)], naps: [1, 1], day: [h(1.5), h(2.5)], night: [h(10), h(12)], total: [h(12), h(13)] },
];

/** Норма для возраста в месяцах */
export function normFor(ageMonths) {
  return NORMS.find((n) => ageMonths >= n.from && ageMonths < n.to) ?? NORMS[0];
}

/**
 * Самый длинный дневной сон подряд, после которого стоит мягко будить.
 * Гайд 0–4: «долго спит днём — более 2,5–3 ч подряд»; гайд 5–9: «не более 2–2,5 ч за раз».
 */
export function maxNapMinutes(ageMonths) {
  return ageMonths < 5 ? 150 : 120;
}

/** Длина сна-цикла: до 3 мес 30–50 мин, после — 40–45 мин */
export function cycleMinutes(ageMonths) {
  return ageMonths < 3 ? [30, 50] : [40, 45];
}

/** Сравнение значения с коридором нормы → 'ok' | 'low' | 'high' и «насколько» */
export function compare(value, [lo, hi]) {
  if (value == null) return { mark: 'none' };
  if (value < lo) return { mark: 'low', slight: value >= lo * 0.9 };
  if (value > hi) return { mark: 'high', slight: value <= hi * 1.1 };
  return { mark: 'ok' };
}
