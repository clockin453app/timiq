"""Placeholder temporary passwords must be rejected by API validators."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.modules.auth.schemas import AdminCreateUserRequest, UserPasswordResetRequest


@pytest.mark.parametrize("password", ["Admin12345", "Employee12345", "password123"])
def test_admin_create_rejects_placeholder_passwords(password: str) -> None:
    with pytest.raises(ValidationError):
        AdminCreateUserRequest(
            email="new.user@example.com",
            password=password,
            system_role="employee",
            is_active=True,
        )


@pytest.mark.parametrize("password", ["Admin12345", "Employee12345"])
def test_admin_reset_rejects_placeholder_passwords(password: str) -> None:
    with pytest.raises(ValidationError):
        UserPasswordResetRequest(password=password)


def test_admin_create_accepts_strong_temporary_password() -> None:
    payload = AdminCreateUserRequest(
        email="new.user@example.com",
        password="SecureTempPass92",
        system_role="employee",
        is_active=True,
    )
    assert payload.password == "SecureTempPass92"
