"""Голос → текст через Whisper."""
import io

from openai import AsyncOpenAI

from config import WHISPER_MODEL

_client = AsyncOpenAI()


async def transcribe(ogg_bytes: bytes) -> str:
    audio = io.BytesIO(ogg_bytes)
    audio.name = "voice.ogg"  # Whisper определяет формат по имени; голосовые Telegram — ogg/opus
    result = await _client.audio.transcriptions.create(
        model=WHISPER_MODEL,
        file=audio,
        language="ru",
        prompt="Отчёт о еде и самочувствии: завтрак, обед, ужин, перекус, сытость, вздутие, прогулка, кормление.",
    )
    return result.text.strip()
