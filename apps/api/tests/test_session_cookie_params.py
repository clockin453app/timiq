"""Session cookie SameSite / Secure behaviour for auth login and logout."""

import pytest

from app.modules.auth import router as auth_router


@pytest.mark.parametrize(
    ("app_env", "samesite_setting", "expected"),
    [
        ("local", "lax", {"secure": False, "samesite": "lax"}),
        ("local", "none", {"secure": False, "samesite": "lax"}),
        ("production", "lax", {"secure": True, "samesite": "lax"}),
        ("production", "strict", {"secure": True, "samesite": "strict"}),
        ("production", "none", {"secure": True, "samesite": "none"}),
        ("production", "bogus", {"secure": True, "samesite": "lax"}),
    ],
)
def test_session_cookie_params(
    monkeypatch: pytest.MonkeyPatch,
    app_env: str,
    samesite_setting: str,
    expected: dict[str, bool | str],
) -> None:
    monkeypatch.setattr(auth_router.settings, "app_env", app_env)
    monkeypatch.setattr(auth_router.settings, "session_cookie_samesite", samesite_setting)
    assert auth_router._session_cookie_params() == expected
