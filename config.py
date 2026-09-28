import os

DISCORD_TOKEN = os.environ["DISCORD_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]  # use the service_role key
ADMIN_ID = int(os.environ["ADMIN_DISCORD_ID"])
PORT = int(os.getenv("PORT", "10000"))  # Render sets this automatically

BOT_NAME = "Donut Bet Bot"
PREFIXES = ["$", ".", "/", "!"]
CURRENCY = "$"
START_BONUS = 1_000_000

COLOR_GOLD = 0xF5B301
COLOR_RED = 0xE74C3C
COLOR_GREEN = 0x2ECC71


def fmt(amount: int) -> str:
    return f"{CURRENCY}{amount:,}"
