import asyncio
import logging
import math
import random
from decimal import ROUND_DOWN, Decimal
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

import config
import db
from cogs.coinflip import no_funds
from utils import embeds
from utils.amounts import parse_amount

log = logging.getLogger(__name__)

TILES = 24  # 5x5 board: 24 tiles + the Cash Out button in the bottom-right slot
MIN_MINES = 1
MAX_MINES = 23
DEFAULT_MINES = 3
DEFAULT_EDGE = 10.0
MAX_PAYOUT = 10**14
IDLE_TIMEOUT = 300  # seconds of inactivity before the game auto cashes out


# ───────────────────── math ─────────────────────


def multiplier(picks: int, mines: int, edge_pct: float) -> Decimal:
    """(1 - edge) / P(surviving `picks` safe picks)."""
    if picks <= 0:
        return Decimal("1.00")
    safe = TILES - mines
    fair = Decimal(math.comb(TILES, picks)) / Decimal(math.comb(safe, picks))
    mult = fair * (Decimal(1) - Decimal(str(edge_pct)) / 100)
    return mult.quantize(Decimal("0.01"), rounding=ROUND_DOWN)


def payout_at(bet: int, mult) -> int:
    return min(int(Decimal(bet) * mult), MAX_PAYOUT)


def fx(value) -> str:
    return f"{Decimal(value):,.2f}x"


def short(n: int) -> str:
    for unit, suffix in ((10**12, "t"), (10**9, "b"), (10**6, "m"), (10**3, "k")):
        if n >= unit:
            text = f"{n / unit:.2f}".rstrip("0").rstrip(".")
            return text + suffix
    return str(n)


def usage_embed():
    return embeds.info(
        "💣 Mines",
        "**Usage**\n"
        "`/mines 1m 3`\n"
        "`!mine 500k 5`\n"
        "`$bomb 10k 1`\n\n"
        f"Bet first, then the number of mines ({MIN_MINES}-{MAX_MINES}, default {DEFAULT_MINES}).\n"
        "Pick tiles to find 💎, avoid the 💣, and cash out any time after your first pick.\n"
        "More mines = bigger multipliers.",
    )


# ───────────────────── board ─────────────────────


class Tile(discord.ui.Button):
    def __init__(self, index):
        super().__init__(label="?", style=discord.ButtonStyle.secondary, row=index // 5)
        self.index = index

    async def callback(self, interaction):
        await self.view.pick(interaction, self.index)


class CashButton(discord.ui.Button):
    def __init__(self):
        super().__init__(
            label="Cash Out", emoji="💰", style=discord.ButtonStyle.success, row=4, disabled=True
        )

    async def callback(self, interaction):
        await self.view.cash_out(interaction)


class MinesView(discord.ui.View):
    def __init__(self, cog, user, bet, mines, edge, mine_set):
        super().__init__(timeout=IDLE_TIMEOUT)
        self.cog = cog
        self.user = user
        self.bet = bet
        self.mines = mines
        self.edge = edge
        self.mine_set = mine_set
        self.safe_total = TILES - mines
        self.picked = set()
        self.done = False
        self.message = None
        self.lock = asyncio.Lock()
        self.tiles = [Tile(i) for i in range(TILES)]
        for tile in self.tiles:
            self.add_item(tile)
        self.cash = CashButton()
        self.add_item(self.cash)

    async def interaction_check(self, interaction):
        if interaction.user.id != self.user.id:
            await interaction.response.send_message(
                "This isn't your game. Start your own with `/mines`.", ephemeral=True
            )
            return False
        return True

    # ── state helpers ──

    def mult_now(self):
        return multiplier(len(self.picked), self.mines, self.edge)

    def payout_now(self) -> int:
        return payout_at(self.bet, self.mult_now())

    def make_embed(self):
        found = len(self.picked)
        e = embeds.make(
            "💣 Mines",
            f"Bet **{config.fmt(self.bet)}** · **{self.mines}** mines",
            config.COLOR_BLURPLE,
            self.user,
        )
        e.add_field(name="💎 Safe found", value=f"{found}/{self.safe_total}", inline=True)
        e.add_field(name="📈 Multiplier", value=fx(self.mult_now()), inline=True)
        e.add_field(
            name="💵 Cash out",
            value=config.fmt(self.payout_now()) if found else "-",
            inline=True,
        )
        nxt = multiplier(found + 1, self.mines, self.edge)
        e.add_field(
            name="➡️ Next pick",
            value=f"{fx(nxt)} · {config.fmt(payout_at(self.bet, nxt))}",
            inline=False,
        )
        return e

    def reveal(self, hit=None):
        for i, tile in enumerate(self.tiles):
            tile.disabled = True
            if i in self.mine_set:
                tile.label = None
                tile.emoji = "💥" if i == hit else "💣"
                tile.style = discord.ButtonStyle.danger if i == hit else discord.ButtonStyle.secondary
            elif i not in self.picked:
                tile.label = None
                tile.emoji = "💎"
                tile.style = discord.ButtonStyle.secondary
        self.cash.disabled = True

    async def settle(self, payout: int, detail: str):
        for _ in range(3):
            try:
                return await db.settle_game(self.user.id, self.bet, payout, "mines", detail)
            except Exception:
                log.exception("mines settle failed, retrying")
                await asyncio.sleep(1)
        return None

    def finish(self):
        self.done = True
        self.cog.active.discard(self.user.id)
        self.stop()

    # ── actions ──

    async def pick(self, interaction, index):
        async with self.lock:
            if self.done or index in self.picked:
                await interaction.response.defer()
                return

            if index in self.mine_set:
                await self._boom(interaction, index)
                return

            self.picked.add(index)
            tile = self.tiles[index]
            tile.label = None
            tile.emoji = "💎"
            tile.style = discord.ButtonStyle.success
            tile.disabled = True

            if len(self.picked) >= self.safe_total or self.payout_now() >= MAX_PAYOUT:
                await self._cash(interaction, cleared=True)
                return

            self.cash.disabled = False
            self.cash.label = short(self.payout_now())
            await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def cash_out(self, interaction):
        async with self.lock:
            if self.done or not self.picked:
                await interaction.response.defer()
                return
            await self._cash(interaction, cleared=False)

    async def _boom(self, interaction, hit):
        self.finish()
        await interaction.response.defer()
        found = len(self.picked)
        self.reveal(hit)
        balance = await self.settle(0, f"hit a mine after {found} picks ({self.mines} mines)")
        e = embeds.make(
            "💥 Boom!",
            f"You hit a mine after **{found}** safe picks.",
            config.COLOR_RED,
            self.user,
        )
        e.add_field(name="🎟️ Bet", value=config.fmt(self.bet), inline=True)
        e.add_field(name="📉 Lost", value=f"-{config.fmt(self.bet)}", inline=True)
        e.add_field(name="💰 Balance", value=config.fmt(balance) if balance is not None else "-", inline=True)
        await interaction.edit_original_response(embed=e, view=self)

    async def _cash(self, interaction, cleared):
        self.finish()
        await interaction.response.defer()
        found = len(self.picked)
        mult = self.mult_now()
        payout = self.payout_now()
        self.reveal()
        balance = await self.settle(payout, f"{fx(mult)} after {found} picks ({self.mines} mines)")
        title = "🏆 Board cleared!" if cleared else "💰 Cashed Out"
        e = embeds.make(
            title,
            f"**{fx(mult)}** after **{found}** safe picks.",
            config.COLOR_GREEN,
            self.user,
        )
        profit = payout - self.bet
        sign = "+" if profit >= 0 else "-"
        e.add_field(name="🎟️ Bet", value=config.fmt(self.bet), inline=True)
        e.add_field(name="💵 Payout", value=config.fmt(payout), inline=True)
        e.add_field(name="📈 Profit", value=f"{sign}{config.fmt(abs(profit))}", inline=True)
        e.add_field(name="💰 Balance", value=config.fmt(balance) if balance is not None else "-", inline=True)
        await interaction.edit_original_response(embed=e, view=self)

    async def on_timeout(self):
        if self.done:
            return
        self.finish()
        found = len(self.picked)
        payout = self.payout_now() if found else self.bet  # nothing picked: refund
        self.reveal()
        balance = await self.settle(payout, "auto cash out (idle)")
        e = embeds.info(
            "⌛ Game timed out",
            f"You were idle, so the game cashed out automatically for **{config.fmt(payout)}**.",
            self.user,
        )
        e.add_field(name="💰 Balance", value=config.fmt(balance) if balance is not None else "-", inline=True)
        if self.message:
            try:
                await self.message.edit(embed=e, view=self)
            except discord.HTTPException:
                pass


# ───────────────────── commands ─────────────────────


class Mines(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.edge = DEFAULT_EDGE
        self.active = set()  # one game per player at a time

    async def cog_load(self):
        self.edge = await db.get_mines_edge()

    async def _entry(self, ctx, bet_text, mines):
        await ctx.defer()
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await ctx.send(
                embed=embeds.error("Join the casino first", "Use `/start` to claim your welcome bonus.")
            )
            return
        if bet_text is None:
            await ctx.send(embed=usage_embed())
            return
        if ctx.author.id in self.active:
            await ctx.send(
                embed=embeds.error("Game in progress", "Finish your current mines game first.")
            )
            return

        bal = row["balance"]
        bet = parse_amount(bet_text, bal)
        if bet is None:
            await ctx.send(embed=usage_embed())
            return
        if bet < 1 or bet > bal:
            await ctx.send(embed=no_funds(bal))
            return

        if mines is None:
            mines = DEFAULT_MINES
        if not MIN_MINES <= mines <= MAX_MINES:
            await ctx.send(
                embed=embeds.error("Invalid mines", f"Pick between {MIN_MINES} and {MAX_MINES} mines.")
            )
            return

        if await db.take_bet(ctx.author.id, bet) is None:
            await ctx.send(embed=no_funds())
            return

        self.active.add(ctx.author.id)
        mine_set = set(random.sample(range(TILES), mines))
        view = MinesView(self, ctx.author, bet, mines, self.edge, mine_set)
        try:
            view.message = await ctx.send(embed=view.make_embed(), view=view)
        except Exception:
            self.active.discard(ctx.author.id)
            view.stop()
            await db.settle_game(ctx.author.id, bet, bet, "mines", "refund (could not start)")
            raise

    @commands.hybrid_command(name="mines", description="Find the gems, avoid the mines")
    @app_commands.describe(bet="Bet, e.g. 5k, 1.5m, 50% or all", mines="Number of mines (1-23)")
    async def mines(self, ctx, bet: Optional[str] = None, mines: Optional[int] = None):
        await self._entry(ctx, bet, mines)

    @commands.hybrid_command(name="mine", description="Find the gems, avoid the mines")
    @app_commands.describe(bet="Bet, e.g. 5k, 1.5m, 50% or all", mines="Number of mines (1-23)")
    async def mine(self, ctx, bet: Optional[str] = None, mines: Optional[int] = None):
        await self._entry(ctx, bet, mines)

    @commands.hybrid_command(name="bomb", description="Find the gems, avoid the mines")
    @app_commands.describe(bet="Bet, e.g. 5k, 1.5m, 50% or all", mines="Number of mines (1-23)")
    async def bomb(self, ctx, bet: Optional[str] = None, mines: Optional[int] = None):
        await self._entry(ctx, bet, mines)

    # Hidden: prefix-only (no slash command), admin only, bot DM only.
    @commands.command(name="setminesedge", aliases=["minesedge"], extras={"always_on": True})
    async def setminesedge(self, ctx, pct: str = None):
        if ctx.guild is not None or ctx.author.id != config.ADMIN_ID:
            return

        if pct is None:
            await ctx.send(
                embed=embeds.info(
                    "💣 Mines house edge",
                    f"Currently **{self.edge:g}%**.\nUsage: `!setminesedge <0-100>`",
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

        await db.set_mines_edge(value)
        self.edge = value
        await ctx.send(
            embed=embeds.success(
                "Mines updated", f"House edge is now **{value:g}%** (applies to new games)."
            )
        )


async def setup(bot):
    await bot.add_cog(Mines(bot))
