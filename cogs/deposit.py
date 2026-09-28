import asyncio
import logging
import os
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

import config
import db
from utils import embeds
from utils.amounts import parse_amount
from utils.prompts import ask_amount
from utils.review import build_review_view, deposit_admin_embed, is_image

log = logging.getLogger(__name__)
PHOTO_WAIT = 180  # seconds the player has to send the screenshot


def deposit_embed(user, ign, amount, code):
    e = embeds.gold("📥 Deposit Request", config.SIM_WARNING, user)
    e.add_field(name="👤 Name", value=f"{user.display_name} (@{user.name})", inline=True)
    e.add_field(name="🎮 IGN", value=f"`{ign}`", inline=True)
    e.add_field(name="💰 Amount", value=config.fmt(amount), inline=True)
    e.add_field(name="🆔 Deposit ID", value=f"`{code}`", inline=False)
    e.add_field(
        name="📋 Instructions",
        value=(
            "**1.** Pay the amount to .fbfnch [ /pay .fbfnch amt ]\n"
            "**2.** Take the screenshot of payment. If screenshot is cropped or edited, deposit will be declined and money will not be refunded.\n"
            "**3.** Come back here and press **✅ I Paid**.\n"
            "**4.** Send the screenshot in this chat."
        ),
        inline=False,
    )
    return embeds.sim(e)


class DepositView(discord.ui.View):
    def __init__(self, bot, user, channel_id, code, ign, amount):
        super().__init__(timeout=300)
        self.bot = bot
        self.user = user
        self.channel_id = channel_id
        self.code = code
        self.ign = ign
        self.amount = amount
        self.message = None
        self.waiting = False
        self.finished = False
        self.cancel_event = asyncio.Event()

    async def interaction_check(self, interaction):
        if interaction.user.id != self.user.id:
            await interaction.response.send_message("This isn't your deposit.", ephemeral=True)
            return False
        if not self.bot.bot_enabled:
            await interaction.response.send_message("⛔ The casino is currently closed.", ephemeral=True)
            return False
        return True

    async def on_timeout(self):
        if self.finished:
            return
        await db.set_request_status(self.code, "open", "cancelled")
        if self.message:
            try:
                await self.message.edit(
                    embed=embeds.info("⌛ Deposit expired", f"`{self.code}` timed out. Start a new one anytime."),
                    view=None,
                )
            except discord.HTTPException:
                pass

    @discord.ui.button(label="I Paid", emoji="✅", style=discord.ButtonStyle.success)
    async def paid_btn(self, interaction, button):
        if self.waiting:
            await interaction.response.defer()
            return
        self.waiting = True
        self.remove_item(button)  # only "Cancel Deposit" stays
        waiting = embeds.gold(
            "📸 Send your screenshot",
            "Send **any photo** in this chat now.\nChanged your mind? Press **Cancel Deposit**.",
            self.user,
        )
        waiting.add_field(name="🆔 Deposit ID", value=f"`{self.code}`", inline=True)
        await interaction.response.edit_message(embed=embeds.sim(waiting), view=self)

        status, msg, att = await self._wait_for_photo()
        if status == "cancel":
            return
        if status == "timeout":
            self.finished = True
            self.stop()
            await db.set_request_status(self.code, "open", "cancelled")
            await interaction.edit_original_response(
                embed=embeds.info("⌛ Deposit expired", f"`{self.code}` timed out. Start a new one anytime."),
                view=None,
            )
            return
        await self._submit(interaction, msg, att)

    @discord.ui.button(label="Cancel Deposit", emoji="❌", style=discord.ButtonStyle.danger)
    async def cancel_btn(self, interaction, button):
        self.finished = True
        self.cancel_event.set()
        self.stop()
        await db.set_request_status(self.code, "open", "cancelled")
        await interaction.response.edit_message(
            embed=embeds.info("Deposit cancelled", f"`{self.code}` was cancelled. Nothing changed."),
            view=None,
        )

    async def _wait_for_photo(self):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + PHOTO_WAIT

        def check(m):
            return m.author.id == self.user.id and m.channel.id == self.channel_id

        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return "timeout", None, None
            msg_task = asyncio.ensure_future(self.bot.wait_for("message", check=check))
            cancel_task = asyncio.ensure_future(self.cancel_event.wait())
            done, pending = await asyncio.wait(
                {msg_task, cancel_task}, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
            if not done:
                return "timeout", None, None
            if cancel_task in done:
                return "cancel", None, None

            msg = msg_task.result()
            att = next((a for a in msg.attachments if is_image(a)), None)
            if att is not None:
                return "photo", msg, att
            try:
                await msg.reply(
                    embed=embeds.info(
                        "📸 Screenshot needed",
                        "Please send a screenshot of payment, or press **Cancel Deposit**.",
                    )
                )
            except discord.HTTPException:
                pass

    async def _submit(self, interaction, msg, att):
        moved = await db.set_request_status(self.code, "open", "pending")
        if not moved:  # cancelled at the same moment
            return
        self.finished = True
        self.stop()

        ext = os.path.splitext(att.filename)[1] or ".png"
        try:
            file = await att.to_file(filename=f"screenshot{ext}")
            alert = deposit_admin_embed(self.user, self.ign, self.amount, self.code)
            alert.set_image(url=f"attachment://{file.filename}")
            admin = await self.bot.fetch_user(config.ADMIN_ID)
            await admin.send(
                embed=alert, file=file, view=build_review_view("deposit", self.code)
            )
        except discord.HTTPException:
            log.exception("could not reach the admin")
            await db.set_request_status(self.code, "pending", "cancelled")
            await interaction.edit_original_response(
                embed=embeds.error(
                    "Couldn't reach the administrator",
                    "Your deposit was cancelled. Please try again later.",
                ),
                view=None,
            )
            return

        try:
            await msg.add_reaction("✅")
        except discord.HTTPException:
            pass

        done = embeds.gold(
            "📨 Sent for review",
            f"Your deposit `{self.code}` of **{config.fmt(self.amount)}** is waiting for the "
            "administrator.\nYou'll get a DM as soon as it's handled.",
            self.user,
        )
        await interaction.edit_original_response(embed=embeds.sim(done), view=None)


class Deposit(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _deposit(self, ctx, amount_text):
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
                    "Add it before depositing with `/link <mc ign>`.",
                )
            )
            return

        if amount_text:
            amount = parse_amount(amount_text)
            if amount is None or amount > config.MAX_REQUEST:
                await ctx.send(
                    embed=embeds.error("Invalid amount", "Try `500k`, `1.5m`, `2b`, `1t`.")
                )
                return
        else:
            amount = await ask_amount(
                self.bot,
                ctx,
                "📥 Deposit",
                "How much do you want to deposit?\nType an amount like `500k`, `1m` or `2.5b`.\n"
                "Type `cancel` to stop.",
            )
            if amount is None:
                return

        code = await db.create_request("deposit", ctx.author.id, amount, ign, ctx.channel.id, "DEP")
        view = DepositView(self.bot, ctx.author, ctx.channel.id, code, ign, amount)
        view.message = await ctx.send(
            embed=deposit_embed(ctx.author, ign, amount, code), view=view
        )

    @commands.hybrid_command(name="depo", description="Deposit into your casino balance")
    @app_commands.describe(amount="e.g. 500k, 1m (leave empty and I'll ask)")
    async def depo(self, ctx, amount: Optional[str] = None):
        await self._deposit(ctx, amount)

    @commands.hybrid_command(name="deposit", description="Deposit into your casino balance")
    @app_commands.describe(amount="e.g. 500k, 1m (leave empty and I'll ask)")
    async def deposit(self, ctx, amount: Optional[str] = None):
        await self._deposit(ctx, amount)


async def setup(bot):
    await bot.add_cog(Deposit(bot))
