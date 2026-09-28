from discord.ext import commands

import config
from utils import embeds


class Help(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.hybrid_command(name="help", description="Show all commands")
    async def help(self, ctx):
        e = embeds.gold(
            "📖 Help",
            "Use any prefix: `/`  `!`  `$`  `.`",
            ctx.author,
        )
        e.add_field(
            name="🎁 Getting started",
            value="`/start` claim your welcome bonus\n"
            "`/bal` · `/balance` · `/wallet` check your balance\n"
            "`/link <ign>` · `/unlink` your Minecraft name",
            inline=False,
        )
        e.add_field(
            name="🎰 Games",
            value="`/cf` · `/coin` · `/flip` · `/coinflip`\n"
            "Buttons, or quick: `/cf 10k heads`, `!cf tails 1m`",
            inline=False,
        )
        e.add_field(
            name="💸 Money",
            value="`/tip <user> <amt>` · `/pay <amt> <user>` send money\n"
            "`/rakeback` claim 0.5% of your losses\n"
            "`/wager` see your remaining wager\n"
            "`/history` your recent activity",
            inline=False,
        )
        if ctx.author.id == config.ADMIN_ID:
            e.add_field(
                name="🛠️ Admin",
                value="`/startbot` · `/stopbot`\n"
                "`/addbal <user> <amt>` · `/deductbal <user> <amt>`\n"
                "`/setwager <user> <amt>`",
                inline=False,
            )
        e.add_field(
            name="❓ More help",
            value="Need any additional help? Contact the administrator.",
            inline=False,
        )
        await ctx.send(embed=e)


async def setup(bot):
    await bot.add_cog(Help(bot))
