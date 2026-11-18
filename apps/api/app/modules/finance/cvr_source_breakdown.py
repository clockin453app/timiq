"""READ-ONLY CVR source breakdown for Finance Data Grid drill-downs.

Does not invent rows. When a component cannot be listed from stored source tables,
verification is PARTIAL or SOURCE BREAKDOWN UNAVAILABLE - NOT VERIFIED.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.finance.cvr_reconcile import (
    MONEY_Q,
    PARTIAL,
    UNAVAILABLE,
    VERIFIED,
    ZERO,
    money_str,
    parse_money,
    reconcile_totals,
    sum_amounts,
)
from app.modules.finance.ledger_service import FinanceLedgerError
from app.modules.finance.project_report_links import COMPANY, COST_SQL

ELIGIBLE_METRICS = frozenset({"actual_eligible", "cost_to_date_eligible"})
INCURRED_METRICS = frozenset({"cost_to_date", "actual_incurred", "actual_incurred_cost"})
SUPPORTED_METRICS = frozenset(
    {
        *ELIGIBLE_METRICS,
        *INCURRED_METRICS,
        "approved_variations",
        "approved_dayworks_in_contract",
        "open_commitments",
        "cost_to_complete",
        "contract_value",
        "forecast_final_cost",
        "forecast_profit",
    }
)

COST_BREAKDOWN_SQL = COST_SQL.replace(
    "allocation.project_id, allocation.amount_eligible",
    "allocation.project_id, allocation.cost_code_id, "
    "allocation.amount_eligible, allocation.amount_net, allocation.amount_non_recoverable, "
    "code.code AS cost_code_code, code.name AS cost_code_name",
).replace(
    f"WHERE allocation.{COMPANY} AND document.status = 'posted'",
    "LEFT JOIN finance_cost_codes code "
    "ON code.id = allocation.cost_code_id AND code.company_id = allocation.company_id "
    f"WHERE allocation.{COMPANY} AND document.status = 'posted'",
)


def _row(
    *,
    id: str,
    reference: str,
    source_type: str,
    amount: Decimal,
    document_date: str | None = None,
    status: str | None = None,
    cost_code: str | None = None,
    net: Decimal | None = None,
    vat_non_recoverable: Decimal | None = None,
    gross_document: Decimal | None = None,
    document_id: str | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "reference": reference,
        "source_type": source_type,
        "document_date": document_date,
        "status": status,
        "cost_code": cost_code,
        "amount": money_str(amount),
        "net": None if net is None else money_str(net),
        "vat_non_recoverable": None if vat_non_recoverable is None else money_str(vat_non_recoverable),
        "gross_document": None if gross_document is None else money_str(gross_document),
        "document_id": document_id,
    }


def _group(
    *,
    id: str,
    label: str,
    rows: list[dict[str, Any]],
    total: Decimal | None = None,
    total_known: bool | None = None,
    verification: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    # total_known=False keeps missing totals as "missing" (never forced to 0).
    # total_known=None means derive from rows when total is None, else use total.
    if total_known is False:
        total_text = "missing"
    elif total is not None:
        total_text = money_str(total)
    else:
        total_text = money_str(sum_amounts(Decimal(str(row["amount"])) for row in rows))
    payload: dict[str, Any] = {
        "id": id,
        "label": label,
        "total": total_text,
        "rows": rows,
    }
    if verification is not None:
        payload["verification"] = verification
    if note is not None:
        payload["note"] = note
    return payload


def _payload(
    *,
    metric: str,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    displayed_total: Decimal | None,
    formula: str,
    basis: str,
    groups: list[dict[str, Any]],
    contributions: Sequence[Decimal],
    warnings: list[str],
    listable: bool = True,
    all_components_known: bool = True,
    verified_subtotal: Decimal | None = None,
    unverified_subtotal: Decimal | None = None,
) -> dict[str, Any]:
    check = reconcile_totals(
        displayed=displayed_total,
        contributions=contributions,
        listable=listable,
        all_components_known=all_components_known,
    )
    displayed_text = "missing" if displayed_total is None else money_str(displayed_total)
    if displayed_total is None:
        formula_check = "INCOMPLETE"
    elif check["difference"] == "0.0000":
        formula_check = "MATCH"
    else:
        formula_check = "MISMATCH"
    source_verification = check["verification"] if all_components_known else (
        UNAVAILABLE if not listable else PARTIAL
    )
    return {
        "metric": metric,
        "company_id": str(company_id),
        "project_id": str(project_id),
        "displayed_total": displayed_text,
        "formula": formula,
        "basis": basis,
        "reconcilable": check["reconcilable"],
        "verification": check["verification"],
        "formula_check": formula_check,
        "source_verification": source_verification,
        "difference": check["difference"],
        "source_total": check["source_total"],
        "verified_subtotal": None if verified_subtotal is None else money_str(verified_subtotal),
        "unverified_subtotal": None if unverified_subtotal is None else money_str(unverified_subtotal),
        "components_incomplete": not all_components_known,
        "groups": groups,
        "warnings": warnings,
    }


def _require_project(db_session: Session, *, company_id: uuid.UUID, project_id: uuid.UUID) -> None:
    owned = db_session.execute(
        text("SELECT 1 FROM finance_projects WHERE id = :project_id AND company_id = :company_id"),
        {"company_id": company_id, "project_id": project_id},
    ).scalar()
    if owned is None:
        raise FinanceLedgerError("NOT_FOUND", "Project was not found in this company.")


def _load_cvr(db_session: Session, *, company_id: uuid.UUID, project_id: uuid.UUID) -> dict[str, str]:
    from app.modules.finance.commercial_service import project_cvr
    return project_cvr(db_session, company_id=company_id, project_id=project_id)


def _actual_eligible_breakdown(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    metric: str,
    cvr: dict[str, str],
) -> dict[str, Any]:
    rows = db_session.execute(
        text(
            COST_BREAKDOWN_SQL
            + " AND allocation.project_id = :project_id "
            "ORDER BY document.document_date, document.external_reference"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).mappings()
    source_rows: list[dict[str, Any]] = []
    contributions: list[Decimal] = []
    for row in rows:
        amount = Decimal(str(row["amount_eligible"] or 0)).quantize(MONEY_Q)
        contributions.append(amount)
        code = " / ".join(
            part
            for part in (
                str(row.get("cost_code_code") or "").strip(),
                str(row.get("cost_code_name") or "").strip(),
            )
            if part
        ) or None
        source_rows.append(
            _row(
                id=str(row["allocation_id"]),
                reference=str(row.get("document_reference") or "Reference missing"),
                source_type=str(row.get("document_type") or "cost_document"),
                document_date=str(row["document_date"]) if row.get("document_date") is not None else None,
                status="posted",
                cost_code=code,
                amount=amount,
                net=Decimal(str(row.get("amount_net") or 0)),
                vat_non_recoverable=Decimal(str(row.get("amount_non_recoverable") or 0)),
                gross_document=Decimal(str(row.get("document_gross") or 0)),
                document_id=str(row["document_id"]),
            )
        )
    displayed = parse_money(cvr.get("actual_eligible_cost"))
    return _payload(
        metric=metric,
        company_id=company_id,
        project_id=project_id,
        displayed_total=displayed,
        formula="sum(posted allocation.amount_eligible) for project",
        basis="eligible = net + non-recoverable VAT",
        groups=[_group(id="actual_eligible", label="Posted eligible cost allocations", rows=source_rows)],
        contributions=contributions,
        warnings=[],
    )


def _approved_variations_breakdown(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cvr: dict[str, str],
) -> dict[str, Any]:
    rows = db_session.execute(
        text(
            "SELECT id, reference_code, description, approved_value, approval_status "
            "FROM finance_variations "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "AND approval_status = 'approved' "
            "ORDER BY reference_code"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).mappings()
    source_rows: list[dict[str, Any]] = []
    contributions: list[Decimal] = []
    for row in rows:
        amount = Decimal(str(row["approved_value"] or 0)).quantize(MONEY_Q)
        contributions.append(amount)
        source_rows.append(
            _row(
                id=str(row["id"]),
                reference=str(row.get("reference_code") or row.get("description") or "Variation"),
                source_type="variation",
                status=str(row.get("approval_status") or "approved"),
                amount=amount,
            )
        )
    return _payload(
        metric="approved_variations",
        company_id=company_id,
        project_id=project_id,
        displayed_total=parse_money(cvr.get("approved_variations")),
        formula="sum(approved_value) where approval_status = approved",
        basis="Approved variations only",
        groups=[_group(id="approved_variations", label="Approved variations", rows=source_rows)],
        contributions=contributions,
        warnings=[],
    )


def _approved_dayworks_breakdown(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cvr: dict[str, str],
) -> dict[str, Any]:
    rows = db_session.execute(
        text(
            "SELECT id, reference_code, work_date, description, approved_value, "
            "approval_status, counts_in_contract_value "
            "FROM finance_dayworks "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "AND approval_status = 'approved' AND counts_in_contract_value = true "
            "ORDER BY work_date, reference_code"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).mappings()
    source_rows: list[dict[str, Any]] = []
    contributions: list[Decimal] = []
    for row in rows:
        amount = Decimal(str(row["approved_value"] or 0)).quantize(MONEY_Q)
        contributions.append(amount)
        source_rows.append(
            _row(
                id=str(row["id"]),
                reference=str(row.get("reference_code") or row.get("description") or "Daywork"),
                source_type="daywork",
                document_date=str(row["work_date"]) if row.get("work_date") is not None else None,
                status=str(row.get("approval_status") or "approved"),
                amount=amount,
            )
        )
    return _payload(
        metric="approved_dayworks_in_contract",
        company_id=company_id,
        project_id=project_id,
        displayed_total=parse_money(cvr.get("approved_dayworks_in_contract")),
        formula="sum(approved_value) where approved and counts_in_contract_value",
        basis="Approved dayworks included in contract value",
        groups=[_group(id="approved_dayworks", label="Approved dayworks in contract", rows=source_rows)],
        contributions=contributions,
        warnings=[],
    )


def _open_commitments_breakdown(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cvr: dict[str, str],
) -> dict[str, Any]:
    rows = db_session.execute(
        text(
            "SELECT commitment.id, commitment.reference_code, commitment.committed_amount, "
            "commitment.commitment_status, commitment.status, "
            "COALESCE((SELECT SUM(draw.amount) FROM finance_commitment_draws draw "
            "WHERE draw.commitment_id = commitment.id AND draw.status = 'posted'), 0) "
            "AS drawn_amount "
            "FROM finance_commitments commitment "
            "WHERE commitment.company_id = :company_id AND commitment.project_id = :project_id "
            "AND commitment.status = 'posted' "
            "ORDER BY commitment.reference_code"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).mappings()
    source_rows: list[dict[str, Any]] = []
    contributions: list[Decimal] = []
    for row in rows:
        committed = Decimal(str(row["committed_amount"] or 0)).quantize(MONEY_Q)
        drawn = Decimal(str(row["drawn_amount"] or 0)).quantize(MONEY_Q)
        remaining = (committed - drawn).quantize(MONEY_Q)
        contributions.append(remaining)
        source_rows.append(
            _row(
                id=str(row["id"]),
                reference=str(row.get("reference_code") or "Commitment"),
                source_type="commitment",
                status=str(row.get("commitment_status") or row.get("status") or "posted"),
                amount=remaining,
                net=committed,
                gross_document=drawn,
            )
        )
    warnings = [
        "Commitment draws are not returned as separate source rows. "
        "Open amount is committed minus posted draws (PARTIAL listing).",
        "Open commitments are not added again as incurred cost.",
    ]
    return _payload(
        metric="open_commitments",
        company_id=company_id,
        project_id=project_id,
        displayed_total=parse_money(cvr.get("open_commitments") or cvr.get("open_commitment")),
        formula="sum(committed_amount - posted draws) for project",
        basis="Open commitments are not actual incurred cost",
        groups=[_group(id="open_commitments", label="Open commitments", rows=source_rows, verification=PARTIAL, note="Commitment rows listed; draw register incomplete")],
        contributions=contributions,
        warnings=warnings,
        # Draws are not listable document rows — £0 component diff still PARTIAL.
        all_components_known=False,
    )


def _contract_value_breakdown(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cvr: dict[str, str],
) -> dict[str, Any]:
    original = parse_money(cvr.get("original_contract_value"))
    variations = _approved_variations_breakdown(
        db_session, company_id=company_id, project_id=project_id, cvr=cvr
    )
    dayworks = _approved_dayworks_breakdown(
        db_session, company_id=company_id, project_id=project_id, cvr=cvr
    )
    variation_rows = variations["groups"][0]["rows"]
    daywork_rows = dayworks["groups"][0]["rows"]
    groups = [
        _group(
            id="original_contract",
            label="Original contract",
            rows=[],
            total=original,
            total_known=original is not None,
            verification=UNAVAILABLE,
            note="No revision list for drill-down rows",
        ),
        _group(
            id="approved_variations",
            label="Approved variations",
            rows=variation_rows,
            verification=VERIFIED,
            note="Listed from finance_variations where approved",
        ),
        _group(
            id="approved_dayworks",
            label="Approved dayworks in contract",
            rows=daywork_rows,
            verification=VERIFIED,
            note="Listed from finance_dayworks where approved and counts_in_contract_value",
        ),
    ]
    contributions: list[Decimal] = []
    if original is not None:
        contributions.append(original)
    contributions.extend(Decimal(str(row["amount"])) for row in variation_rows)
    contributions.extend(Decimal(str(row["amount"])) for row in daywork_rows)
    warnings = [
        "SOURCE BREAKDOWN UNAVAILABLE for original contract - no revision list for drill-down rows.",
        "Known components may sum to Diff £0 and still remain PARTIAL until revision history is listable.",
    ]
    displayed = parse_money(cvr.get("approved_contract_value"))
    return _payload(
        metric="contract_value",
        company_id=company_id,
        project_id=project_id,
        displayed_total=displayed,
        formula="original + approved_variations + approved_dayworks_in_contract",
        basis="Approved contract value from compose_cvr_forecast",
        groups=groups,
        contributions=contributions,
        warnings=warnings,
        listable=True,
        # Original contract revision history is incomplete even when component math matches.
        all_components_known=False,
    )


def _component_row(id: str, label: str, amount: Decimal | None, *, note: str | None = None) -> dict[str, Any]:
    return _row(
        id=id,
        reference=label if note is None else f"{label} ({note})",
        source_type="component",
        status=None if amount is not None else "missing",
        amount=ZERO if amount is None else amount,
    )


def _cost_to_date_breakdown(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    metric: str,
    cvr: dict[str, str],
) -> dict[str, Any]:
    """Cost to Date = actual_eligible + cis_labour_gross (once). Payments are not added again."""
    eligible = _actual_eligible_breakdown(
        db_session,
        company_id=company_id,
        project_id=project_id,
        metric="actual_eligible",
        cvr=cvr,
    )
    eligible_rows = list(eligible["groups"][0]["rows"])
    eligible_amounts = [Decimal(str(row["amount"])) for row in eligible_rows]
    eligible_sum = sum_amounts(eligible_amounts)
    displayed_eligible = parse_money(cvr.get("actual_eligible_cost"))
    eligible_status = (
        VERIFIED
        if displayed_eligible is not None and eligible_sum == displayed_eligible
        else PARTIAL
    )
    cis = parse_money(cvr.get("cis_labour_gross"))
    # Missing CIS is not forced to zero for reconciliation presentation.
    cis_amount = ZERO if cis is None else cis
    incurred = parse_money(cvr.get("actual_incurred_cost"))
    contributions: list[Decimal] = [*eligible_amounts]
    if cis is not None:
        contributions.append(cis_amount)
    warnings = [
        "Cost to Date = actual_eligible_cost + cis_labour_gross (compose_cvr_forecast).",
        "Eligible component uses posted allocation documents. CIS uses the CVR field only.",
        "No CIS split register rows are invented. Payments are not added as a second cost.",
        "Global KPI stays PARTIAL while CIS source register is unavailable.",
    ]
    if cis is None:
        warnings.append("cis_labour_gross is missing — not treated as zero for verification.")
    return _payload(
        metric=metric,
        company_id=company_id,
        project_id=project_id,
        displayed_total=incurred,
        formula="actual_eligible_cost + cis_labour_gross",
        basis="compose_cvr_forecast actual_incurred; CIS counted once",
        groups=[
            _group(
                id="actual_eligible",
                label="Actual eligible cost (documented)",
                rows=eligible_rows,
                total=eligible_sum,
                verification=eligible_status,
                note="Sum of posted allocation.amount_eligible for this project",
            ),
            _group(
                id="cis_labour",
                label="CIS labour gross",
                rows=[],
                total=cis_amount if cis is not None else None,
                total_known=cis is not None,
                verification=UNAVAILABLE,
                note=(
                    "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED. "
                    f"CVR field cis_labour_gross={money_str(cis_amount) if cis is not None else 'missing'}."
                ),
            ),
        ],
        contributions=contributions,
        warnings=warnings,
        all_components_known=False,
        verified_subtotal=eligible_sum,
        unverified_subtotal=None if cis is None else cis_amount,
    )


def _cost_to_complete_breakdown(
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cvr: dict[str, str],
) -> dict[str, Any]:
    ctc = parse_money(cvr.get("cost_to_complete"))
    warnings = [
        "Cost to complete is the latest stored estimate from Finance Core.",
        "CTC revision history register is SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED.",
        "Missing CTC is not forced to zero.",
    ]
    return _payload(
        metric="cost_to_complete",
        company_id=company_id,
        project_id=project_id,
        displayed_total=ctc,
        formula="latest cost_to_complete estimate",
        basis="No revision list API — component remains unverified at document level",
        groups=[
            _group(
                id="ctc",
                label="Cost to complete",
                rows=[],
                total=ctc,
                total_known=ctc is not None,
                verification=UNAVAILABLE if ctc is not None else PARTIAL,
                note="Latest estimate only — no listable revision documents",
            )
        ],
        contributions=[] if ctc is None else [ctc],
        warnings=warnings,
        listable=False,
        all_components_known=False,
        verified_subtotal=ZERO,
        unverified_subtotal=ctc,
    )


def _forecast_final_breakdown(
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cvr: dict[str, str],
) -> dict[str, Any]:
    eligible = parse_money(cvr.get("actual_eligible_cost")) or ZERO
    labour = parse_money(cvr.get("cis_labour_gross")) or ZERO
    incurred = parse_money(cvr.get("actual_incurred_cost"))
    open_commitment = parse_money(cvr.get("open_commitments") or cvr.get("open_commitment")) or ZERO
    ctc = parse_money(cvr.get("cost_to_complete"))
    final = parse_money(cvr.get("forecast_final_cost"))
    rows = [
        _component_row("actual_eligible", "Actual eligible cost", eligible),
        _component_row("cis_labour_gross", "CIS labour gross", labour, note="no split register drill-down"),
        _component_row("open_commitments", "Open commitments", open_commitment),
        _component_row("cost_to_complete", "Cost to complete (CTC)", ctc, note="latest estimate only"),
    ]
    contributions: list[Decimal] = []
    known = True
    if incurred is not None:
        contributions.append(incurred)
    else:
        known = False
    contributions.append(open_commitment)
    if ctc is None:
        known = False
    else:
        contributions.append(ctc)
    warnings = [
        "Component tree only - CIS labour and CTC have no listable source document rows.",
        "Forecast final = actual_incurred + open_commitment + CTC (CTC required).",
        "Commitments are open remaining only; already drawn/invoiced cost stays in actual eligible, not added twice.",
    ]
    if ctc is None:
        warnings.append("CTC is missing - forecast final is incomplete and not forced to zero.")
    return _payload(
        metric="forecast_final_cost",
        company_id=company_id,
        project_id=project_id,
        displayed_total=final,
        formula="actual_incurred + open_commitment + cost_to_complete",
        basis="actual_incurred = actual_eligible + cis_labour_gross",
        groups=[_group(id="forecast_final_components", label="Forecast final cost components", rows=rows)],
        contributions=contributions if known and final is not None else [],
        warnings=warnings,
        listable=True,
        # Document-level sources incomplete even when component arithmetic matches.
        all_components_known=False,
    )


def _forecast_profit_breakdown(
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cvr: dict[str, str],
) -> dict[str, Any]:
    approved = parse_money(cvr.get("approved_contract_value"))
    final = parse_money(cvr.get("forecast_final_cost"))
    profit = parse_money(cvr.get("forecast_final_profit") or cvr.get("forecast_margin"))
    rows = [
        _component_row("approved_contract", "Approved contract value", approved),
        _component_row("forecast_final_cost", "Forecast final cost", final),
    ]
    warnings = [
        "Component tree only - profit = approved_contract - forecast_final_cost.",
        "Forecast profit is indicative projected profit, not recognised accounting profit.",
    ]
    known = approved is not None and final is not None
    contributions: list[Decimal] = []
    if known:
        contributions.append((approved - final).quantize(MONEY_Q))
    else:
        warnings.append("Contract and/or CTC incomplete - profit cannot be verified from components.")
    return _payload(
        metric="forecast_profit",
        company_id=company_id,
        project_id=project_id,
        displayed_total=profit,
        formula="approved_contract - forecast_final_cost",
        basis="compose_cvr_forecast profit composition",
        groups=[_group(id="forecast_profit_components", label="Forecast profit components", rows=rows)],
        contributions=contributions,
        warnings=warnings,
        listable=True,
        # Inherits incomplete contract / CTC document provenance.
        all_components_known=False,
    )


def build_cvr_source_breakdown(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    metric: str,
) -> dict[str, Any]:
    key = (metric or "").strip().lower()
    if key not in SUPPORTED_METRICS:
        raise FinanceLedgerError(
            "INVALID_METRIC",
            f"Unsupported metric '{metric}'. Supported: {', '.join(sorted(SUPPORTED_METRICS))}.",
        )
    _require_project(db_session, company_id=company_id, project_id=project_id)
    cvr = _load_cvr(db_session, company_id=company_id, project_id=project_id)

    if key in ELIGIBLE_METRICS:
        return _actual_eligible_breakdown(
            db_session, company_id=company_id, project_id=project_id, metric=key, cvr=cvr
        )
    if key in INCURRED_METRICS:
        return _cost_to_date_breakdown(
            db_session, company_id=company_id, project_id=project_id, metric=key, cvr=cvr
        )
    if key == "approved_variations":
        return _approved_variations_breakdown(
            db_session, company_id=company_id, project_id=project_id, cvr=cvr
        )
    if key == "approved_dayworks_in_contract":
        return _approved_dayworks_breakdown(
            db_session, company_id=company_id, project_id=project_id, cvr=cvr
        )
    if key == "open_commitments":
        return _open_commitments_breakdown(
            db_session, company_id=company_id, project_id=project_id, cvr=cvr
        )
    if key == "cost_to_complete":
        return _cost_to_complete_breakdown(company_id=company_id, project_id=project_id, cvr=cvr)
    if key == "contract_value":
        return _contract_value_breakdown(
            db_session, company_id=company_id, project_id=project_id, cvr=cvr
        )
    if key == "forecast_final_cost":
        return _forecast_final_breakdown(company_id=company_id, project_id=project_id, cvr=cvr)
    return _forecast_profit_breakdown(company_id=company_id, project_id=project_id, cvr=cvr)
