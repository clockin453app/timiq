"""Finance module gate and production pilot allowlist.

FINANCE_MODULE_ENABLED is the global on/off switch (separate from CIS integration).
When off, Finance operations are denied; TIMIQ otherwise starts and runs normally.
Navigation is not the security boundary — API asserts still apply.

Production also denies Finance until FINANCE_PILOT_USER_IDS allowlists the actor.
"""

from __future__ import annotations

import os

from fastapi import HTTPException

from app.core.config import settings
from app.modules.auth.models import SystemRole, User

MODULE_DISABLED = "Finance module is disabled."
PILOT_DISABLED = "Finance is disabled until a pilot administrator is allowlisted."
PREVIEW_READONLY = "Finance preview is read-only. Posting and other changes are disabled."

_TRUTHY = frozenset({"1", "true", "yes", "on"})
_FALSY = frozenset({"0", "false", "no", "off"})


def finance_module_enabled() -> bool:
    """Global Finance Core switch, independent of FINANCE_CIS_PAYMENT_INTEGRATION.

    Explicit env wins. Otherwise: enabled outside production (local/test),
    disabled in production until operators set FINANCE_MODULE_ENABLED=1.
    """
    raw = os.environ.get("FINANCE_MODULE_ENABLED", "").strip().lower()
    if raw in _TRUTHY:
        return True
    if raw in _FALSY:
        return False
    return settings.app_env.strip().lower() not in {"production", "prod"}


def assert_finance_module_enabled() -> None:
    if not finance_module_enabled():
        raise HTTPException(status_code=403, detail=MODULE_DISABLED)


def finance_preview_readonly() -> bool:
    """Explicit switch. Local environment alone does not make Finance read-only."""
    return os.environ.get("FINANCE_PREVIEW_MODE", "").strip().lower() == "readonly"


def assert_finance_access(actor: User) -> None:
    assert_finance_module_enabled()
    if settings.app_env.strip().lower() != "production":
        return
    if actor.system_role not in {SystemRole.ADMINISTRATOR, SystemRole.ADMIN}:
        raise HTTPException(status_code=403, detail=PILOT_DISABLED)
    allowed = {
        item.strip()
        for item in os.environ.get("FINANCE_PILOT_USER_IDS", "").split(",")
        if item.strip()
    }
    if str(actor.id) not in allowed:
        raise HTTPException(status_code=403, detail=PILOT_DISABLED)
