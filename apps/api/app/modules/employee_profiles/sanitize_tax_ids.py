"""Normalize NI / UTR values for storage and display (no logging of secrets)."""


def sanitize_national_insurance_value(raw: object | None, *, max_len: int = 32) -> str | None:
    if raw is None or not isinstance(raw, str):
        return None
    cleaned = "".join(ch for ch in raw.strip().upper() if ch.isalnum() or ch in " ")
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return None
    return cleaned[:max_len]


def sanitize_utr_value(raw: object | None, *, max_len: int = 32) -> str | None:
    if raw is None or not isinstance(raw, str):
        return None
    digits = "".join(ch for ch in raw.strip() if ch.isdigit())
    if not digits:
        return None
    return digits[:max_len]
