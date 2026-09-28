import re
from decimal import Decimal

MULTIPLIERS = {"": 1, "k": 10**3, "m": 10**6, "b": 10**9, "t": 10**12}
_NUM = re.compile(r"^(\d+(?:\.\d+)?|\.\d+)([kmbt]?)$")
_PCT = re.compile(r"^(\d+(?:\.\d+)?)%$")


def parse_amount(text, balance=None):
    """'5k' -> 5000, '1.5m' -> 1500000, '1t' -> 10**12.
    With a balance, also understands: all / max / half / 25%.
    Returns an int (may be 0 for all/half on an empty wallet) or None if unreadable."""
    if text is None:
        return None
    t = text.strip().lower().replace(",", "").replace("_", "").lstrip("$")

    if balance is not None:
        if t in ("all", "max", "allin"):
            return int(balance)
        if t == "half":
            return int(balance) // 2
        m = _PCT.match(t)
        if m:
            pct = Decimal(m.group(1))
            if pct <= 0 or pct > 100:
                return None
            return int(Decimal(balance) * pct / 100)

    m = _NUM.match(t)
    if not m:
        return None
    value = int(Decimal(m.group(1)) * MULTIPLIERS[m.group(2)])
    return value if value > 0 else None


def parse_side(text):
    if text is None:
        return None
    t = text.strip().lower()
    if t in ("h", "head", "heads"):
        return "heads"
    if t in ("t", "tail", "tails"):
        return "tails"
    return None
