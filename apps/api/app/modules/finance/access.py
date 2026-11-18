"""Finance module gate, pilot allowlists, and scoped write exceptions.

FINANCE_MODULE_ENABLED is the global on/off switch (separate from CIS integration).
When off, Finance operations are denied; TIMIQ otherwise starts and runs normally.
Navigation is not the security boundary — API asserts still apply.

Live-like environments (anything not a known local/test env) also require:
- FINANCE_PILOT_USER_IDS — actor must be listed
- FINANCE_PILOT_COMPANY_IDS — resolved company must be listed

FINANCE_PREVIEW_MODE=readonly keeps Finance mutations blocked by default.
Scoped write may unlock a narrow commercial allowlist only when:
- actor is company admin (SystemRole.ADMIN), never MASTER/administrator
- company is in FINANCE_WRITE_COMPANY_IDS
- project is in FINANCE_WRITE_PROJECT_IDS
- project belongs to that company (database check)

Missing or invalid allowlist configuration fails closed.
Unknown/unclassified APP_ENV values are treated as live-like (fail closed).
"""

from __future__ import annotations

import os
import uuid

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.auth.models import SystemRole, User

MODULE_DISABLED = "Finance module is disabled."
PILOT_DISABLED = "Finance is disabled until a pilot administrator is allowlisted."
COMPANY_DISABLED = "Finance is disabled for this company."
PREVIEW_READONLY = "Finance preview is read-only. Posting and other changes are disabled."
WRITE_DENIED = "Finance write is not authorised for this company admin, company, or project."
WRITE_ROLE_DENIED = "Finance write requires a company admin for the authorised company."
WRITE_PROJECT_REQUIRED = "Finance write requires an authorised project."
WRITE_PROJECT_MISMATCH = "Finance project is not in the authorised company."

# Commercial operations eligible for scoped write under preview readonly.
SCOPED_WRITE_OPERATIONS = frozenset(
    {
        "contract_value",
        "budget_create",
        "budget_approve",
        "cost_to_complete",
        "variation_save",
        "variation_status",
        "daywork_save",
        "daywork_approve",
        "commitment_create",
        "commitment_draw",
        "application_create",
        "certificate_create",
        "retention_release",
    }
)

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


def _write_allowlists() -> tuple[set[uuid.UUID], set[uuid.UUID]] | None:
    """Return (companies, projects) or None when configuration is invalid."""
    companies = _parse_uuid_allowlist("FINANCE_WRITE_COMPANY_IDS")
    projects = _parse_uuid_allowlist("FINANCE_WRITE_PROJECT_IDS")
    if companies is None or projects is None:
        return None
    return companies, projects


def finance_is_company_admin(actor: User) -> bool:
    """Company admin only. MASTER/administrator is intentionally excluded."""
    return actor.system_role == SystemRole.ADMIN


def project_belongs_to_company(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
) -> bool:
    row = db_session.execute(
        text(
            "SELECT 1 FROM finance_projects "
            "WHERE id = :project_id AND company_id = :company_id LIMIT 1"
        ),
        {"project_id": project_id, "company_id": company_id},
    ).first()
    return row is not None


def finance_write_allowed(
    db_session: Session,
    *,
    actor: User,
    company_id: uuid.UUID,
    project_id: uuid.UUID | None,
    operation: str | None = None,
) -> bool:
    """True when this actor may mutate Finance for company/project.

    When preview readonly is off, existing non-preview write behaviour applies
    (module + pilot/company access already enforced by callers).
    When preview readonly is on, only scoped commercial ops may pass.
    """
    if not finance_preview_readonly():
        return True
    if operation is not None and operation not in SCOPED_WRITE_OPERATIONS:
        return False
    if project_id is None:
        return False
    if not finance_is_company_admin(actor):
        return False
    if actor.company_id is None or actor.company_id != company_id:
        return False
    allowlists = _write_allowlists()
    if allowlists is None:
        return False
    companies, projects = allowlists
    if not companies or not projects:
        return False
    if company_id not in companies:
        return False
    if project_id not in projects:
        return False
    if not project_belongs_to_company(db_session, company_id=company_id, project_id=project_id):
        return False
    return True


def assert_finance_write(
    db_session: Session,
    *,
    actor: User,
    company_id: uuid.UUID,
    project_id: uuid.UUID | None,
    operation: str,
) -> None:
    """Fail-closed mutation gate. Call after company scope resolution."""
    if finance_write_allowed(
        db_session,
        actor=actor,
        company_id=company_id,
        project_id=project_id,
        operation=operation,
    ):
        return
    if not finance_preview_readonly():
        # Non-preview path should not reach a deny from this helper.
        raise HTTPException(status_code=403, detail=WRITE_DENIED)
    if operation not in SCOPED_WRITE_OPERATIONS:
        raise HTTPException(status_code=403, detail=PREVIEW_READONLY)
    if project_id is None:
        raise HTTPException(status_code=403, detail=WRITE_PROJECT_REQUIRED)
    if not finance_is_company_admin(actor):
        raise HTTPException(status_code=403, detail=WRITE_ROLE_DENIED)
    if actor.company_id is None or actor.company_id != company_id:
        raise HTTPException(status_code=403, detail=WRITE_ROLE_DENIED)
    allowlists = _write_allowlists()
    if allowlists is None or not allowlists[0] or not allowlists[1]:
        raise HTTPException(status_code=403, detail=PREVIEW_READONLY)
    companies, projects = allowlists
    if company_id not in companies or project_id not in projects:
        raise HTTPException(status_code=403, detail=WRITE_DENIED)
    if not project_belongs_to_company(db_session, company_id=company_id, project_id=project_id):
        raise HTTPException(status_code=403, detail=WRITE_PROJECT_MISMATCH)
    raise HTTPException(status_code=403, detail=WRITE_DENIED)


def effective_finance_readonly(
    db_session: Session | None,
    *,
    actor: User,
    company_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
) -> bool:
    """UI/effective lock for the current company+project selection."""
    if not finance_preview_readonly():
        return False
    if db_session is None or company_id is None or project_id is None:
        return True
    return not finance_write_allowed(
        db_session,
        actor=actor,
        company_id=company_id,
        project_id=project_id,
        operation="contract_value",
    )
