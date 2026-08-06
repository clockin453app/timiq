"""Budget tasks and project notes (admin-only; no notifications)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.budgets.models import BudgetProject, BudgetProjectNote, BudgetTask
from app.modules.budgets.repository import (
    count_budget_tasks_by_status,
    count_overdue_budget_tasks,
    delete_budget_project_note,
    delete_budget_task,
    get_budget_project,
    get_budget_project_note,
    get_budget_project_note_by_client_action_id,
    get_budget_task,
    get_budget_task_by_client_action_id,
    list_budget_project_notes_for_budget,
    list_budget_tasks_for_budget,
    save_budget_project_note,
    save_budget_task,
)
from app.modules.budgets.schemas import (
    TASK_ACTIVE_STATUSES,
    BudgetProjectNoteCreateRequest,
    BudgetProjectNotePatchRequest,
    BudgetProjectNoteResponse,
    BudgetTaskCreateRequest,
    BudgetTaskPatchRequest,
    BudgetTaskReopenRequest,
    BudgetTaskResponse,
    BudgetTaskSummaryResponse,
)
from app.modules.companies.service import ensure_company_time_policy

# Allowed active-status transitions (terminal changes use dedicated endpoints).
_ACTIVE_TRANSITIONS: dict[str, frozenset[str]] = {
    "to_do": frozenset({"to_do", "in_progress", "blocked"}),
    "in_progress": frozenset({"in_progress", "blocked"}),
    "blocked": frozenset({"blocked", "in_progress"}),
}

_PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
_TERMINAL = frozenset({"completed", "cancelled"})


def _assert_can_access_budget(actor: User, project: BudgetProject) -> None:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission.")
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id != project.company_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this budget.")
    elif actor.system_role != SystemRole.ADMINISTRATOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission.")


def _load_budget(db_session: Session, actor: User, budget_id: uuid.UUID) -> BudgetProject:
    project = get_budget_project(db_session, budget_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
    _assert_can_access_budget(actor, project)
    return project


def _company_local_today(db_session: Session, company_id: uuid.UUID) -> date:
    policy = ensure_company_time_policy(db_session, company_id)
    tz_name = getattr(policy, "timezone_name", None) or "Europe/London"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Europe/London")
    return datetime.now(timezone.utc).astimezone(tz).date()


def _is_overdue(task: BudgetTask, today_local: date) -> bool:
    if task.due_date is None:
        return False
    if task.status in _TERMINAL:
        return False
    return task.due_date < today_local


def _task_response(task: BudgetTask, today_local: date) -> BudgetTaskResponse:
    return BudgetTaskResponse(
        id=task.id,
        company_id=task.company_id,
        budget_id=task.budget_id,
        client_action_id=task.client_action_id,
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        category=task.category,
        due_date=task.due_date,
        assignee_user_id=task.assignee_user_id,
        created_by_user_id=task.created_by_user_id,
        updated_by_user_id=task.updated_by_user_id,
        completed_by_user_id=task.completed_by_user_id,
        completed_at=task.completed_at,
        cancelled_by_user_id=task.cancelled_by_user_id,
        cancelled_at=task.cancelled_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
        is_overdue=_is_overdue(task, today_local),
    )


def _note_response(note: BudgetProjectNote) -> BudgetProjectNoteResponse:
    return BudgetProjectNoteResponse(
        id=note.id,
        company_id=note.company_id,
        budget_id=note.budget_id,
        client_action_id=note.client_action_id,
        body=note.body,
        is_pinned=bool(note.is_pinned),
        created_by_user_id=note.created_by_user_id,
        updated_by_user_id=note.updated_by_user_id,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def _task_audit_details(task: BudgetTask) -> dict:
    return {
        "budget_id": str(task.budget_id),
        "task_id": str(task.id),
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "category": task.category,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "assignee_user_id": str(task.assignee_user_id) if task.assignee_user_id else None,
    }


def _note_excerpt(body: str) -> str:
    return (body or "")[:200]


def _sort_tasks(tasks: list[BudgetTask], today_local: date) -> list[BudgetTask]:
    def key(task: BudgetTask) -> tuple:
        terminal = 1 if task.status in _TERMINAL else 0
        overdue = 0 if (terminal == 0 and _is_overdue(task, today_local)) else 1
        priority = _PRIORITY_RANK.get(task.priority, 9)
        has_due = 0 if task.due_date is not None else 1
        due = task.due_date or date.max
        return (terminal, overdue, priority, has_due, due, task.created_at)

    return sorted(tasks, key=key)


def _validate_assignee(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    assignee_user_id: uuid.UUID | None,
) -> None:
    if assignee_user_id is None:
        return
    user = get_user_by_id(db_session, assignee_user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignee not found.")
    if user.company_id != company_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Assignee must belong to the same company.",
        )
    if user.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Assignee must be an admin or administrator (employees cannot be assigned).",
        )


def _load_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    task_id: uuid.UUID,
) -> tuple[BudgetProject, BudgetTask]:
    project = _load_budget(db_session, actor, budget_id)
    task = get_budget_task(db_session, task_id)
    if task is None or task.budget_id != budget_id or task.company_id != project.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    return project, task


def _load_note(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    note_id: uuid.UUID,
) -> tuple[BudgetProject, BudgetProjectNote]:
    project = _load_budget(db_session, actor, budget_id)
    note = get_budget_project_note(db_session, note_id)
    if note is None or note.budget_id != budget_id or note.company_id != project.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")
    return project, note


def list_tasks(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    *,
    status: str | None = None,
    priority: str | None = None,
    category: str | None = None,
    assignee_user_id: uuid.UUID | None = None,
    overdue: bool | None = None,
    due_from: date | None = None,
    due_to: date | None = None,
    include_completed: bool = False,
    search: str | None = None,
) -> list[BudgetTaskResponse]:
    project = _load_budget(db_session, actor, budget_id)
    today_local = _company_local_today(db_session, project.company_id)
    rows = list_budget_tasks_for_budget(
        db_session,
        budget_id=budget_id,
        status=status,
        priority=priority,
        category=category,
        assignee_user_id=assignee_user_id,
        due_from=due_from,
        due_to=due_to,
        include_completed=include_completed,
        search=search,
    )
    if overdue is True:
        rows = [t for t in rows if _is_overdue(t, today_local)]
    elif overdue is False:
        rows = [t for t in rows if not _is_overdue(t, today_local)]
    return [_task_response(t, today_local) for t in _sort_tasks(rows, today_local)]


def get_task_summary(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> BudgetTaskSummaryResponse:
    project = _load_budget(db_session, actor, budget_id)
    today_local = _company_local_today(db_session, project.company_id)
    by_status = count_budget_tasks_by_status(db_session, budget_id=budget_id)
    outstanding = (
        int(by_status.get("to_do", 0))
        + int(by_status.get("in_progress", 0))
        + int(by_status.get("blocked", 0))
    )
    return BudgetTaskSummaryResponse(
        budget_id=project.id,
        company_id=project.company_id,
        outstanding=outstanding,
        in_progress=int(by_status.get("in_progress", 0)),
        blocked=int(by_status.get("blocked", 0)),
        overdue=count_overdue_budget_tasks(db_session, budget_id=budget_id, today_local=today_local),
        completed=int(by_status.get("completed", 0)),
    )


def create_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    body: BudgetTaskCreateRequest,
) -> BudgetTaskResponse:
    project = _load_budget(db_session, actor, budget_id)
    existing = get_budget_task_by_client_action_id(
        db_session,
        company_id=project.company_id,
        client_action_id=body.client_action_id,
    )
    if existing is not None:
        if existing.budget_id != budget_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="client_action_id already used for another task.",
            )
        today_local = _company_local_today(db_session, project.company_id)
        return _task_response(existing, today_local)

    _validate_assignee(db_session, company_id=project.company_id, assignee_user_id=body.assignee_user_id)

    row = BudgetTask(
        company_id=project.company_id,
        budget_id=project.id,
        client_action_id=body.client_action_id,
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        category=body.category,
        due_date=body.due_date,
        assignee_user_id=body.assignee_user_id,
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    save_budget_task(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.task_created",
        entity_type="budget_task",
        entity_id=str(row.id),
        company_id=project.company_id,
        details={
            **_task_audit_details(row),
            "client_action_id": str(body.client_action_id),
        },
    )
    if body.assignee_user_id is not None:
        create_internal_audit_event(
            db_session,
            actor,
            action="budget.task_assigned",
            entity_type="budget_task",
            entity_id=str(row.id),
            company_id=project.company_id,
            details=_task_audit_details(row),
        )
    today_local = _company_local_today(db_session, project.company_id)
    return _task_response(row, today_local)


def get_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    task_id: uuid.UUID,
) -> BudgetTaskResponse:
    project, task = _load_task(db_session, actor, budget_id, task_id)
    today_local = _company_local_today(db_session, project.company_id)
    return _task_response(task, today_local)


def patch_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    task_id: uuid.UUID,
    body: BudgetTaskPatchRequest,
) -> BudgetTaskResponse:
    project, task = _load_task(db_session, actor, budget_id, task_id)
    if task.status in _TERMINAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Completed or cancelled tasks cannot be edited; reopen first.",
        )

    data = body.model_dump(exclude_unset=True)
    changed: list[str] = []
    prev_assignee = task.assignee_user_id
    prev_status = task.status

    if "title" in data and body.title is not None:
        task.title = body.title
        changed.append("title")
    if "description" in data:
        task.description = body.description
        changed.append("description")
    if "priority" in data and body.priority is not None:
        task.priority = body.priority
        changed.append("priority")
    if "category" in data and body.category is not None:
        task.category = body.category
        changed.append("category")
    if "due_date" in data:
        task.due_date = body.due_date
        changed.append("due_date")
    if "assignee_user_id" in data:
        _validate_assignee(
            db_session,
            company_id=project.company_id,
            assignee_user_id=body.assignee_user_id,
        )
        task.assignee_user_id = body.assignee_user_id
        changed.append("assignee_user_id")
    if "status" in data and body.status is not None:
        allowed = _ACTIVE_TRANSITIONS.get(task.status, frozenset())
        if body.status not in allowed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot change status from {task.status} to {body.status}.",
            )
        task.status = body.status
        changed.append("status")

    if not changed:
        today_local = _company_local_today(db_session, project.company_id)
        return _task_response(task, today_local)

    task.updated_by_user_id = actor.id
    save_budget_task(db_session, task)

    create_internal_audit_event(
        db_session,
        actor,
        action="budget.task_updated",
        entity_type="budget_task",
        entity_id=str(task.id),
        company_id=project.company_id,
        details={**_task_audit_details(task), "changed_fields": changed},
    )
    if "assignee_user_id" in changed and task.assignee_user_id != prev_assignee:
        create_internal_audit_event(
            db_session,
            actor,
            action="budget.task_assigned",
            entity_type="budget_task",
            entity_id=str(task.id),
            company_id=project.company_id,
            details=_task_audit_details(task),
        )
    if "status" in changed and task.status == "blocked" and prev_status != "blocked":
        create_internal_audit_event(
            db_session,
            actor,
            action="budget.task_blocked",
            entity_type="budget_task",
            entity_id=str(task.id),
            company_id=project.company_id,
            details=_task_audit_details(task),
        )

    today_local = _company_local_today(db_session, project.company_id)
    return _task_response(task, today_local)


def complete_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    task_id: uuid.UUID,
) -> BudgetTaskResponse:
    project, task = _load_task(db_session, actor, budget_id, task_id)
    if task.status not in TASK_ACTIVE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only active tasks can be completed.",
        )
    now = datetime.now(timezone.utc)
    task.status = "completed"
    task.completed_at = now
    task.completed_by_user_id = actor.id
    task.cancelled_at = None
    task.cancelled_by_user_id = None
    task.updated_by_user_id = actor.id
    save_budget_task(db_session, task)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.task_completed",
        entity_type="budget_task",
        entity_id=str(task.id),
        company_id=project.company_id,
        details=_task_audit_details(task),
    )
    today_local = _company_local_today(db_session, project.company_id)
    return _task_response(task, today_local)


def cancel_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    task_id: uuid.UUID,
) -> BudgetTaskResponse:
    project, task = _load_task(db_session, actor, budget_id, task_id)
    if task.status not in TASK_ACTIVE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only active tasks can be cancelled.",
        )
    now = datetime.now(timezone.utc)
    task.status = "cancelled"
    task.cancelled_at = now
    task.cancelled_by_user_id = actor.id
    task.completed_at = None
    task.completed_by_user_id = None
    task.updated_by_user_id = actor.id
    save_budget_task(db_session, task)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.task_cancelled",
        entity_type="budget_task",
        entity_id=str(task.id),
        company_id=project.company_id,
        details=_task_audit_details(task),
    )
    today_local = _company_local_today(db_session, project.company_id)
    return _task_response(task, today_local)


def reopen_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    task_id: uuid.UUID,
    body: BudgetTaskReopenRequest | None = None,
) -> BudgetTaskResponse:
    project, task = _load_task(db_session, actor, budget_id, task_id)
    if task.status not in _TERMINAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only completed or cancelled tasks can be reopened.",
        )
    target = (body.target_status if body else "to_do")
    if task.status == "cancelled" and target != "to_do":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cancelled tasks can only reopen to to_do.",
        )
    if task.status == "completed" and target not in ("to_do", "in_progress"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Completed tasks can reopen to to_do or in_progress.",
        )

    task.status = target
    task.completed_at = None
    task.completed_by_user_id = None
    task.cancelled_at = None
    task.cancelled_by_user_id = None
    task.updated_by_user_id = actor.id
    save_budget_task(db_session, task)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.task_reopened",
        entity_type="budget_task",
        entity_id=str(task.id),
        company_id=project.company_id,
        details=_task_audit_details(task),
    )
    today_local = _company_local_today(db_session, project.company_id)
    return _task_response(task, today_local)


def delete_task(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    task_id: uuid.UUID,
) -> None:
    project, task = _load_task(db_session, actor, budget_id, task_id)
    if (
        task.status != "to_do"
        or task.completed_at is not None
        or task.cancelled_at is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only never-started to_do tasks can be deleted; cancel instead.",
        )
    details = _task_audit_details(task)
    delete_budget_task(db_session, task.id)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.task_deleted",
        entity_type="budget_task",
        entity_id=str(task_id),
        company_id=project.company_id,
        details=details,
    )


def list_notes(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
) -> list[BudgetProjectNoteResponse]:
    _load_budget(db_session, actor, budget_id)
    rows = list_budget_project_notes_for_budget(db_session, budget_id=budget_id)
    return [_note_response(n) for n in rows]


def create_note(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    body: BudgetProjectNoteCreateRequest,
) -> BudgetProjectNoteResponse:
    project = _load_budget(db_session, actor, budget_id)
    existing = get_budget_project_note_by_client_action_id(
        db_session,
        company_id=project.company_id,
        client_action_id=body.client_action_id,
    )
    if existing is not None:
        if existing.budget_id != budget_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="client_action_id already used for another note.",
            )
        return _note_response(existing)

    row = BudgetProjectNote(
        company_id=project.company_id,
        budget_id=project.id,
        client_action_id=body.client_action_id,
        body=body.body,
        is_pinned=bool(body.is_pinned),
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    save_budget_project_note(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.note_created",
        entity_type="budget_project_note",
        entity_id=str(row.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "note_id": str(row.id),
            "client_action_id": str(body.client_action_id),
            "is_pinned": bool(row.is_pinned),
            "body_excerpt": _note_excerpt(row.body),
        },
    )
    return _note_response(row)


def patch_note(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    note_id: uuid.UUID,
    body: BudgetProjectNotePatchRequest,
) -> BudgetProjectNoteResponse:
    project, note = _load_note(db_session, actor, budget_id, note_id)
    data = body.model_dump(exclude_unset=True)
    if not data:
        return _note_response(note)

    prev_pinned = bool(note.is_pinned)
    changed: list[str] = []
    if "body" in data and body.body is not None:
        note.body = body.body
        changed.append("body")
    if "is_pinned" in data and body.is_pinned is not None:
        note.is_pinned = bool(body.is_pinned)
        changed.append("is_pinned")

    note.updated_by_user_id = actor.id
    save_budget_project_note(db_session, note)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.note_updated",
        entity_type="budget_project_note",
        entity_id=str(note.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "note_id": str(note.id),
            "is_pinned": bool(note.is_pinned),
            "changed_fields": changed,
            "body_excerpt": _note_excerpt(note.body),
        },
    )
    if "is_pinned" in changed and bool(note.is_pinned) != prev_pinned:
        create_internal_audit_event(
            db_session,
            actor,
            action="budget.note_pinned" if note.is_pinned else "budget.note_unpinned",
            entity_type="budget_project_note",
            entity_id=str(note.id),
            company_id=project.company_id,
            details={
                "budget_id": str(project.id),
                "note_id": str(note.id),
                "is_pinned": bool(note.is_pinned),
                "body_excerpt": _note_excerpt(note.body),
            },
        )
    return _note_response(note)


def pin_note(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    note_id: uuid.UUID,
) -> BudgetProjectNoteResponse:
    project, note = _load_note(db_session, actor, budget_id, note_id)
    if note.is_pinned:
        return _note_response(note)
    note.is_pinned = True
    note.updated_by_user_id = actor.id
    save_budget_project_note(db_session, note)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.note_pinned",
        entity_type="budget_project_note",
        entity_id=str(note.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "note_id": str(note.id),
            "is_pinned": True,
            "body_excerpt": _note_excerpt(note.body),
        },
    )
    return _note_response(note)


def unpin_note(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    note_id: uuid.UUID,
) -> BudgetProjectNoteResponse:
    project, note = _load_note(db_session, actor, budget_id, note_id)
    if not note.is_pinned:
        return _note_response(note)
    note.is_pinned = False
    note.updated_by_user_id = actor.id
    save_budget_project_note(db_session, note)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.note_unpinned",
        entity_type="budget_project_note",
        entity_id=str(note.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "note_id": str(note.id),
            "is_pinned": False,
            "body_excerpt": _note_excerpt(note.body),
        },
    )
    return _note_response(note)


def delete_note(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    note_id: uuid.UUID,
) -> None:
    project, note = _load_note(db_session, actor, budget_id, note_id)
    details = {
        "budget_id": str(project.id),
        "note_id": str(note.id),
        "is_pinned": bool(note.is_pinned),
        "body_excerpt": _note_excerpt(note.body),
    }
    delete_budget_project_note(db_session, note.id)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.note_deleted",
        entity_type="budget_project_note",
        entity_id=str(note_id),
        company_id=project.company_id,
        details=details,
    )
