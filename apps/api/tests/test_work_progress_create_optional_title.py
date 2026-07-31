"""Backend coverage for optional title on Site Progress create."""

from datetime import date
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.work_progress.schemas import WorkProgressCreateRequest


def test_create_request_requires_work_date_and_location():
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(location_id=uuid4(), progress_status="in_progress")
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(work_date=date(2026, 7, 31), progress_status="in_progress")


def test_create_request_accepts_empty_optional_title_and_notes():
    body = WorkProgressCreateRequest(
        work_date=date(2026, 7, 31),
        location_id=uuid4(),
        title="",
        progress_status="in_progress",
        notes=None,
        percent_complete=None,
    )
    assert body.title == ""
    assert body.notes is None
    assert body.percent_complete is None


def test_create_request_rejects_percent_out_of_range():
    with pytest.raises(ValidationError):
        WorkProgressCreateRequest(
            work_date=date(2026, 7, 31),
            location_id=uuid4(),
            progress_status="in_progress",
            percent_complete=140,
        )


def test_create_request_title_defaults_to_empty_when_omitted():
    body = WorkProgressCreateRequest(
        work_date=date(2026, 7, 31),
        location_id=uuid4(),
        progress_status="in_progress",
    )
    assert body.title == ""
