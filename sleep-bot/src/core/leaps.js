// Скачки развития — недели от ПДР (гайды 0–4 и 5–9 мес).
export const LEAPS = [
  { from: 5, to: 5, name: '«мир меняющихся ощущений»' },
  { from: 8, to: 9, name: '«мир явлений»' },
  { from: 11, to: 12, name: '«мир постепенных перемен»' },
  { from: 15, to: 19, name: '«мир событий» и регресс 4 месяцев' },
  { from: 23, to: 26, name: '«мир взаимосвязей»' },
  { from: 29, to: 30, name: 'пик сепарационной тревоги' },
  { from: 34, to: 37, name: '«мир категорий»' },
];

/** Идёт ли сейчас скачок: { from, to, name, text } или null */
export function currentLeap(weekFromDue) {
  const l = LEAPS.find((x) => weekFromDue >= x.from && weekFromDue <= x.to);
  if (!l) return null;
  const weeks = l.from === l.to ? `${l.from}-я неделя` : `${l.from}–${l.to}-я недели`;
  return {
    ...l,
    text: `Идёт скачок развития (${weeks} от ПДР) — сон может временно ухудшиться, это нормально.`,
  };
}
