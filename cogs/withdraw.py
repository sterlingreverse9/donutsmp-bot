import logging
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

import config
import db
from utils import embeds
from utils.amounts import parse_amount
from utils.prompts import ask_amount
from utils.review import build_review_view, withdraw_admin_embed

log = logging.getLogger(__name__)


def confirm_embed(user, ign, amount, balance_after):
    e = embeds.gold("📤 Confirm Withdrawal", config.SIM_WARNING, user)
    e.add_field(name="👤 Name", value=f"{user.display_name} (@{user.name})", inline=True)
    e.add_field(name="🎮 IGN", value=f"`{ign}`", inline=True)
    e.add_field(name="💰 Amount", value=config.fmt(amount), inline=True)
    e.add_field(name="🏦 Remaining balance", value=config.fmt(balance_after), inline=True)
    e.add_field(
        name="⏱️ Processing",
        value="You'll receive your withdrawal within **1 hour**.",
        inline=False,
    )
    return embeds.sim(e)


class ConfirmWithdrawView(discord.ui.View):
    def __init__(self, bot, user, channel_id, ign, amount):
        super().__init__(timeout=120)
        self.bot = bot
        self.user = user
        self.channel_id = channel_id
        self.ign = ign
        self.amount = amount
        self.message = None
        self.busy = False

    async def interaction_check(self, interaction):
        if interaction.user.id != self.user.id:
            await interaction.response.send_message("This isn't your withdrawal.", ephemeral=True)
            return False
        if not self.bot.bot_enabled:
            await interaction.response.send_message("⛔ The casino is currently closed.", ephemeral=True)
            return False
        return True

    async def on_timeout(self):
        if self.message:
            try:
                await self.message.edit(
                    embed=embeds.info("⌛ Expired", "This withdrawal timed out. Nothing changed."),
                    view=None,
                )
            except discord.HTTPException:
                pass

    @discord.ui.button(label="Confirm", emoji="✅", style=discord.ButtonStyle.success)
    async def confirm(self, interaction, button):
        if self.busy:
            await interaction.response.defer()
            return
        self.busy = True
        await interaction.response.defer()

        code, result = await db.create_withdraw(
            self.user.id, self.amount, self.ign, self.channel_id
        )
        if result < 0:
            self.busy = False
            reasons = {
                -1: "Use `/start` to join the casino first.",
                -2: "You still have wager left. Check `/wager`.",
                -3: "Your balance no longer covers this amount.",
            }
            self.stop()
            await interaction.edit_original_response(
                embed=embeds.error("Withdrawal failed", reasons.get(result, "Try again in a moment.")),
                view=None,
            )
            return

        self.stop()
        try:
            alert = withdraw_admin_embed(self.user, self.ign, self.amount, code, result)
            admin = await self.bot.fetch_user(config.ADMIN_ID)
            await admin.send(embed=alert, view=build_review_view("withdraw", code))
        except discord.HTTPException:
            log.exception("could not reach the admin, refunding")
            await db.reject_withdraw(code, "Administrator could not be reached")
            await interaction.edit_original_response(
                embed=embeds.error(
                    "Couldn't reach the administrator",
                    "Your withdrawal was cancelled and your balance is untouched. Try again later.",
                ),
                view=None,
            )
            return

        done = embeds.gold(
            "⏳ Withdrawal submitted",
            f"Your withdrawal `{code}` of **{config.fmt(self.amount)}** was sent to the administrator.\n"
            "You'll receive it within **1 hour** and get a DM when it's handled.",
            self.user,
        )
        done.add_field(name="🏦 Balance", value=config.fmt(result), inline=True)
        await interaction.edit_original_response(embed=embeds.sim(done), view=None)

    @discord.ui.button(label="Cancel", emoji="❌", style=discord.ButtonStyle.danger)
    async def cancel(self, interaction, button):
        self.stop()
        await interaction.response.edit_message(
            embed=embeds.info("Withdrawal cancelled", "Nothing changed. Your balance is untouched."),
            view=None,
        )


class Withdraw(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _withdraw(self, ctx, amount_text):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await ctx.send(
                embed=embeds.error("Join the casino first", "Use `/start` to claim your welcome bonus.")
            )
            return

        ign = row.get("mc_ign")
        if not ign:
            await ctx.send(
                embed=embeds.error(
                    "Link your Minecraft name first",
                    "Add it before withdrawing with `/link <mc ign>`.",
                )
            )
            return

        if row["wager_left"] > 0:
            e = embeds.error(
                "Wager not complete",
                f"You still need to wager **{config.fmt(row['wager_left'])}** before you can withdraw.\n"
                "Check `/wager` anytime.",
            )
            await ctx.send(embed=e)
            return

        bal = row["balance"]
        if bal < 1:
            await ctx.send(embed=embeds.error("Nothing to withdraw", "Your balance is empty."))
            return

        if amount_text:
            amount = parse_amount(amount_text, bal)
            if amount is None:
                await ctx.send(
                    embed=embeds.error("Invalid amount", "Try `500k`, `1.5m`, `50%` or `all`.")
                )
                return
        else:
            amount = await ask_amount(
                self.bot,
                ctx,
                "📤 Withdraw",
                f"How much do you want to withdraw?\n**Max:** {config.fmt(bal)}\n"
                "Type an amount like `500k`, `1m` or `all`. Type `cancel` to stop.",
                balance=bal,
            )
            if amount is None:
                return

        if amount < 1 or amount > bal:
            await ctx.send(embed=embeds.error("Invalid amount", f"You can withdraw up to **{config.fmt(bal)}**."))
            return

        view = ConfirmWithdrawView(self.bot, ctx.author, ctx.channel.id, ign, amount)
        view.message = await ctx.send(
            embed=confirm_embed(ctx.author, ign, amount, bal - amount), view=view
        )

    @commands.hybrid_command(name="withdraw", description="Withdraw from your casino balance")
    @app_commands.describe(amount="e.g. 500k, 1m, all (leave empty and I'll ask)")
    async def withdraw(self, ctx, amount: Optional[str] = None):
        await self._withdraw(ctx, amount)


async def setup(bot):
    await bot.add_cog(Withdraw(bot))
