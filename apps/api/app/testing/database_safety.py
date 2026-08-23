"""Fail-closed database URL guards for pytest and Alembic.

This module never opens a database connection. It only parses URL strings.

Alembic URL precedence (implemented in migrations/env.py):

1. Explicit Alembic Config ``sqlalchemy.url`` when it is not the alembic.ini
   placeholder. SQLite is kept as-is. PostgreSQL must pass test-target checks
   when running under pytest or TIMIQ_ENV=test.
2. Else if TIMIQ_ENV=test or pytest: require ``TEST_DATABASE_URL``. Never fall
   back to ``DATABASE_URL``.
3. Else (operator / deploy migration): Settings ``DATABASE_URL``.

There is no pytest switch that allows targeting production.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping, MutableMapping
from urllib.parse import unquote, urlparse

from sqlalchemy.engine.url import make_url

TEST_ENV_NAME = "test"
TEST_DATABASE_NAME_RE = re.compile(r"^timiq_test_[A-Za-z0-9_]+$")
ALEMBIC_PLACEHOLDER_URLS = frozenset(
    {
        "",
        "driver://user:pass@localhost/dbname",
        "postgresql://user:pass@localhost/dbname",
    }
)
_PRODUCTION_HOST_SUFFIXES = (".render.com", ".onrender.com")
_PRODUCTION_HOSTS = frozenset({"render.com", "onrender.com"})
_PRODUCTION_DB_NAMES = frozenset({"timiq", "postgres", "template0", "template1"})


class UnsafeTestDatabaseError(RuntimeError):
    """Raised when tests or test migrations would use an unsafe database target."""


def running_under_pytest(environ: Mapping[str, str] | None = None) -> bool:
    env = os.environ if environ is None else environ
    return bool(env.get("PYTEST_VERSION") or env.get("PYTEST_CURRENT_TEST"))


def current_timiq_env(environ: Mapping[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    return (env.get("TIMIQ_ENV") or env.get("APP_ENV") or "").strip()


def is_sqlite_url(url: str) -> bool:
    return (url or "").strip().startswith("sqlite:")


def is_placeholder_alembic_url(url: str | None) -> bool:
    return (url or "").strip() in ALEMBIC_PLACEHOLDER_URLS


def _parse_url(url: str):
    try:
        return make_url(url)
    except Exception as exc:
        raise UnsafeTestDatabaseError(
            "REFUSING TO RUN TESTS: TEST_DATABASE_URL is not a dedicated TimIQ test database "
            "(the URL could not be parsed)."
        ) from exc


def database_name_from_url(url: str) -> str:
    if is_sqlite_url(url):
        parsed = urlparse(url)
        path = unquote(parsed.path or "").rstrip("/")
        return path.rsplit("/", 1)[-1] if path else ":memory:"
    return (_parse_url(url).database or "").strip()


def hostname_from_url(url: str) -> str:
    if is_sqlite_url(url):
        return ""
    return (_parse_url(url).host or "").strip().lower().rstrip(".")


def _redact_host(host: str) -> str:
    if not host:
        return "(empty-host)"
    if host in {"localhost", "127.0.0.1", "::1"}:
        return host
    labels = host.split(".")
    if len(labels) == 1:
        return labels[0][:1] + "***"
    return "***." + ".".join(labels[1:])


def redact_database_url(url: str) -> str:
    """Host/database diagnostics with no password and no full URL."""
    try:
        if is_sqlite_url(url):
            return f"sqlite database={database_name_from_url(url) or 'unnamed'}"
        parsed = _parse_url(url)
        host = _redact_host((parsed.host or "unknown-host").strip())
        name = (parsed.database or "unknown-db").strip()
        return f"driver={parsed.drivername} host={host} database={name}"
    except Exception:
        return "unparseable-database-url"


def is_production_host(host: str) -> bool:
    hostname = (host or "").strip().lower().rstrip(".")
    if not hostname:
        return False
    if hostname in _PRODUCTION_HOSTS:
        return True
    return any(hostname.endswith(suffix) for suffix in _PRODUCTION_HOST_SUFFIXES)


def is_allowed_test_database_name(name: str) -> bool:
    return bool(TEST_DATABASE_NAME_RE.fullmatch((name or "").strip()))


def _refuse(reason: str, url: str | None = None) -> UnsafeTestDatabaseError:
    suffix = f" ({redact_database_url(url)})" if url else ""
    return UnsafeTestDatabaseError(
        "REFUSING TO RUN TESTS: TEST_DATABASE_URL is not a dedicated TimIQ test database. "
        + reason
        + suffix
    )


def validate_test_database_url(url: str, *, timiq_env: str) -> str:
    """Accept isolated SQLite or PostgreSQL ``timiq_test_*`` URLs only."""
    candidate = (url or "").strip()
    if not candidate:
        raise _refuse("TEST_DATABASE_URL is missing.")

    if is_sqlite_url(candidate):
        return candidate

    if (timiq_env or "").strip().lower() != TEST_ENV_NAME:
        raise _refuse(
            f"TIMIQ_ENV must be '{TEST_ENV_NAME}' "
            f"(current TIMIQ_ENV={timiq_env or '(unset)'}).",
            candidate,
        )

    parsed = _parse_url(candidate)
    dialect = (parsed.drivername or "").split("+", 1)[0].lower()
    if dialect not in {"postgresql", "postgres"}:
        raise _refuse("TEST_DATABASE_URL must be sqlite or postgresql.", candidate)

    if is_production_host(hostname_from_url(candidate)):
        raise _refuse("Render/production database hosts are not allowed for tests.", candidate)

    name = database_name_from_url(candidate)
    if not name or name.lower() in _PRODUCTION_DB_NAMES or not is_allowed_test_database_name(name):
        raise _refuse(
            "PostgreSQL test database name must match timiq_test_* "
            "(for example timiq_test_local), not a production-like name.",
            candidate,
        )
    return candidate


def select_pytest_database_url(environ: Mapping[str, str] | None = None) -> str | None:
    """URL pytest may use, or None when no database is configured (pure tests).

    Never returns ``DATABASE_URL`` for PostgreSQL.
    """
    env = os.environ if environ is None else environ
    timiq_env = current_timiq_env(env)
    test_url = (env.get("TEST_DATABASE_URL") or "").strip()
    database_url = (env.get("DATABASE_URL") or "").strip()

    if timiq_env.lower() in {"production", "prod"}:
        raise UnsafeTestDatabaseError(
            "REFUSING TO RUN TESTS: TIMIQ_ENV is production. Pytest must not run against production."
        )

    if test_url:
        return validate_test_database_url(test_url, timiq_env=timiq_env)

    if database_url and not is_sqlite_url(database_url):
        raise UnsafeTestDatabaseError(
            "REFUSING TO RUN TESTS: TEST_DATABASE_URL is not a dedicated TimIQ test database. "
            "PostgreSQL pytest must set TIMIQ_ENV=test and TEST_DATABASE_URL; "
            "DATABASE_URL is never used as a fallback. "
            f"({redact_database_url(database_url)})"
        )

    if database_url and is_sqlite_url(database_url):
        if timiq_env.lower() not in {"", TEST_ENV_NAME, "local"}:
            raise _refuse(f"TIMIQ_ENV={timiq_env} is not valid for pytest sqlite DATABASE_URL.")
        return database_url

    return None


def _mutable_environ(environ: Mapping[str, str] | None) -> MutableMapping[str, str] | None:
    if environ is None:
        return os.environ
    if isinstance(environ, MutableMapping):
        return environ
    return None


def pin_pytest_process_to_test_database(
    validated_url: str,
    *,
    environ: Mapping[str, str] | None = None,
) -> None:
    """Overwrite DATABASE_URL in this process with the already-validated test URL.

    Does not log the previous value. Does not connect.
    """
    target = _mutable_environ(environ)
    if target is None:
        return
    target["DATABASE_URL"] = validated_url


def enforce_pytest_database_guard(environ: Mapping[str, str] | None = None) -> str | None:
    """Pytest startup hook. Does not connect.

    When a validated test URL is selected, DATABASE_URL in this process is
    overwritten with that URL before collection so getenv("DATABASE_URL") cannot
    still point at production.
    """
    selected = select_pytest_database_url(environ)
    if selected:
        pin_pytest_process_to_test_database(selected, environ=environ)
    return selected


def assert_safe_destructive_migration_target(
    url: str,
    *,
    environ: Mapping[str, str] | None = None,
) -> str:
    """Fail-closed check immediately before upgrade/downgrade/stamp/create/drop."""
    candidate = (url or "").strip()
    env = os.environ if environ is None else environ
    if is_sqlite_url(candidate):
        return candidate
    if running_under_pytest(env) or current_timiq_env(env).lower() == TEST_ENV_NAME:
        return validate_test_database_url(candidate, timiq_env=current_timiq_env(env))
    return candidate


def resolve_alembic_sqlalchemy_url(
    config_url: str | None,
    *,
    environ: Mapping[str, str] | None = None,
    settings_database_url: str | None = None,
) -> str:
    """Choose the Alembic SQLAlchemy URL without connecting."""
    env = os.environ if environ is None else environ
    explicit = (config_url or "").strip()
    test_mode = running_under_pytest(env) or current_timiq_env(env).lower() == TEST_ENV_NAME

    if explicit and not is_placeholder_alembic_url(explicit):
        if is_sqlite_url(explicit):
            return explicit
        if test_mode:
            return assert_safe_destructive_migration_target(explicit, environ=env)
        return explicit

    if test_mode:
        test_url = (env.get("TEST_DATABASE_URL") or "").strip()
        if not test_url:
            raise UnsafeTestDatabaseError(
                "REFUSING TO RUN TESTS: TEST_DATABASE_URL is not a dedicated TimIQ test database. "
                "Alembic test migrations require TEST_DATABASE_URL; DATABASE_URL is not used."
            )
        return validate_test_database_url(test_url, timiq_env=current_timiq_env(env))

    fallback = (settings_database_url or env.get("DATABASE_URL") or "").strip()
    if not fallback:
        raise UnsafeTestDatabaseError(
            "DATABASE_URL is missing for operator/deploy Alembic migrations."
        )
    return fallback


def alembic_test_subprocess_env(
    test_database_url: str,
    *,
    extra: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Environment for Alembic subprocesses spawned from pytest."""
    merged = os.environ.copy()
    merged["TIMIQ_ENV"] = TEST_ENV_NAME
    merged["TEST_DATABASE_URL"] = test_database_url
    if extra:
        merged.update(dict(extra))
    merged["TIMIQ_ENV"] = TEST_ENV_NAME
    merged["TEST_DATABASE_URL"] = test_database_url
    merged["DATABASE_URL"] = test_database_url
    assert_safe_destructive_migration_target(test_database_url, environ=merged)
    return merged
