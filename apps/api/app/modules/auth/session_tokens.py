import base64
import hashlib
import hmac
import json
import time
import uuid

from app.core.config import settings


SESSION_COOKIE_NAME = "timiq_session"
SESSION_DURATION_SECONDS = 60 * 60 * 10


class InvalidSessionTokenError(ValueError):
    pass


def _get_session_secret() -> bytes:
    secret = settings.session_secret.strip()

    if not secret:
        raise RuntimeError("SESSION_SECRET is required.")

    if settings.app_env != "local" and secret == "change-this-with-a-secure-random-value":
        raise RuntimeError("SESSION_SECRET must be changed outside local development.")

    return secret.encode("utf-8")


def create_session_token(user_id: uuid.UUID) -> str:
    expires_at = int(time.time()) + SESSION_DURATION_SECONDS

    payload = {
        "sub": str(user_id),
        "exp": expires_at,
    }

    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8")

    signature = hmac.new(
        _get_session_secret(),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    signature_b64 = base64.urlsafe_b64encode(signature).decode("utf-8")

    return f"{payload_b64}.{signature_b64}"


def read_session_token(token: str) -> uuid.UUID:
    try:
        payload_b64, signature_b64 = token.split(".", maxsplit=1)
    except ValueError as exc:
        raise InvalidSessionTokenError("Invalid session token format.") from exc

    expected_signature = hmac.new(
        _get_session_secret(),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    actual_signature = base64.urlsafe_b64decode(signature_b64.encode("utf-8"))

    if not hmac.compare_digest(actual_signature, expected_signature):
        raise InvalidSessionTokenError("Invalid session token signature.")

    payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8"))
    payload = json.loads(payload_json)

    expires_at = int(payload["exp"])

    if expires_at < int(time.time()):
        raise InvalidSessionTokenError("Session token has expired.")

    return uuid.UUID(payload["sub"])