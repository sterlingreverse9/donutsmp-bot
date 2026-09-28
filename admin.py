from discord.ext import commands

import db
from checks import admin_only


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
            await ctx.send("✅ The bot is already running.")
            return
        await db.set_running(True)
        self.bot.bot_enabled = True
        await ctx.send("✅ Casino started. All commands are live again.")

    @commands.hybrid_command(
        name="stopbot",
        description="Admin: stop the casino",
        extras={"always_on": True},
    )
    @admin_only()
    async def stopbot(self, ctx):
        if not self.bot.bot_enabled:
            await ctx.send("⛔ The bot is already stopped.")
            return
        await db.set_running(False)
        self.bot.bot_enabled = False
        await ctx.send("⛔ Casino stopped. Commands are disabled until you use `/startbot`.")


async def setup(bot):
    await bot.add_cog(Admin(bot))
