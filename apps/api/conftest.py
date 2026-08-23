"""Central pytest hooks. Database guards must not open a connection here."""

from __future__ import annotations

from app.testing.database_safety import enforce_pytest_database_guard


def pytest_configure() -> None:
    """Fail closed before collection when a PostgreSQL URL is in the environment."""
    enforce_pytest_database_guard()
