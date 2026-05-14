from __future__ import annotations

import hashlib
import secrets


def generate_raw_account_token() -> str:
    return secrets.token_urlsafe(32)


def hash_account_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
