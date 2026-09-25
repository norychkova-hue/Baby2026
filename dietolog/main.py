"""Бережный диетолог — Telegram-бот. Запуск: python main.py"""
import asyncio
import logging
import random
from datetime import date, datetime

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatAction
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import Message

import codex
import coach
import db
import stt
from config import ALLOWED_USER_ID, REMIND_TIME, TELEGRAM_TOKEN

log = logging.getLogger("dietolog")

HELP = """\
Привет. Я помогаю мягко вернуться к своему весу и беречь живот. Калории не считаем.

Просто рассказывай — голосом или текстом — что ела, как себя чувствовала, гуляла ли.
Например: «Обед: суп и курица, ела без телефона, голод был 6, сейчас сытость приятная, живот ок».
Я запишу и отвечу, опираясь на твой кодекс — твои же принципы из заметок.
Первые две недели расспрашиваю про ощущения, потом становлюсь тише: вечером один вопрос про фокус недели.
По воскресеньям — итог недели.

Команды:
/weight 68.5 — вес (лучше раз в неделю, утром)
/waist 78 — талия в см (раз в месяц)
/week — итог недели и фокус на следующую
/focus — мой кодекс и фокус недели (/focus 3 — выбрать пункт самой)
/undo — удалить последнюю запись
/birth 2026-11-20 — дата родов
/settings — настройки: кормление грудью, скрывать цифры веса
"""

# Вечерние напоминания: если записей за день нет / если уже есть.
REMIND_EMPTY = [
    "Привет. Как прошёл день? Можно одним голосовым: что ела, как себя чувствовала, была ли прогулка.",
    "Докладываю: весь день скучал. Расскажешь, как ты? Что ела, как живот, гуляли ли?",
    "Вечерняя перекличка. Мама — есть? Как день, как живот, что было вкусного?",
    "Если сегодня ела одной рукой, держа ребёнка другой, — это тоже считается. Расскажи, как прошёл день?",
]
REMIND_DONE = [
    "Как ты сейчас? Если хочется — расскажи, как прошёл вечер и как живот.",
    "Вечерний обход. Как самочувствие, как живот после ужина?",
    "Как прошёл вечер? Чай в итоге выпит горячим или по классике — остывшим?",
]

# После двух недель наблюдения бот спрашивает вечером только про фокус недели.
REMIND_FOCUS = [
    "Как сегодня с «{focus}»? Хватит одного слова.",
    "Вечерняя сверка с кодексом: «{focus}» — получилось сегодня?",
    "Короткий вопрос дня: как там «{focus}»? Можно ответить смайликом.",
]

TOGGLES = {
    "bf": ("breastfeeding", "Кормлю грудью"),
    "hideweight": ("hide_weight", "Не показывать цифры веса"),
}

router = Router()
router.message.filter(F.from_user.id == ALLOWED_USER_ID)
strangers = Router()


@strangers.message()
async def stranger(message: Message) -> None:
    if not ALLOWED_USER_ID:
        await message.answer(f"Твой Telegram ID: {message.from_user.id}\nВпиши его в .env как ALLOWED_USER_ID и перезапусти бота.")


@router.message(CommandStart())
@router.message(Command("help"))
async def start(message: Message) -> None:
    await message.answer(HELP)


@router.message(Command("birth"))
async def birth(message: Message, command: CommandObject) -> None:
    try:
        day = date.fromisoformat((command.args or "").strip())
    except ValueError:
        await message.answer("Напиши дату так: /birth 2026-11-20")
        return
    db.set_profile("birth_date", day.isoformat())
    await message.answer(f"Запомнила: {day:%d.%m.%Y}.")


async def _measure(message: Message, command: CommandObject, kind: str, example: str) -> None:
    try:
        value = float((command.args or "").replace(",", ".").strip())
    except ValueError:
        await message.answer(f"Напиши число, например: {example}")
        return
    db.add_measure(kind, value)
    hidden = kind == "weight" and db.get_profile()["hide_weight"] == "да"
    await message.answer("Записала. Смотрим только на тренд за недели, не на отдельные дни." if hidden
                         else f"Записала: {value:g}. Смотрим на тренд за недели, а не на отдельные дни.")


@router.message(Command("weight"))
async def weight(message: Message, command: CommandObject) -> None:
    await _measure(message, command, "weight", "/weight 68.5")


@router.message(Command("waist"))
async def waist(message: Message, command: CommandObject) -> None:
    await _measure(message, command, "waist", "/waist 78")


@router.message(Command("settings"))
async def settings(message: Message) -> None:
    p = db.get_profile()
    lines = [f"{title}: {p[key]} — /{cmd} чтобы переключить" for cmd, (key, title) in TOGGLES.items()]
    lines.append(f"Дата родов: {p.get('birth_date', 'не указана')} — /birth ГГГГ-ММ-ДД")
    await message.answer("\n".join(lines))


@router.message(Command(*TOGGLES))
async def toggle(message: Message, command: CommandObject) -> None:
    key, title = TOGGLES[command.command]
    value = "нет" if db.get_profile()[key] == "да" else "да"
    db.set_profile(key, value)
    await message.answer(f"{title}: {value}")


@router.message(Command("undo"))
async def undo(message: Message) -> None:
    n = db.undo_last()
    await message.answer(f"Удалила последний отчёт ({n} зап.)." if n else "Удалять нечего.")


@router.message(Command("week"))
async def week(message: Message) -> None:
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    await message.answer(await _week_text())


async def _week_text() -> str:
    try:
        result = await coach.week_review()
    except Exception:
        log.exception("week review failed")
        return "Не получилось подвести итог — попробуй /week чуть позже."
    index = db.focus_index()
    if result["focus_settled"]:
        index = (index + 1) % len(codex.CODEX)
        db.set_profile("focus_index", str(index))
        head = "Прошлый фокус прижился — берём следующий пункт кодекса."
    else:
        head = "Оставляем тот же фокус ещё на неделю, привычке нужно время."
    focus = codex.title(index)
    db.add_week(result["summary"], focus)
    return f"{result['summary']}\n\n{head}\nФокус на неделю: {focus}"


@router.message(Command("focus"))
async def focus(message: Message, command: CommandObject) -> None:
    if command.args:
        try:
            index = int(command.args.strip()) - 1
            codex.CODEX[index]
            if index < 0:
                raise IndexError
        except (ValueError, IndexError):
            await message.answer(f"Напиши номер пункта от 1 до {len(codex.CODEX)}, например: /focus 2")
            return
        db.set_profile("focus_index", str(index))
    current = db.focus_index()
    lines = [("👉 " if i == current else "") + f"{i + 1}. {title} — {text}" for i, (title, text) in enumerate(codex.CODEX)]
    await message.answer("Твой кодекс:\n\n" + "\n\n".join(lines) + f"\n\nФокус недели: {codex.title(current)}")


@router.message(F.voice)
async def voice(message: Message) -> None:
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    audio = await message.bot.download(message.voice)
    try:
        text = await stt.transcribe(audio.read())
    except Exception:
        log.exception("transcription failed")
        await message.answer("Не получилось распознать голосовое. Попробуй ещё раз или напиши текстом.")
        return
    if not text:
        await message.answer("Кажется, запись пустая. Попробуй ещё раз.")
        return
    await _report(message, text, heard=True)


@router.message(F.text & ~F.text.startswith("/"))
async def text(message: Message) -> None:
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    await _report(message, message.text, heard=False)


async def _report(message: Message, text: str, heard: bool) -> None:
    try:
        result = await coach.log_report(text)
    except Exception:
        log.exception("coach failed")
        db.add_entries([{"kind": "wellbeing", "tags": ["не разобрано"], "note": text}], text)
        await message.answer("Сохранила твой отчёт как есть, но ответить сейчас не могу — что-то со связью. Разберу позже.")
        return
    db.add_entries(result["entries"], text)
    reply = result["reply"]
    if result["red_flag"]:
        reply += "\n\n⚠️ Пожалуйста, покажись врачу. Если состояние резко ухудшается — звони 103 или 112."
    if heard:
        reply = f"«{text}»\n\n{reply}"
    await message.answer(reply)


async def reminders(bot: Bot) -> None:
    """Раз в минуту: вечернее напоминание и итог недели по воскресеньям.

    Если компьютер был выключен в нужное время, напоминание придёт, когда бот запустится (до 23:00).
    """
    hh, mm = map(int, REMIND_TIME.split(":"))
    while True:
        try:
            now = db.now()
            today = now.date().isoformat()
            p = db.get_profile()
            due = (now.hour, now.minute) >= (hh, mm) and now.hour < 23
            if due and p.get("last_remind") != today:
                db.set_profile("last_remind", today)
                if not coach.observing():
                    # Тихий режим: один вопрос про фокус недели вместо расспросов.
                    text = random.choice(REMIND_FOCUS).format(focus=codex.title(db.focus_index()))
                elif db.count_today():
                    text = random.choice(REMIND_DONE)
                else:
                    text = random.choice(REMIND_EMPTY)
                await bot.send_message(ALLOWED_USER_ID, text)
                if now.weekday() == 6:
                    await bot.send_message(ALLOWED_USER_ID, await _week_text())
        except Exception:
            log.exception("reminder failed")
        await asyncio.sleep(60 - datetime.now().second)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not TELEGRAM_TOKEN:
        raise SystemExit("Заполни TELEGRAM_TOKEN в .env (см. .env.example)")
    db.init()
    bot = Bot(TELEGRAM_TOKEN)
    dp = Dispatcher()
    dp.include_routers(router, strangers)
    if ALLOWED_USER_ID:
        asyncio.create_task(reminders(bot))
    # Long polling: не нужен ни белый IP, ни HTTPS — работает с домашнего компьютера.
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
