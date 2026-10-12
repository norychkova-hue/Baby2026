// Какие напоминания пора отправить. Чистая функция: на входе статус, на выходе список.
// Отправленные отмечаются по ключу (key) — одно и то же не шлём дважды.
// По умолчанию только: «скоро укладывать», «можно будить» / «будить на кормление», «забыли нажать?».

import { MIN, minuteOfDay, dur } from './time.js';

const LEAD_MIN = 15;

function daytime(ms) {
  const m = minuteOfDay(ms);
  return m >= 7 * 60 && m < 21 * 60;
}

export function dueReminders(st, now = Date.now()) {
  const out = [];
  if (st.state === 'awake' && st.nextAt) {
    const at = st.nextAt - LEAD_MIN * MIN;
    if (now >= at && now < st.nextAt + 30 * MIN && at > st.since && daytime(now)) {
      out.push({
        key: `slow:${st.since}`,
        text: `Через ${Math.max(1, Math.round((st.nextAt - now) / MIN))} мин укладывать — можно начинать замедляться.`,
        silent: false,
      });
    }
    // не спит слишком долго — возможно, забыли нажать «Уснул»
    const awakeMin = (now - st.since) / MIN;
    if (awakeMin >= Math.max(st.window * 2, 3 * 60) && daytime(now)) {
      out.push({ key: `forgot-sleep:${st.since}`, kind: 'forgot-sleep', text: `Не спит уже ${dur(awakeMin)}. Может быть, забыли нажать «Уснул»?`, silent: true });
    }
  }

  if (st.state === 'asleep') {
    const sleptMin = (now - st.since) / MIN;
    if (st.nextAt && now >= st.nextAt) {
      if (st.nextReason === 'feed') {
        out.push({
          key: `feed:${st.since}:${st.nextAt}`,
          kind: 'wake',
          text: `Спит уже ${dur(sleptMin)} — пора будить на кормление: ${st.feeding.reason}.`,
          silent: false,
        });
      } else if (daytime(now)) {
        out.push({
          key: `wake:${st.since}:${st.nextAt}`,
          kind: 'wake',
          text: `Спит уже ${dur(sleptMin)}. Можно мягко будить, чтобы не сбилась ночь.`,
          silent: false,
        });
      }
    }
    const limit = st.kind === 'night' ? 13 * 60 : 4 * 60;
    if (sleptMin >= limit) {
      out.push({ key: `forgot-wake:${st.since}`, kind: 'forgot-wake', text: `Сон идёт уже ${dur(sleptMin)}. Может быть, забыли нажать «Проснулся»?`, silent: true });
    }
  }
  return out;
}

