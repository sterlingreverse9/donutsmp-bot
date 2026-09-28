import os

DISCORD_TOKEN = os.environ["DISCORD_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]  # use the service_role key
ADMIN_ID = int(os.environ["ADMIN_DISCORD_ID"])
PORT = int(os.getenv("PORT", "10000"))  # Render sets this automatically

BOT_NAME = "Donut Bet"
PREFIXES = ["$", ".", "/", "!"]
CURRENCY = "$"
START_BONUS = 1_000_000
DEFAULT_CF_WIN = 45.0  # % chance a player wins a coinflip (change with !wincf in bot DM)

# embed palette
COLOR_GOLD = 0xF5B301
COLOR_GREEN = 0x57F287
COLOR_RED = 0xED4245
COLOR_BLURPLE = 0x5865F2
COLOR_DARK = 0x2B2D31


def fmt(amount: int) -> str:
    return f"{CURRENCY}{int(amount):,}"
