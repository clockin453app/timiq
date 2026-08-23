"""Pure tests for the pytest/Alembic production-database guard. No connections."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

from app.db.session import get_database_url
from app.testing.database_safety import (
    UnsafeTestDatabaseError,
    assert_safe_destructive_migration_target,
    enforce_pytest_database_guard,
    redact_database_url,
    resolve_alembic_sqlalchemy_url,
    validate_test_database_url,
)

SAFE_TEST_URL = "postgresql+psycopg://timiq_test:s3cret-does-not-leak@127.0.0.1:5432/timiq_test_local"
PRODUCTION_STYLE_URL = (
    "postgresql+psycopg://timiq_app:super-secret-prod-password@"
    "dpg-aaaa1111bbbb-a.oregon-postgres.render.com:5432/timiq"
)
RENDER_TEST_NAMED_URL = (
    "postgresql+psycopg://timiq_test:s3cret-does-not-leak@"
    "dpg-aaaa1111bbbb-a.oregon-postgres.render.com:5432/timiq_test_local"
)


def test_production_db_name_timiq_is_refused() -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="REFUSING TO RUN TESTS"):
        validate_test_database_url(
            "postgresql+psycopg://u:p@127.0.0.1:5432/timiq",
            timiq_env="test",
        )


def test_render_host_with_test_looking_db_is_refused() -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="Render/production"):
        validate_test_database_url(RENDER_TEST_NAMED_URL, timiq_env="test")


def test_timiq_env_not_test_is_refused() -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="TIMIQ_ENV"):
        validate_test_database_url(SAFE_TEST_URL, timiq_env="production")


def test_missing_test_database_url_for_postgres_pytest_is_refused() -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="TEST_DATABASE_URL"):
        enforce_pytest_database_guard(
            {
                "TIMIQ_ENV": "test",
                "DATABASE_URL": PRODUCTION_STYLE_URL,
            }
        )


def test_timiq_test_local_with_timiq_env_test_is_accepted() -> None:
    selected = validate_test_database_url(SAFE_TEST_URL, timiq_env="test")
    assert selected == SAFE_TEST_URL


def test_explicit_sqlite_alembic_url_is_kept() -> None:
    sqlite_url = "sqlite:///C:/tmp/timiq_guard_migration_test.db"
    resolved = resolve_alembic_sqlalchemy_url(
        sqlite_url,
        environ={
            "TIMIQ_ENV": "test",
            "PYTEST_VERSION": "1",
            "DATABASE_URL": PRODUCTION_STYLE_URL,
            "TEST_DATABASE_URL": SAFE_TEST_URL,
        },
        settings_database_url=PRODUCTION_STYLE_URL,
    )
    assert resolved == sqlite_url
    assert resolved.startswith("sqlite:")


def test_explicit_test_alembic_url_is_not_replaced_by_database_url() -> None:
    explicit = "postgresql+psycopg://timiq_test:pw@127.0.0.1:5432/timiq_test_migrations"
    resolved = resolve_alembic_sqlalchemy_url(
        explicit,
        environ={
            "TIMIQ_ENV": "test",
            "PYTEST_VERSION": "1",
            "DATABASE_URL": PRODUCTION_STYLE_URL,
            "TEST_DATABASE_URL": SAFE_TEST_URL,
        },
        settings_database_url=PRODUCTION_STYLE_URL,
    )
    assert resolved == explicit
    assert "timiq_test_migrations" in resolved
    assert "oregon-postgres.render.com" not in resolved


def test_production_database_url_present_uses_test_database_url_only() -> None:
    env = {
        "TIMIQ_ENV": "test",
        "DATABASE_URL": PRODUCTION_STYLE_URL,
        "TEST_DATABASE_URL": SAFE_TEST_URL,
    }
    selected = enforce_pytest_database_guard(env)
    assert selected == SAFE_TEST_URL
    assert env["DATABASE_URL"] == SAFE_TEST_URL
    assert "render.com" not in selected
    assert selected.endswith("/timiq_test_local")


def test_pytest_guard_pins_process_database_url_over_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIMIQ_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", PRODUCTION_STYLE_URL)
    monkeypatch.setenv("TEST_DATABASE_URL", SAFE_TEST_URL)
    selected = enforce_pytest_database_guard()
    assert selected == SAFE_TEST_URL
    assert os.environ["DATABASE_URL"] == SAFE_TEST_URL
    assert os.environ["TEST_DATABASE_URL"] == SAFE_TEST_URL
    assert PRODUCTION_STYLE_URL not in os.environ["DATABASE_URL"]
    assert "super-secret-prod-password" not in os.environ["DATABASE_URL"]
    assert os.environ["DATABASE_URL"].endswith("/timiq_test_local")


def test_later_dotenv_does_not_replace_pinned_test_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("TIMIQ_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", PRODUCTION_STYLE_URL)
    monkeypatch.setenv("TEST_DATABASE_URL", SAFE_TEST_URL)
    enforce_pytest_database_guard()
    fake_env = tmp_path / ".env"
    fake_env.write_text(
        f"DATABASE_URL={PRODUCTION_STYLE_URL}\n",
        encoding="utf-8",
    )
    loaded = load_dotenv(fake_env, override=False)
    assert loaded is True
    assert os.environ["DATABASE_URL"] == SAFE_TEST_URL
    assert "super-secret-prod-password" not in os.environ["DATABASE_URL"]


def test_get_database_url_uses_test_url_not_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIMIQ_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", PRODUCTION_STYLE_URL)
    monkeypatch.setenv("TEST_DATABASE_URL", SAFE_TEST_URL)
    enforce_pytest_database_guard()
    resolved = get_database_url()
    assert resolved == SAFE_TEST_URL
    assert resolved.endswith("/timiq_test_local")
    assert "timiq_test_local" in resolved
    assert not resolved.rstrip("/").endswith("/timiq")


def test_password_never_appears_in_error_output() -> None:
    secret = "super-secret-prod-password"
    with pytest.raises(UnsafeTestDatabaseError) as raised:
        validate_test_database_url(PRODUCTION_STYLE_URL, timiq_env="test")
    message = str(raised.value)
    assert secret not in message
    assert "s3cret-does-not-leak" not in message
    redacted = redact_database_url(PRODUCTION_STYLE_URL)
    assert secret not in redacted
    assert "dpg-aaaa1111bbbb-a" not in redacted
    assert "database=timiq" in redacted


def test_destructive_migration_helper_rejects_unsafe_target() -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="REFUSING TO RUN TESTS"):
        assert_safe_destructive_migration_target(
            PRODUCTION_STYLE_URL,
            environ={"TIMIQ_ENV": "test", "PYTEST_VERSION": "1"},
        )


def test_destructive_migration_helper_accepts_safe_target() -> None:
    assert (
        assert_safe_destructive_migration_target(
            SAFE_TEST_URL,
            environ={"TIMIQ_ENV": "test", "PYTEST_VERSION": "1"},
        )
        == SAFE_TEST_URL
    )


def test_placeholder_alembic_url_uses_test_database_url_not_settings() -> None:
    resolved = resolve_alembic_sqlalchemy_url(
        "driver://user:pass@localhost/dbname",
        environ={
            "TIMIQ_ENV": "test",
            "PYTEST_VERSION": "1",
            "DATABASE_URL": PRODUCTION_STYLE_URL,
            "TEST_DATABASE_URL": SAFE_TEST_URL,
        },
        settings_database_url=PRODUCTION_STYLE_URL,
    )
    assert resolved == SAFE_TEST_URL


def test_pure_pytest_without_database_urls_is_allowed() -> None:
    assert enforce_pytest_database_guard({"TIMIQ_ENV": "local"}) is None


def test_alembic_without_test_url_in_test_env_refuses_database_url_fallback() -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="TEST_DATABASE_URL"):
        resolve_alembic_sqlalchemy_url(
            "driver://user:pass@localhost/dbname",
            environ={
                "TIMIQ_ENV": "test",
                "PYTEST_VERSION": "1",
                "DATABASE_URL": PRODUCTION_STYLE_URL,
            },
            settings_database_url=PRODUCTION_STYLE_URL,
        )
