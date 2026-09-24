import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
ALLOWED_USER_ID = int(os.environ.get("ALLOWED_USER_ID") or 0)
TZ = ZoneInfo(os.environ.get("TIMEZONE", "Europe/Moscow"))
REMIND_TIME = os.environ.get("REMIND_TIME", "21:00")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "whisper-1")
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "dietolog.sqlite3"))
