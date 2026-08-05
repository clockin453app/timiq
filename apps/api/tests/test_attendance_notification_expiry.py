"""Attendance notification expiry filtering and cleanup."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.modules.attendance_notifications.service import (
    cleanup_expired_attendance_notifications,
    run_attendance_notification_check_once,
)
from app.modules.notifications.repository import (
    ATTENDANCE_EXPIRABLE_KINDS,
    _attendance_work_date_from_dedupe_key,
    resolve_attendance_work_date,
)
from app.modules.notifications.service import _attendance_record_is_expired


def test_attendance_kinds_covered_for_expiry() -> None:
    assert "attendance_missing_clock_in" in ATTENDANCE_EXPIRABLE_KINDS
    assert "attendance_late_arrival" in ATTENDANCE_EXPIRABLE_KINDS
    assert "attendance_forgot_clock_in" in ATTENDANCE_EXPIRABLE_KINDS
    assert "attendance_forgot_clock_out" in ATTENDANCE_EXPIRABLE_KINDS
    assert "message_received" not in ATTENDANCE_EXPIRABLE_KINDS
    assert "payroll_pending" not in ATTENDANCE_EXPIRABLE_KINDS


def test_work_date_from_dedupe_key() -> None:
    company_id = uuid.uuid4()
    employee_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    key = f"attendance:missing_clock_in:{company_id}:{employee_id}:2026-08-05:{recipient_id}"
    assert _attendance_work_date_from_dedupe_key(key) == date(2026, 8, 5)


def test_expired_attendance_hidden_from_summary_filter() -> None:
    record = SimpleNamespace(
        kind="attendance_missing_clock_in",
        company_id=uuid.uuid4(),
        work_date=date(2026, 8, 4),
        dedupe_key="attendance:missing_clock_in:x",
    )
    cache: dict = {}
    with patch(
        "app.modules.notifications.service._company_local_today",
        return_value=date(2026, 8, 5),
    ):
        assert _attendance_record_is_expired(
            MagicMock(),
            record,
            now_utc=datetime(2026, 8, 5, 1, 0, tzinfo=timezone.utc),
            local_today_cache=cache,
        )


def test_current_day_attendance_not_expired() -> None:
    record = SimpleNamespace(
        kind="attendance_missing_clock_in",
        company_id=uuid.uuid4(),
        work_date=date(2026, 8, 5),
        dedupe_key="attendance:missing_clock_in:x",
    )
    cache: dict = {}
    with patch(
        "app.modules.notifications.service._company_local_today",
        return_value=date(2026, 8, 5),
    ):
        assert not _attendance_record_is_expired(
            MagicMock(),
            record,
            now_utc=datetime(2026, 8, 5, 23, 0, tzinfo=timezone.utc),
            local_today_cache=cache,
        )


def test_message_records_not_treated_as_attendance_expiry() -> None:
    record = SimpleNamespace(
        kind="message_received",
        company_id=uuid.uuid4(),
        work_date=date(2026, 8, 1),
        dedupe_key="message:x",
    )
    assert not _attendance_record_is_expired(
        MagicMock(),
        record,
        now_utc=datetime(2026, 8, 5, tzinfo=timezone.utc),
        local_today_cache={},
    )


def test_cleanup_dry_run_reports_aggregates_without_delete() -> None:
    company_id = uuid.uuid4()
    expired = SimpleNamespace(
        id=uuid.uuid4(),
        kind="attendance_missing_clock_in",
        company_id=company_id,
        work_date=date(2026, 8, 4),
        seen_at=None,
        dedupe_key=f"attendance:missing_clock_in:{company_id}:e:2026-08-04:r",
        created_at=datetime(2026, 8, 4, 10, 0, tzinfo=timezone.utc),
    )
    current = SimpleNamespace(
        id=uuid.uuid4(),
        kind="attendance_missing_clock_in",
        company_id=company_id,
        work_date=date(2026, 8, 5),
        seen_at=None,
        dedupe_key=f"attendance:missing_clock_in:{company_id}:e:2026-08-05:r",
        created_at=datetime(2026, 8, 5, 10, 0, tzinfo=timezone.utc),
    )

    db = MagicMock()
    db.scalars.return_value = SimpleNamespace(all=lambda: [expired, current])

    from app.modules.notifications.repository import delete_expired_attendance_notification_records

    result = delete_expired_attendance_notification_records(
        db,
        company_id=company_id,
        local_today=date(2026, 8, 5),
        dry_run=True,
    )

    assert result.matched == 1
    assert result.deleted == 0
    assert result.aggregates is not None
    assert result.aggregates[0].kind == "attendance_missing_clock_in"
    assert result.aggregates[0].count == 1
    assert resolve_attendance_work_date(expired) == date(2026, 8, 4)


def test_cleanup_delete_is_idempotent_when_nothing_left() -> None:
    company_id = uuid.uuid4()
    db = MagicMock()
    db.scalars.return_value = SimpleNamespace(all=lambda: [])
    from app.modules.notifications.repository import delete_expired_attendance_notification_records

    first = delete_expired_attendance_notification_records(
        db,
        company_id=company_id,
        local_today=date(2026, 8, 5),
        dry_run=False,
    )
    second = delete_expired_attendance_notification_records(
        db,
        company_id=company_id,
        local_today=date(2026, 8, 5),
        dry_run=False,
    )
    assert first.deleted == 0
    assert second.deleted == 0


def test_run_once_includes_cleanup_counts() -> None:
    company_id = uuid.uuid4()
    settings = SimpleNamespace(
        company_id=company_id,
        late_arrival_enabled=False,
        forgot_clock_in_enabled=False,
        forgot_clock_out_enabled=False,
        active_weekdays=[0, 1, 2, 3, 4],
    )
    with (
        patch("app.modules.attendance_notifications.service.list_active_enabled_settings", return_value=[settings]),
        patch("app.modules.attendance_notifications.service._check_late_and_forgot_in"),
        patch("app.modules.attendance_notifications.service._check_forgot_clock_out"),
        patch(
            "app.modules.attendance_notifications.service.cleanup_expired_attendance_notifications",
            return_value=SimpleNamespace(
                matched=3,
                deleted=3,
                aggregates=[
                    SimpleNamespace(
                        kind="attendance_missing_clock_in",
                        work_date=date(2026, 8, 4),
                        company_id=company_id,
                        seen=False,
                        count=3,
                    )
                ],
            ),
        ),
    ):
        result = run_attendance_notification_check_once(
            MagicMock(),
            now_utc=datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc),
            dry_run=False,
        )
    assert result.expired_matched == 3
    assert result.expired_deleted == 3
    assert result.expiry_aggregates is not None
    assert result.expiry_aggregates[0]["count"] == 3


def test_london_midnight_boundary_expires_previous_local_day() -> None:
    """5 Aug work_date expires after London midnight into 6 Aug."""
    record = SimpleNamespace(
        kind="attendance_forgot_clock_out",
        company_id=uuid.uuid4(),
        work_date=date(2026, 8, 5),
        dedupe_key="x",
    )
    cache: dict = {}
    # 2026-08-05 23:30 London = still 5 Aug
    with patch(
        "app.modules.notifications.service._company_local_today",
        return_value=date(2026, 8, 5),
    ):
        assert not _attendance_record_is_expired(
            MagicMock(),
            record,
            now_utc=datetime(2026, 8, 5, 22, 30, tzinfo=timezone.utc),
            local_today_cache=cache,
        )
    cache.clear()
    with patch(
        "app.modules.notifications.service._company_local_today",
        return_value=date(2026, 8, 6),
    ):
        assert _attendance_record_is_expired(
            MagicMock(),
            record,
            now_utc=datetime(2026, 8, 5, 23, 30, tzinfo=timezone.utc),
            local_today_cache=cache,
        )
