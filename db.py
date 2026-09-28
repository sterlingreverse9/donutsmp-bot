import asyncio

from supabase import create_client

import config

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


async def is_running() -> bool:
    def q():
        r = _client.table("bot_state").select("is_running").eq("id", 1).execute()
        return r.data[0]["is_running"] if r.data else True

    return await asyncio.to_thread(q)


async def set_running(value: bool) -> None:
    def q():
        _client.table("bot_state").update({"is_running": value}).eq("id", 1).execute()

    await asyncio.to_thread(q)
