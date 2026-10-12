// Минимальный клиент Telegram Bot API на fetch — без сторонних библиотек.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export class Telegram {
  constructor(token, base = 'https://api.telegram.org') {
    this.token = token;
    this.base = base;
  }

  async call(method, params = {}) {
    const res = await fetch(`${this.base}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(70_000),
    });
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!json.ok) {
      const err = new Error(`Telegram ${method}: ${json.description}`);
      err.code = json.error_code;
      throw err;
    }
    return json.result;
  }

  async sendDocument(chatId, filePath, { caption, filename } = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    form.append('document', new Blob([readFileSync(filePath)]), filename ?? basename(filePath));
    const res = await fetch(`${this.base}/bot${this.token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram sendDocument: ${json.description}`);
    return json.result;
  }

  async downloadFile(fileId) {
    const file = await this.call('getFile', { file_id: fileId });
    const res = await fetch(`${this.base}/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Не удалось скачать файл: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
