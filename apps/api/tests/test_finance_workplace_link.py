"""Workplace -> Finance project association service tests (no LIVE DB writes)."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import create_mock_engine

from app.modules.finance.ledger_service import FinanceLedgerError
from app.modules.finance.workplace_link import (
    dry_run_workplace_initialize,
    initialize_finance_project_from_workplace,
    list_project_links,
)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def first(self):
        return self._rows[0] if self._rows else None

    def __iter__(self):
        return iter(self._rows)


class _Session:
    def __init__(self, handlers):
        self.handlers = handlers
        self.executed = []
        self.commits = 0

    def execute(self, statement, params=None):
        sql = str(statement)
        self.executed.append((sql, params or {}))
        for prefix, fn in self.handlers:
            if prefix in sql:
                return _Result(fn(params or {}))
        raise AssertionError(f"Unhandled SQL: {sql}")


def test_list_project_links_marks_linked_and_unlinked():
    company_id = uuid4()
    workplace_a = uuid4()
    workplace_b = uuid4()
    project_a = uuid4()
    project_orphan = uuid4()

    def projects(_):
        return [
            {
                "id": project_a,
                "name": "Site A",
                "reference_code": "A1",
                "status": "active",
                "notes": None,
                "workplace_id": workplace_a,
            },
            {
                "id": project_orphan,
                "name": "Manual Finance Only",
                "reference_code": None,
                "status": "active",
                "notes": None,
                "workplace_id": None,
            },
        ]

    def workplaces(_):
        return [
            {"id": workplace_a, "name": "Site A", "code": "A1", "is_active": True},
            {"id": workplace_b, "name": "Site B", "code": "B1", "is_active": True},
            {"id": uuid4(), "name": "Old Site", "code": "OLD", "is_active": False},
        ]

    session = _Session(
        [
            ("FROM finance_projects", projects),
            ("FROM workplaces", workplaces),
        ]
    )
    payload = list_project_links(session, company_id=company_id)
    assert payload["company_id"] == str(company_id)
    linked = [row for row in payload["finance_projects"] if row["link_status"] == "LINKED"]
    unlinked_finance = [row for row in payload["finance_projects"] if row["link_status"] == "NOT LINKED"]
    assert len(linked) == 1
    assert unlinked_finance[0]["name"] == "Manual Finance Only"
    available = payload["unlinked_active_workplaces"]
    assert len(available) == 1
    assert available[0]["name"] == "Site B"


def test_dry_run_skips_inactive_and_reports_existing():
    company_id = uuid4()
    linked_wp = uuid4()
    active_wp = uuid4()
    inactive_wp = uuid4()
    project_id = uuid4()

    def projects(_):
        return [
            {
                "id": project_id,
                "name": "Linked",
                "reference_code": "L1",
                "status": "active",
                "notes": None,
                "workplace_id": linked_wp,
            }
        ]

    def workplaces(_):
        return [
            {"id": linked_wp, "name": "Linked", "code": "L1", "is_active": True},
            {"id": active_wp, "name": "Ready", "code": "R1", "is_active": True},
            {"id": inactive_wp, "name": "Inactive", "code": "I1", "is_active": False},
        ]

    session = _Session(
        [
            ("FROM finance_projects", projects),
            ("FROM workplaces", workplaces),
        ]
    )
    report = dry_run_workplace_initialize(session, company_id=company_id)
    assert report["mode"] == "DRY_RUN"
    assert report["writable"] is False
    assert len(report["already_linked"]) == 1
    assert len(report["would_create"]) == 1
    assert report["would_create"][0]["workplace_id"] == str(active_wp)
    assert report["would_create"][0]["contract_value"] is None
    assert report["would_create"][0]["imports"] == []
    assert len(report["skipped_inactive"]) == 1


def test_initialize_rejects_wrong_company_and_inactive():
    company_id = uuid4()
    other_company = uuid4()
    workplace_id = uuid4()

    def workplaces(params):
        return [
            {
                "id": params["workplace_id"],
                "company_id": other_company,
                "name": "Other Co Site",
                "code": "X",
                "is_active": True,
            }
        ]

    session = _Session([("FROM workplaces WHERE id", workplaces)])
    with pytest.raises(FinanceLedgerError) as exc:
        initialize_finance_project_from_workplace(
            session,
            company_id=company_id,
            actor_user_id=uuid4(),
            workplace_id=workplace_id,
        )
    assert exc.value.code == "COMPANY_MISMATCH"

    def inactive(params):
        return [
            {
                "id": params["workplace_id"],
                "company_id": company_id,
                "name": "Inactive",
                "code": "I",
                "is_active": False,
            }
        ]

    session2 = _Session([("FROM workplaces WHERE id", inactive)])
    with pytest.raises(FinanceLedgerError) as exc2:
        initialize_finance_project_from_workplace(
            session2,
            company_id=company_id,
            actor_user_id=uuid4(),
            workplace_id=workplace_id,
        )
    assert exc2.value.code == "INACTIVE_WORKPLACE"


def test_initialize_is_idempotent_when_already_linked(monkeypatch: pytest.MonkeyPatch):
    company_id = uuid4()
    workplace_id = uuid4()
    project_id = uuid4()

    def workplaces(params):
        return [
            {
                "id": params["workplace_id"],
                "company_id": company_id,
                "name": "Site",
                "code": "S1",
                "is_active": True,
            }
        ]

    def existing(_params):
        return [
            {
                "id": project_id,
                "name": "Site",
                "reference_code": "S1",
                "status": "active",
                "workplace_id": workplace_id,
            }
        ]

    session = _Session(
        [
            ("FROM workplaces WHERE id", workplaces),
            ("FROM finance_projects", existing),
        ]
    )
    result = initialize_finance_project_from_workplace(
        session,
        company_id=company_id,
        actor_user_id=uuid4(),
        workplace_id=workplace_id,
    )
    assert result["created"] is False
    assert result["id"] == str(project_id)
    assert result["link_status"] == "LINKED"


def test_initialize_missing_workplace():
    session = _Session([("FROM workplaces WHERE id", lambda _p: [])])
    with pytest.raises(FinanceLedgerError) as exc:
        initialize_finance_project_from_workplace(
            session,
            company_id=uuid4(),
            actor_user_id=uuid4(),
            workplace_id=uuid4(),
        )
    assert exc.value.code == "NOT_FOUND"


def test_migration_is_additive_and_follows_current_head():
    from importlib import import_module
    from pathlib import Path

    migration = import_module("migrations.versions.b8c9d0e1f2a3_finance_project_workplace_link")
    assert migration.revision == "b8c9d0e1f2a3"
    assert migration.down_revision == "a7c8d9e0f1a2"
    source = Path(__file__).resolve().parents[1] / "migrations/versions/b8c9d0e1f2a3_finance_project_workplace_link.py"
    text = source.read_text(encoding="utf-8")
    assert "op.add_column" in text
    assert "workplace_id" in text
    assert "uq_finance_projects_company_workplace" in text

def test_initialize_approved_dry_run_default_does_not_insert():
    company_id = uuid4()
    workplace_id = uuid4()
    session = _Session(
        [
            ("FROM finance_projects WHERE company_id", lambda _: []),
            (
                "FROM workplaces WHERE company_id",
                lambda _: [
                    {"id": workplace_id, "name": "Site", "code": "S1", "is_active": True}
                ],
            ),
        ]
    )
    from app.modules.finance.workplace_link import initialize_approved_workplaces

    result = initialize_approved_workplaces(
        session,
        company_id=company_id,
        actor_user_id=None,
        workplace_ids=[workplace_id],
        dry_run=True,
    )
    assert result["executed"] is False
    assert result["mode"] == "DRY_RUN"
    assert len(result["plan"]["would_create"]) == 1
    assert not any("INSERT INTO finance_projects" in sql for sql, _ in session.executed)


def test_initialize_integrity_error_returns_existing_idempotently(monkeypatch):
    company_id = uuid4()
    workplace_id = uuid4()
    existing_id = uuid4()
    from sqlalchemy.exc import IntegrityError
    import app.modules.finance.workplace_link as wl

    def workplace_lookup(_):
        return [
            {
                "id": workplace_id,
                "company_id": company_id,
                "name": "Site",
                "code": "S1",
                "is_active": True,
            }
        ]

    calls = {"select": 0}

    def existing_lookup(_):
        calls["select"] += 1
        if calls["select"] == 1:
            return []
        return [
            {
                "id": existing_id,
                "name": "Site",
                "reference_code": "S1",
                "status": "active",
                "workplace_id": workplace_id,
            }
        ]

    class _RaceSession(_Session):
        def begin_nested(self):
            class _Nested:
                def __enter__(self_inner):
                    return self_inner

                def __exit__(self_inner, exc_type, exc, tb):
                    return False

            return _Nested()

    session = _RaceSession(
        [
            ("FROM workplaces WHERE id", workplace_lookup),
            ("FROM finance_projects", existing_lookup),
        ]
    )

    def boom(*_a, **_k):
        raise IntegrityError("INSERT", {}, Exception("unique"))

    monkeypatch.setattr(wl, "_insert", boom)
    result = wl.initialize_finance_project_from_workplace(
        session,
        company_id=company_id,
        actor_user_id=None,
        workplace_id=workplace_id,
    )
    assert result["created"] is False
    assert result["id"] == str(existing_id)
    assert result["link_status"] == "LINKED"

def test_init_audit_action_fits_schema_limit():
    from app.modules.finance.audit import AUDIT_ACTION_LIMIT

    action = "project_init_workplace"
    assert len(action) <= AUDIT_ACTION_LIMIT
    assert len("project_initialized_from_workplace") > AUDIT_ACTION_LIMIT


def test_initialize_writes_short_audit_action(monkeypatch):
    """Ensure initialize records an audit action that fits String(32)."""
    from uuid import uuid4
    import app.modules.finance.workplace_link as wl
    from app.modules.finance.audit import AUDIT_ACTION_LIMIT

    company_id = uuid4()
    workplace_id = uuid4()
    captured = {}

    def workplace_lookup(_):
        return [{
            "id": workplace_id,
            "company_id": company_id,
            "name": "Kennington",
            "code": "0001",
            "is_active": True,
        }]

    class _S(_Session):
        def begin_nested(self):
            class _N:
                def __enter__(self_inner):
                    return self_inner
                def __exit__(self_inner, exc_type, exc, tb):
                    return False
            return _N()

    session = _S([
        ("FROM workplaces WHERE id", workplace_lookup),
        ("FROM finance_projects", lambda _: []),
    ])

    def fake_insert(db, statement, params):
        captured["insert"] = params

    def fake_event(db, **kwargs):
        captured["event"] = kwargs
        assert len(kwargs["action"]) <= AUDIT_ACTION_LIMIT

    monkeypatch.setattr(wl, "_insert", fake_insert)
    monkeypatch.setattr(wl, "_event", fake_event)

    result = wl.initialize_finance_project_from_workplace(
        session,
        company_id=company_id,
        actor_user_id=None,
        workplace_id=workplace_id,
    )
    assert result["created"] is True
    assert captured["event"]["action"] == "project_init_workplace"
    assert len(captured["event"]["action"]) <= AUDIT_ACTION_LIMIT

