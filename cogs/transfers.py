import discord
from discord import app_commands
from discord.ext import commands

import config
import db
from utils import embeds
from utils.amounts import parse_amount


class Transfers(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send(self, ctx, target, amount_text):
        await ctx.defer()

        if target.bot or target.id == ctx.author.id:
            await ctx.send(embed=embeds.error("Invalid player", "Pick another player to send to."))
            return

        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await ctx.send(
                embed=embeds.info("🍩 Not in yet", "Use `/start` to join the casino first.", ctx.author)
            )
            return

        bal = row["balance"]
        amount = parse_amount(amount_text, bal)
        if amount is None or amount < 1:
            await ctx.send(
                embed=embeds.error("Invalid amount", "Try `5k`, `1.5m`, `2b`, `50%` or `all`.")
            )
            return
        if amount > bal:
            await ctx.send(embed=embeds.error("Not enough balance", f"You only have **{config.fmt(bal)}**."))
            return

        result = await db.transfer(ctx.author.id, target.id, amount)
        if result == "no_receiver":
            await ctx.send(
                embed=embeds.error(
                    "Player not found",
                    f"{target.mention} hasn't joined the casino yet. They need to use `/start`.",
                )
            )
            return
        if result != "ok":
            await ctx.send(embed=embeds.error("Transfer failed", "Your balance doesn't cover that."))
            return

        e = embeds.make(
            "💸 Money Sent",
            f"{ctx.author.mention} sent **{config.fmt(amount)}** to {target.mention}",
            config.COLOR_GREEN,
            ctx.author,
        )
        e.add_field(name="💰 Your balance", value=config.fmt(bal - amount), inline=True)
        await ctx.send(content=target.mention, embed=e)

    @commands.hybrid_command(name="tip", description="Send money to another player")
    @app_commands.describe(user="Who to send money to", amount="e.g. 5k, 1.5m, 50% or all")
    async def tip(self, ctx, user: discord.User, amount: str):
        await self._send(ctx, user, amount)

    @commands.hybrid_command(name="pay", description="Send money to another player")
    @app_commands.describe(amount="e.g. 5k, 1.5m, 50% or all", user="Who to send money to")
    async def pay(self, ctx, amount: str, user: discord.User):
        await self._send(ctx, user, amount)


async def setup(bot):
    await bot.add_cog(Transfers(bot))
