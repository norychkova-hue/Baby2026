// Отчёт за неделю: среднее за 7 суток против таблицы норм (§3) и против прошлой недели.

import { addDays, dur, hmm, rangeLabel, startOfDay, HOUR } from './time.js';
import { ageInfo } from './age.js';
import { normFor, compare } from './norms.js';
import { buildSleeps, dayStats } from './sleep.js';
import { currentLeap } from './leaps.js';

const hrs = ([a, b]) => `${a / 60}–${b / 60} ч`.replace(/\./g, ',');

const avg = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function weekAverages(built, mondayKey) {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(dayStats(built, addDays(mondayKey, i)));
  const full = days.filter((d) => d.complete);
  return {
    days: full.length,
    total: avg(full.map((d) => d.total)),
    night: avg(full.map((d) => d.nightSleep)),
    naps: avg(full.map((d) => d.napCount)),
    day: avg(full.map((d) => d.daySleep)),
    window: avg(full.map((d) => d.avgWindow)),
    wakeTotal: avg(full.map((d) => d.wakeTotal)),
    nightWakes: avg(full.map((d) => d.nightWakes)),
  };
}

const METRICS = [
  { id: 'total', label: 'Сон за сутки', norm: 'total', fmt: (v) => dur(v), nfmt: hrs },
  { id: 'night', label: 'Ночной сон', norm: 'night', fmt: (v) => dur(v), nfmt: hrs },
  { id: 'naps', label: 'Дневных снов', norm: 'naps', fmt: (v) => String(Math.round(v * 10) / 10).replace('.', ','), nfmt: ([a, b]) => (a === b ? `${a}` : `${a}–${b}`) },
  { id: 'day', label: 'Дневной сон', norm: 'day', fmt: (v) => dur(v), nfmt: hrs },
  { id: 'window', label: 'Бодрствование за раз', norm: 'ww', fmt: (v) => dur(v), nfmt: ([a, b]) => `${hmm(a)}–${hmm(b)}` },
  { id: 'wakeTotal', label: 'Бодрствование за сутки', norm: 'wwTotal', fmt: (v) => dur(v), nfmt: hrs },
];

const MARK_TEXT = {
  ok: 'в норме',
  low: (slight) => (slight ? 'чуть меньше' : 'меньше нормы'),
  high: (slight) => (slight ? 'чуть больше' : 'больше нормы'),
};

/**
 * @param data {profile, segments}
 * @param mondayKey понедельник отчётной недели
 */
export function weeklyReport(data, mondayKey, now = Date.now()) {
  const built = buildSleeps(data.segments, now);
  const endKey = addDays(mondayKey, 6);
  const age = ageInfo(data.profile, startOfDay(endKey) + 12 * HOUR);
  const norm = normFor(age.correctedMonths);
  const cur = weekAverages(built, mondayKey);
  const prev = weekAverages(built, addDays(mondayKey, -7));
  const leap = currentLeap(age.weekFromDue);

  const rows = METRICS.map((m) => {
    const v = cur[m.id];
    const c = compare(v, norm[m.norm]);
    const p = prev.days >= 3 ? prev[m.id] : null;
    return {
      id: m.id,
      label: m.label,
      value: v,
      valueText: v == null ? '—' : m.fmt(v),
      normText: `норма ${m.nfmt(norm[m.norm])}`,
      mark: c.mark,
      markText: c.mark === 'ok' ? MARK_TEXT.ok : c.mark === 'none' ? '' : MARK_TEXT[c.mark](c.slight),
      slight: c.slight ?? false,
      prev: p,
      prevText: p == null ? null : `было ${m.id === 'naps' ? m.fmt(p) : hmm(p)}`,
      trend: p == null || v == null ? null : v > p * 1.03 ? 'up' : v < p * 0.97 ? 'down' : 'same',
    };
  });

  const okCount = rows.filter((r) => r.mark === 'ok').length;
  const enough = cur.days >= 5;

  // что изменилось к прошлой неделе — одна-две хорошие новости
  const news = [];
  if (prev.days >= 3 && cur.night != null && prev.night != null && cur.night - prev.night >= 15) {
    news.push(`ночь стала длиннее на ${dur(cur.night - prev.night)}`);
  }
  if (prev.days >= 3 && cur.window != null && prev.window != null && cur.window - prev.window >= 5) {
    const wr = rows.find((r) => r.id === 'window');
    news.push(wr.mark === 'ok' ? 'бодрствование выросло по возрасту' : `бодрствование выросло на ${dur(cur.window - prev.window)}`);
  }
  if (prev.days >= 3 && cur.nightWakes != null && prev.nightWakes != null && prev.nightWakes - cur.nightWakes >= 0.7) {
    news.push('ночью стал просыпаться реже');
  }

  let title;
  if (!enough) title = 'Мало записей за неделю';
  else if (okCount >= 5) title = 'Хорошая неделя';
  else if (okCount >= 3) title = 'Неделя в целом нормальная';
  else title = 'Есть над чем поработать';

  let summary;
  if (!enough) summary = `Полных суток с ночью — ${cur.days} из 7. Сравнение с нормой по тому, что есть.`;
  else {
    const head = news.length ? cap(news.join(', ')) + '. ' : '';
    summary = `${head}${okCount} из 6 показателей в норме.`;
  }

  return {
    mondayKey,
    endKey,
    label: rangeLabel(mondayKey, endKey),
    weekOfLife: Math.floor(age.days / 7) + 1,
    normLabel: norm.label,
    days: cur.days,
    enough,
    title,
    summary,
    rows,
    step: nextStep(rows, cur, norm, enough),
    leap: leap ? leap.text : null,
  };
}

/** Один шаг на следующую неделю (ARCHITECTURE §7) */
function nextStep(rows, cur, norm, enough) {
  if (!enough) return 'Чтобы отчёт был точнее, отмечайте сны и ночь хотя бы 5 дней в неделю.';
  const r = Object.fromEntries(rows.map((x) => [x.id, x]));
  if (r.day.mark === 'high' && (r.night.mark === 'low' || (cur.nightWakes ?? 0) >= 3)) {
    return 'Днём спит больше нормы, а ночь короче — попробуйте не давать дневным снам затягиваться: мягко будить после 2–2,5 ч.';
  }
  if (r.window.mark === 'low' && !r.window.slight) {
    return 'Бодрствование короче нормы — растягивайте самый короткий отрезок на 5–15 мин, по одному отрезку за раз, давая 1–2 дня на привыкание.';
  }
  if (r.window.mark === 'high' && !r.window.slight) {
    return 'Бодрствование длиннее нормы — следите за признаками усталости и начинайте замедляться раньше.';
  }
  if (r.total.mark === 'low' && !r.total.slight) {
    return 'Сна за сутки меньше нормы — продлевайте дневные сны и укладывайте по первым признакам усталости.';
  }
  const lows = rows.filter((x) => x.mark !== 'ok' && x.mark !== 'none');
  if (lows.length && lows.every((x) => x.slight)) {
    return `Ничего менять не нужно. ${cap(lows.map((x) => `${x.label.toLowerCase()} ${x.markText}`).join(', '))} — это небольшое отклонение, главное — самочувствие малыша.`;
  }
  return 'Ничего менять не нужно — продолжайте как есть.';
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Короткий текст для сообщения в чат */
export function reportMessage(rep) {
  const lines = [`<b>Неделя ${rep.label}.</b> ${rep.title}.`, rep.summary];
  const off = rep.rows.filter((r) => r.mark === 'low' || r.mark === 'high');
  if (rep.enough && off.length) lines.push(off.map((r) => `${r.label}: ${r.valueText} (${r.normText}) — ${r.markText}.`).join('\n'));
  lines.push(`<b>На следующую неделю:</b> ${rep.step}`);
  if (rep.leap) lines.push(rep.leap);
  return lines.join('\n\n');
}
