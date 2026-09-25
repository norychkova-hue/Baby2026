"""SQLite: один файл, одна пользовательница."""
import json
import sqlite3
from datetime import datetime, timedelta

from config import DB_PATH, TZ

SCHEMA = """
CREATE TABLE IF NOT EXISTS profile (
    key   TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS entries (
    id       INTEGER PRIMARY KEY,
    ts       TEXT NOT NULL,      -- ISO, локальное время
    kind     TEXT NOT NULL,      -- meal / movement / sleep / water / wellbeing / stool
    tags     TEXT NOT NULL,      -- JSON-список: ["белок", "овощи", "поздно"]
    note     TEXT,
    hunger   INTEGER,            -- голод до еды 0–10
    fullness INTEGER,            -- сытость после 0–10
    belly    TEXT,               -- комфорт / тяжесть / вздутие / изжога / боль
    raw_text TEXT                -- исходный текст отчёта
);
CREATE TABLE IF NOT EXISTS measures (
    id    INTEGER PRIMARY KEY,
    ts    TEXT NOT NULL,
    kind  TEXT NOT NULL,         -- weight / waist
    value REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS weeks (
    id         INTEGER PRIMARY KEY,
    ts         TEXT NOT NULL,
    summary    TEXT NOT NULL,
    focus      TEXT NOT NULL     -- одна привычка на неделю
);
"""

ENTRY_FIELDS = ("kind", "tags", "note", "hunger", "fullness", "belly")

# Профиль по умолчанию: кормление грудью до года.
DEFAULT_PROFILE = {
    "breastfeeding": "да",
    "hide_weight": "нет",
}


def now() -> datetime:
    return datetime.now(TZ).replace(microsecond=0)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        for key, value in DEFAULT_PROFILE.items():
            conn.execute("INSERT OR IGNORE INTO profile VALUES (?, ?)", (key, value))


def get_profile() -> dict[str, str]:
    with connect() as conn:
        return {r["key"]: r["value"] for r in conn.execute("SELECT * FROM profile")}


def set_profile(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute("INSERT OR REPLACE INTO profile VALUES (?, ?)", (key, value))


def add_entries(entries: list[dict], raw_text: str) -> None:
    ts = now().isoformat()
    with connect() as conn:
        for e in entries:
            conn.execute(
                "INSERT INTO entries (ts, kind, tags, note, hunger, fullness, belly, raw_text)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (ts, e["kind"], json.dumps(e.get("tags") or [], ensure_ascii=False),
                 *(e.get(f) for f in ENTRY_FIELDS[2:]), raw_text),
            )


def undo_last() -> int:
    """Удаляет записи последнего отчёта (у них общее время). Возвращает сколько удалено."""
    with connect() as conn:
        row = conn.execute("SELECT ts FROM entries ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return 0
        return conn.execute("DELETE FROM entries WHERE ts = ?", (row["ts"],)).rowcount


def entries_since(days: int) -> list[dict]:
    since = (now() - timedelta(days=days)).isoformat()
    with connect() as conn:
        rows = conn.execute("SELECT * FROM entries WHERE ts >= ? ORDER BY id", (since,)).fetchall()
    result = []
    for r in rows:
        d = {k: r[k] for k in ("ts", *ENTRY_FIELDS) if r[k] not in (None, "", "[]")}
        d["tags"] = json.loads(r["tags"])
        result.append(d)
    return result


def count_today() -> int:
    today = now().date().isoformat()
    with connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM entries WHERE ts >= ?", (today,)).fetchone()[0]


def add_measure(kind: str, value: float) -> None:
    with connect() as conn:
        conn.execute("INSERT INTO measures (ts, kind, value) VALUES (?, ?, ?)", (now().isoformat(), kind, value))


def measures(kind: str, days: int = 120) -> list[tuple[str, float]]:
    since = (now() - timedelta(days=days)).isoformat()
    with connect() as conn:
        rows = conn.execute(
            "SELECT ts, value FROM measures WHERE kind = ? AND ts >= ? ORDER BY ts", (kind, since)
        ).fetchall()
    return [(r["ts"][:10], r["value"]) for r in rows]


def add_week(summary: str, focus: str) -> None:
    with connect() as conn:
        conn.execute("INSERT INTO weeks (ts, summary, focus) VALUES (?, ?, ?)", (now().isoformat(), summary, focus))


def focus_index() -> int:
    """Номер текущего фокуса недели в кодексе (с нуля)."""
    return int(get_profile().get("focus_index", 0))


def first_entry_day() -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT MIN(ts) FROM entries").fetchone()
    return row[0][:10] if row[0] else None


def belly_complaints(days: int = 7) -> dict[str, int]:
    """Сколько раз за период живот был не в порядке: {"изжога": 2, ...}."""
    since = (now() - timedelta(days=days)).isoformat()
    with connect() as conn:
        rows = conn.execute(
            "SELECT belly, COUNT(*) FROM entries WHERE ts >= ? AND belly IS NOT NULL AND belly != 'комфорт'"
            " GROUP BY belly", (since,)
        ).fetchall()
    return {r[0]: r[1] for r in rows}
