"""Разговор с Claude: разбор отчёта и недельный итог."""
import json
from datetime import date

from anthropic import AsyncAnthropic

import db
import prompts
from config import CLAUDE_MODEL

_client = AsyncAnthropic()

NULLABLE_INT = {"type": ["integer", "null"]}

LOG_SCHEMA = {
    "type": "object",
    "properties": {
        "entries": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["meal", "movement", "sleep", "water", "wellbeing", "stool"]},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "note": {"type": "string"},
                    "hunger": NULLABLE_INT,
                    "fullness": NULLABLE_INT,
                    "belly": {"type": ["string", "null"]},
                    "energy": NULLABLE_INT,
                    "mood": NULLABLE_INT,
                },
                "required": ["kind", "tags", "note", "hunger", "fullness", "belly", "energy", "mood"],
                "additionalProperties": False,
            },
        },
        "reply": {"type": "string"},
        "red_flag": {"type": "boolean"},
    },
    "required": ["entries", "reply", "red_flag"],
    "additionalProperties": False,
}

WEEK_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}, "focus": {"type": "string"}},
    "required": ["summary", "focus"],
    "additionalProperties": False,
}


WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]


class CoachError(Exception):
    pass


def _context(days: int) -> str:
    """Всё, что Claude нужно знать сейчас: профиль, фокус недели, недавние записи, вес."""
    p = db.get_profile()
    now = db.now()
    lines = [f"Сейчас: {now:%Y-%m-%d %H:%M}, {WEEKDAYS[now.weekday()]}."]
    if birth := p.get("birth_date"):
        weeks = (now.date() - date.fromisoformat(birth)).days // 7
        lines.append(f"Дата родов: {birth} ({weeks} нед. назад)." if weeks >= 0 else f"Роды ожидаются {birth}.")
    lines.append(f"Кормит грудью: {p['breastfeeding']}. Врач разрешил нагрузки: {p['doctor_ok']}.")
    if focus := db.current_focus():
        lines.append(f"Фокус этой недели: {focus}")

    weights = db.measures("weight")
    if weights:
        if p["hide_weight"] == "да":
            lines.append("Вес она просила не показывать — не называй цифры, только общее направление.")
        lines.append(f"Вес (дата, кг): {weights[-8:]}")
    if waist := db.measures("waist"):
        lines.append(f"Талия (дата, см): {waist[-4:]}")

    lines.append(f"Записи за последние {days} дн.:")
    lines.append(json.dumps(db.entries_since(days), ensure_ascii=False))
    return "\n".join(lines)


async def _ask(task: str, context: str, schema: dict, effort: str) -> dict:
    response = await _client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=16000,
        system=prompts.SYSTEM,
        messages=[{"role": "user", "content": f"{context}\n\n{task}"}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise CoachError("refusal")
    if response.stop_reason == "max_tokens":
        raise CoachError("max_tokens")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)


async def log_report(text: str) -> dict:
    """Возвращает {"entries": [...], "reply": str, "red_flag": bool}."""
    context = _context(days=3)
    return await _ask(f"{prompts.LOG_TASK}\n\nЕё отчёт:\n{text}", context, LOG_SCHEMA, effort="low")


async def week_review() -> dict:
    """Возвращает {"summary": str, "focus": str}."""
    return await _ask(prompts.WEEK_TASK, _context(days=7), WEEK_SCHEMA, effort="medium")
