import re
from datetime import datetime

from discord import app_commands
from discord.ext import commands

import config
import db
from utils import embeds

# Java names (3-16 letters/digits/_) and Bedrock names with a leading "."
IGN_RE = re.compile(r"^\.?[A-Za-z0-9_]{3,16}$")

KINDS = {
    "coinflip": ("🪙", "Coin Flip"),
    "bonus": ("🎁", "Bonus"),
    "rakeback": ("💚", "Rakeback"),
    "tip_sent": ("📤", "Tip sent"),
    "tip_received": ("📥", "Tip received"),
    "admin_add": ("🛠️", "Balance added"),
    "admin_deduct": ("🛠️", "Balance removed"),
}


def to_unix(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


class Profile(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _need_join(self, ctx):
        await ctx.send(
            embed=embeds.info(
                "🍩 Not in yet", "Use `/start` to join the casino first.", ctx.author
            )
        )

    @commands.hybrid_command(name="link", description="Link your Minecraft in-game name")
    @app_commands.describe(ign="Your Minecraft in-game name")
    async def link(self, ctx, ign: str):
        await ctx.defer()
        ign = ign.strip()
        if not IGN_RE.match(ign):
            await ctx.send(
                embed=embeds.error(
                    "Invalid name",
                    "Use your exact in-game name (3-16 letters, numbers or `_`).\n"
                    "Bedrock names start with a `.`",
                )
            )
            return
        if not await db.set_ign(ctx.author.id, ign):
            await self._need_join(ctx)
            return
        e = embeds.success("Account linked", "Your Minecraft name is now linked.", ctx.author)
        e.add_field(name="🎮 In-game name", value=f"`{ign}`", inline=True)
        await ctx.send(embed=e)

    @commands.hybrid_command(name="unlink", description="Unlink your Minecraft in-game name")
    async def unlink(self, ctx):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row.get("mc_ign"):
            await ctx.send(embed=embeds.info("Nothing to unlink", "You haven't linked a name yet."))
            return
        await db.set_ign(ctx.author.id, None)
        await ctx.send(
            embed=embeds.success(
                "Account unlinked", f"`{row['mc_ign']}` has been removed.", ctx.author
            )
        )

    @commands.hybrid_command(name="wager", description="See how much you still need to wager")
    async def wager(self, ctx):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await self._need_join(ctx)
            return
        left = row["wager_left"]
        if left <= 0:
            e = embeds.make(
                "✅ Wager complete",
                "You've met your wagering requirement.",
                config.COLOR_GREEN,
                ctx.author,
            )
        else:
            e = embeds.gold(
                "🎲 Wager Requirement",
                f"## {config.fmt(left)}\nleft to wager before you can withdraw.",
                ctx.author,
            )
            e.add_field(name="ℹ️ How it works", value="Every bet counts toward your wager.", inline=False)
        await ctx.send(embed=e)

    @commands.hybrid_command(name="history", description="See your recent activity")
    async def history(self, ctx):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await self._need_join(ctx)
            return
        rows = await db.history(ctx.author.id, config.HISTORY_LIMIT)
        if not rows:
            await ctx.send(
                embed=embeds.info("📜 History", "No activity yet. Try `/cf`!", ctx.author)
            )
            return

        lines = []
        for r in rows:
            icon, name = KINDS.get(r["kind"], ("•", r["kind"].replace("_", " ").title()))
            net = r["net"]
            sign = "+" if net >= 0 else "-"
            when = f"<t:{to_unix(r['created_at'])}:R>"
            bet = f"bet {config.fmt(r['amount'])} · " if r["kind"] == "coinflip" else ""
            lines.append(f"{icon} **{name}** · {bet}{sign}{config.fmt(abs(net))} · {when}")

        e = embeds.gold(
            "📜 History", f"Your latest {len(rows)} activities\n\n" + "\n".join(lines), ctx.author
        )
        await ctx.send(embed=e)


async def setup(bot):
    await bot.add_cog(Profile(bot))
