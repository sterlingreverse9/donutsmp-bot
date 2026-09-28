import logging

import discord
from discord.ext import commands

import checks
import config
import db
from webserver import start_web

logging.basicConfig(level=logging.INFO)


class DonutBetBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(
            command_prefix=commands.when_mentioned_or(*config.PREFIXES),
            intents=intents,
            case_insensitive=True,
            help_command=None,
        )
        self.bot_enabled = True
        self.add_check(self.global_check)

    async def setup_hook(self):
        await start_web()
        self.bot_enabled = await db.is_running()
        for ext in ("cogs.economy", "cogs.admin"):
            await self.load_extension(ext)
        await self.tree.sync()

    async def global_check(self, ctx):
        # admin start/stop commands must work even while the bot is stopped
        if ctx.command and ctx.command.extras.get("always_on"):
            return True
        if not self.bot_enabled:
            raise checks.BotStopped()
        return True

    async def on_ready(self):
        logging.info("Logged in as %s", self.user)

    async def on_command_error(self, ctx, error):
        if isinstance(error, commands.CommandNotFound):
            return
        if isinstance(error, checks.BotStopped):
            await ctx.send(
                "⛔ The casino is currently stopped. "
                "Ask the administrator to start it again."
            )
            return
        if isinstance(error, checks.NotAdmin):
            await ctx.send("🚫 This command is for the administrator only.")
            return
        logging.exception("Command error", exc_info=error)
        await ctx.send("⚠️ Something went wrong. Try again in a moment.")


if __name__ == "__main__":
    DonutBetBot().run(config.DISCORD_TOKEN)
