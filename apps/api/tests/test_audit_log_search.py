"""Audit log search over visible names/emails and sanitized responses."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import postgresql

from app.modules.audit.repository import list_audit_events_filtered
from app.modules.audit.service import list_audit_events_for_user
from app.modules.auth.models import SystemRole


def _actor(role: SystemRole, company_id: uuid.UUID | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), system_role=role, company_id=company_id)


def _compiled_for_search(search: str, *, viewer: SimpleNamespace | None = None) -> tuple[str, dict[str, object]]:
    db = MagicMock()
    db.scalar.return_value = 0
    db.scalars.return_value.all.return_value = []
    list_audit_events_filtered(
        db,
        viewer=viewer or _actor(SystemRole.ADMINISTRATOR),
        date_from=None,
        date_to=None,
        actor_user_id=None,
        subject_user_id=None,
        company_id_filter=None,
        action_contains=None,
        entity_type_contains=None,
        search=search,
        limit=50,
        offset=0,
    )
    stmt = db.scalars.call_args.args[0]
    compiled = stmt.compile(dialect=postgresql.dialect())
    return str(compiled).lower(), dict(compiled.params)


def _sql_for_search(search: str, *, viewer: SimpleNamespace | None = None) -> str:
    return _compiled_for_search(search, viewer=viewer)[0]


def test_search_by_action_still_uses_action_predicate() -> None:
    sql = _sql_for_search("Payroll item edited")
    assert "audit_events.action ilike" in sql


def test_search_by_actor_name_uses_actor_profile_names() -> None:
    sql = _sql_for_search("Petre Rotaru")
    assert "employee_profiles" in sql
    assert "first_name" in sql
    assert "last_name" in sql


def test_search_by_actor_email_uses_actor_email() -> None:
    sql = _sql_for_search("stelianrotaru94@gmail.com")
    assert "users" in sql
    assert "email ilike" in sql


def test_search_by_subject_name_uses_subject_profile_names() -> None:
    sql, params = _compiled_for_search("Petre Rotaru")
    assert "owner_user_id" in params.values()
    assert "subject_user_id" in params.values()
    assert "user_id" in params.values()
    assert "employee_profiles" in sql
    assert "first_name" in sql
    assert "last_name" in sql


def test_search_by_subject_email_uses_subject_email() -> None:
    sql, params = _compiled_for_search("employee@example.com")
    assert "owner_user_id" in params.values()
    assert "subject_user_id" in params.values()
    assert "email ilike" in sql


def test_search_by_company_name_uses_company_name() -> None:
    sql = _sql_for_search("New Era Brickwork")
    assert "companies" in sql
    assert "name ilike" in sql


def test_company_admin_search_keeps_company_scope() -> None:
    company_id = uuid.uuid4()
    sql = _sql_for_search("Other Company", viewer=_actor(SystemRole.ADMIN, company_id))
    assert "audit_events.company_id = " in sql
    assert "companies" in sql


def test_sensitive_fields_remain_redacted_in_audit_response() -> None:
    company_id = uuid.uuid4()
    actor = _actor(SystemRole.ADMIN, company_id)
    event = SimpleNamespace(
        id=uuid.uuid4(),
        created_at=datetime(2026, 5, 18, tzinfo=timezone.utc),
        action="face_reference.viewed",
        entity_type="employee_profile",
        entity_id=str(uuid.uuid4()),
        actor_user_id=actor.id,
        company_id=company_id,
        details={
            "subject_user_id": str(uuid.uuid4()),
            "storage_path": "r2://private-bucket/faces/ref.jpg",
            "reset_token": "secret",
            "safe_note": "Face reference viewed",
        },
    )
    with (
        patch("app.modules.audit.service.list_audit_events_filtered", return_value=([event], 1)),
        patch("app.modules.audit.service.get_user_by_id", return_value=None),
        patch("app.modules.audit.service.get_company_by_id", return_value=SimpleNamespace(name="New Era Brickwork")),
    ):
        response = list_audit_events_for_user(
            MagicMock(),
            actor,
            date_from=None,
            date_to=None,
            actor_user_id=None,
            subject_user_id=None,
            company_id=None,
            action_contains=None,
            entity_type_contains=None,
            search="Face Reference Viewed",
            limit=50,
            offset=0,
        )
    details = response.items[0].details
    assert details["storage_path"] == "[redacted]"
    assert details["reset_token"] == "[redacted]"
    assert details["safe_note"] == "Face reference viewed"
