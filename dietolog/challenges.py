"""Челленджи недели: сама выбирает до трёх целей, неделя с понедельника по воскресенье."""
from datetime import date, timedelta

import db

MAX_PER_WEEK = 3


def week_start(day: date | None = None) -> str:
    day = day or db.now().date()
    return (day - timedelta(days=day.weekday())).isoformat()


def active() -> list[dict]:
    """Челленджи текущей недели по порядку: [{"id", "text", "kept", "marked"}]."""
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT c.id, c.text, COALESCE(SUM(d.kept), 0) AS kept, COUNT(d.day) AS marked"
            " FROM challenges c LEFT JOIN challenge_days d ON d.challenge_id = c.id"
            " WHERE c.week_start = ? AND c.removed = 0 GROUP BY c.id ORDER BY c.id",
            (week_start(),),
        ).fetchall()
    return [dict(r) for r in rows]


def add(text: str) -> bool:
    """Добавляет челлендж на эту неделю. False, если уже три."""
    text = text.strip().rstrip(".")
    text = text[:1].upper() + text[1:]
    if not text or len(active()) >= MAX_PER_WEEK:
        return False
    with db.connect() as conn:
        conn.execute("INSERT INTO challenges (week_start, text) VALUES (?, ?)", (week_start(), text[:100]))
    return True


def remove(number: int) -> str | None:
    """Убирает челлендж по номеру (с единицы). Возвращает его текст."""
    current = active()
    if not 1 <= number <= len(current):
        return None
    with db.connect() as conn:
        conn.execute("UPDATE challenges SET removed = 1 WHERE id = ?", (current[number - 1]["id"],))
    return current[number - 1]["text"]


def mark(number: int, kept: bool) -> None:
    """Отмечает за сегодня: получилось или нет. Повторная отметка за день перезаписывает прежнюю."""
    current = active()
    if 1 <= number <= len(current):
        with db.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO challenge_days VALUES (?, ?, ?)",
                (current[number - 1]["id"], db.now().date().isoformat(), int(kept)),
            )


def as_lines() -> list[str]:
    return [f"{i}. {c['text']} — получилось {c['kept']} из {c['marked']} отмеченных дней"
            for i, c in enumerate(active(), 1)]
