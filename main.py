import logging

import discord
from discord.ext import commands

import checks
import config
import db
from utils import embeds
from utils.review import ReviewButton
from webserver import start_web

logging.basicConfig(level=logging.INFO)

EXTENSIONS = (
    "cogs.economy",
    "cogs.profile",
    "cogs.help",
    "cogs.coinflip",
    "cogs.deposit",
    "cogs.withdraw",
    "cogs.transfers",
    "cogs.rewards",
    "cogs.admin",
)


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
        self.cf_win_chance = config.DEFAULT_CF_WIN
        self.add_check(self.global_check)

    async def setup_hook(self):
        await start_web()
        self.add_dynamic_items(ReviewButton)  # admin buttons keep working after restarts
        self.bot_enabled = await db.is_running()
        self.cf_win_chance = await db.get_cf_chance()
        for ext in EXTENSIONS:
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
        logging.info("Commands loaded: %s", sorted(c.name for c in self.commands))

    async def on_command_error(self, ctx, error):
        if isinstance(error, commands.CommandNotFound):
            return
        if isinstance(error, checks.BotStopped):
            await ctx.send(
                embed=embeds.info(
                    "⛔ Casino Closed",
                    "The casino is currently stopped.\nAsk the administrator to start it again.",
                ),
                ephemeral=True,
            )
            return
        if isinstance(error, checks.NotAdmin):
            await ctx.send(
                embed=embeds.error("Admins only", "This command is for the administrator."),
                ephemeral=True,
            )
            return
        if isinstance(
            error,
            (commands.MissingRequiredArgument, commands.BadArgument, commands.UserNotFound),
        ):
            usage = f"/{ctx.command.qualified_name} {ctx.command.signature}".strip()
            await ctx.send(
                embed=embeds.error(
                    "Check your command",
                    f"Usage: `{usage}`\nTip: mention players like @name. See `/help`.",
                ),
                ephemeral=True,
            )
            return
        logging.exception("Command error", exc_info=error)
        text = "Please try again in a moment."
        if ctx.author.id == config.ADMIN_ID:  # only you see the technical reason
            cause = getattr(error, "original", error)
            text += f"\n```{type(cause).__name__}: {str(cause)[:500]}```"
        await ctx.send(embed=embeds.error("Something went wrong", text), ephemeral=True)


if __name__ == "__main__":
    DonutBetBot().run(config.DISCORD_TOKEN)