"""Account access helpers (hashing, password policy)."""

from app.modules.auth.schemas import validate_account_password
from app.modules.auth.token_utils import generate_raw_account_token, hash_account_token


def test_token_hash_stable() -> None:
    raw = generate_raw_account_token()
    assert len(hash_account_token(raw)) == 64
    assert hash_account_token(raw) == hash_account_token(raw)
    assert hash_account_token(raw) != hash_account_token(raw + "x")


def test_account_password_min_length() -> None:
    try:
        validate_account_password("short1a")
    except ValueError as exc:
        assert "12" in str(exc)
    else:
        raise AssertionError("expected short password rejection")
