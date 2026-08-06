"""Budget tasks and project notes phase 4 — service-level coverage (PostgreSQL)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.auth.security import hash_password
from app.modules.budgets.models import BudgetProject
from app.modules.budgets.schemas import (
    BudgetProjectNoteCreateRequest,
    BudgetProjectNotePatchRequest,
    BudgetTaskCreateRequest,
    BudgetTaskPatchRequest,
    BudgetTaskReopenRequest,
)
from app.modules.budgets.tasks_notes import (
    cancel_task,
    complete_task,
    create_note,
    create_task,
    delete_note,
    delete_task,
    get_task_summary,
    list_notes,
    list_tasks,
    patch_note,
    patch_task,
    pin_note,
    reopen_task,
    unpin_note,
)
from app.modules.companies.models import Company, CompanyTimePolicy
from app.modules.notifications.models import NotificationRecord

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_disposable_budget_tasks_phase4"


def _local_postgres_available() -> bool:
    try:
        eng = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _local_postgres_available(),
    reason="Local Postgres required for budget tasks/notes phase 4 tests",
)


@pytest.fixture()
def db_session() -> Session:
    admin = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"),
            {"n": DB_NAME},
        ).scalar()
        if exists:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    target_url = f"postgresql+psycopg://postgres:postgres@127.0.0.1:5432/{DB_NAME}"
    engine = create_engine(target_url)
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE budget_tasks
                  ADD CONSTRAINT ck_budget_tasks_status
                  CHECK (status IN ('to_do', 'in_progress', 'blocked', 'completed', 'cancelled'));
                ALTER TABLE budget_tasks
                  ADD CONSTRAINT ck_budget_tasks_priority
                  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
                ALTER TABLE budget_tasks
                  ADD CONSTRAINT ck_budget_tasks_category
                  CHECK (category IN ('general', 'client', 'site', 'purchase', 'labour', 'billing', 'compliance'));
                CREATE UNIQUE INDEX uq_budget_tasks_company_client_action
                  ON budget_tasks (company_id, client_action_id)
                  WHERE client_action_id IS NOT NULL;
                CREATE UNIQUE INDEX uq_budget_project_notes_company_client_action
                  ON budget_project_notes (company_id, client_action_id)
                  WHERE client_action_id IS NOT NULL;
                """
            )
        )
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        admin.dispose()


def _user(*, company_id: uuid.UUID | None, role: SystemRole, email: str | None = None) -> User:
    return User(
        id=uuid.uuid4(),
        email=email or f"{uuid.uuid4().hex[:8]}@ex.com",
        password_hash=hash_password("Password123!"),
        system_role=role,
        company_id=company_id,
        is_active=True,
    )


def _seed(session: Session) -> dict:
    company = Company(id=uuid.uuid4(), name=f"Task Co {uuid.uuid4().hex[:6]}", is_active=True)
    other = Company(id=uuid.uuid4(), name=f"Other {uuid.uuid4().hex[:6]}", is_active=True)
    session.add_all([company, other])
    session.flush()
    policy = CompanyTimePolicy(
        company_id=company.id,
        timezone_name="Europe/London",
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=15,
        rounding_mode="nearest",
        break_deduction_minutes=0,
        break_deduction_after_minutes=360,
    )
    admin = _user(company_id=company.id, role=SystemRole.ADMIN)
    peer_admin = _user(company_id=company.id, role=SystemRole.ADMIN, email=f"peer-{uuid.uuid4().hex[:6]}@ex.com")
    administrator = _user(company_id=None, role=SystemRole.ADMINISTRATOR)
    employee = _user(company_id=company.id, role=SystemRole.EMPLOYEE)
    other_admin = _user(company_id=other.id, role=SystemRole.ADMIN)
    budget = BudgetProject(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Job Tasks",
        description=None,
        workplace_id=None,
        location_id=None,
        client_name="Acme",
        reference_code="JT-1",
        status="active",
        start_date=date(2026, 1, 1),
        end_date=None,
        planned_budget_amount=10000.0,
        contract_value_net=None,
        billing_currency=None,
        notes=None,
        created_by_user_id=admin.id,
    )
    session.add_all([policy, admin, peer_admin, administrator, employee, other_admin, budget])
    session.commit()
    return {
        "company": company,
        "other": other,
        "admin": admin,
        "peer_admin": peer_admin,
        "administrator": administrator,
        "employee": employee,
        "other_admin": other_admin,
        "budget": budget,
    }


def _task_req(**kwargs) -> BudgetTaskCreateRequest:
    defaults = dict(
        client_action_id=uuid.uuid4(),
        title="Order materials",
        priority="normal",
        category="purchase",
    )
    defaults.update(kwargs)
    return BudgetTaskCreateRequest(**defaults)


def _note_req(**kwargs) -> BudgetProjectNoteCreateRequest:
    defaults = dict(
        client_action_id=uuid.uuid4(),
        body="Site access confirmed with client.",
    )
    defaults.update(kwargs)
    return BudgetProjectNoteCreateRequest(**defaults)


def test_create_and_idempotent_client_action_id(db_session: Session) -> None:
    world = _seed(db_session)
    action = uuid.uuid4()
    first = create_task(db_session, world["admin"], world["budget"].id, _task_req(client_action_id=action))
    second = create_task(db_session, world["admin"], world["budget"].id, _task_req(client_action_id=action, title="Other"))
    assert first.id == second.id
    assert second.title == "Order materials"


def test_status_transitions_complete_reopen_cancel_block(db_session: Session) -> None:
    world = _seed(db_session)
    task = create_task(db_session, world["admin"], world["budget"].id, _task_req())

    blocked = patch_task(
        db_session,
        world["admin"],
        world["budget"].id,
        task.id,
        BudgetTaskPatchRequest(status="blocked"),
    )
    assert blocked.status == "blocked"
    actions = {
        r.action
        for r in db_session.scalars(select(AuditEvent).where(AuditEvent.entity_id == str(task.id))).all()
    }
    assert "budget.task_blocked" in actions

    progress = patch_task(
        db_session,
        world["admin"],
        world["budget"].id,
        task.id,
        BudgetTaskPatchRequest(status="in_progress"),
    )
    assert progress.status == "in_progress"

    done = complete_task(db_session, world["admin"], world["budget"].id, task.id)
    assert done.status == "completed"
    assert done.completed_at is not None

    reopened = reopen_task(
        db_session,
        world["admin"],
        world["budget"].id,
        task.id,
        BudgetTaskReopenRequest(target_status="in_progress"),
    )
    assert reopened.status == "in_progress"
    assert reopened.completed_at is None

    cancelled = cancel_task(db_session, world["admin"], world["budget"].id, task.id)
    assert cancelled.status == "cancelled"
    assert cancelled.cancelled_at is not None

    to_do = reopen_task(
        db_session,
        world["admin"],
        world["budget"].id,
        task.id,
        BudgetTaskReopenRequest(target_status="to_do"),
    )
    assert to_do.status == "to_do"
    assert to_do.cancelled_at is None

    with pytest.raises(HTTPException) as exc:
        reopen_task(
            db_session,
            world["admin"],
            world["budget"].id,
            task.id,
            BudgetTaskReopenRequest(target_status="to_do"),
        )
    assert exc.value.status_code == 409


def test_overdue_ordering_and_summary(db_session: Session) -> None:
    world = _seed(db_session)
    today = date.today()
    overdue = create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(title="Overdue", due_date=today - timedelta(days=2), priority="low"),
    )
    urgent = create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(title="Urgent", due_date=today + timedelta(days=5), priority="urgent"),
    )
    create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(title="Normal later", due_date=today + timedelta(days=10), priority="normal"),
    )
    done = create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(title="Done", due_date=today - timedelta(days=1)),
    )
    complete_task(db_session, world["admin"], world["budget"].id, done.id)

    listed = list_tasks(db_session, world["admin"], world["budget"].id, include_completed=True)
    titles = [t.title for t in listed]
    assert titles[0] == "Overdue"
    assert titles[1] == "Urgent"
    assert titles[-1] == "Done"
    assert overdue.is_overdue is True
    assert urgent.is_overdue is False

    overdue_only = list_tasks(db_session, world["admin"], world["budget"].id, overdue=True)
    assert [t.title for t in overdue_only] == ["Overdue"]

    summary = get_task_summary(db_session, world["admin"], world["budget"].id)
    assert summary.outstanding == 3
    assert summary.overdue == 1
    assert summary.completed == 1


def test_assignee_rejects_employee_and_other_company(db_session: Session) -> None:
    world = _seed(db_session)
    with pytest.raises(HTTPException) as emp_exc:
        create_task(
            db_session,
            world["admin"],
            world["budget"].id,
            _task_req(assignee_user_id=world["employee"].id),
        )
    assert emp_exc.value.status_code == 422

    with pytest.raises(HTTPException) as other_exc:
        create_task(
            db_session,
            world["admin"],
            world["budget"].id,
            _task_req(assignee_user_id=world["other_admin"].id),
        )
    assert other_exc.value.status_code == 422

    ok = create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(assignee_user_id=world["peer_admin"].id),
    )
    assert ok.assignee_user_id == world["peer_admin"].id
    assigned = {
        r.action
        for r in db_session.scalars(select(AuditEvent).where(AuditEvent.entity_id == str(ok.id))).all()
    }
    assert "budget.task_assigned" in assigned


def test_employee_and_other_admin_denied(db_session: Session) -> None:
    world = _seed(db_session)
    with pytest.raises(HTTPException) as emp_exc:
        list_tasks(db_session, world["employee"], world["budget"].id)
    assert emp_exc.value.status_code == 403

    with pytest.raises(HTTPException) as other_exc:
        create_task(db_session, world["other_admin"], world["budget"].id, _task_req())
    assert other_exc.value.status_code == 403


def test_delete_todo_only_not_completed(db_session: Session) -> None:
    world = _seed(db_session)
    todo = create_task(db_session, world["admin"], world["budget"].id, _task_req(title="Delete me"))
    delete_task(db_session, world["admin"], world["budget"].id, todo.id)

    done = create_task(db_session, world["admin"], world["budget"].id, _task_req(title="Keep"))
    complete_task(db_session, world["admin"], world["budget"].id, done.id)
    with pytest.raises(HTTPException) as exc:
        delete_task(db_session, world["admin"], world["budget"].id, done.id)
    assert exc.value.status_code == 409


def test_notes_pin_order_idempotency_and_delete(db_session: Session) -> None:
    world = _seed(db_session)
    older = create_note(
        db_session,
        world["admin"],
        world["budget"].id,
        _note_req(body="Older note"),
    )
    # Force older created_at
    from app.modules.budgets.models import BudgetProjectNote

    row = db_session.get(BudgetProjectNote, older.id)
    assert row is not None
    row.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    db_session.commit()

    action = uuid.uuid4()
    first = create_note(
        db_session,
        world["admin"],
        world["budget"].id,
        _note_req(client_action_id=action, body="Pinned candidate"),
    )
    second = create_note(
        db_session,
        world["admin"],
        world["budget"].id,
        _note_req(client_action_id=action, body="Ignored"),
    )
    assert first.id == second.id

    pinned = pin_note(db_session, world["admin"], world["budget"].id, first.id)
    assert pinned.is_pinned is True

    listed = list_notes(db_session, world["admin"], world["budget"].id)
    assert listed[0].id == first.id
    assert listed[0].is_pinned is True

    unpinned = unpin_note(db_session, world["admin"], world["budget"].id, first.id)
    assert unpinned.is_pinned is False

    patch_note(
        db_session,
        world["admin"],
        world["budget"].id,
        first.id,
        BudgetProjectNotePatchRequest(body="Updated body text"),
    )
    delete_note(db_session, world["admin"], world["budget"].id, first.id)
    deleted_audit = db_session.scalars(
        select(AuditEvent).where(AuditEvent.action == "budget.note_deleted")
    ).first()
    assert deleted_audit is not None
    assert deleted_audit.details.get("body_excerpt") == "Updated body text"


def test_create_complete_assign_creates_no_notifications(db_session: Session) -> None:
    from sqlalchemy import func

    world = _seed(db_session)
    assert db_session.scalar(select(func.count()).select_from(NotificationRecord)) == 0

    task = create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(assignee_user_id=world["peer_admin"].id),
    )
    complete_task(db_session, world["admin"], world["budget"].id, task.id)
    reopened = reopen_task(
        db_session,
        world["admin"],
        world["budget"].id,
        task.id,
        BudgetTaskReopenRequest(target_status="to_do"),
    )
    patch_task(
        db_session,
        world["admin"],
        world["budget"].id,
        reopened.id,
        BudgetTaskPatchRequest(assignee_user_id=world["admin"].id),
    )

    assert db_session.scalar(select(func.count()).select_from(NotificationRecord)) == 0


def test_include_completed_default_hides_terminal(db_session: Session) -> None:
    world = _seed(db_session)
    active = create_task(db_session, world["admin"], world["budget"].id, _task_req(title="Active"))
    done = create_task(db_session, world["admin"], world["budget"].id, _task_req(title="Done"))
    complete_task(db_session, world["admin"], world["budget"].id, done.id)

    default_list = list_tasks(db_session, world["admin"], world["budget"].id)
    assert [t.id for t in default_list] == [active.id]

    with_done = list_tasks(db_session, world["admin"], world["budget"].id, include_completed=True)
    assert {t.id for t in with_done} == {active.id, done.id}


def test_administrator_can_access(db_session: Session) -> None:
    world = _seed(db_session)
    task = create_task(db_session, world["administrator"], world["budget"].id, _task_req())
    listed = list_tasks(db_session, world["administrator"], world["budget"].id)
    assert listed[0].id == task.id

def test_completed_and_cancelled_not_overdue(db_session: Session) -> None:
    world = _seed(db_session)
    past = date.today() - timedelta(days=3)
    done = create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(title="Was overdue then done", due_date=past),
    )
    complete_task(db_session, world["admin"], world["budget"].id, done.id)
    done_view = list_tasks(db_session, world["admin"], world["budget"].id, include_completed=True)
    done_row = next(t for t in done_view if t.id == done.id)
    assert done_row.is_overdue is False

    cancelled = create_task(
        db_session,
        world["admin"],
        world["budget"].id,
        _task_req(title="Cancel overdue", due_date=past),
    )
    cancel_task(db_session, world["admin"], world["budget"].id, cancelled.id)
    cancelled_view = list_tasks(
        db_session, world["admin"], world["budget"].id, include_completed=True
    )
    cancelled_row = next(t for t in cancelled_view if t.id == cancelled.id)
    assert cancelled_row.is_overdue is False
    assert cancelled_row.cancelled_at is not None
    assert cancelled_row.cancelled_by_user_id == world["admin"].id


def test_note_length_and_html_stored_as_plain_text(db_session: Session) -> None:
    world = _seed(db_session)
    html_body = "<script>alert(1)</script> Site note"
    note = create_note(
        db_session,
        world["admin"],
        world["budget"].id,
        _note_req(body=html_body),
    )
    assert note.body == html_body
    assert "<script>" in note.body

    with pytest.raises(Exception):
        BudgetProjectNoteCreateRequest(client_action_id=uuid.uuid4(), body="x" * 5001)


def test_note_employee_and_cross_company_denied(db_session: Session) -> None:
    world = _seed(db_session)
    note = create_note(db_session, world["admin"], world["budget"].id, _note_req())
    with pytest.raises(HTTPException) as emp_exc:
        list_notes(db_session, world["employee"], world["budget"].id)
    assert emp_exc.value.status_code == 403
    with pytest.raises(HTTPException) as other_exc:
        pin_note(db_session, world["other_admin"], world["budget"].id, note.id)
    assert other_exc.value.status_code == 403


def test_tasks_notes_do_not_import_notification_or_push() -> None:
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "modules"
        / "budgets"
        / "tasks_notes.py"
    ).read_text(encoding="utf-8")
    assert "notification" not in src.lower() or "no notifications" in src.lower()
    assert "create_notification" not in src
    assert "push_subscription" not in src
    assert "webpush" not in src.lower()
    assert "send_email" not in src


def test_financial_modules_untouched_by_phase4_imports() -> None:
    """Phase 4 must not alter billing/payment/reporting calculation modules."""
    from pathlib import Path

    api_root = Path(__file__).resolve().parents[1]
    for rel in (
        "app/modules/budgets/billing.py",
        "app/modules/budgets/payments.py",
        "app/modules/budgets/financial_reporting.py",
    ):
        text = (api_root / rel).read_text(encoding="utf-8")
        assert "BudgetTask" not in text
        assert "budget_tasks" not in text
        assert "BudgetProjectNote" not in text
