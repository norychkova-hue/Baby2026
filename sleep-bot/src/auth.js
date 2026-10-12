// Проверка подписи Telegram Mini App (initData).
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Возвращает пользователя Telegram, если подпись верна и данные не старше maxAgeSec; иначе null */
export function verifyInitData(initData, botToken, maxAgeSec = 7 * 24 * 3600, nowSec = Date.now() / 1000) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowSec - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

/** Для тестов: подписать initData так же, как это делает Telegram */
export function signInitData(fields, botToken) {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
