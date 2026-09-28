from discord.ext import commands

import config
import db
from utils import embeds


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
            e = embeds.make(
                f"🍩 Welcome to {config.BOT_NAME}!",
                f"## 🎰 You're in, {ctx.author.display_name}!\n"
                f"A **{config.fmt(config.START_BONUS)}** welcome bonus just landed in your wallet.",
                config.COLOR_GREEN,
                ctx.author,
                thumbnail=True,
            )
            e.add_field(name="💰 Balance", value=config.fmt(user["balance"]), inline=True)
            e.add_field(name="🎲 Games", value="🪙 Coin Flip · `/cf`", inline=True)
        else:
            e = embeds.info(
                "🍩 You're already in!",
                "Your welcome bonus has already been claimed.",
                ctx.author,
            )
            e.add_field(name="💰 Balance", value=config.fmt(user["balance"]), inline=True)
        await ctx.send(embed=e)

    async def _show_balance(self, ctx):
        await ctx.defer()
        user = await db.get_user(ctx.author.id)
        if not user or not user["started"]:
            await ctx.send(
                embed=embeds.info(
                    "🍩 Not in yet",
                    "Use `/start` to join the casino and claim your bonus!",
                    ctx.author,
                )
            )
            return
        e = embeds.gold(
            "💼 Wallet",
            f"## 💰 {config.fmt(user['balance'])}",
            ctx.author,
            thumbnail=True,
        )
        e.add_field(name="🎲 Ready to play?", value="`/cf` to flip a coin", inline=False)
        await ctx.send(embed=e)

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
