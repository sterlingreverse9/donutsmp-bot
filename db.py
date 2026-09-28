import asyncio
import logging
import secrets
from datetime import datetime, timezone

from supabase import create_client

import config

log = logging.getLogger(__name__)
_client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)


async def _rpc(name: str, params: dict):
    def q():
        return _client.rpc(name, params).execute().data

    return await asyncio.to_thread(q)


# ───── users ─────


async def get_user(discord_id: int):
    def q():
        r = (
            _client.table("users")
            .select("*")
            .eq("discord_id", discord_id)
            .limit(1)
            .execute()
        )
        return r.data[0] if r.data else None

    return await asyncio.to_thread(q)


async def claim_start(discord_id: int, username: str) -> bool:
    """Atomic: True only the very first time this user claims."""
    data = await _rpc(
        "claim_start",
        {"p_id": discord_id, "p_name": username, "p_amount": config.START_BONUS},
    )
    return bool(data)


async def set_ign(discord_id: int, ign):
    """Returns True if the user row exists."""

    def q():
        r = _client.table("users").update({"mc_ign": ign}).eq("discord_id", discord_id).execute()
        return bool(r.data)

    return await asyncio.to_thread(q)


# ───── money ─────


async def take_bet(discord_id: int, amount: int):
    """Removes the bet (and counts it toward wager). New balance, or None if not enough."""
    result = await _rpc("take_bet", {"p_id": discord_id, "p_amount": amount})
    if result is None or result < 0:
        return None
    return result


async def settle_cf(discord_id: int, bet: int, win: bool, detail: str) -> int:
    return await _rpc(
        "settle_cf", {"p_id": discord_id, "p_bet": bet, "p_win": win, "p_detail": detail}
    )


async def credit_with_wager(discord_id: int, amount: int, kind: str, detail: str):
    """Adds balance AND wager. New balance, or None if the user hasn't joined."""
    result = await _rpc(
        "credit_with_wager",
        {"p_id": discord_id, "p_amount": amount, "p_kind": kind, "p_detail": detail},
    )
    return None if result is None or result < 0 else result


async def deduct_balance(discord_id: int, amount: int):
    result = await _rpc("deduct_balance", {"p_id": discord_id, "p_amount": amount})
    return None if result is None or result < 0 else result


async def set_wager(discord_id: int, amount: int):
    result = await _rpc("set_wager", {"p_id": discord_id, "p_amount": amount})
    return None if result is None or result < 0 else result


async def transfer(from_id: int, to_id: int, amount: int) -> str:
    """'ok' | 'no_receiver' | 'no_funds' | 'invalid'"""
    return await _rpc(
        "transfer_funds", {"p_from": from_id, "p_to": to_id, "p_amount": amount}
    )


async def claim_rakeback(discord_id: int):
    """Reward amount claimed (0 = nothing to claim), or None if user not found."""
    result = await _rpc(
        "claim_rakeback", {"p_id": discord_id, "p_rate": config.RAKEBACK_RATE}
    )
    return None if result is None or result < 0 else result


async def history(discord_id: int, limit: int):
    def q():
        r = (
            _client.table("transactions")
            .select("*")
            .eq("discord_id", discord_id)
            .order("id", desc=True)
            .limit(limit)
            .execute()
        )
        return r.data

    return await asyncio.to_thread(q)


# ───── bot state ─────


async def is_running() -> bool:
    def q():
        r = _client.table("bot_state").select("is_running").eq("id", 1).execute()
        return r.data[0]["is_running"] if r.data else True

    return await asyncio.to_thread(q)


async def set_running(value: bool) -> None:
    def q():
        _client.table("bot_state").update({"is_running": value}).eq("id", 1).execute()

    await asyncio.to_thread(q)


async def get_cf_chance() -> float:
    def q():
        r = _client.table("bot_state").select("cf_win_chance").eq("id", 1).execute()
        return float(r.data[0]["cf_win_chance"]) if r.data else config.DEFAULT_CF_WIN

    try:
        return await asyncio.to_thread(q)
    except Exception:
        log.warning("cf_win_chance missing, using default")
        return config.DEFAULT_CF_WIN


async def set_cf_chance(value: float) -> None:
    def q():
        _client.table("bot_state").update({"cf_win_chance": value}).eq("id", 1).execute()

    await asyncio.to_thread(q)


# ───── deposit / withdraw requests ─────


def new_code(prefix: str) -> str:
    return f"{prefix}-{secrets.randbelow(900000) + 100000}"


async def create_request(kind, discord_id, amount, ign, channel_id, prefix) -> str:
    """Inserts an 'open' request and returns its unique code."""
    for _ in range(5):
        code = new_code(prefix)

        def q(code=code):
            _client.table("requests").insert(
                {
                    "code": code,
                    "kind": kind,
                    "discord_id": discord_id,
                    "amount": amount,
                    "mc_ign": ign,
                    "channel_id": channel_id,
                    "status": "open",
                }
            ).execute()

        try:
            await asyncio.to_thread(q)
            return code
        except Exception:
            log.exception("create_request failed, retrying with a new code")
    raise RuntimeError("could not create request")


async def set_request_status(code: str, from_status: str, to_status: str, reason=None):
    """Atomic conditional update. Returns the updated row, or None if it wasn't in from_status."""

    def q():
        r = (
            _client.table("requests")
            .update(
                {
                    "status": to_status,
                    "reason": reason,
                    "resolved_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("code", code)
            .eq("status", from_status)
            .execute()
        )
        return r.data[0] if r.data else None

    return await asyncio.to_thread(q)


async def approve_deposit(code: str):
    """Credits balance + wager. Returns {discord_id, amount, balance} or None if already handled."""
    return await _rpc("approve_deposit", {"p_code": code})


async def create_withdraw(discord_id: int, amount: int, ign: str, channel_id: int):
    """Returns (code, result). result >= 0 is the new balance; -1 not joined, -2 wager left, -3 no funds."""
    for _ in range(3):
        code = new_code("WD")
        try:
            result = await _rpc(
                "create_withdraw",
                {
                    "p_code": code,
                    "p_id": discord_id,
                    "p_amount": amount,
                    "p_ign": ign,
                    "p_channel": channel_id,
                },
            )
            return code, result
        except Exception:
            log.exception("create_withdraw failed, retrying")
    raise RuntimeError("could not create withdrawal")


async def reject_withdraw(code: str, reason: str):
    """Refunds the player. Returns {discord_id, amount, balance} or None if already handled."""
    return await _rpc("reject_withdraw", {"p_code": code, "p_reason": reason})


# ───── limbo ─────


async def settle_game(discord_id: int, bet: int, payout: int, kind: str, detail: str) -> int:
    """payout > 0 credits the win; payout == 0 records a loss (for rakeback)."""
    return await _rpc(
        "settle_game",
        {"p_id": discord_id, "p_bet": bet, "p_payout": payout, "p_kind": kind, "p_detail": detail},
    )


async def get_limbo_edge() -> float:
    def q():
        r = _client.table("bot_state").select("limbo_house_edge").eq("id", 1).execute()
        return float(r.data[0]["limbo_house_edge"]) if r.data else 10.0

    try:
        return await asyncio.to_thread(q)
    except Exception:
        log.warning("limbo_house_edge missing, using 10%. Run migration_4.sql")
        return 10.0


async def set_limbo_edge(value: float) -> None:
    def q():
        _client.table("bot_state").update({"limbo_house_edge": value}).eq("id", 1).execute()

    await asyncio.to_thread(q)


# ───── mines ─────


async def get_mines_edge() -> float:
    def q():
        r = _client.table("bot_state").select("mines_house_edge").eq("id", 1).execute()
        return float(r.data[0]["mines_house_edge"]) if r.data else 10.0

    try:
        return await asyncio.to_thread(q)
    except Exception:
        log.warning("mines_house_edge missing, using 10%. Run migration_5.sql")
        return 10.0


async def set_mines_edge(value: float) -> None:
    def q():
        _client.table("bot_state").update({"mines_house_edge": value}).eq("id", 1).execute()

    await asyncio.to_thread(q)


# ───── referrals ─────


async def get_ref_code(discord_id: int, guild_id: int):
    def q():
        r = (
            _client.table("referral_codes")
            .select("*")
            .eq("discord_id", discord_id)
            .eq("guild_id", guild_id)
            .limit(1)
            .execute()
        )
        return r.data[0] if r.data else None

    return await asyncio.to_thread(q)


async def save_ref_code(discord_id: int, guild_id: int, code: str, uses: int):
    def q():
        _client.table("referral_codes").upsert(
            {"discord_id": discord_id, "guild_id": guild_id, "code": code, "uses": uses},
            on_conflict="discord_id,guild_id",
        ).execute()

    await asyncio.to_thread(q)


async def ref_codes_for_guild(guild_id: int):
    def q():
        return _client.table("referral_codes").select("*").eq("guild_id", guild_id).execute().data

    return await asyncio.to_thread(q)


async def update_ref_uses(code: str, uses: int):
    def q():
        _client.table("referral_codes").update({"uses": uses}).eq("code", code).execute()

    await asyncio.to_thread(q)


async def register_referral(referred_id: int, referrer_id: int, name: str, guild_id: int) -> bool:
    """True if this is a brand-new referral (a player can only be referred once)."""
    data = await _rpc(
        "register_referral",
        {"p_referred": referred_id, "p_referrer": referrer_id, "p_name": name, "p_guild": guild_id},
    )
    return bool(data)


async def get_referral(referred_id: int):
    def q():
        r = _client.table("referrals").select("*").eq("referred_id", referred_id).limit(1).execute()
        return r.data[0] if r.data else None

    return await asyncio.to_thread(q)


async def referrals_of(referrer_id: int):
    def q():
        return (
            _client.table("referrals")
            .select("*")
            .eq("referrer_id", referrer_id)
            .order("joined_at", desc=True)
            .execute()
            .data
        )

    return await asyncio.to_thread(q)


async def referrals_due(cutoff_iso: str):
    """Pending referrals that joined before the cutoff (i.e. 24h have passed)."""

    def q():
        return (
            _client.table("referrals")
            .select("*")
            .eq("status", "pending")
            .lte("joined_at", cutoff_iso)
            .execute()
            .data
        )

    return await asyncio.to_thread(q)


async def set_referral_status(referred_id: int, from_status: str, to_status: str):
    """Atomic conditional update. Returns the row, or None if it wasn't in from_status."""

    def q():
        values = {"status": to_status}
        if to_status == "qualified":
            values["qualified_at"] = datetime.now(timezone.utc).isoformat()
        r = (
            _client.table("referrals")
            .update(values)
            .eq("referred_id", referred_id)
            .eq("status", from_status)
            .execute()
        )
        return r.data[0] if r.data else None

    return await asyncio.to_thread(q)


async def referrals_awaiting_wager_notice():
    """Referrals that made their first deposit and whose wager-complete DM hasn't been sent yet."""

    def q():
        rows = (
            _client.table("referrals")
            .select("*")
            .eq("first_done", True)
            .eq("wager_notified", False)
            .in_("status", ["pending", "qualified"])
            .execute()
            .data
        )
        if not rows:
            return []
        ids = [r["referred_id"] for r in rows]
        users = (
            _client.table("users").select("discord_id,wager_left").in_("discord_id", ids).execute().data
        )
        left = {u["discord_id"]: u["wager_left"] for u in users}
        return [r for r in rows if left.get(r["referred_id"], 1) == 0]

    return await asyncio.to_thread(q)


async def mark_wager_notified(referred_id: int):
    def q():
        _client.table("referrals").update({"wager_notified": True}).eq("referred_id", referred_id).execute()

    await asyncio.to_thread(q)


async def claim_referral(referrer_id: int):
    """Amount claimed (0 = nothing claimable), or None if the player hasn't joined."""
    result = await _rpc("claim_referral", {"p_id": referrer_id})
    return None if result is None or result < 0 else result
