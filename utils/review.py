"""Admin review buttons (accept/decline/paid/reject) for deposits and withdrawals.
They are 'dynamic' items, so they keep working even after the bot restarts."""
import discord

import config
import db
from utils import embeds

IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic")


def is_image(att) -> bool:
    ct = (att.content_type or "").lower()
    return ct.startswith("image/") or att.filename.lower().endswith(IMG_EXT)


def who(user) -> str:
    return f"{user.mention}\n{user} (`{user.id}`)"


# ───────────── admin alert embeds ─────────────


def deposit_admin_embed(user, ign, amount, code):
    e = embeds.gold(
        "📥 Deposit Request",
        "Simulated deposit. Accept to credit their balance.",
    )
    e.add_field(name="👤 Player", value=who(user), inline=False)
    e.add_field(name="🎮 IGN", value=f"`{ign}`", inline=True)
    e.add_field(name="💰 Amount", value=config.fmt(amount), inline=True)
    e.add_field(name="🆔 Deposit ID", value=f"`{code}`", inline=True)
    return embeds.sim(e)


def withdraw_admin_embed(user, ign, amount, code, balance_after):
    e = embeds.gold(
        "📤 Withdrawal Request",
        " withdrawal aa gya oye, jldi pay kr",
    )
    e.add_field(name="👤 Player", value=who(user), inline=False)
    e.add_field(name="🎮 IGN", value=f"`{ign}`", inline=True)
    e.add_field(name="💰 Amount", value=config.fmt(amount), inline=True)
    e.add_field(name="🆔 Withdraw ID", value=f"`{code}`", inline=True)
    e.add_field(name="🏦 Balance left", value=config.fmt(balance_after), inline=True)
    e.add_field(name="🎲 Wager", value="✅ Complete", inline=True)
    return embeds.sim(e)


def build_review_view(kind: str, code: str) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    actions = ("accept", "decline") if kind == "deposit" else ("paid", "reject")
    for action in actions:
        view.add_item(ReviewButton(action, code))
    return view


def resolved_embed(message, status, color, reason=None):
    if message is not None and message.embeds:
        e = message.embeds[0].copy()
    else:
        e = discord.Embed()
    e.color = color
    e.title = f"{status} · {e.title}" if e.title else status
    if reason:
        e.add_field(name="📝 Reason", value=reason, inline=False)
    return e


# ───────────── helpers ─────────────


async def dm_user(bot, user_id, embed) -> bool:
    try:
        user = await bot.fetch_user(user_id)
        await user.send(embed=embed)
        return True
    except discord.HTTPException:
        return False


async def announce_withdrawal(bot, req):
    channel_id = config.ANNOUNCE_CHANNEL_ID or req.get("channel_id")
    if not channel_id:
        return
    try:
        channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)
        e = embeds.make(
            "🏧 Withdrawal",
            f"<@{req['discord_id']}> withdrew **{config.fmt(req['amount'])}**",
            config.COLOR_GREEN,
        )
        e.add_field(
            name="🌹",
            value="paid in game. go vouch me",
            inline=False,
        )
        await channel.send(embed=embeds.sim(e))
    except discord.HTTPException:
        pass


async def _message(interaction):
    return interaction.message or await interaction.original_response()


async def _dm_failed(interaction):
    await interaction.followup.send(
        "⚠️ Done, but I couldn't DM the player (their DMs are closed).", ephemeral=True
    )


# ───────────── button actions ─────────────


async def do_accept(interaction, code):
    await interaction.response.defer()
    data = await db.approve_deposit(code)
    if not data:
        await interaction.followup.send("Already handled (or not found).", ephemeral=True)
        return

    msg = await _message(interaction)
    await interaction.edit_original_response(
        embed=resolved_embed(msg, "✅ Approved", config.COLOR_GREEN), view=None
    )

    e = embeds.make(
        "✅ Deposit Approved",
        f"Your deposit of **{config.fmt(data['amount'])}** is approved and your balance is updated. "
        "You can play now! 🎰",
        config.COLOR_GREEN,
    )
    e.add_field(name="🆔 Deposit ID", value=f"`{code}`", inline=True)
    e.add_field(name="💰 Balance", value=config.fmt(data["balance"]), inline=True)
    if not await dm_user(interaction.client, data["discord_id"], embeds.sim(e)):
        await _dm_failed(interaction)


async def do_paid(interaction, code):
    await interaction.response.defer()
    req = await db.set_request_status(code, "pending", "approved")
    if not req:
        await interaction.followup.send("Already handled (or not found).", ephemeral=True)
        return

    msg = await _message(interaction)
    await interaction.edit_original_response(
        embed=resolved_embed(msg, "💸 Marked paid", config.COLOR_GREEN), view=None
    )

    e = embeds.make(
        "💸 Withdrawal Completed",
        f"Your withdrawal of **{config.fmt(req['amount'])}** was marked as paid.",
        config.COLOR_GREEN,
    )
    e.add_field(name="🆔 Withdraw ID", value=f"`{code}`", inline=True)
    e.add_field(name="🎮 IGN", value=f"`{req['mc_ign']}`", inline=True)
    e.add_field(
        name="🌹",
        value="Your withdrawal amount is paid in game, pls check and drop a vouch in server",
        inline=False,
    )
    if not await dm_user(interaction.client, req["discord_id"], embeds.sim(e)):
        await _dm_failed(interaction)
    await announce_withdrawal(interaction.client, req)


async def do_negative(interaction, action, code, reason):
    await interaction.response.defer()

    if action == "decline":
        req = await db.set_request_status(code, "pending", "declined", reason)
        if not req:
            await interaction.followup.send("Already handled (or not found).", ephemeral=True)
            return
        msg = await _message(interaction)
        await interaction.edit_original_response(
            embed=resolved_embed(msg, "❌ Declined", config.COLOR_RED, reason), view=None
        )
        e = embeds.make(
            "❌ Deposit Declined",
            f"Your deposit `{code}` of **{config.fmt(req['amount'])}** was declined.",
            config.COLOR_RED,
        )
        e.add_field(name="📝 Reason", value=reason, inline=False)
        user_id = req["discord_id"]
    else:
        data = await db.reject_withdraw(code, reason)
        if not data:
            await interaction.followup.send("Already handled (or not found).", ephemeral=True)
            return
        msg = await _message(interaction)
        await interaction.edit_original_response(
            embed=resolved_embed(msg, "❌ Rejected", config.COLOR_RED, reason), view=None
        )
        e = embeds.make(
            "❌ Withdrawal Rejected",
            f"Your withdrawal `{code}` of **{config.fmt(data['amount'])}** was rejected "
            "and the amount is back in your balance.",
            config.COLOR_RED,
        )
        e.add_field(name="📝 Reason", value=reason, inline=False)
        e.add_field(name="💰 Balance", value=config.fmt(data["balance"]), inline=True)
        user_id = data["discord_id"]

    if not await dm_user(interaction.client, user_id, embeds.sim(e)):
        await _dm_failed(interaction)


class ReasonModal(discord.ui.Modal):
    reason = discord.ui.TextInput(
        label="Reason (sent to the player)",
        style=discord.TextStyle.paragraph,
        placeholder="Why is this being declined?",
        max_length=300,
    )

    def __init__(self, action, code):
        title = "Decline deposit" if action == "decline" else "Reject withdrawal"
        super().__init__(title=title)
        self.action = action
        self.code = code

    async def on_submit(self, interaction):
        await do_negative(interaction, self.action, self.code, self.reason.value.strip())


STYLES = {
    "accept": ("Accept", discord.ButtonStyle.success, "✅"),
    "decline": ("Decline", discord.ButtonStyle.danger, "✖️"),
    "paid": ("Paid", discord.ButtonStyle.success, "💸"),
    "reject": ("Reject", discord.ButtonStyle.danger, "✖️"),
}


class ReviewButton(
    discord.ui.DynamicItem[discord.ui.Button],
    template=r"rq:(?P<action>accept|decline|paid|reject):(?P<code>[A-Z]+-[0-9]+)",
):
    def __init__(self, action: str, code: str):
        label, style, emoji = STYLES[action]
        super().__init__(
            discord.ui.Button(
                label=label, style=style, emoji=emoji, custom_id=f"rq:{action}:{code}"
            )
        )
        self.action = action
        self.code = code

    @classmethod
    async def from_custom_id(cls, interaction, item, match, /):
        return cls(match["action"], match["code"])

    async def interaction_check(self, interaction):
        if interaction.user.id != config.ADMIN_ID:
            await interaction.response.send_message("Admins only.", ephemeral=True)
            return False
        return True

    async def callback(self, interaction):
        if self.action in ("decline", "reject"):
            await interaction.response.send_modal(ReasonModal(self.action, self.code))
        elif self.action == "accept":
            await do_accept(interaction, self.code)
        else:
            await do_paid(interaction, self.code)
