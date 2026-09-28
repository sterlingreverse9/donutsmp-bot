import discord
from discord.ext import commands

import config
import db


def balance_embed(user, balance: int) -> discord.Embed:
    e = discord.Embed(
        title="💰 Your Wallet",
        description=f"**{config.fmt(balance)}**",
        color=config.COLOR_GOLD,
    )
    e.set_author(name=user.display_name, icon_url=user.display_avatar.url)
    return e


class Economy(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.hybrid_command(
        name="start", description="Join the casino and claim your welcome bonus"
    )
    async def start(self, ctx):
        await ctx.defer()
        claimed = await db.claim_start(ctx.author.id, str(ctx.author))
        user = await db.get_user(ctx.author.id)

        if claimed:
            e = discord.Embed(
                title=f"🎰 Welcome to {config.BOT_NAME}!",
                description=(
                    f"{ctx.author.mention}, you've received "
                    f"**{config.fmt(config.START_BONUS)}** to get you started.\n\n"
                    "Use `/bal` to check your wallet. Good luck at the tables!"
                ),
                color=config.COLOR_GREEN,
            )
        else:
            e = discord.Embed(
                title="Already in the casino",
                description=(
                    "You've already claimed your welcome bonus.\n"
                    f"Current balance: **{config.fmt(user['balance'])}**"
                ),
                color=config.COLOR_RED,
            )
        await ctx.send(embed=e)

    async def _show_balance(self, ctx):
        await ctx.defer()
        user = await db.get_user(ctx.author.id)
        if not user or not user["started"]:
            await ctx.send("You haven't joined yet. Use `/start` to claim your bonus!")
            return
        await ctx.send(embed=balance_embed(ctx.author, user["balance"]))

    @commands.hybrid_command(name="bal", description="Check your balance")
    async def bal(self, ctx):
        await self._show_balance(ctx)

    @commands.hybrid_command(name="balance", description="Check your balance")
    async def balance(self, ctx):
        await self._show_balance(ctx)

    @commands.hybrid_command(name="wallet", description="Check your balance")
    async def wallet(self, ctx):
        await self._show_balance(ctx)


async def setup(bot):
    await bot.add_cog(Economy(bot))
