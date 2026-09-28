from discord.ext import commands

import config


class BotStopped(commands.CheckFailure):
    pass


class NotAdmin(commands.CheckFailure):
    pass


def admin_only():
    async def predicate(ctx):
        if ctx.author.id != config.ADMIN_ID:
            raise NotAdmin()
        return True

    return commands.check(predicate)
