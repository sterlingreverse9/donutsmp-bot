import asyncio

import config
from utils import embeds
from utils.amounts import parse_amount


async def ask_amount(bot, ctx, title, text, balance=None):
    """Asks for an amount in chat and waits for the player's next message.
    Returns an int, or None if cancelled / timed out."""
    await ctx.send(embed=embeds.gold(title, text, ctx.author))

    def check(m):
        return m.author.id == ctx.author.id and m.channel.id == ctx.channel.id

    for _ in range(3):
        try:
            msg = await bot.wait_for("message", check=check, timeout=60)
        except asyncio.TimeoutError:
            await ctx.send(embed=embeds.info("⌛ Timed out", "No amount received. Start again anytime."))
            return None

        content = msg.content.strip()
        if content.lower() in ("cancel", "stop", "exit"):
            await ctx.send(embed=embeds.info("Cancelled", "No changes were made."))
            return None

        amount = parse_amount(content, balance)
        if amount and 1 <= amount <= config.MAX_REQUEST:
            return amount
        await ctx.send(
            embed=embeds.error("Invalid amount", "Try `500k`, `1.5m`, `2b`... or type `cancel`.")
        )
    return None
