from datetime import datetime

import discord

import config
from utils import embeds

DEPOSIT_PCT = 2
FIRST_MULT = 10
FIRST_CAP = 5_000_000
HOLD_HOURS = 24


def parse_time(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


async def dm(bot, user_id, embed) -> bool:
    try:
        user = await bot.fetch_user(user_id)
        await user.send(embed=embed)
        return True
    except discord.HTTPException:
        return False


def joined_embed(name):
    return embeds.gold(
        "👋 New referral",
        f"**{name}** joined using your link.\n"
        f"If they stay **{HOLD_HOURS} hours**, their rewards unlock for you.",
    )


def left_embed(name):
    return embeds.error(
        "Referral left",
        f"**{name}** left the server before {HOLD_HOURS} hours, so this referral earns you nothing.",
    )


def unlocked_embed(name, claimable):
    e = embeds.make(
        "✅ Referral unlocked",
        f"**{name}** stayed for {HOLD_HOURS} hours. Their rewards are yours now.\n"
        "Use `!ref` to claim.",
        config.COLOR_GREEN,
    )
    e.add_field(name="🎁 Claimable now", value=config.fmt(claimable), inline=True)
    return e


def deposit_embed(name, amount, reward, qualified, first):
    text = f"**{name}** deposited **{config.fmt(amount)}** using your link.\n"
    text += f"You earned **+{config.fmt(reward)}**"
    text += " (includes the 10x first-deposit bonus).\n" if first else ".\n"
    if qualified:
        text += "It's claimable now with `!ref`."
    else:
        text += f"It unlocks once they've stayed {HOLD_HOURS} hours."
    return embeds.make("💸 Referral deposit", text, config.COLOR_GOLD)


def wager_embed(name):
    return embeds.make(
        "🎲 Referral wagered",
        f"**{name}** completed their wager.",
        config.COLOR_BLURPLE,
    )
