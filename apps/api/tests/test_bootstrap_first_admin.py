"""Unit tests for scripts/create_first_admin.py bootstrap validation and apply logic."""

import importlib.util
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.auth.security import hash_password, verify_password
from app.modules.companies.models import Company


def _load_create_first_admin():
    root = Path(__file__).resolve().parents[1] / "scripts" / "create_first_admin.py"
    spec = importlib.util.spec_from_file_location("create_first_admin", root)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _clear_bootstrap_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "CONFIRM_CREATE_FIRST_ADMIN",
        "ADMIN_EMAIL",
        "ADMIN_PASSWORD",
        "ADMIN_ROLE",
        "ADMIN_COMPANY_NAME",
    ):
        monkeypatch.delenv(key, raising=False)


def test_validate_requires_confirm(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = _load_create_first_admin()
    _clear_bootstrap_env(monkeypatch)
    monkeypatch.setenv("ADMIN_EMAIL", "a@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "secret-not-printed")
    with pytest.raises(ValueError, match="CONFIRM_CREATE_FIRST_ADMIN=yes"):
        mod.validate_bootstrap_environ()


def test_validate_rejects_unsupported_role(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = _load_create_first_admin()
    _clear_bootstrap_env(monkeypatch)
    monkeypatch.setenv("CONFIRM_CREATE_FIRST_ADMIN", "yes")
    monkeypatch.setenv("ADMIN_EMAIL", "a@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "x")
    monkeypatch.setenv("ADMIN_ROLE", "employee")
    with pytest.raises(ValueError, match="ADMIN_ROLE"):
        mod.validate_bootstrap_environ()


def test_validate_administrator_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = _load_create_first_admin()
    _clear_bootstrap_env(monkeypatch)
    monkeypatch.setenv("CONFIRM_CREATE_FIRST_ADMIN", "yes")
    monkeypatch.setenv("ADMIN_EMAIL", " Admin@Example.COM ")
    monkeypatch.setenv("ADMIN_PASSWORD", "pw")
    cfg = mod.validate_bootstrap_environ()
    assert cfg.email == "admin@example.com"
    assert cfg.role == "administrator"
    assert cfg.company_name == ""


def test_validate_admin_company_name_default(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = _load_create_first_admin()
    _clear_bootstrap_env(monkeypatch)
    monkeypatch.setenv("CONFIRM_CREATE_FIRST_ADMIN", "yes")
    monkeypatch.setenv("ADMIN_EMAIL", "b@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "pw")
    monkeypatch.setenv("ADMIN_ROLE", "admin")
    cfg = mod.validate_bootstrap_environ()
    assert cfg.role == "admin"
    assert cfg.company_name == "TimIQ Demo Company"


def test_apply_administrator_new_user_hash_verifies(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = _load_create_first_admin()
    cfg = mod.BootstrapConfig(email="adm@example.com", password="TestPw!234", role="administrator", company_name="")
    db = MagicMock()

    with patch("app.modules.auth.repository.get_user_by_email", return_value=None):
        msg = mod.apply_bootstrap(db, cfg)

    assert "First administrator ready" in msg
    assert cfg.email in msg
    add_kw = db.add.call_args[0][0]
    assert isinstance(add_kw, User)
    assert add_kw.system_role == SystemRole.ADMINISTRATOR
    assert add_kw.company_id is None
    assert add_kw.is_active is True
    assert add_kw.email_verified_at is not None
    assert verify_password("TestPw!234", add_kw.password_hash)


def test_apply_administrator_updates_existing(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = _load_create_first_admin()
    cfg = mod.BootstrapConfig(email="x@example.com", password="NewPw!567", role="administrator", company_name="")
    existing = User(
        id=uuid.uuid4(),
        email="x@example.com",
        password_hash=hash_password("old"),
        system_role=SystemRole.EMPLOYEE,
        company_id=uuid.uuid4(),
        is_active=False,
    )
    db = MagicMock()
    with patch("app.modules.auth.repository.get_user_by_email", return_value=existing):
        mod.apply_bootstrap(db, cfg)
    assert existing.system_role == SystemRole.ADMINISTRATOR
    assert existing.company_id is None
    assert existing.is_active is True
    assert verify_password("NewPw!567", existing.password_hash)


def test_apply_company_admin_uses_existing_company(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = _load_create_first_admin()
    cfg = mod.BootstrapConfig(
        email="co@example.com",
        password="CoPw!890",
        role="admin",
        company_name="Acme Ltd",
    )
    co = Company(id=uuid.uuid4(), name="Acme Ltd", is_active=True)
    db = MagicMock()

    with (
        patch("app.modules.companies.repository.get_company_by_name", return_value=co),
        patch("app.modules.companies.service.create_company") as mock_create,
        patch("app.modules.companies.service.ensure_company_time_policy") as mock_ensure,
        patch("app.modules.auth.repository.get_user_by_email", return_value=None),
    ):
        msg = mod.apply_bootstrap(db, cfg)

    mock_create.assert_not_called()
    mock_ensure.assert_called_once()
    assert "First company admin ready" in msg
    assert "Acme Ltd" in msg
    user = db.add.call_args[0][0]
    assert isinstance(user, User)
    assert user.system_role == SystemRole.ADMIN
    assert user.company_id == co.id
    assert verify_password("CoPw!890", user.password_hash)
