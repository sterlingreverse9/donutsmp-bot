from aiohttp import web

import config


async def start_web():
    async def alive(request):
        return web.Response(text="Donut Bet Bot is alive")

    app = web.Application()
    app.router.add_get("/", alive)
    app.router.add_get("/health", alive)

    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", config.PORT).start()
