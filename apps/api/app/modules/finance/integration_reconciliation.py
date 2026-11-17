"""Company/project reconciliation view for a7-safe + experimental metrics.

Does not invent accounting policy. Unavailable measures stay MISSING / UNVALIDATED /
TEST-ONLY rather than silent zeros.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.finance.cvr_forecast import MISSING, compose_cvr_forecast

UNVALIDATED = "UNVALIDATED"
TEST_ONLY = "TEST-ONLY"
LIVE_AS_OF = "LIVE AS-OF"
PROVISIONAL = "PROVISIONAL"


def _dec(value: object | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _label(value: object | None, *, unavailable: str = MISSING) -> str:
    if value is None:
        return unavailable
    return str(value)


def build_company_project_reconciliation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cut_off: date | None = None,
    include_experimental: bool = False,
) -> dict[str, Any]:
    """Return separated accounting measures for one company project."""
    owned = db_session.execute(
        text(
            "SELECT 1 FROM finance_projects WHERE id = :project_id AND company_id = :company_id"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).scalar()
    if owned is None:
        raise ValueError("Project was not found in this company.")

    params = {"company_id": company_id, "project_id": project_id}
    contract = _dec(
        db_session.execute(
            text(
                "SELECT amount FROM finance_contract_values "
                "WHERE company_id = :company_id AND project_id = :project_id "
                "ORDER BY revision_number DESC LIMIT 1"
            ),
            params,
        ).scalar()
    )
    ctc = _dec(
        db_session.execute(
            text(
                "SELECT amount FROM finance_cost_to_complete "
                "WHERE company_id = :company_id AND project_id = :project_id "
                "ORDER BY revision_number DESC LIMIT 1"
            ),
            params,
        ).scalar()
    )
    eligible_sql = (
        "SELECT COALESCE(SUM(allocation.amount_eligible), 0) "
        "FROM finance_cost_allocations allocation "
        "JOIN finance_cost_lines line ON line.id = allocation.line_id "
        "JOIN finance_cost_documents document ON document.id = line.document_id "
        "WHERE document.company_id = :company_id AND allocation.project_id = :project_id "
        "AND document.status = 'posted' AND document.document_type <> 'accrual'"
    )
    if cut_off is not None:
        eligible_sql += " AND document.document_date <= :cut_off"
        params = {**params, "cut_off": cut_off}
    eligible = _dec(db_session.execute(text(eligible_sql), params).scalar_one()) or Decimal("0")

    cis_gross = _dec(
        db_session.execute(
            text(
                "SELECT COALESCE(SUM(gross_amount), 0) FROM finance_cis_project_splits "
                "WHERE company_id = :company_id AND project_id = :project_id "
                "AND status = 'posted'"
            ),
            {"company_id": company_id, "project_id": project_id},
        ).scalar_one()
    )
    if cis_gross is None:
        cis_gross = Decimal("0")

    committed = _dec(
        db_session.execute(
            text(
                "SELECT COALESCE(SUM(committed_amount), 0) FROM finance_commitments "
                "WHERE company_id = :company_id AND project_id = :project_id "
                "AND status = 'posted'"
            ),
            {"company_id": company_id, "project_id": project_id},
        ).scalar_one()
    ) or Decimal("0")
    drawn = _dec(
        db_session.execute(
            text(
                "SELECT COALESCE(SUM(draw.amount), 0) FROM finance_commitment_draws draw "
                "JOIN finance_commitments commitment ON commitment.id = draw.commitment_id "
                "WHERE commitment.company_id = :company_id AND commitment.project_id = :project_id "
                "AND draw.status = 'posted'"
            ),
            {"company_id": company_id, "project_id": project_id},
        ).scalar_one()
    ) or Decimal("0")
    open_commitment = committed - drawn

    supplier_liability = _dec(
        db_session.execute(
            text(
                "SELECT COALESCE(SUM(finance_supplier_gross_liability(document.id) - "
                "finance_supplier_allocated_to_document(document.id)), 0) "
                "FROM finance_cost_documents document "
                "WHERE document.company_id = :company_id AND document.status = 'posted' "
                "AND document.document_type IN ('supplier_invoice', 'expense_receipt')"
            ),
            {"company_id": company_id},
        ).scalar_one()
    )
    supplier_settlements = _dec(
        db_session.execute(
            text(
                "SELECT COALESCE(SUM(allocation.amount), 0) "
                "FROM finance_supplier_payment_allocations allocation "
                "JOIN finance_supplier_payments payment ON payment.id = allocation.payment_id "
                "WHERE payment.company_id = :company_id AND allocation.status = 'posted' "
                "AND payment.status = 'posted' "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM finance_supplier_payment_allocation_reversals rev "
                "  WHERE rev.allocation_id = allocation.id AND rev.status = 'posted'"
                ")"
            ),
            {"company_id": company_id},
        ).scalar_one()
    )

    forecast = compose_cvr_forecast(
        contract_known=contract is not None,
        original_contract=contract or Decimal("0"),
        approved_variations=Decimal("0"),
        approved_dayworks_in_contract=Decimal("0"),
        approved_budget=Decimal("0"),
        actual_eligible_cost=eligible,
        cis_labour_gross=cis_gross,
        open_commitment=open_commitment,
        cost_to_complete=ctc,
    )

    report: dict[str, Any] = {
        "report_kind": LIVE_AS_OF if cut_off else "LIVE",
        "company_id": str(company_id),
        "project_id": str(project_id),
        "cut_off": cut_off.isoformat() if cut_off else None,
        "approved_contract": _label(contract),
        "eligible_supplier_incurred": str(eligible),
        "cis_gross_incurred": str(cis_gross),
        "total_actual_incurred": forecast["actual_incurred_cost"],
        "open_accrual": MISSING,
        "adjusted_incurred": MISSING,
        "open_commitments": str(open_commitment),
        "additional_ctc": forecast["cost_to_complete"],
        "forecast_final_cost": forecast["forecast_final_cost"],
        "forecast_profit": forecast["forecast_final_profit"],
        "margin_percent": forecast["forecast_final_margin_percent"],
        "internal_vow": MISSING,
        "certified_value": UNVALIDATED,
        "certificate_basis": UNVALIDATED,
        "customer_invoiced": MISSING,
        "customer_cash": MISSING,
        "receivable_outstanding": MISSING,
        "supplier_gross_liability_outstanding": _label(supplier_liability),
        "supplier_settlements": _label(supplier_settlements),
        "approved_daywork_chargeout": MISSING,
        "site_attributed_costs": MISSING,
        "unattributed_costs": MISSING,
        "labels": {
            "live_as_of": LIVE_AS_OF,
            "provisional": PROVISIONAL,
            "unvalidated": UNVALIDATED,
            "experimental": TEST_ONLY,
        },
    }

    if include_experimental:
        marker = db_session.execute(
            text(
                "SELECT to_regclass('public.finance_x_cvr_full_batch_marker')"
            )
        ).scalar()
        if marker is None:
            report["experimental_schema"] = "UNAVAILABLE"
            return report
        report["experimental_schema"] = TEST_ONLY
        try:
            from app.modules.finance import cvr_experimental_persistence as xp

            vow = xp.internal_vow_as_of(
                db_session,
                company_id=company_id,
                project_id=project_id,
                cut_off=cut_off or date.today(),
            )
            report["internal_vow"] = vow.get("internal_vow", MISSING)
            report["internal_vow_label"] = PROVISIONAL
            cert = xp.certified_to_date_experimental(
                db_session, company_id=company_id, project_id=project_id
            )
            report["certified_value"] = cert.get("certified_to_date", UNVALIDATED)
            report["certificate_basis"] = cert.get("basis", UNVALIDATED)
            adj = xp.adjusted_incurred_with_accruals(
                db_session,
                company_id=company_id,
                project_id=project_id,
                cut_off=cut_off or date.today(),
            )
            report["open_accrual"] = adj.get("open_accrual", MISSING)
            report["adjusted_incurred"] = adj.get("adjusted_incurred_cost", MISSING)
        except Exception:  # noqa: BLE001 — experimental path stays labelled unavailable
            report["experimental_read_error"] = "EXPERIMENTAL_READ_FAILED"
    return report
