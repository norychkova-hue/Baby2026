// Хранилище — один файл SQLite (встроенный в Node модуль node:sqlite, без зависимостей).

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, rmSync, readFileSync } from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  birth INTEGER NOT NULL,
  due INTEGER,
  birth_weight INTEGER
);
CREATE TABLE IF NOT EXISTS sleeps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start INTEGER NOT NULL,
  end INTEGER,
  wakes INTEGER NOT NULL DEFAULT 0,
  long_wake INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sleeps_start ON sleeps(start);
CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  grams INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  side TEXT
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS sent (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
`;

const SQLITE_MAGIC = 'SQLite format 3\u0000';

export class Store {
  constructor(file) {
    this.file = file;
    this.open();
  }

  open() {
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ── профиль и настройки ──
  getProfile() {
    const r = this.db.prepare('SELECT * FROM profile WHERE id = 1').get();
    return r ? { name: r.name, birth: r.birth, due: r.due, birthWeight: r.birth_weight } : null;
  }

  saveProfile(p) {
    this.db.prepare(`INSERT INTO profile (id, name, birth, due, birth_weight) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, birth = excluded.birth, due = excluded.due, birth_weight = excluded.birth_weight`)
      .run(p.name ?? null, p.birth, p.due ?? null, p.birthWeight ?? null);
  }

  get(key, fallback = null) {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return r ? JSON.parse(r.value) : fallback;
  }

  set(key, value) {
    if (value === undefined || value === null) this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  getSettings() {
    return { feedings: false, ...this.get('settings', {}) };
  }

  saveSettings(s) {
    this.set('settings', { ...this.getSettings(), ...s });
  }

  // ── сон ──
  listSleeps(sinceMs = 0) {
    return this.db.prepare('SELECT * FROM sleeps WHERE start >= ? OR end IS NULL ORDER BY start').all(sinceMs)
      .map((r) => ({ id: r.id, start: r.start, end: r.end, wakes: r.wakes, longWake: Boolean(r.long_wake) }));
  }

  getSleep(id) {
    const r = this.db.prepare('SELECT * FROM sleeps WHERE id = ?').get(id);
    return r ? { id: r.id, start: r.start, end: r.end, wakes: r.wakes, longWake: Boolean(r.long_wake) } : null;
  }

  openSleep() {
    const r = this.db.prepare('SELECT * FROM sleeps WHERE end IS NULL ORDER BY start DESC LIMIT 1').get();
    return r ? this.getSleep(r.id) : null;
  }

  lastSleep() {
    const r = this.db.prepare('SELECT id FROM sleeps ORDER BY start DESC LIMIT 1').get();
    return r ? this.getSleep(r.id) : null;
  }

  addSleep({ start, end = null, wakes = 0, longWake = false }) {
    const r = this.db.prepare('INSERT INTO sleeps (start, end, wakes, long_wake) VALUES (?, ?, ?, ?)').run(start, end, wakes, longWake ? 1 : 0);
    return Number(r.lastInsertRowid);
  }

  updateSleep(id, { start, end, wakes, longWake }) {
    const cur = this.getSleep(id);
    if (!cur) return false;
    this.db.prepare('UPDATE sleeps SET start = ?, end = ?, wakes = ?, long_wake = ? WHERE id = ?').run(
      start ?? cur.start,
      end === undefined ? cur.end : end,
      wakes ?? cur.wakes,
      (longWake ?? cur.longWake) ? 1 : 0,
      id,
    );
    return true;
  }

  deleteSleep(id) {
    this.db.prepare('DELETE FROM sleeps WHERE id = ?').run(id);
  }

  /** Отрезки, пересекающиеся с интервалом */
  overlapping(start, end, now) {
    return this.db.prepare('SELECT id FROM sleeps WHERE start < ? AND COALESCE(end, ?) > ?').all(end, now, start).map((r) => r.id);
  }

  // ── вес и кормления ──
  listWeights() {
    return this.db.prepare('SELECT * FROM weights ORDER BY at').all().map((r) => ({ id: r.id, at: r.at, grams: r.grams }));
  }

  addWeight(at, grams) {
    return Number(this.db.prepare('INSERT INTO weights (at, grams) VALUES (?, ?)').run(at, grams).lastInsertRowid);
  }

  deleteWeight(id) {
    this.db.prepare('DELETE FROM weights WHERE id = ?').run(id);
  }

  listFeedings(sinceMs = 0) {
    return this.db.prepare('SELECT * FROM feedings WHERE at >= ? ORDER BY at').all(sinceMs).map((r) => ({ id: r.id, at: r.at, side: r.side }));
  }

  addFeeding(at, side = null) {
    return Number(this.db.prepare('INSERT INTO feedings (at, side) VALUES (?, ?)').run(at, side).lastInsertRowid);
  }

  updateFeeding(id, at, side) {
    this.db.prepare('UPDATE feedings SET at = ?, side = ? WHERE id = ?').run(at, side, id);
  }

  deleteFeeding(id) {
    this.db.prepare('DELETE FROM feedings WHERE id = ?').run(id);
  }

  // ── отправленные сообщения (чтобы не повторять) ──
  wasSent(key) {
    return Boolean(this.db.prepare('SELECT 1 FROM sent WHERE key = ?').get(key));
  }

  markSent(key, at = Date.now()) {
    this.db.prepare('INSERT OR IGNORE INTO sent (key, at) VALUES (?, ?)').run(key, at);
  }

  // ── резервная копия ──
  backupTo(path) {
    if (existsSync(path)) rmSync(path);
    this.db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  }

  /** Восстановление из файла копии. Возвращает false, если файл не похож на базу SQLite. */
  restoreFrom(path) {
    const head = readFileSync(path).subarray(0, 16).toString('latin1');
    if (head !== SQLITE_MAGIC) return false;
    const probe = new DatabaseSync(path);
    const ok = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sleeps'").get();
    probe.close();
    if (!ok) return false;
    this.close();
    for (const ext of ['-wal', '-shm']) if (existsSync(this.file + ext)) rmSync(this.file + ext);
    copyFileSync(path, this.file);
    this.open();
    return true;
  }
}
