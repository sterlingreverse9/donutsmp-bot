import asyncio
import logging

from supabase import create_client

import config

log = logging.getLogger(__name__)
_client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)


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
    """Atomic: returns True only the very first time this user claims."""

    def q():
        r = _client.rpc(
            "claim_start",
            {"p_id": discord_id, "p_name": username, "p_amount": config.START_BONUS},
        ).execute()
        return bool(r.data)

    return await asyncio.to_thread(q)


async def take_bet(discord_id: int, amount: int):
    """Atomically removes `amount` from the balance. Returns new balance, or None if not enough."""

    def q():
        r = _client.rpc("take_bet", {"p_id": discord_id, "p_amount": amount}).execute()
        return r.data

    result = await asyncio.to_thread(q)
    if result is None or result < 0:
        return None
    return result


async def add_balance(discord_id: int, amount: int) -> int:
    def q():
        r = _client.rpc("add_balance", {"p_id": discord_id, "p_amount": amount}).execute()
        return r.data

    return await asyncio.to_thread(q)


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
        log.warning("cf_win_chance column missing? run migration.sql. Using default.")
        return config.DEFAULT_CF_WIN


async def set_cf_chance(value: float) -> None:
    def q():
        _client.table("bot_state").update({"cf_win_chance": value}).eq("id", 1).execute()

    await asyncio.to_thread(q)
