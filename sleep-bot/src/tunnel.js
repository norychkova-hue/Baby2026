// Бесплатный туннель Cloudflare: даёт адрес https://…trycloudflare.com для Mini App,
// без белого IP, роутера и покупки домена. Нужна программа cloudflared (см. README).

import { spawn } from 'node:child_process';

/** Запускает cloudflared и возвращает публичный адрес (или null, если не вышло за 60 с). */
export function startTunnel(port, log = console) {
  return new Promise((resolve) => {
    let done = false;
    let child;
    try {
      child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    const finish = (url) => {
      if (done) return;
      done = true;
      resolve(url);
    };
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) finish(m[0]);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => {
      log.warn(e.code === 'ENOENT'
        ? 'Программа cloudflared не найдена — приложение (Mini App) не откроется из Telegram. Кнопки в чате работают. Как установить — в README.'
        : `Туннель не запустился: ${e.message}`);
      finish(null);
    });
    child.on('exit', (code) => {
      if (!done) log.warn(`Туннель завершился (код ${code}).`);
      finish(null);
    });
    setTimeout(() => finish(null), 60_000);
    process.on('exit', () => child.kill());
  });
}
