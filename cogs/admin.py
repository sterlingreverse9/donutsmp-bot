from discord.ext import commands

import config
import db
from checks import admin_only
from utils import embeds


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
