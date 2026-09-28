from decimal import Decimal

import discord
from discord.ext import commands

import config
import db
from utils import embeds


def claimable(losses: int) -> int:
    return int(Decimal(losses) * Decimal(str(config.RAKEBACK_RATE)))


class ClaimView(discord.ui.View):
    def __init__(self, bot, user, amount):
        super().__init__(timeout=120)
        self.bot = bot
        self.user = user
        self.message = None
        self.busy = False
        self.claim_btn.label = f"Claim {config.fmt(amount)}"

    async def interaction_check(self, interaction):
        if interaction.user.id != self.user.id:
            await interaction.response.send_message("This isn't your rakeback.", ephemeral=True)
            return False
        if not self.bot.bot_enabled:
            await interaction.response.send_message("⛔ The casino is currently closed.", ephemeral=True)
            return False
        return True

    async def on_timeout(self):
        if self.message:
            try:
                await self.message.edit(view=None)
            except discord.HTTPException:
                pass

    @discord.ui.button(label="Claim", emoji="💚", style=discord.ButtonStyle.success)
    async def claim_btn(self, interaction, button):
        if self.busy:
            await interaction.response.defer()
            return
        self.busy = True
        await interaction.response.defer()
        reward = await db.claim_rakeback(self.user.id)
        if not reward:
            self.busy = False
            await interaction.followup.send(
                embed=embeds.error("Nothing to claim", "No rakeback available right now."),
                ephemeral=True,
            )
            return
        self.stop()
        row = await db.get_user(self.user.id)
        e = embeds.make(
            "💚 Rakeback Claimed",
            f"## +{config.fmt(reward)}",
            config.COLOR_GREEN,
            self.user,
        )
        e.add_field(name="💰 Balance", value=config.fmt(row["balance"]), inline=True)
        await interaction.edit_original_response(embed=e, view=None)


class Rewards(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.hybrid_command(name="rakeback", description="Claim 0.5% of your losses back")
    async def rakeback(self, ctx):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await ctx.send(
                embed=embeds.info("🍩 Not in yet", "Use `/start` to join the casino first.", ctx.author)
            )
            return

        losses = row["losses_unclaimed"]
        amount = claimable(losses)
        e = embeds.gold(
            "💚 Rakeback",
            f"Get **{config.RAKEBACK_RATE * 100:g}%** of your losses back.",
            ctx.author,
        )
        e.add_field(name="📉 Losses", value=config.fmt(losses), inline=True)
        e.add_field(name="💰 Claimable", value=config.fmt(amount), inline=True)

        if amount < 1:
            e.set_footer(text=f"{config.BOT_NAME} 🍩 · Nothing to claim yet")
            await ctx.send(embed=e)
            return

        view = ClaimView(self.bot, ctx.author, amount)
        view.message = await ctx.send(embed=e, view=view)


async def setup(bot):
    await bot.add_cog(Rewards(bot))
