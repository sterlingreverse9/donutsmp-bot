import discord

import config


def make(title, description, color, user=None, thumbnail=False):
    e = discord.Embed(title=title, description=description, color=color)
    e.set_footer(text=f"{config.BOT_NAME} 🍩")
    if user is not None:
        e.set_author(name=user.display_name, icon_url=user.display_avatar.url)
        if thumbnail:
            e.set_thumbnail(url=user.display_avatar.url)
    return e


def gold(title, description, user=None, thumbnail=False):
    return make(title, description, config.COLOR_GOLD, user, thumbnail)


def success(title, description, user=None):
    return make(f"✅ {title}", description, config.COLOR_GREEN, user)


def error(title, description, user=None):
    return make(f"❌ {title}", description, config.COLOR_RED, user)


def info(title, description, user=None):
    return make(title, description, config.COLOR_DARK, user)