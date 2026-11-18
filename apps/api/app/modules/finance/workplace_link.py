"""Associate operational workplaces with Finance projects by stable workplace_id.

Does not import payroll, costs, invoices, payments, CIS, contracts, budgets, or forecasts.
Contract value is never invented as GBP 0.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.finance.commercial_service import _clean, _event, _insert, _rows
from app.modules.finance.ledger_service import FinanceLedgerError

def list_project_links(db_session: Session, *, company_id: uuid.UUID) -> dict[str, Any]:
    projects = _rows(
        db_session.execute(
            text(
                "SELECT id, name, reference_code, status, notes, workplace_id "
                "FROM finance_projects WHERE company_id = :company_id ORDER BY name"
            ),
            {"company_id": company_id},
        )
    )
    workplaces = _rows(
        db_session.execute(
            text(
                "SELECT id, name, code, is_active "
                "FROM workplaces WHERE company_id = :company_id ORDER BY name"
            ),
            {"company_id": company_id},
        )
    )
    by_workplace = {
        str(row["workplace_id"]): row
        for row in projects
        if row.get("workplace_id") is not None
    }
    finance_rows = []
    for row in projects:
        linked = row.get("workplace_id") is not None
        finance_rows.append(
            {
                "id": str(row["id"]),
                "name": row["name"],
                "reference_code": row.get("reference_code"),
                "status": row.get("status"),
                "workplace_id": str(row["workplace_id"]) if row.get("workplace_id") else None,
                "link_status": "LINKED" if linked else "NOT LINKED",
            }
        )
    workplace_rows = []
    for row in workplaces:
        wid = str(row["id"])
        linked_project = by_workplace.get(wid)
        workplace_rows.append(
            {
                "id": wid,
                "name": row["name"],
                "code": row.get("code"),
                "is_active": bool(row.get("is_active")),
                "finance_project_id": str(linked_project["id"]) if linked_project else None,
                "link_status": "LINKED" if linked_project else "NOT LINKED",
            }
        )
    return {
        "company_id": str(company_id),
        "finance_projects": finance_rows,
        "workplaces": workplace_rows,
        "unlinked_active_workplaces": [
            row for row in workplace_rows if row["link_status"] == "NOT LINKED" and row["is_active"]
        ],
    }


def dry_run_workplace_initialize(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    workplace_ids: list[uuid.UUID] | None = None,
) -> dict[str, Any]:
    links = list_project_links(db_session, company_id=company_id)
    selected = {str(item) for item in workplace_ids} if workplace_ids is not None else None
    already_linked: list[dict[str, Any]] = []
    would_create: list[dict[str, Any]] = []
    skipped_inactive: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    missing: list[str] = []

    workplaces_by_id = {row["id"]: row for row in links["workplaces"]}
    if selected is not None:
        for wid in selected:
            if wid not in workplaces_by_id:
                missing.append(wid)

    for row in links["workplaces"]:
        if selected is not None and row["id"] not in selected:
            continue
        if row["link_status"] == "LINKED":
            already_linked.append(
                {
                    "workplace_id": row["id"],
                    "name": row["name"],
                    "finance_project_id": row["finance_project_id"],
                    "action": "none",
                }
            )
            continue
        if not row["is_active"]:
            skipped_inactive.append(
                {
                    "workplace_id": row["id"],
                    "name": row["name"],
                    "reason": "inactive workplace is not auto-selected",
                }
            )
            continue
        would_create.append(
            {
                "workplace_id": row["id"],
                "name": row["name"],
                "reference_code": row.get("code"),
                "action": "create_finance_project",
                "contract_value": None,
                "imports": [],
            }
        )

    if missing:
        conflicts.append(
            {
                "code": "WORKPLACE_NOT_IN_COMPANY",
                "workplace_ids": missing,
                "message": "One or more workplace IDs are missing for this company.",
            }
        )

    return {
        "company_id": str(company_id),
        "writable": False,
        "mode": "DRY_RUN",
        "eligible_workplaces": would_create,
        "already_linked": already_linked,
        "would_create": would_create,
        "skipped_inactive": skipped_inactive,
        "conflicts": conflicts,
        "existing_finance_projects": links["finance_projects"],
    }


def initialize_finance_project_from_workplace(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    workplace_id: uuid.UUID,
) -> dict[str, Any]:
    workplace = db_session.execute(
        text(
            "SELECT id, company_id, name, code, is_active "
            "FROM workplaces WHERE id = :workplace_id"
        ),
        {"workplace_id": workplace_id},
    ).mappings().first()
    if workplace is None:
        raise FinanceLedgerError("NOT_FOUND", "Workplace was not found.")
    if workplace["company_id"] != company_id:
        raise FinanceLedgerError("COMPANY_MISMATCH", "Workplace belongs to another company.")
    if not bool(workplace["is_active"]):
        raise FinanceLedgerError("INACTIVE_WORKPLACE", "Inactive workplaces cannot be initialized.")

    existing = db_session.execute(
        text(
            "SELECT id, name, reference_code, status, workplace_id "
            "FROM finance_projects "
            "WHERE company_id = :company_id AND workplace_id = :workplace_id"
        ),
        {"company_id": company_id, "workplace_id": workplace_id},
    ).mappings().first()
    if existing is not None:
        return {
            "id": str(existing["id"]),
            "created": False,
            "workplace_id": str(workplace_id),
            "name": existing["name"],
            "reference_code": existing.get("reference_code"),
            "status": existing.get("status"),
            "link_status": "LINKED",
        }

    project_id = uuid.uuid4()
    reference = _clean(workplace.get("code"))
    try:
        with db_session.begin_nested():
            _insert(
                db_session,
                "INSERT INTO finance_projects "
                "(id, company_id, name, reference_code, status, notes, workplace_id, created_by_user_id, created_at, updated_at) "
                "VALUES "
                "(:id, :company_id, :name, :reference_code, 'active', :notes, :workplace_id, :actor, now(), now())",
                {
                    "id": project_id,
                    "company_id": company_id,
                    "name": str(workplace["name"]).strip(),
                    "reference_code": reference,
                    "notes": "Initialized from operational workplace. No contract or costs imported.",
                    "workplace_id": workplace_id,
                    "actor": actor_user_id,
                },
            )
            _event(
                db_session,
                company_id=company_id,
                actor_user_id=actor_user_id,
                entity_type="finance_project",
                entity_id=project_id,
                action="project_initialized_from_workplace",
                reason="Finance project created from workplace identity only.",
                after={
                    "workplace_id": str(workplace_id),
                    "name": str(workplace["name"]).strip(),
                    "reference_code": reference,
                    "contract_value": None,
                },
            )
    except IntegrityError as exc:
        # Concurrent initialize of the same workplace: treat unique violation as idempotent.
        raced = db_session.execute(
            text(
                "SELECT id, name, reference_code, status, workplace_id "
                "FROM finance_projects "
                "WHERE company_id = :company_id AND workplace_id = :workplace_id"
            ),
            {"company_id": company_id, "workplace_id": workplace_id},
        ).mappings().first()
        if raced is None:
            raise FinanceLedgerError(
                "LINK_CONFLICT",
                "Could not initialize Finance project for workplace due to a database conflict.",
            ) from exc
        return {
            "id": str(raced["id"]),
            "created": False,
            "workplace_id": str(workplace_id),
            "name": raced["name"],
            "reference_code": raced.get("reference_code"),
            "status": raced.get("status"),
            "link_status": "LINKED",
        }
    return {
        "id": str(project_id),
        "created": True,
        "workplace_id": str(workplace_id),
        "name": str(workplace["name"]).strip(),
        "reference_code": reference,
        "status": "active",
        "link_status": "LINKED",
    }


def initialize_approved_workplaces(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    workplace_ids: list[uuid.UUID],
    dry_run: bool = True,
) -> dict[str, Any]:
    """Owner-approved batch init. Explicit IDs only; never invents financial values.

    When dry_run=True (default), no writes occur. Callers must pass dry_run=False
    only after reviewing the plan. Does not change FINANCE_PREVIEW_MODE.
    """
    if not workplace_ids:
        raise FinanceLedgerError("EMPTY_SELECTION", "Approved workplace ID list is empty.")

    plan = dry_run_workplace_initialize(
        db_session,
        company_id=company_id,
        workplace_ids=workplace_ids,
    )
    if plan["conflicts"]:
        return {
            "mode": "DRY_RUN" if dry_run else "ABORTED",
            "executed": False,
            "plan": plan,
            "created": [],
            "already_linked": plan["already_linked"],
            "reason": "conflicts_present",
        }
    if dry_run:
        return {
            "mode": "DRY_RUN",
            "executed": False,
            "plan": plan,
            "created": [],
            "already_linked": plan["already_linked"],
        }

    created: list[dict[str, Any]] = []
    linked: list[dict[str, Any]] = []
    for wid in workplace_ids:
        result = initialize_finance_project_from_workplace(
            db_session,
            company_id=company_id,
            actor_user_id=actor_user_id,
            workplace_id=wid,
        )
        if result.get("created"):
            created.append(result)
        else:
            linked.append(result)
    return {
        "mode": "EXECUTE",
        "executed": True,
        "plan": plan,
        "created": created,
        "already_linked": linked,
        "imports": [],
        "contract_values_set": 0,
    }
