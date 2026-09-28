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