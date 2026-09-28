import logging
from datetime import datetime, timedelta, timezone

import discord
from discord.ext import commands, tasks

import config
import db
from utils import embeds, referral

log = logging.getLogger(__name__)


class ClaimView(discord.ui.View):
    def __init__(self, cog, user, link, claimable):
        super().__init__(timeout=180)
        self.cog = cog
        self.user = user
        self.link = link
        self.message = None
        self.busy = False
        self.set_button(claimable)

    def set_button(self, claimable):
        self.claim_btn.label = f"Claim {config.fmt(claimable)}" if claimable > 0 else "Nothing to claim"
        self.claim_btn.disabled = claimable < 1

    async def interaction_check(self, interaction):
        if interaction.user.id != self.user.id:
            await interaction.response.send_message("These aren't your referrals.", ephemeral=True)
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

        amount = await db.claim_referral(self.user.id)
        if not amount:
            self.busy = False
            await interaction.followup.send(
                embed=embeds.error("Nothing to claim", "No unlocked rewards right now."),
                ephemeral=True,
            )
            return

        embed, claimable = await self.cog.build(self.user, self.link)
        self.set_button(claimable)
        self.busy = False
        await interaction.edit_original_response(embed=embed, view=self)
        await interaction.followup.send(
            embed=embeds.make(
                "💚 Rewards claimed",
                f"**+{config.fmt(amount)}** was added to your balance.\n"
                "Referral rewards must be wagered before you can withdraw.",
                config.COLOR_GREEN,
            ),
            ephemeral=True,
        )


class Referral(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.check_loop.start()

    async def cog_unload(self):
        self.check_loop.cancel()

    # ───────── background checks (24h unlock + wager notices) ─────────

    @tasks.loop(minutes=5)
    async def check_loop(self):
        try:
            await self._resolve_due()
            await self._wager_notices()
        except Exception:
            log.exception("referral check failed")

    @check_loop.before_loop
    async def _before_loop(self):
        await self.bot.wait_until_ready()

    async def _resolve_due(self):
        cutoff = datetime.now(timezone.utc) - timedelta(hours=referral.HOLD_HOURS)
        for row in await db.referrals_due(cutoff.isoformat()):
            await self._settle_referral(row)

    async def _still_in_server(self, row):
        guild = self.bot.get_guild(row["guild_id"]) if row.get("guild_id") else None
        if guild is None:
            return None  # can't tell, try again later
        try:
            await guild.fetch_member(row["referred_id"])
            return True
        except discord.NotFound:
            return False
        except discord.HTTPException:
            return None

    async def _settle_referral(self, row):
        present = await self._still_in_server(row)
        if present is None:
            return
        name = row["referred_name"]
        if present:
            updated = await db.set_referral_status(row["referred_id"], "pending", "qualified")
            if updated:
                claimable = updated["earned"] - updated["claimed"]
                await referral.dm(
                    self.bot, row["referrer_id"], referral.unlocked_embed(name, claimable)
                )
        else:
            updated = await db.set_referral_status(row["referred_id"], "pending", "void")
            if updated:
                await referral.dm(self.bot, row["referrer_id"], referral.left_embed(name))

    async def _wager_notices(self):
        for row in await db.referrals_awaiting_wager_notice():
            await db.mark_wager_notified(row["referred_id"])
            await referral.dm(self.bot, row["referrer_id"], referral.wager_embed(row["referred_name"]))

    # ───────── join / leave tracking ─────────

    @commands.Cog.listener()
    async def on_member_join(self, member):
        if member.bot:
            return
        try:
            invites = await member.guild.invites()
        except discord.HTTPException:
            return  # missing Manage Server permission

        saved = {c["code"]: c for c in await db.ref_codes_for_guild(member.guild.id)}
        used = None
        for inv in invites:
            c = saved.get(inv.code)
            if c and (inv.uses or 0) > c["uses"]:
                used = (c, inv.uses or 0)
                break
        if used is None:
            return

        code_row, uses = used
        await db.update_ref_uses(code_row["code"], uses)
        created = await db.register_referral(
            member.id, code_row["discord_id"], str(member), member.guild.id
        )
        if created:
            await referral.dm(self.bot, code_row["discord_id"], referral.joined_embed(str(member)))

    @commands.Cog.listener()
    async def on_member_remove(self, member):
        row = await db.get_referral(member.id)
        if not row or row["status"] != "pending":
            return
        joined = referral.parse_time(row["joined_at"])
        stayed = datetime.now(timezone.utc) - joined >= timedelta(hours=referral.HOLD_HOURS)
        if stayed:  # they made the 24h, the loop just hadn't run yet
            updated = await db.set_referral_status(member.id, "pending", "qualified")
            if updated:
                claimable = updated["earned"] - updated["claimed"]
                await referral.dm(
                    self.bot,
                    row["referrer_id"],
                    referral.unlocked_embed(row["referred_name"], claimable),
                )
            return
        updated = await db.set_referral_status(member.id, "pending", "void")
        if updated:
            await referral.dm(self.bot, row["referrer_id"], referral.left_embed(row["referred_name"]))

    # ───────── the !ref message ─────────

    async def _link_for(self, ctx):
        """Returns the player's invite URL, creating it if needed. Sends an error and returns None on failure."""
        guild = ctx.guild
        try:
            invites = await guild.invites()
        except discord.HTTPException:
            await ctx.send(
                embed=embeds.error(
                    "Missing permission",
                    "I need the **Manage Server** permission to track invites. Ask the administrator.",
                )
            )
            return None

        saved = await db.get_ref_code(ctx.author.id, guild.id)
        if saved and any(i.code == saved["code"] for i in invites):
            return f"https://discord.gg/{saved['code']}"

        me = guild.me
        channel = ctx.channel if isinstance(ctx.channel, discord.TextChannel) else None
        if channel is None or not channel.permissions_for(me).create_instant_invite:
            channel = next(
                (c for c in guild.text_channels if c.permissions_for(me).create_instant_invite), None
            )
        if channel is None:
            await ctx.send(
                embed=embeds.error(
                    "Missing permission", "I can't create invites here. Ask the administrator."
                )
            )
            return None

        try:
            inv = await channel.create_invite(
                max_age=0, max_uses=0, unique=True, reason=f"Referral link for {ctx.author}"
            )
        except discord.HTTPException:
            await ctx.send(
                embed=embeds.error("Couldn't create link", "Please try again in a moment.")
            )
            return None
        await db.save_ref_code(ctx.author.id, guild.id, inv.code, inv.uses or 0)
        return f"https://discord.gg/{inv.code}"

    async def build(self, user, link):
        refs = await db.referrals_of(user.id)
        unlocked = sum(1 for r in refs if r["status"] == "qualified")
        pending = sum(1 for r in refs if r["status"] == "pending")
        earned = sum(r["earned"] for r in refs if r["status"] != "void")
        claimable = sum(r["earned"] - r["claimed"] for r in refs if r["status"] == "qualified")

        e = embeds.gold(
            "🤝 Referrals",
            f"Invite friends with your personal link:\n**{link}**",
            user,
            thumbnail=True,
        )
        e.add_field(
            name="📜 How it works",
            value=(
                f"• Friends get the **{config.fmt(config.START_BONUS)}** starter bonus\n"
                f"• Their first deposit (up to {config.fmt(referral.FIRST_CAP)}) pays you "
                f"**{referral.FIRST_MULT}x**\n"
                f"• Plus **{referral.DEPOSIT_PCT}%** of everything they deposit\n"
                f"• Rewards unlock after they stay **{referral.HOLD_HOURS}h** in the server\n"
                "• Rewards must be wagered before withdrawing"
            ),
            inline=False,
        )
        e.add_field(name="👥 Referrals", value=str(len(refs)), inline=True)
        e.add_field(name="✅ Unlocked", value=str(unlocked), inline=True)
        e.add_field(name="⏳ Pending", value=str(pending), inline=True)
        e.add_field(name="💰 Total earned", value=config.fmt(earned), inline=True)
        e.add_field(name="🎁 Claimable", value=config.fmt(claimable), inline=True)

        ordered = sorted(
            refs, key=lambda r: -1 if r["status"] == "void" else r["earned"], reverse=True
        )
        lines = []
        for r in ordered[:8]:
            if r["status"] == "qualified":
                tag = "✅ unlocked"
            elif r["status"] == "pending":
                unlock = referral.parse_time(r["joined_at"]) + timedelta(hours=referral.HOLD_HOURS)
                tag = f"⏳ unlocks <t:{int(unlock.timestamp())}:R>"
            else:
                tag = "❌ left early"
            made = 0 if r["status"] == "void" else r["earned"]
            lines.append(
                f"**{r['referred_name']}** · {tag}\n"
                f"└ deposited {config.fmt(r['deposited'])} · earned {config.fmt(made)}"
            )
        if len(refs) > 8:
            lines.append(f"*+{len(refs) - 8} more*")
        e.add_field(
            name="🧑‍🤝‍🧑 Your referrals",
            value="\n".join(lines) or "No referrals yet. Share your link!",
            inline=False,
        )
        return e, claimable

    async def _show(self, ctx):
        await ctx.defer()
        if ctx.guild is None:
            await ctx.send(
                embed=embeds.error(
                    "Use it in the server", "Run this in the server so I can create your invite link."
                )
            )
            return
        row = await db.get_user(ctx.author.id)
        if not row or not row["started"]:
            await ctx.send(
                embed=embeds.error("Join the casino first", "Use `/start` to claim your welcome bonus.")
            )
            return

        link = await self._link_for(ctx)
        if link is None:
            return
        embed, claimable = await self.build(ctx.author, link)
        view = ClaimView(self, ctx.author, link, claimable)
        view.message = await ctx.send(embed=embed, view=view)

    @commands.hybrid_command(name="ref", description="Your referral link, referrals and rewards")
    async def ref(self, ctx):
        await self._show(ctx)

    @commands.hybrid_command(name="refer", description="Your referral link, referrals and rewards")
    async def refer(self, ctx):
        await self._show(ctx)


async def setup(bot):
    await bot.add_cog(Referral(bot))
