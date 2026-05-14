#!/usr/bin/env python3
"""One-off bootstrap for Render (or any fresh DB): create/update first administrator or company admin.

Security:
- Requires CONFIRM_CREATE_FIRST_ADMIN=yes
- Never prints passwords or password hashes
- Uses app.modules.auth.security.hash_password (PBKDF2)

Run from apps/api:
  CONFIRM_CREATE_FIRST_ADMIN=yes ADMIN_EMAIL=... ADMIN_PASSWORD=... python scripts/create_first_admin.py
"""

import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

# Ensure apps/api is on path when run as `python scripts/create_first_admin.py`
_API_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _API_ROOT not in sys.path:
    sys.path.insert(0, _API_ROOT)


@dataclass(frozen=True)
class BootstrapConfig:
    email: str
    password: str
    role: str  # "administrator" | "admin"
    company_name: str


def validate_bootstrap_environ() -> BootstrapConfig:
    """Read and validate environment. Raises ValueError with a clear message on failure."""
    confirm = os.environ.get("CONFIRM_CREATE_FIRST_ADMIN", "").strip()
    if confirm != "yes":
        raise ValueError(
            'Refusing to run: set CONFIRM_CREATE_FIRST_ADMIN=yes to acknowledge intentional bootstrap.',
        )

    email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    if not email:
        raise ValueError("ADMIN_EMAIL is required.")

    password = os.environ.get("ADMIN_PASSWORD", "")
    if not password:
        raise ValueError("ADMIN_PASSWORD is required (non-empty).")

    role_raw = os.environ.get("ADMIN_ROLE", "").strip().lower() or "administrator"
    if role_raw not in ("administrator", "admin"):
        raise ValueError("ADMIN_ROLE must be 'administrator' or 'admin' (default: administrator).")

    company_name = os.environ.get("ADMIN_COMPANY_NAME", "").strip()
    if role_raw == "admin":
        if not company_name:
            company_name = "TimIQ Demo Company"
    else:
        company_name = company_name or ""

    return BootstrapConfig(
        email=email,
        password=password,
        role=role_raw,
        company_name=company_name,
    )


def apply_bootstrap(db: Session, cfg: BootstrapConfig) -> str:
    """Apply bootstrap inside an open SQLAlchemy session. Caller commits or rolls back."""
    from app.modules.auth.models import SystemRole, User
    from app.modules.auth.repository import get_user_by_email
    from app.modules.auth.security import hash_password, verify_password
    from app.modules.companies.repository import get_company_by_name
    from app.modules.companies.schemas import CompanyCreateRequest
    from app.modules.companies.service import DuplicateCompanyError, create_company, ensure_company_time_policy

    now = datetime.now(timezone.utc)
    pw_hash = hash_password(cfg.password)

    if cfg.role == "administrator":
        user = get_user_by_email(db, cfg.email)
        if user is None:
            user = User(
                email=cfg.email,
                password_hash=pw_hash,
                system_role=SystemRole.ADMINISTRATOR,
                company_id=None,
                is_active=True,
                email_verified_at=now,
                password_changed_at=now,
            )
            db.add(user)
        else:
            user.password_hash = pw_hash
            user.system_role = SystemRole.ADMINISTRATOR
            user.company_id = None
            user.is_active = True
            user.email_verified_at = now
            user.password_changed_at = now
            user.updated_at = now
            db.add(user)
        db.flush()
        if not verify_password(cfg.password, user.password_hash):
            raise RuntimeError("Internal error: password hash did not verify after save.")
        return f"First administrator ready: {cfg.email}"

    # company admin
    req = CompanyCreateRequest(name=cfg.company_name, is_active=True)
    existing_co = get_company_by_name(db, req.name)
    if existing_co is None:
        try:
            company = create_company(db, req)
        except DuplicateCompanyError:
            company = get_company_by_name(db, req.name)
            if company is None:
                raise
    else:
        company = existing_co
    ensure_company_time_policy(db, company.id)

    user = get_user_by_email(db, cfg.email)
    if user is None:
        user = User(
            email=cfg.email,
            password_hash=pw_hash,
            system_role=SystemRole.ADMIN,
            company_id=company.id,
            is_active=True,
            email_verified_at=now,
            password_changed_at=now,
        )
        db.add(user)
    else:
        user.password_hash = pw_hash
        user.system_role = SystemRole.ADMIN
        user.company_id = company.id
        user.is_active = True
        user.email_verified_at = now
        user.password_changed_at = now
        user.updated_at = now
        db.add(user)
    db.flush()
    if not verify_password(cfg.password, user.password_hash):
        raise RuntimeError("Internal error: password hash did not verify after save.")
    return f"First company admin ready: {cfg.email} for {company.name}"


def main() -> int:
    try:
        cfg = validate_bootstrap_environ()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    try:
        from app.db.session import DatabaseConfigurationError, get_session_factory
    except Exception as exc:  # pragma: no cover - import guard
        print(f"Failed to load database configuration: {exc}", file=sys.stderr)
        return 1

    try:
        session_factory = get_session_factory()
    except DatabaseConfigurationError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    db = session_factory()
    try:
        msg = apply_bootstrap(db, cfg)
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"Bootstrap failed: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()

    print(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
