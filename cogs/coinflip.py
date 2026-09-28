import asyncio
import logging
import random
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

import config
import db
from utils import embeds
from utils.amounts import parse_amount, parse_side

log = logging.getLogger(__name__)

EMOJI = {"heads": "🟡", "tails": "⚪"}
NAME = {"heads": "Heads", "tails": "Tails"}
FLIP_STEPS = 6
FLIP_DELAY = 0.75


def other(side):
    return "tails" if side == "heads" else "heads"


def label(side):
    return f"{EMOJI[side]} {NAME[side]}"


# ───────────────────────── embeds ─────────────────────────


def bet_prompt(user, balance, side=None):
    e = embeds.gold("🪙 Coin Flip", "Choose how much you want to put on the line.", user)
    e.add_field(name="💰 Balance", value=config.fmt(balance), inline=True)
    if side:
        e.add_field(name="🎯 Your Call", value=label(side), inline=True)
    return e


def side_prompt(user, bet, balance):
    e = embeds.gold("🪙 Coin Flip", "Call it in the air. Heads or tails?", user)
    e.add_field(name="🎟️ Bet", value=config.fmt(bet), inline=True)
    e.add_field(name="💰 Balance", value=config.fmt(balance), inline=True)
    return e


def flip_frame(user, bet, side, face, step):
    dots = "." * (step % 3 + 1)
    desc = (
        f"You bet **{config.fmt(bet)}** on {label(side)}\n\n"
        f"## {EMOJI[face]} {NAME[face].upper()}\n"
        f"*The coin is spinning{dots}*"
    )
    return embeds.make("🪙 Flipping…", desc, config.COLOR_BLURPLE, user)


def result_embed(user, bet, side, result, win, balance):
    header = f"## {EMOJI[result]} {NAME[result].upper()}\nYou called {label(side)}."
    if win:
        e = embeds.make("🎉 You Won!", header, config.COLOR_GREEN, user)
        e.add_field(name="🎟️ Bet", value=config.fmt(bet), inline=True)
        e.add_field(name="📈 Profit", value=f"+{config.fmt(bet)}", inline=True)
    else:
        e = embeds.make("💸 You Lost", header, config.COLOR_RED, user)
        e.add_field(name="🎟️ Bet", value=config.fmt(bet), inline=True)
        e.add_field(name="📉 Lost", value=f"-{config.fmt(bet)}", inline=True)
    e.add_field(name="💰 Balance", value=config.fmt(balance), inline=True)
    return e


def no_funds(balance=None):
    text = "Your balance doesn't cover that bet."
    if balance is not None:
        text = f"You only have **{config.fmt(balance)}**."
    return embeds.error("Not enough balance", text)


def bad_amount():
    return embeds.error(
        "Invalid amount", "Try something like `5k`, `1.5m`, `2b`, `1t`, `50%` or `all`."
    )


def usage_embed():
    return embeds.info(
        "🪙 Coin Flip",
        "**Quick bet**\n"
        "`/cf 10k heads`\n"
        "`!cf tails 1m`\n"
        "`$coin 5k head`\n\n"
        "Or just type `!cf` for buttons.\n"
        "Amounts: `1k` `10k` `1m` `1b` `1t` `50%` `all`",
    )


# ───────────────────────── game logic ─────────────────────────


def interaction_editor(interaction):
    async def edit(embed, view=None):
        return await interaction.edit_original_response(embed=embed, view=view)

    return edit


async def play_round(bot, user, bet, side, edit, owner_view=None):
    """Charges the bet, animates the flip by editing one message, pays out.
    Returns False (and touches nothing) if the balance can't cover the bet."""
    new_bal = await db.take_bet(user.id, bet)
    if new_bal is None:
        return False
    if owner_view is not None:
        owner_view.stop()

    win = random.random() * 100 < bot.cf_win_chance
    result = side if win else other(side)

    # alternate faces, landing on the opposite of the result right before the reveal
    faces = [
        other(result) if (FLIP_STEPS - 1 - i) % 2 == 0 else result
        for i in range(FLIP_STEPS)
    ]
    try:
        for i, face in enumerate(faces):
            await edit(flip_frame(user, bet, side, face, i))
            await asyncio.sleep(FLIP_DELAY)
    except discord.HTTPException:
        pass  # a failed edit must never cost the player their payout

    detail = f"{NAME[side]} -> {NAME[result]}"
    for _ in range(3):
        try:
            new_bal = await db.settle_cf(user.id, bet, win, detail)
            break
        except Exception:
            log.exception("settle failed, retrying")
            await asyncio.sleep(1)

    view = AgainView(bot, user, bet, side)
    try:
        view.message = await edit(result_embed(user, bet, side, result, win, new_bal), view)
    except discord.HTTPException:
        pass
    return True


# ───────────────────────── views ─────────────────────────


class BaseView(discord.ui.View):
    expire_embed = True

    def __init__(self, bot, user, timeout=90):
        super().__init__(timeout=timeout)
        self.bot = bot
        self.user = user
        self.message = None
        self.busy = False

    async def interaction_check(self, interaction):
        if interaction.user.id != self.user.id:
            await interaction.response.send_message(
                "This isn't your game. Start your own with `/cf`.", ephemeral=True
            )
            return False
        if not self.bot.bot_enabled:
            await interaction.response.send_message(
                "⛔ The casino is currently closed.", ephemeral=True
            )
            return False
        return True

    async def on_timeout(self):
        if self.message is None:
            return
        try:
            if self.expire_embed:
                await self.message.edit(
                    embed=embeds.info("⌛ Expired", "This bet timed out. Start a new one anytime."),
                    view=None,
                )
            else:
                await self.message.edit(view=None)
        except discord.HTTPException:
            pass

    async def cancel(self, interaction):
        self.stop()
        await interaction.response.edit_message(
            embed=embeds.info("Cancelled", "No bet placed. Come back anytime! 🍩"), view=None
        )


class PercentButton(discord.ui.Button):
    def __init__(self, pct):
        style = discord.ButtonStyle.danger if pct == 100 else discord.ButtonStyle.secondary
        super().__init__(label=f"{pct}%", style=style, row=0)
        self.pct = pct

    async def callback(self, interaction):
        await self.view.handle_percent(interaction, self.pct)


class CustomBetModal(discord.ui.Modal, title="Custom Bet"):
    amount = discord.ui.TextInput(
        label="How much do you want to bet?",
        placeholder="e.g. 25k, 1.5m, 2b, 1t or all",
        max_length=20,
    )

    def __init__(self, flow):
        super().__init__()
        self.flow = flow

    async def on_submit(self, interaction):
        await self.flow.handle_custom(interaction, self.amount.value)


class BetView(BaseView):
    def __init__(self, bot, user, side=None):
        super().__init__(bot, user)
        self.side = side
        for pct in (5, 10, 30, 50, 100):
            self.add_item(PercentButton(pct))

    @discord.ui.button(label="Custom", emoji="✏️", style=discord.ButtonStyle.primary, row=1)
    async def custom(self, interaction, button):
        await interaction.response.send_modal(CustomBetModal(self))

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary, row=1)
    async def cancel_btn(self, interaction, button):
        await self.cancel(interaction)

    async def handle_percent(self, interaction, pct):
        await self._choose(interaction, lambda bal: max(1, bal * pct // 100))

    async def handle_custom(self, interaction, text):
        await self._choose(interaction, lambda bal: parse_amount(text, bal))

    async def _choose(self, interaction, calc):
        if self.busy:
            await interaction.response.defer()
            return
        self.busy = True
        await interaction.response.defer()

        row = await db.get_user(self.user.id)
        bal = row["balance"] if row else 0
        bet = calc(bal)

        if bet is None:
            self.busy = False
            await interaction.followup.send(embed=bad_amount(), ephemeral=True)
            return
        if bet < 1 or bet > bal:
            self.busy = False
            await interaction.followup.send(embed=no_funds(bal), ephemeral=True)
            return

        if self.side:
            ok = await play_round(
                self.bot, self.user, bet, self.side, interaction_editor(interaction), owner_view=self
            )
            if not ok:
                self.busy = False
                await interaction.followup.send(embed=no_funds(), ephemeral=True)
        else:
            self.stop()
            view = SideView(self.bot, self.user, bet)
            view.message = self.message
            await interaction.edit_original_response(
                embed=side_prompt(self.user, bet, bal), view=view
            )


class SideView(BaseView):
    def __init__(self, bot, user, bet):
        super().__init__(bot, user)
        self.bet = bet

    @discord.ui.button(label="Heads", emoji="🟡", style=discord.ButtonStyle.primary, row=0)
    async def heads(self, interaction, button):
        await self._pick(interaction, "heads")

    @discord.ui.button(label="Tails", emoji="⚪", style=discord.ButtonStyle.primary, row=0)
    async def tails(self, interaction, button):
        await self._pick(interaction, "tails")

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary, row=1)
    async def cancel_btn(self, interaction, button):
        await self.cancel(interaction)

    async def _pick(self, interaction, side):
        if self.busy:
            await interaction.response.defer()
            return
        self.busy = True
        await interaction.response.defer()
        ok = await play_round(
            self.bot, self.user, self.bet, side, interaction_editor(interaction), owner_view=self
        )
        if not ok:
            self.busy = False
            await interaction.followup.send(embed=no_funds(), ephemeral=True)


class AgainView(BaseView):
    expire_embed = False  # keep the result on screen, just remove the buttons

    def __init__(self, bot, user, bet, side):
        super().__init__(bot, user, timeout=120)
        self.bet = bet
        self.side = side

    @discord.ui.button(label="Flip Again", emoji="🔁", style=discord.ButtonStyle.primary)
    async def again(self, interaction, button):
        await self._replay(interaction, self.bet)

    @discord.ui.button(label="Double", emoji="⏫", style=discord.ButtonStyle.secondary)
    async def double(self, interaction, button):
        await self._replay(interaction, self.bet * 2)

    async def _replay(self, interaction, bet):
        if self.busy:
            await interaction.response.defer()
            return
        self.busy = True
        await interaction.response.defer()
        ok = await play_round(
            self.bot, self.user, bet, self.side, interaction_editor(interaction), owner_view=self
        )
        if not ok:
            self.busy = False
            await interaction.followup.send(embed=no_funds(), ephemeral=True)


# ───────────────────────── commands ─────────────────────────


class Coinflip(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _entry(self, ctx, a, b):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await ctx.send(
                embed=embeds.error(
                    "Join the casino first", "Use `/start` to claim your welcome bonus."
                )
            )
            return
        bal = row["balance"]

        # arguments can come in either order: "10k heads" or "heads 10k"
        side = None
        bet = None
        for tok in (a, b):
            if tok is None:
                continue
            s = parse_side(tok)
            if s is not None:
                if side is not None:
                    await ctx.send(embed=usage_embed())
                    return
                side = s
                continue
            amt = parse_amount(tok, bal)
            if amt is None or bet is not None:
                await ctx.send(embed=usage_embed() if bet is not None else bad_amount())
                return
            bet = amt

        if bet is not None and (bet < 1 or bet > bal):
            await ctx.send(embed=no_funds(bal))
            return

        if bet is None:
            view = BetView(self.bot, ctx.author, side)
            view.message = await ctx.send(embed=bet_prompt(ctx.author, bal, side), view=view)
        elif side is None:
            view = SideView(self.bot, ctx.author, bet)
            view.message = await ctx.send(embed=side_prompt(ctx.author, bet, bal), view=view)
        else:
            msg = None

            async def edit(embed, view=None):
                nonlocal msg
                if msg is None:
                    msg = await ctx.send(embed=embed, view=view)
                else:
                    msg = await msg.edit(embed=embed, view=view)
                return msg

            ok = await play_round(self.bot, ctx.author, bet, side, edit)
            if not ok:
                await ctx.send(embed=no_funds())

    @commands.hybrid_command(name="cf", description="Flip a coin: bet on heads or tails")
    @app_commands.describe(amount="Bet, e.g. 5k, 1.5m, 2b, 50% or all", side="heads or tails")
    async def cf(self, ctx, amount: Optional[str] = None, side: Optional[str] = None):
        await self._entry(ctx, amount, side)

    @commands.hybrid_command(name="coin", description="Flip a coin: bet on heads or tails")
    @app_commands.describe(amount="Bet, e.g. 5k, 1.5m, 2b, 50% or all", side="heads or tails")
    async def coin(self, ctx, amount: Optional[str] = None, side: Optional[str] = None):
        await self._entry(ctx, amount, side)

    @commands.hybrid_command(name="flip", description="Flip a coin: bet on heads or tails")
    @app_commands.describe(amount="Bet, e.g. 5k, 1.5m, 2b, 50% or all", side="heads or tails")
    async def flip(self, ctx, amount: Optional[str] = None, side: Optional[str] = None):
        await self._entry(ctx, amount, side)

    @commands.hybrid_command(name="coinflip", description="Flip a coin: bet on heads or tails")
    @app_commands.describe(amount="Bet, e.g. 5k, 1.5m, 2b, 50% or all", side="heads or tails")
    async def coinflip(self, ctx, amount: Optional[str] = None, side: Optional[str] = None):
        await self._entry(ctx, amount, side)


async def setup(bot):
    await bot.add_cog(Coinflip(bot))
