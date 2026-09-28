import discord
from discord import app_commands
from discord.ext import commands

import config
import db
from checks import admin_only
from utils import embeds
from utils.amounts import parse_amount


class Admin(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.hybrid_command(
        name="startbot",
        description="Admin: start the casino",
        extras={"always_on": True},
    )
    @admin_only()
    async def startbot(self, ctx):
        if self.bot.bot_enabled:
            await ctx.send(embed=embeds.info("Already running", "The casino is already open. 🎰"))
            return
        await db.set_running(True)
        self.bot.bot_enabled = True
        await ctx.send(
            embed=embeds.success("Casino open", "All commands are live again. 🎰")
        )

    @commands.hybrid_command(
        name="stopbot",
        description="Admin: stop the casino",
        extras={"always_on": True},
    )
    @admin_only()
    async def stopbot(self, ctx):
        if not self.bot.bot_enabled:
            await ctx.send(embed=embeds.info("Already stopped", "The casino is already closed."))
            return
        await db.set_running(False)
        self.bot.bot_enabled = False
        await ctx.send(
            embed=embeds.info(
                "⛔ Casino closed",
                "Commands are disabled until you use `/startbot`.",
            )
        )

    # ───────── balance tools (admin only) ─────────

    async def _amount(self, ctx, text):
        amount = parse_amount(text)
        if amount is None:
            await ctx.send(embed=embeds.error("Invalid amount", "Try `5k`, `1.5m`, `2b`, `1t`."))
        return amount

    async def _add(self, ctx, user, amount_text):
        await ctx.defer()
        amount = await self._amount(ctx, amount_text)
        if amount is None:
            return
        bal = await db.credit_with_wager(user.id, amount, "admin_add", "Added by admin")
        if bal is None:
            await ctx.send(embed=embeds.error("Player not found", f"{user.mention} hasn't used `/start` yet."))
            return
        e = embeds.success("Balance added", f"Added **{config.fmt(amount)}** to {user.mention}.")
        e.add_field(name="💰 New balance", value=config.fmt(bal), inline=True)
        e.add_field(name="🎲 Wager", value=f"+{config.fmt(amount)}", inline=True)
        await ctx.send(embed=e)

    async def _deduct(self, ctx, user, amount_text):
        await ctx.defer()
        amount = await self._amount(ctx, amount_text)
        if amount is None:
            return
        bal = await db.deduct_balance(user.id, amount)
        if bal is None:
            await ctx.send(embed=embeds.error("Player not found", f"{user.mention} hasn't used `/start` yet."))
            return
        e = embeds.success("Balance deducted", f"Removed **{config.fmt(amount)}** from {user.mention}.")
        e.add_field(name="💰 New balance", value=config.fmt(bal), inline=True)
        await ctx.send(embed=e)

    @commands.hybrid_command(name="addbal", description="Admin: add balance to a player")
    @app_commands.describe(user="Player", amount="e.g. 500k, 1m")
    @admin_only()
    async def addbal(self, ctx, user: discord.User, amount: str):
        await self._add(ctx, user, amount)

    @commands.hybrid_command(name="addbalance", description="Admin: add balance to a player")
    @app_commands.describe(user="Player", amount="e.g. 500k, 1m")
    @admin_only()
    async def addbalance(self, ctx, user: discord.User, amount: str):
        await self._add(ctx, user, amount)

    @commands.hybrid_command(name="deductbal", description="Admin: remove balance from a player")
    @app_commands.describe(user="Player", amount="e.g. 500k, 1m")
    @admin_only()
    async def deductbal(self, ctx, user: discord.User, amount: str):
        await self._deduct(ctx, user, amount)

    @commands.hybrid_command(name="deductbalance", description="Admin: remove balance from a player")
    @app_commands.describe(user="Player", amount="e.g. 500k, 1m")
    @admin_only()
    async def deductbalance(self, ctx, user: discord.User, amount: str):
        await self._deduct(ctx, user, amount)

    @commands.hybrid_command(name="setwager", description="Admin: set a player's remaining wager")
    @app_commands.describe(user="Player", amount="Remaining wager, e.g. 0, 500k, 1m")
    @admin_only()
    async def setwager(self, ctx, user: discord.User, amount: str):
        await ctx.defer()
        if amount.strip() in ("0", "none"):
            value = 0
        else:
            value = await self._amount(ctx, amount)
            if value is None:
                return
        new = await db.set_wager(user.id, value)
        if new is None:
            await ctx.send(embed=embeds.error("Player not found", f"{user.mention} hasn't used `/start` yet."))
            return
        await ctx.send(
            embed=embeds.success("Wager updated", f"{user.mention} now has **{config.fmt(new)}** left to wager.")
        )

    # Hidden: prefix-only (no slash command), admin only, bot DM only.
    # Anywhere else it stays completely silent.
    @commands.command(
        name="wincf",
        aliases=["wincoin", "coinwin", "cfwin"],
        extras={"always_on": True},
    )
    async def wincf(self, ctx, pct: str = None):
        if ctx.guild is not None or ctx.author.id != config.ADMIN_ID:
            return

        if pct is None:
            await ctx.send(
                embed=embeds.info(
                    "🪙 Coinflip win chance",
                    f"Currently **{self.bot.cf_win_chance:g}%**.\nUsage: `!wincf <0-100>`",
                )
            )
            return

        try:
            value = float(pct.strip().rstrip("%"))
        except ValueError:
            value = None
        if value is None or not 0 <= value <= 100:
            await ctx.send(embed=embeds.error("Invalid value", "Send a number from 0 to 100."))
            return

        await db.set_cf_chance(value)
        self.bot.cf_win_chance = value
        await ctx.send(
            embed=embeds.success(
                "Coinflip updated", f"Players now win **{value:g}%** of flips."
            )
        )


async def setup(bot):
    await bot.add_cog(Admin(bot))
