// HTTP-сервер: отдаёт Mini App (папка webapp/) и API для неё.
// Каждый запрос к API подписан Telegram (initData) — данные видит только владелица бота.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { verifyInitData } from './auth.js';
import { UserError } from './app.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

export function createAppServer({ app, config, ownerId, onChange = () => {}, log = console }) {
  const routes = {
    'GET /api/state': () => app.state(),
    'POST /api/toggle': (b) => app.toggle(b.at ? Number(b.at) : Date.now()),
    'POST /api/shift': (b) => app.shift({ action: b.action, id: Number(b.id) }, Number(b.minutesAgo) || 0, Number(b.base) || Date.now()),
    'POST /api/undo': (b) => app.undo({ action: b.action, id: Number(b.id) }),
    'POST /api/sleep': (b) => ({ id: app.saveBlock({ ids: b.ids || (b.id ? [b.id] : []), start: b.start, end: b.end }) }),
    'POST /api/sleep/delete': (b) => app.deleteBlock(b.ids || [b.id]),
    'POST /api/night': (b) => ({ id: app.saveNight(b) }),
    'POST /api/night/skip': () => app.skipNightForm(),
    'POST /api/weight': (b) => ({ id: app.addWeight(b.grams) }),
    'POST /api/feeding': (b) => ({ id: app.addFeeding(b.at ? Number(b.at) : Date.now(), b.side) }),
    'POST /api/feeding/update': (b) => app.updateFeeding(Number(b.id), Number(b.at), b.side),
    'POST /api/feeding/delete': (b) => app.deleteFeeding(Number(b.id)),
    'POST /api/profile': (b) => app.saveProfile(b),
    'POST /api/settings': (b) => app.saveSettings(b),
    'GET /api/report': (_, q) => app.report(Number(q.get('offset') ?? -1)),
  };

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body ?? { ok: true }));
  };

  async function readBody(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new UserError('Слишком большой запрос.');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  function authorized(req) {
    if (config.dev) return true;
    const user = verifyInitData(req.headers['x-init-data'], config.botToken);
    const owner = ownerId();
    return Boolean(user && owner != null && user.id === owner);
  }

  async function serveStatic(res, path) {
    const rel = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1));
    const file = resolve(config.webappDir, rel);
    if (!file.startsWith(config.webappDir + sep)) return json(res, 404, { error: 'not found' });
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      json(res, 404, { error: 'not found' });
    }
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method' });
      return serveStatic(res, url.pathname);
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return json(res, 404, { error: 'not found' });
    if (!authorized(req)) return json(res, 401, { error: 'Откройте приложение из Telegram — кнопкой в чате с ботом.' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await handler(body, url.searchParams);
      if (req.method === 'POST') onChange();
      json(res, 200, result);
    } catch (e) {
      if (e instanceof UserError || e instanceof SyntaxError) return json(res, 400, { error: e.message });
      log.error('API', e);
      json(res, 500, { error: 'Что-то пошло не так. Попробуйте ещё раз.' });
    }
  });
}
