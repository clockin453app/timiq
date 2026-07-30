"""Administrator-supplied timestamps for forced clock-in / clock-out."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.modules.auth.models import SystemRole
from app.modules.live_attendance.permissions import LiveAttendancePermissionError
from app.modules.live_attendance.service import (
    LiveAttendanceError,
    _normalize_effective_at,
    manual_clock_in,
    manual_clock_out,
)

SERVICE = "app.modules.live_attendance.service"


def _actor() -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), company_id=uuid.uuid4(), system_role=SystemRole.ADMIN)


def _employee(company_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        system_role=SystemRole.EMPLOYEE,
        email="employee@example.com",
    )


def _location(company_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        is_active=True,
        latitude=51.5,
        longitude=-0.12,
    )


def _open_shift(clock_in_at: datetime, company_id: uuid.UUID, user_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=user_id,
        company_id=company_id,
        location_id=uuid.uuid4(),
        status="open",
        clock_in_at=clock_in_at,
        clock_out_at=None,
        clock_in_latitude=51.5,
        clock_in_longitude=-0.12,
        clock_in_distance_to_site_meters=0.0,
        clock_out_latitude=None,
        clock_out_longitude=None,
        clock_out_accuracy_meters=None,
        clock_out_distance_to_site_meters=None,
        break_seconds=0,
        worked_seconds=None,
    )


def _clock_in(
    *,
    effective_at: datetime | None,
    open_shift=None,
    overlapping=None,
    save_side_effect=None,
) -> tuple[object, MagicMock]:
    """Run manual_clock_in with every collaborator stubbed out."""
    actor = _actor()
    company_id = uuid.uuid4()
    employee = _employee(company_id)
    location = _location(company_id)
    audit = MagicMock()

    with (
        patch(f"{SERVICE}.get_user_by_id", return_value=employee),
        patch(f"{SERVICE}.assert_target_is_manageable_employee"),
        patch(f"{SERVICE}.get_location_by_id", return_value=location),
        patch(f"{SERVICE}.employee_has_location_access", return_value=True),
        patch(f"{SERVICE}.repo_get_open_shift", return_value=open_shift),
        patch(f"{SERVICE}.get_completed_shift_covering_instant", return_value=overlapping),
        patch(f"{SERVICE}.save_shift", side_effect=save_side_effect) as save,
        patch(f"{SERVICE}.create_internal_audit_event", audit),
    ):
        shift = manual_clock_in(
            MagicMock(),
            actor,
            user_id=employee.id,
            location_id=location.id,
            reason="Employee forgot to clock in",
            effective_at=effective_at,
        )
        assert save.called
    return shift, audit


def _clock_out(
    *,
    effective_at: datetime | None,
    clock_in_at: datetime,
    breaks: list | None = None,
    open_break=None,
) -> tuple[object, MagicMock]:
    """Run manual_clock_out with every collaborator stubbed out."""
    actor = _actor()
    company_id = uuid.uuid4()
    employee = _employee(company_id)
    shift = _open_shift(clock_in_at, company_id, employee.id)
    audit = MagicMock()

    with (
        patch(f"{SERVICE}.get_user_by_id", return_value=employee),
        patch(f"{SERVICE}.assert_target_is_manageable_employee"),
        patch(f"{SERVICE}.repo_get_open_shift", return_value=shift),
        patch(f"{SERVICE}.get_open_break_for_shift", return_value=open_break),
        patch(f"{SERVICE}.list_breaks_for_shift", return_value=breaks or []),
        patch(f"{SERVICE}.update_shift"),
        patch(f"{SERVICE}.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="Europe/London")),
        patch(f"{SERVICE}._payroll_week_start_for_instant", return_value=date(2026, 4, 6)),
        patch(f"{SERVICE}.mark_payroll_period_needs_recalculation"),
        patch(f"{SERVICE}.create_internal_audit_event", audit),
    ):
        result = manual_clock_out(
            MagicMock(),
            actor,
            user_id=employee.id,
            shift_id=None,
            reason="Employee forgot to clock out",
            effective_at=effective_at,
        )
    return result, audit


# --------------------------------------------------------------------------- #
# Normalisation: UTC conversion happens exactly once
# --------------------------------------------------------------------------- #


def test_naive_timestamp_is_treated_as_utc() -> None:
    value, source = _normalize_effective_at(datetime(2026, 4, 7, 8, 37))
    assert value == datetime(2026, 4, 7, 8, 37, tzinfo=timezone.utc)
    assert source == "admin_supplied"


def test_offset_timestamp_is_converted_to_utc_once() -> None:
    # 09:37 at +01:00 (British Summer Time) is 08:37 UTC.
    value, source = _normalize_effective_at(
        datetime(2026, 4, 7, 9, 37, tzinfo=timezone(timedelta(hours=1)))
    )
    assert value == datetime(2026, 4, 7, 8, 37, tzinfo=timezone.utc)
    assert value.utcoffset() == timedelta(0)
    assert source == "admin_supplied"

    # Re-normalising must be a fixed point: no second conversion.
    again, _ = _normalize_effective_at(value)
    assert again == value


def test_utc_timestamp_is_left_alone() -> None:
    original = datetime(2026, 4, 7, 8, 37, tzinfo=timezone.utc)
    value, source = _normalize_effective_at(original)
    assert value == original
    assert source == "admin_supplied"


def test_missing_timestamp_falls_back_to_server_now() -> None:
    before = datetime.now(timezone.utc)
    value, source = _normalize_effective_at(None)
    after = datetime.now(timezone.utc)
    assert before <= value <= after
    assert source == "server_now"


# --------------------------------------------------------------------------- #
# Forced clock-in
# --------------------------------------------------------------------------- #


def test_forced_clock_in_uses_the_explicit_timestamp() -> None:
    chosen = datetime(2026, 4, 7, 6, 42, tzinfo=timezone.utc)
    shift, _ = _clock_in(effective_at=chosen)

    assert shift.clock_in_at == chosen
    assert shift.status == "open"
    assert shift.clock_source == "manual_admin"


def test_forced_clock_in_preserves_date_and_minute_precision() -> None:
    chosen = datetime(2025, 11, 3, 17, 9, tzinfo=timezone.utc)
    shift, _ = _clock_in(effective_at=chosen)

    assert (shift.clock_in_at.year, shift.clock_in_at.month, shift.clock_in_at.day) == (2025, 11, 3)
    assert (shift.clock_in_at.hour, shift.clock_in_at.minute) == (17, 9)
    assert shift.clock_in_at.second == 0


def test_forced_clock_in_accepts_a_backdated_timestamp() -> None:
    chosen = datetime.now(timezone.utc) - timedelta(days=9)
    shift, _ = _clock_in(effective_at=chosen)
    assert shift.clock_in_at == chosen


def test_forced_clock_in_without_a_timestamp_still_stamps_now() -> None:
    before = datetime.now(timezone.utc)
    shift, _ = _clock_in(effective_at=None)
    after = datetime.now(timezone.utc)
    assert before <= shift.clock_in_at <= after


def test_forced_clock_in_rejects_a_time_inside_an_existing_shift() -> None:
    overlapping = SimpleNamespace(id=uuid.uuid4())
    with pytest.raises(LiveAttendanceError, match="falls inside an existing shift") as excinfo:
        _clock_in(effective_at=datetime(2026, 4, 7, 9, 0, tzinfo=timezone.utc), overlapping=overlapping)
    assert excinfo.value.http_status == 409


def test_forced_clock_in_rejects_a_second_open_shift() -> None:
    with pytest.raises(LiveAttendanceError, match="already has an open shift") as excinfo:
        _clock_in(effective_at=None, open_shift=SimpleNamespace(id=uuid.uuid4()))
    assert excinfo.value.http_status == 409


def test_forced_clock_in_reports_a_concurrent_write_as_a_conflict() -> None:
    error = IntegrityError("insert", {}, Exception("duplicate open shift"))
    with pytest.raises(LiveAttendanceError, match="changed while you were editing") as excinfo:
        _clock_in(effective_at=None, save_side_effect=error)
    assert excinfo.value.http_status == 409


def test_forced_clock_in_requires_a_reason() -> None:
    with pytest.raises(LiveAttendanceError, match="Reason is required"):
        manual_clock_in(
            MagicMock(),
            _actor(),
            user_id=uuid.uuid4(),
            location_id=uuid.uuid4(),
            reason="   ",
            effective_at=datetime.now(timezone.utc),
        )


def test_forced_clock_in_still_enforces_manageability() -> None:
    employee = _employee(uuid.uuid4())
    with (
        patch(f"{SERVICE}.get_user_by_id", return_value=employee),
        patch(
            f"{SERVICE}.assert_target_is_manageable_employee",
            side_effect=LiveAttendancePermissionError("You cannot manage this employee."),
        ),
        pytest.raises(LiveAttendancePermissionError),
    ):
        manual_clock_in(
            MagicMock(),
            _actor(),
            user_id=employee.id,
            location_id=uuid.uuid4(),
            reason="Correcting attendance",
            effective_at=datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc),
        )


def test_forced_clock_in_still_requires_site_access() -> None:
    company_id = uuid.uuid4()
    employee = _employee(company_id)
    with (
        patch(f"{SERVICE}.get_user_by_id", return_value=employee),
        patch(f"{SERVICE}.assert_target_is_manageable_employee"),
        patch(f"{SERVICE}.get_location_by_id", return_value=_location(company_id)),
        patch(f"{SERVICE}.employee_has_location_access", return_value=False),
        pytest.raises(LiveAttendanceError, match="not assigned to this location"),
    ):
        manual_clock_in(
            MagicMock(),
            _actor(),
            user_id=employee.id,
            location_id=uuid.uuid4(),
            reason="Correcting attendance",
            effective_at=datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc),
        )


# --------------------------------------------------------------------------- #
# Forced clock-out
# --------------------------------------------------------------------------- #


def test_forced_clock_out_uses_the_explicit_timestamp() -> None:
    clock_in_at = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)
    chosen = datetime(2026, 4, 7, 16, 30, tzinfo=timezone.utc)
    shift, _ = _clock_out(effective_at=chosen, clock_in_at=clock_in_at)

    assert shift.clock_out_at == chosen
    assert shift.status == "completed"
    assert shift.worked_seconds == int((chosen - clock_in_at).total_seconds())


def test_forced_clock_out_preserves_minute_precision() -> None:
    clock_in_at = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)
    chosen = datetime(2026, 4, 7, 16, 47, tzinfo=timezone.utc)
    shift, _ = _clock_out(effective_at=chosen, clock_in_at=clock_in_at)

    assert (shift.clock_out_at.hour, shift.clock_out_at.minute) == (16, 47)
    assert shift.worked_seconds == 8 * 3600 + 47 * 60


def test_forced_clock_out_supports_an_overnight_shift() -> None:
    clock_in_at = datetime(2026, 4, 7, 21, 30, tzinfo=timezone.utc)
    chosen = datetime(2026, 4, 8, 5, 45, tzinfo=timezone.utc)
    shift, _ = _clock_out(effective_at=chosen, clock_in_at=clock_in_at)

    assert shift.clock_out_at.date() > shift.clock_in_at.date()
    assert shift.worked_seconds == 8 * 3600 + 15 * 60


def test_forced_clock_out_deducts_recorded_breaks() -> None:
    clock_in_at = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)
    chosen = datetime(2026, 4, 7, 16, 0, tzinfo=timezone.utc)
    breaks = [
        SimpleNamespace(
            started_at=datetime(2026, 4, 7, 12, 0, tzinfo=timezone.utc),
            ended_at=datetime(2026, 4, 7, 12, 30, tzinfo=timezone.utc),
        )
    ]
    shift, _ = _clock_out(effective_at=chosen, clock_in_at=clock_in_at, breaks=breaks)

    assert shift.break_seconds == 1800
    assert shift.worked_seconds == 8 * 3600 - 1800


def test_forced_clock_out_rejects_a_time_before_clock_in() -> None:
    clock_in_at = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)
    with pytest.raises(LiveAttendanceError, match="must be after the clock-in time") as excinfo:
        _clock_out(effective_at=datetime(2026, 4, 7, 7, 59, tzinfo=timezone.utc), clock_in_at=clock_in_at)
    assert excinfo.value.http_status == 422


def test_forced_clock_out_rejects_a_time_equal_to_clock_in() -> None:
    clock_in_at = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)
    with pytest.raises(LiveAttendanceError, match="must be after the clock-in time"):
        _clock_out(effective_at=clock_in_at, clock_in_at=clock_in_at)


def test_forced_clock_out_never_records_a_negative_duration() -> None:
    clock_in_at = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)
    chosen = datetime(2026, 4, 7, 8, 10, tzinfo=timezone.utc)
    breaks = [
        SimpleNamespace(
            started_at=datetime(2026, 4, 7, 8, 1, tzinfo=timezone.utc),
            ended_at=datetime(2026, 4, 7, 8, 59, tzinfo=timezone.utc),
        )
    ]
    shift, _ = _clock_out(effective_at=chosen, clock_in_at=clock_in_at, breaks=breaks)
    assert shift.worked_seconds == 0


def test_forced_clock_out_without_a_timestamp_still_stamps_now() -> None:
    clock_in_at = datetime.now(timezone.utc) - timedelta(hours=3)
    before = datetime.now(timezone.utc)
    shift, _ = _clock_out(effective_at=None, clock_in_at=clock_in_at)
    after = datetime.now(timezone.utc)
    assert before <= shift.clock_out_at <= after


def test_forced_clock_out_is_blocked_while_a_break_is_open() -> None:
    clock_in_at = datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc)
    with pytest.raises(LiveAttendanceError, match="while a break is open"):
        _clock_out(
            effective_at=datetime(2026, 4, 7, 16, 0, tzinfo=timezone.utc),
            clock_in_at=clock_in_at,
            open_break=SimpleNamespace(id=uuid.uuid4(), started_at=clock_in_at),
        )


def test_forced_clock_out_requires_a_reason() -> None:
    with pytest.raises(LiveAttendanceError, match="Reason is required"):
        manual_clock_out(
            MagicMock(),
            _actor(),
            user_id=uuid.uuid4(),
            shift_id=None,
            reason="",
            effective_at=datetime.now(timezone.utc),
        )


def test_forced_clock_out_requires_exactly_one_target() -> None:
    with pytest.raises(LiveAttendanceError, match="exactly one of user_id or shift_id"):
        manual_clock_out(
            MagicMock(),
            _actor(),
            user_id=uuid.uuid4(),
            shift_id=uuid.uuid4(),
            reason="Correcting attendance",
            effective_at=None,
        )


# --------------------------------------------------------------------------- #
# Read-back
# --------------------------------------------------------------------------- #


def test_saved_clock_in_reads_back_unchanged() -> None:
    chosen = datetime(2026, 2, 14, 5, 3, tzinfo=timezone.utc)
    shift, _ = _clock_in(effective_at=chosen)
    # The router serialises straight off the persisted shift.
    assert shift.clock_in_at.isoformat() == chosen.isoformat()


def test_saved_clock_out_reads_back_unchanged() -> None:
    chosen = datetime(2026, 2, 14, 19, 3, tzinfo=timezone.utc)
    shift, _ = _clock_out(effective_at=chosen, clock_in_at=datetime(2026, 2, 14, 8, 0, tzinfo=timezone.utc))
    assert shift.clock_out_at.isoformat() == chosen.isoformat()


# --------------------------------------------------------------------------- #
# Audit trail
# --------------------------------------------------------------------------- #


def _details(audit: MagicMock) -> dict:
    assert audit.call_count == 1
    return audit.call_args.kwargs["details"]


def test_clock_in_audit_separates_effective_time_from_action_time() -> None:
    chosen = datetime(2026, 4, 7, 6, 42, tzinfo=timezone.utc)
    _, audit = _clock_in(effective_at=chosen)
    details = _details(audit)

    assert details["effective_at"] == chosen.isoformat()
    assert details["effective_time_source"] == "admin_supplied"
    assert details["action_recorded_at"] != details["effective_at"]
    assert datetime.fromisoformat(details["action_recorded_at"]) > chosen


def test_clock_in_audit_records_actor_subject_and_context() -> None:
    _, audit = _clock_in(effective_at=datetime(2026, 4, 7, 6, 42, tzinfo=timezone.utc))
    details = _details(audit)

    assert audit.call_args.kwargs["action"] == "live_attendance.manual_clock_in"
    assert audit.call_args.kwargs["entity_type"] == "time_shift"
    for key in ("actor_user_id", "subject_user_id", "location_id", "company_id", "reason", "shift_id"):
        assert details[key], f"{key} missing from audit details"
    assert details["before_clock_in_at"] is None
    assert details["after_clock_in_at"] == details["effective_at"]


def test_clock_in_audit_flags_a_server_stamped_time() -> None:
    _, audit = _clock_in(effective_at=None)
    assert _details(audit)["effective_time_source"] == "server_now"


def test_clock_out_audit_separates_effective_time_from_action_time() -> None:
    chosen = datetime(2026, 4, 7, 16, 30, tzinfo=timezone.utc)
    _, audit = _clock_out(effective_at=chosen, clock_in_at=datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc))
    details = _details(audit)

    assert details["effective_at"] == chosen.isoformat()
    assert details["effective_time_source"] == "admin_supplied"
    assert datetime.fromisoformat(details["action_recorded_at"]) > chosen


def test_clock_out_audit_records_the_previous_and_new_value() -> None:
    chosen = datetime(2026, 4, 7, 16, 30, tzinfo=timezone.utc)
    _, audit = _clock_out(effective_at=chosen, clock_in_at=datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc))
    details = _details(audit)

    assert details["before_clock_out_at"] is None
    assert details["after_clock_out_at"] == chosen.isoformat()
    assert details["before_status"] == "open"
    assert details["after_status"] == "completed"
    assert details["clock_in_at"] == datetime(2026, 4, 7, 8, 0, tzinfo=timezone.utc).isoformat()
    assert details["reason"]


# --------------------------------------------------------------------------- #
# Contract and HTTP mapping
# --------------------------------------------------------------------------- #


def test_request_schemas_accept_an_optional_effective_at() -> None:
    from app.modules.live_attendance.schemas import ManualClockInRequest, ManualClockOutRequest

    user_id = uuid.uuid4()
    payload_in = ManualClockInRequest(
        user_id=user_id,
        location_id=uuid.uuid4(),
        reason="Forgot to clock in",
        effective_at="2026-04-07T08:37:00Z",
    )
    assert payload_in.effective_at == datetime(2026, 4, 7, 8, 37, tzinfo=timezone.utc)

    # Omission stays valid so existing clients keep the default-now behaviour.
    assert (
        ManualClockInRequest(
            user_id=user_id, location_id=uuid.uuid4(), reason="Forgot to clock in"
        ).effective_at
        is None
    )
    assert (
        ManualClockOutRequest(user_id=user_id, reason="Forgot to clock out").effective_at is None
    )


def test_request_schema_rejects_an_unparseable_timestamp() -> None:
    from pydantic import ValidationError

    from app.modules.live_attendance.schemas import ManualClockInRequest

    with pytest.raises(ValidationError):
        ManualClockInRequest(
            user_id=uuid.uuid4(),
            location_id=uuid.uuid4(),
            reason="Forgot to clock in",
            effective_at="not-a-timestamp",
        )


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (LiveAttendanceError("bad request"), 400),
        (LiveAttendanceError("out before in", http_status=422), 422),
        (LiveAttendanceError("conflict", http_status=409), 409),
        (LiveAttendancePermissionError("forbidden"), 403),
    ],
)
def test_router_maps_errors_to_the_project_detail_format(error: Exception, expected_status: int) -> None:
    from app.modules.live_attendance.router import _handle_live_exc

    mapped = _handle_live_exc(error)
    assert mapped.status_code == expected_status
    assert mapped.detail == str(error)
