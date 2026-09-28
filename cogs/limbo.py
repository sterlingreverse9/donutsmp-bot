import asyncio
import logging
import math
import random
import re
from decimal import ROUND_DOWN, Decimal
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

import config
import db
from cogs.coinflip import BaseView, PercentButton, bad_amount, interaction_editor, no_funds
from utils import embeds
from utils.amounts import parse_amount

log = logging.getLogger(__name__)

MIN_MULTI = Decimal("1.01")
MAX_MULTI = Decimal("1000000")
MAX_PAYOUT = 10**14
DEFAULT_EDGE = 10.0
ANIM_STEPS = 6
ANIM_DELAY = 0.7
X_FORM = re.compile(r"^\d+(?:\.\d+)?x$")
NUM_FORM = re.compile(r"^(\d+(?:\.\d+)?)x?$")


# ───────────────────── math ─────────────────────


def parse_multiplier(text):
    """'2x' / '2.5' -> Decimal (2 decimals). None if unreadable or out of range."""
    if text is None:
        return None
    m = NUM_FORM.match(text.strip().lower().replace(",", ""))
    if not m:
        return None
    value = Decimal(m.group(1)).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    if value < MIN_MULTI or value > MAX_MULTI:
        return None
    return value


def roll(edge_pct: float) -> Decimal:
    """Crash-style roll: P(result >= m) = (1 - edge) / m."""
    u = 1.0 - random.random()  # (0, 1]
    raw = (1 - edge_pct / 100) / u
    cents = math.floor(raw * 100)
    cents = max(100, min(cents, int(MAX_MULTI * 100)))
    return Decimal(cents) / 100


def win_chance(edge_pct: float, target) -> float:
    return max(0.0, min(100.0, (1 - edge_pct / 100) / float(target) * 100))


def chance_text(p: float) -> str:
    if p <= 0:
        return "0%"
    if p < 0.01:
        return "<0.01%"
    return f"{p:.2f}%"


def fx(value) -> str:
    return f"{Decimal(value):,.2f}x"


def payout_for(bet: int, target) -> int:
    return int(Decimal(bet) * target)


def payout_error(bet: int, target):
    if payout_for(bet, target) > MAX_PAYOUT:
        return embeds.error(
            "Payout too high",
            f"Max payout is **{config.fmt(MAX_PAYOUT)}**. Lower your bet or your target.",
        )
    return None


def bad_target():
    return embeds.error(
        "Invalid target",
        f"Pick a target from **{fx(MIN_MULTI)}** to **{fx(MAX_MULTI)}**, like `2x` or `10x`.",
    )


# ───────────────────── embeds ─────────────────────


def bet_prompt(user, balance, target=None):
    e = embeds.gold(
        "🚀 Limbo",
        "Choose your bet. Higher target, bigger payout, lower chance.",
        user,
    )
    e.add_field(name="💰 Balance", value=config.fmt(balance), inline=True)
    if target:
        e.add_field(name="🎯 Target", value=fx(target), inline=True)
    return e


def target_prompt(user, bet, balance):
    e = embeds.gold("🚀 Limbo", "Pick your target multiplier. Beat it to win.", user)
    e.add_field(name="🎟️ Bet", value=config.fmt(bet), inline=True)
    e.add_field(name="💰 Balance", value=config.fmt(balance), inline=True)
    return e


def climb_frame(user, bet, target, shown):
    desc = (
        f"Bet **{config.fmt(bet)}** · Target **{fx(target)}**\n\n"
        f"## 🚀 {fx(shown)}\n"
        "*Climbing...*"
    )
    return embeds.make("🚀 Limbo", desc, config.COLOR_BLURPLE, user)


def result_embed(user, bet, target, result, win, payout, balance, chance):
    desc = (
        f"## 🚀 {fx(result)}\n"
        f"Target **{fx(target)}** · Chance **{chance_text(chance)}**"
    )
    if win:
        e = embeds.make("🎉 You Won!", desc, config.COLOR_GREEN, user)
        e.add_field(name="🎟️ Bet", value=config.fmt(bet), inline=True)
        e.add_field(name="💵 Payout", value=config.fmt(payout), inline=True)
        e.add_field(name="📈 Profit", value=f"+{config.fmt(payout - bet)}", inline=True)
    else:
        e = embeds.make("💸 You Lost", desc, config.COLOR_RED, user)
        e.add_field(name="🎟️ Bet", value=config.fmt(bet), inline=True)
        e.add_field(name="📉 Lost", value=f"-{config.fmt(bet)}", inline=True)
    e.add_field(name="💰 Balance", value=config.fmt(balance), inline=True)
    return e


def usage_embed():
    return embeds.info(
        "🚀 Limbo",
        "**Quick bet**\n"
        "`/limbo 10k 2x`\n"
        "`!limbo 1m 5x`\n"
        "`$limbo 5k 10`\n\n"
        "Or just type `!limbo` for buttons.\n"
        f"Target: `{fx(MIN_MULTI)}` to `{fx(MAX_MULTI)}`. "
        "Higher target = bigger payout, lower chance.",
    )


# ───────────────────── game ─────────────────────


async def play_limbo(cog, user, bet, target, edit, owner_view=None):
    """Charges the bet, animates the climb by editing one message, settles.
    Returns False (touching nothing) if the balance can't cover the bet."""
    new_bal = await db.take_bet(user.id, bet)
    if new_bal is None:
        return False
    if owner_view is not None:
        owner_view.stop()

    edge = cog.edge
    result = roll(edge)
    win = result >= target
    payout = payout_for(bet, target) if win else 0

    try:
        for i in range(1, ANIM_STEPS + 1):
            frac = (i / (ANIM_STEPS + 1)) ** 2
            shown = Decimal(1) + (result - 1) * Decimal(str(round(frac, 4)))
            await edit(climb_frame(user, bet, target, shown.quantize(Decimal("0.01"))))
            await asyncio.sleep(ANIM_DELAY)
    except discord.HTTPException:
        pass  # a failed edit must never cost the player their payout

    detail = f"{fx(target)} -> {fx(result)}"
    for _ in range(3):
        try:
            new_bal = await db.settle_game(user.id, bet, payout, "limbo", detail)
            break
        except Exception:
            log.exception("limbo settle failed, retrying")
            await asyncio.sleep(1)

    view = LimboAgainView(cog, user, bet, target)
    try:
        chance = win_chance(edge, target)
        view.message = await edit(
            result_embed(user, bet, target, result, win, payout, new_bal, chance), view
        )
    except discord.HTTPException:
        pass
    return True


# ───────────────────── views ─────────────────────


class BetModal(discord.ui.Modal, title="Custom Bet"):
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


class TargetModal(discord.ui.Modal, title="Custom Target"):
    multi = discord.ui.TextInput(
        label="Target multiplier",
        placeholder="e.g. 2x, 7.5x, 100x",
        max_length=12,
    )

    def __init__(self, flow):
        super().__init__()
        self.flow = flow

    async def on_submit(self, interaction):
        await self.flow.handle_target(interaction, self.multi.value)


class TargetButton(discord.ui.Button):
    def __init__(self, value: str):
        super().__init__(label=f"{value}x", style=discord.ButtonStyle.secondary, row=0)
        self.value = value

    async def callback(self, interaction):
        await self.view.handle_target(interaction, self.value)


class LimboBetView(BaseView):
    def __init__(self, cog, user, target=None):
        super().__init__(cog.bot, user)
        self.cog = cog
        self.target = target
        for pct in (5, 10, 30, 50, 100):
            self.add_item(PercentButton(pct))

    @discord.ui.button(label="Custom", emoji="✏️", style=discord.ButtonStyle.primary, row=1)
    async def custom(self, interaction, button):
        await interaction.response.send_modal(BetModal(self))

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

        if self.target:
            err = payout_error(bet, self.target)
            if err:
                self.busy = False
                await interaction.followup.send(embed=err, ephemeral=True)
                return
            ok = await play_limbo(
                self.cog, self.user, bet, self.target, interaction_editor(interaction), owner_view=self
            )
            if not ok:
                self.busy = False
                await interaction.followup.send(embed=no_funds(), ephemeral=True)
        else:
            self.stop()
            view = TargetView(self.cog, self.user, bet)
            view.message = self.message
            await interaction.edit_original_response(
                embed=target_prompt(self.user, bet, bal), view=view
            )


class TargetView(BaseView):
    def __init__(self, cog, user, bet):
        super().__init__(cog.bot, user)
        self.cog = cog
        self.bet = bet
        for value in ("1.5", "2", "3", "5", "10"):
            self.add_item(TargetButton(value))

    @discord.ui.button(label="Custom", emoji="✏️", style=discord.ButtonStyle.primary, row=1)
    async def custom(self, interaction, button):
        await interaction.response.send_modal(TargetModal(self))

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary, row=1)
    async def cancel_btn(self, interaction, button):
        await self.cancel(interaction)

    async def handle_target(self, interaction, text):
        if self.busy:
            await interaction.response.defer()
            return
        self.busy = True
        await interaction.response.defer()

        target = parse_multiplier(text)
        if target is None:
            self.busy = False
            await interaction.followup.send(embed=bad_target(), ephemeral=True)
            return
        err = payout_error(self.bet, target)
        if err:
            self.busy = False
            await interaction.followup.send(embed=err, ephemeral=True)
            return

        ok = await play_limbo(
            self.cog, self.user, self.bet, target, interaction_editor(interaction), owner_view=self
        )
        if not ok:
            self.busy = False
            await interaction.followup.send(embed=no_funds(), ephemeral=True)


class LimboAgainView(BaseView):
    expire_embed = False  # keep the result on screen, just remove the buttons

    def __init__(self, cog, user, bet, target):
        super().__init__(cog.bot, user, timeout=120)
        self.cog = cog
        self.bet = bet
        self.target = target

    @discord.ui.button(label="Play Again", emoji="🔁", style=discord.ButtonStyle.primary)
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

        err = payout_error(bet, self.target)
        if err:
            self.busy = False
            await interaction.followup.send(embed=err, ephemeral=True)
            return
        ok = await play_limbo(
            self.cog, self.user, bet, self.target, interaction_editor(interaction), owner_view=self
        )
        if not ok:
            self.busy = False
            await interaction.followup.send(embed=no_funds(), ephemeral=True)


# ───────────────────── commands ─────────────────────


class Limbo(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.edge = DEFAULT_EDGE

    async def cog_load(self):
        self.edge = await db.get_limbo_edge()

    async def _entry(self, ctx, a, b):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await ctx.send(
                embed=embeds.error("Join the casino first", "Use `/start` to claim your welcome bonus.")
            )
            return
        bal = row["balance"]

        # "10k 2x" or "2x 10k": a token like 2x is the target, the other is the bet
        bet_text = None
        target_text = None
        for tok in (a, b):
            if tok is None:
                continue
            if X_FORM.match(tok.strip().lower()):
                if target_text is not None:
                    await ctx.send(embed=usage_embed())
                    return
                target_text = tok
            elif bet_text is None:
                bet_text = tok
            elif target_text is None:
                target_text = tok
            else:
                await ctx.send(embed=usage_embed())
                return

        bet = None
        target = None
        if bet_text is not None:
            bet = parse_amount(bet_text, bal)
            if bet is None:
                await ctx.send(embed=bad_amount())
                return
            if bet < 1 or bet > bal:
                await ctx.send(embed=no_funds(bal))
                return
        if target_text is not None:
            target = parse_multiplier(target_text)
            if target is None:
                await ctx.send(embed=bad_target())
                return
        if bet is not None and target is not None:
            err = payout_error(bet, target)
            if err:
                await ctx.send(embed=err)
                return

        if bet is None:
            view = LimboBetView(self, ctx.author, target)
            view.message = await ctx.send(embed=bet_prompt(ctx.author, bal, target), view=view)
        elif target is None:
            view = TargetView(self, ctx.author, bet)
            view.message = await ctx.send(embed=target_prompt(ctx.author, bet, bal), view=view)
        else:
            msg = None

            async def edit(embed, view=None):
                nonlocal msg
                if msg is None:
                    msg = await ctx.send(embed=embed, view=view)
                else:
                    msg = await msg.edit(embed=embed, view=view)
                return msg

            ok = await play_limbo(self, ctx.author, bet, target, edit)
            if not ok:
                await ctx.send(embed=no_funds())

    @commands.hybrid_command(name="limbo", description="Pick a target multiplier and try to beat it")
    @app_commands.describe(
        bet="Bet, e.g. 5k, 1.5m, 50% or all",
        target="Target multiplier, e.g. 2x, 10x, 100x",
    )
    async def limbo(self, ctx, bet: Optional[str] = None, target: Optional[str] = None):
        await self._entry(ctx, bet, target)

    # Hidden: prefix-only (no slash command), admin only, bot DM only.
    # Anywhere else it stays completely silent.
    @commands.command(
        name="sethousedge",
        aliases=["sethouseedge", "housedge", "limboedge"],
        extras={"always_on": True},
    )
    async def sethousedge(self, ctx, pct: str = None):
        if ctx.guild is not None or ctx.author.id != config.ADMIN_ID:
            return

        if pct is None:
            await ctx.send(
                embed=embeds.info(
                    "🚀 Limbo house edge",
                    f"Currently **{self.edge:g}%**.\nUsage: `!sethousedge <0-100>`",
                )
            )
            return

        try:
            value = float(pct.strip().rstrip("%"))
        except ValueError:
            value = None
        if value is None or not 0 <= value <= 100:
            await ctx.send(embed=embeds.error("Invalid value", "Send a number from 0 to 100."))
            return

        await db.set_limbo_edge(value)
        self.edge = value
        e = embeds.success("Limbo updated", f"House edge is now **{value:g}%**.")
        for m in (2, 10, 100):
            e.add_field(
                name=f"{m}x",
                value=chance_text(win_chance(value, m)),
                inline=True,
            )
        await ctx.send(embed=e)


async def setup(bot):
    await bot.add_cog(Limbo(bot))
