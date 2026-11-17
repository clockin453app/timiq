"""Finance module gate and production/prod pilot allowlists.

FINANCE_MODULE_ENABLED is the global on/off switch (separate from CIS integration).
When off, Finance operations are denied; TIMIQ otherwise starts and runs normally.
Navigation is not the security boundary — API asserts still apply.

Live-like environments (anything not a known local/test env) also require:
- FINANCE_PILOT_USER_IDS — actor must be listed
- FINANCE_PILOT_COMPANY_IDS — resolved company must be listed

Missing or invalid pilot configuration fails closed while the module is enabled.
Unknown/unclassified APP_ENV values are treated as live-like (fail closed).
"""

from __future__ import annotations

import os
import uuid

from fastapi import HTTPException

from app.core.config import settings
from app.modules.auth.models import SystemRole, User

MODULE_DISABLED = "Finance module is disabled."
PILOT_DISABLED = "Finance is disabled until a pilot administrator is allowlisted."
COMPANY_DISABLED = "Finance is disabled for this company."
PREVIEW_READONLY = "Finance preview is read-only. Posting and other changes are disabled."

_TRUTHY = frozenset({"1", "true", "yes", "on"})
_FALSY = frozenset({"0", "false", "no", "off"})
# Only these are treated as non-live. production, prod, staging, empty, and
# any unknown value require pilot allowlists (fail closed).
_SAFE_NON_LIVE_ENVS = frozenset({"local", "test", "development", "dev"})


def is_live_like_env() -> bool:
    """True unless APP_ENV/TIMIQ_ENV is a known local/test value.

    ``prod`` and ``production`` are both live-like. Unclassified values are
    treated as live-like so mis-set environments cannot skip the allowlists.
    """
    return settings.app_env.strip().lower() not in _SAFE_NON_LIVE_ENVS


def finance_module_enabled() -> bool:
    """Global Finance Core switch, independent of FINANCE_CIS_PAYMENT_INTEGRATION.

    Explicit env wins. Otherwise: enabled outside live-like envs (local/test),
    disabled in production/prod until operators set FINANCE_MODULE_ENABLED=1.
    """
    raw = os.environ.get("FINANCE_MODULE_ENABLED", "").strip().lower()
    if raw in _TRUTHY:
        return True
    if raw in _FALSY:
        return False
    return not is_live_like_env()


def assert_finance_module_enabled() -> None:
    if not finance_module_enabled():
        raise HTTPException(status_code=403, detail=MODULE_DISABLED)


def finance_preview_readonly() -> bool:
    """Explicit switch. Local environment alone does not make Finance read-only."""
    return os.environ.get("FINANCE_PREVIEW_MODE", "").strip().lower() == "readonly"


def _parse_uuid_allowlist(env_name: str) -> set[uuid.UUID] | None:
    """Parse a comma-separated UUID allowlist.

    Returns:
      - empty set when the variable is absent or only whitespace/commas
      - None when any non-empty token is not a valid UUID (invalid config)
      - non-empty set of UUIDs when every token is valid
    """
    raw = os.environ.get(env_name)
    if raw is None:
        return set()
    tokens = [part.strip() for part in raw.split(",") if part.strip()]
    if not tokens:
        return set()
    parsed: set[uuid.UUID] = set()
    for token in tokens:
        try:
            parsed.add(uuid.UUID(token))
        except ValueError:
            return None
    return parsed


def _pilot_allowlists_ready() -> bool:
    """Both pilot allowlists must be present and fully valid UUID sets."""
    users = _parse_uuid_allowlist("FINANCE_PILOT_USER_IDS")
    companies = _parse_uuid_allowlist("FINANCE_PILOT_COMPANY_IDS")
    return bool(users) and bool(companies)


def finance_user_authorized(actor: User) -> bool:
    """Whether this authenticated actor may use Finance when the module is on.

    Local/test: authorized once the module flag is on (existing developer workflow).
    Live-like: fail closed unless role + both pilot allowlists are valid and the
    actor is listed. Company membership is enforced separately per request.
    """
    if not finance_module_enabled():
        return False
    if not is_live_like_env():
        return True
    if actor.system_role not in {SystemRole.ADMINISTRATOR, SystemRole.ADMIN}:
        return False
    if not _pilot_allowlists_ready():
        return False
    allowed = _parse_uuid_allowlist("FINANCE_PILOT_USER_IDS")
    if allowed is None or not allowed:
        return False
    try:
        return uuid.UUID(str(actor.id)) in allowed
    except ValueError:
        return False


def assert_finance_access(actor: User) -> None:
    assert_finance_module_enabled()
    if not is_live_like_env():
        return
    if not finance_user_authorized(actor):
        raise HTTPException(status_code=403, detail=PILOT_DISABLED)


def assert_finance_company_access(company_id: uuid.UUID) -> None:
    """Restrict Finance to allowlisted companies in live-like environments."""
    if not is_live_like_env():
        return
    allowed = _parse_uuid_allowlist("FINANCE_PILOT_COMPANY_IDS")
    if allowed is None or not allowed:
        raise HTTPException(status_code=403, detail=PILOT_DISABLED)
    if company_id not in allowed:
        raise HTTPException(status_code=403, detail=COMPANY_DISABLED)
