"""Paid payroll locking, undo paid, and late-shift marker helpers."""

import uuid
from types import SimpleNamespace
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole
from app.modules.payroll.late_shifts import (
    append_late_shift_ids_marker,
    parse_late_shift_ids_from_notes,
    reserved_late_shift_ids_for_user_period,
)
from app.modules.payroll.permissions import PayrollPermissionError
from app.modules.payroll.schemas import PayrollItemPatchRequest, PayrollLateAdjustmentRequest, PayrollUndoPaidRequest
from app.modules.payroll.service import (
    PayrollError,
    PayrollItemStateError,
    create_late_shift_adjustment_from_paid_item,
    patch_payroll_item,
    undo_paid_item,
)


def test_late_shift_ids_marker_roundtrip() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    notes = append_late_shift_ids_marker("Adjustment note", [a, b])
    assert "Adjustment note" in notes
    parsed = parse_late_shift_ids_from_notes(notes)
    assert parsed == {a, b}


def test_reserved_late_shift_ids_pending_only() -> None:
    uid = uuid.uuid4()
    sid = uuid.uuid4()
    pending = SimpleNamespace(
        user_id=uid,
        status="pending",
        notes=append_late_shift_ids_marker("", [sid]),
    )
    approved = SimpleNamespace(user_id=uid, status="approved", notes=append_late_shift_ids_marker("", [uuid.uuid4()]))
    reserved = reserved_late_shift_ids_for_user_period([pending, approved], uid)
    assert reserved == {sid}


def test_undo_paid_requires_confirm() -> None:
    actor = SimpleNamespace(system_role=SystemRole.ADMIN, company_id=uuid.uuid4(), id=uuid.uuid4())
    req = PayrollUndoPaidRequest(reason="mistake", confirm=False)
    with pytest.raises(PayrollError, match="confirm"):
        undo_paid_item(MagicMock(), actor, uuid.uuid4(), req)


def test_undo_paid_rejects_employee() -> None:
    actor = SimpleNamespace(system_role=SystemRole.EMPLOYEE, company_id=uuid.uuid4(), id=uuid.uuid4())
    req = PayrollUndoPaidRequest(reason="x", confirm=True)
    with pytest.raises(PayrollPermissionError):
        undo_paid_item(MagicMock(), actor, uuid.uuid4(), req)


@patch("app.modules.payroll.service.get_item_by_id")
def test_patch_paid_blocks_money_fields(mock_get: MagicMock) -> None:
    cid = uuid.uuid4()
    iid = uuid.uuid4()
    item = MagicMock()
    item.id = iid
    item.status = "paid"
    item.company_id = cid
    mock_get.return_value = item
    actor = SimpleNamespace(system_role=SystemRole.ADMINISTRATOR, company_id=None, id=uuid.uuid4())
    req = PayrollItemPatchRequest(payment_mode="net_payment")
    with pytest.raises(PayrollError, match="locked"):
        patch_payroll_item(MagicMock(), actor, iid, req)


@patch("app.modules.payroll.service.ensure_company_time_policy")
@patch("app.modules.payroll.service._late_shift_rounded_entries_after_paid_cutoff")
@patch("app.modules.payroll.service.list_items_for_period")
@patch("app.modules.payroll.service.get_item_by_id")
def test_create_adjustment_rejects_zero_rounded_hours(
    mock_get: MagicMock,
    mock_list: MagicMock,
    mock_late_entries: MagicMock,
    mock_policy: MagicMock,
) -> None:
    paid_id = uuid.uuid4()
    period_id = uuid.uuid4()
    company_id = uuid.uuid4()
    user_id = uuid.uuid4()
    shift_id = uuid.uuid4()
    item = MagicMock()
    item.id = paid_id
    item.status = "paid"
    item.company_id = company_id
    item.user_id = user_id
    item.period_id = period_id
    item.paid_at = datetime.now(timezone.utc)
    mock_get.return_value = item
    mock_list.return_value = []
    mock_late_entries.return_value = [(shift_id, 0)]
    mock_policy.return_value = SimpleNamespace(
        overtime_multiplier=1.5,
        overtime_after_hours=40,
        timezone_name="Europe/London",
    )
    period = MagicMock()
    period.id = period_id
    period.week_start = date.today()
    db = MagicMock()
    db.get.return_value = period
    actor = SimpleNamespace(system_role=SystemRole.ADMINISTRATOR, company_id=None, id=uuid.uuid4())
    with pytest.raises(PayrollError, match="No payable late hours"):
        create_late_shift_adjustment_from_paid_item(
            db,
            actor,
            paid_id,
            PayrollLateAdjustmentRequest(confirm=True),
        )


@patch("app.modules.payroll.service.get_item_by_id")
def test_create_adjustment_requires_paid_row(mock_get: MagicMock) -> None:
    iid = uuid.uuid4()
    item = MagicMock()
    item.id = iid
    item.status = "pending"
    item.company_id = uuid.uuid4()
    mock_get.return_value = item
    actor = SimpleNamespace(system_role=SystemRole.ADMINISTRATOR, company_id=None, id=uuid.uuid4())
    with pytest.raises(PayrollItemStateError):
        create_late_shift_adjustment_from_paid_item(
            MagicMock(),
            actor,
            iid,
            PayrollLateAdjustmentRequest(confirm=True),
        )
